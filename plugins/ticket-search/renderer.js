// Ticket Search plugin — main window renderer
//
// Adds a 🔎 Search tab to the side panel: type a ticket number, words from the
// subject, or a requester's name or email, and the matching tickets are listed
// as you type. Click one to open it. The search is done by the site plugin
// (its ticketSearch adapter part; Freshservice searches through its REST API),
// so this plugin knows nothing about any particular site.
//
// Other plugins (a command palette, say) can open the tab with a term already
// filled in: pluginAPI.events.emit("ticket-search:open", { term: "printer" }).
// For results of their own they can call a site's ticketSearch.search(term)
// directly (see docs/sites.md).
//
// The command palette (Ctrl+K) searches too: what's typed there is looked up
// the same way, and the tickets found are listed under "Ticket Search".
//
// The pure helpers at the top are exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  const TAB_ID = "ticket-search";
  const DEBOUNCE_MS = 450;
  const MIN_CHARS = 2;
  const MAX_TERM = 100;

  // ==================== Pure helpers ====================

  // Whether a term is worth searching while typing: a ticket number of any
  // length, or two characters or more of anything else.
  function shouldSearch(term) {
    const t = String(term || "").trim();
    if (!t || t.length > MAX_TERM) return false;
    return /^#?\d+$/.test(t) || t.length >= MIN_CHARS;
  }

  // "2026-11-12T10:00:00Z" → "3h ago" (or a date once it's over a week old).
  function relativeTime(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.round(((now || Date.now()) - t) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 7 * 86400) return Math.floor(s / 86400) + "d ago";
    return new Date(t).toLocaleDateString();
  }

  // The grey line under a result: requester · status · priority · updated.
  function metaLine(ticket, now) {
    const parts = [];
    if (ticket.requester) parts.push(ticket.requester);
    if (ticket.status) parts.push(ticket.status);
    if (ticket.priority) parts.push(ticket.priority);
    const when = relativeTime(ticket.updatedAt, now);
    if (when) parts.push("updated " + when);
    return parts.join(" · ");
  }

  // Which site to search: the active tab's, when it can search, else the one
  // chosen last, else the first that can.
  function pickSite(sites, activeId, preferredId) {
    const able = (sites || []).filter(function (s) { return s && s.ticketSearch; });
    return able.find(function (s) { return s.id === activeId; }) ||
      able.find(function (s) { return s.id === preferredId; }) ||
      able[0] || null;
  }

  // A found ticket as a command palette entry (without run). The term is a
  // keyword so the palette keeps tickets matched on requester or email,
  // whose title doesn't hold what was typed.
  function paletteEntry(ticket, term, index, now) {
    const label = String(ticket.label || "").trim();
    const subject = String(ticket.subject || "").trim() || "(no subject)";
    const keywords = [String(term || "").trim(), label, ticket.requester, ticket.requesterEmail]
      .filter(function (k) { return typeof k === "string" && k !== ""; });
    return {
      id: "t" + index,
      title: label ? label + "  " + subject : subject,
      subtitle: metaLine(ticket, now),
      keywords: keywords,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { shouldSearch, relativeTime, metaLine, pickSite, paletteEntry };
    return;
  }
  if (typeof window === "undefined" || !window.pluginAPI) return;

  // ===================== State =====================

  const api = window.pluginAPI;
  if (!api.ui || typeof api.ui.addSidePanelTab !== "function") return;

  let settings = api.getSettings();
  let chosenSiteId = null; // set when the user picks a site in the drop-down
  let results = [];        // what's listed now
  let resultsFor = "";     // the term (and site) those results are for
  let highlight = -1;
  let seq = 0;             // drops answers to searches that were overtaken
  let debounce = null;

  api.events.on("settings:changed", function (s) { settings = s; });

  // ===================== UI =====================

  const tab = api.ui.addSidePanelTab({ id: TAB_ID, label: "Search", icon: "🔎", title: "Search tickets", order: 15 });
  const panel = tab.element;
  panel.classList.add("ts-panel");
  panel.innerHTML =
    '<div class="ts-header">' +
    '  <input type="search" id="ts-input" class="ts-input" spellcheck="false" autocomplete="off" maxlength="' + MAX_TERM + '" />' +
    '  <select id="ts-site" class="ts-site" title="Site to search" hidden></select>' +
    "</div>" +
    '<div id="ts-list" class="ts-list" role="listbox" aria-label="Tickets found"></div>' +
    '<div id="ts-status" class="ts-status" aria-live="polite"></div>';

  const elInput = panel.querySelector("#ts-input");
  const elSite = panel.querySelector("#ts-site");
  const elList = panel.querySelector("#ts-list");
  const elStatus = panel.querySelector("#ts-status");

  function searchableSites() {
    return api.sites.list().filter(function (s) { return s.ticketSearch; });
  }

  function currentSite() {
    const active = api.sites.forActiveTab();
    return pickSite(api.sites.list(), chosenSiteId ? null : active && active.site.id, chosenSiteId);
  }

  function refreshSitePicker() {
    const sites = searchableSites();
    const site = currentSite();
    elSite.hidden = sites.length < 2;
    elSite.innerHTML = "";
    sites.forEach(function (s) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.shortName || s.name;
      elSite.appendChild(o);
    });
    if (site) elSite.value = site.id;
    elInput.placeholder = site ? site.ticketSearch.placeholder : "Search tickets";
    elInput.disabled = !site;
    if (!site) {
      renderMessage("No installed site can search tickets yet. Turn on a site plugin that can (such as Freshservice) under Settings → Plugins.", "openSettings");
    }
  }

  function openSettings() {
    if (window.backupAPI && typeof window.backupAPI.openSettingsWindow === "function") {
      window.backupAPI.openSettingsWindow();
    }
  }

  function setStatus(text, kind) {
    elStatus.textContent = text || "";
    elStatus.className = "ts-status" + (kind ? " ts-status-" + kind : "");
  }

  function renderMessage(text, action) {
    results = [];
    highlight = -1;
    elList.innerHTML = "";
    const box = document.createElement("div");
    box.className = "ts-empty";
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(p);
    if (action === "openSettings") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-small btn-secondary";
      btn.textContent = "Open Settings";
      btn.addEventListener("click", openSettings);
      box.appendChild(btn);
    }
    elList.appendChild(box);
  }

  function renderHint() {
    renderMessage("Type a ticket number, words from the subject, or a requester's name or email. " +
      "Press Enter to open the first match, or use the arrow keys.");
    setStatus("");
  }

  function renderResults(list) {
    results = list;
    elList.innerHTML = "";
    const now = Date.now();
    list.forEach(function (t, i) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ts-item";
      item.setAttribute("role", "option");
      item.dataset.index = String(i);
      item.title = (t.subject || t.label) + (t.requesterEmail ? "\n" + t.requesterEmail : "") +
        "\n\nClick to open" + (openInNewTab() ? " in a new tab" : "") + ". Ctrl+click opens it in a background tab.";

      const top = document.createElement("span");
      top.className = "ts-item-top";
      const num = document.createElement("span");
      num.className = "ts-item-num";
      num.textContent = t.label;
      const subj = document.createElement("span");
      subj.className = "ts-item-subject";
      subj.textContent = t.subject || "(no subject)";
      top.appendChild(num);
      top.appendChild(subj);

      const meta = document.createElement("span");
      meta.className = "ts-item-meta";
      meta.textContent = metaLine(t, now);

      item.appendChild(top);
      item.appendChild(meta);
      if (t.matches && t.matches.length) {
        const tags = document.createElement("span");
        tags.className = "ts-item-tags";
        t.matches.forEach(function (m) {
          const tag = document.createElement("span");
          tag.className = "ts-tag";
          tag.textContent = m;
          tags.appendChild(tag);
        });
        item.appendChild(tags);
      }

      item.addEventListener("click", function (e) {
        openResult(t, e.ctrlKey || e.metaKey ? "background" : null);
      });
      item.addEventListener("auxclick", function (e) {
        if (e.button === 1) { e.preventDefault(); openResult(t, "background"); }
      });
      elList.appendChild(item);
    });
    highlight = list.length ? 0 : -1;
    applyHighlight();
  }

  function applyHighlight() {
    const items = elList.querySelectorAll(".ts-item");
    items.forEach(function (el, i) {
      const on = i === highlight;
      el.classList.toggle("ts-item-active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  }

  function openInNewTab() { return settings.ticketSearchOpenIn !== "current"; }

  // how: null (the setting), or "background" (a new tab, not switched to).
  function openResult(ticket, how) {
    if (!ticket || !/^https?:\/\//i.test(ticket.url || "")) return;
    if (how === "background") api.browser.newTab(ticket.url, { activate: false });
    else if (openInNewTab()) api.browser.newTab(ticket.url);
    else api.browser.navigate(ticket.url);
  }

  // ===================== Searching =====================

  function searchKey(site, term) { return (site ? site.id : "") + "\u0000" + term; }

  async function runSearch(force) {
    clearTimeout(debounce);
    const term = elInput.value.trim();
    const site = currentSite();
    if (!site) return;
    if (!term) { seq++; resultsFor = ""; renderHint(); return; }
    if (!force && !shouldSearch(term)) return;
    if (term.length > MAX_TERM) { setStatus("Search for " + MAX_TERM + " characters or fewer.", "error"); return; }
    const key = searchKey(site, term);
    if (key === resultsFor) return;
    const mine = ++seq;
    setStatus("Searching " + (site.shortName || site.name) + "…", "busy");
    let res;
    try {
      res = await site.ticketSearch.search(term, { days: Number(settings.ticketSearchDays) || 30 });
    } catch (err) {
      res = { error: (err && err.message) || String(err) };
    }
    if (mine !== seq) return;
    if (!res || res.error) {
      resultsFor = "";
      renderMessage((res && res.error) || "The search failed.", res && res.skipped ? "openSettings" : null);
      setStatus("");
      return;
    }
    resultsFor = key;
    const list = Array.isArray(res.tickets) ? res.tickets : [];
    if (list.length) renderResults(list);
    else renderMessage("No tickets match “" + term + "”.");
    const notes = [];
    if (list.length) notes.push(list.length + (list.length === 1 ? " ticket" : " tickets") + ".");
    if (res.note) notes.push(res.note);
    (res.warnings || []).forEach(function (w) { notes.push(w); });
    setStatus(notes.join(" "), res.warnings && res.warnings.length ? "error" : "");
  }

  elInput.addEventListener("input", function () {
    clearTimeout(debounce);
    if (!elInput.value.trim()) { runSearch(); return; }
    debounce = setTimeout(function () { runSearch(false); }, DEBOUNCE_MS);
  });

  elInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      highlight = (highlight + step + results.length) % results.length;
      applyHighlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const term = elInput.value.trim();
      // Enter opens the highlighted result once the list is for what's typed.
      if (results.length && searchKey(currentSite(), term) === resultsFor && highlight >= 0) {
        openResult(results[highlight], e.ctrlKey || e.metaKey ? "background" : null);
      } else {
        runSearch(true);
      }
    } else if (e.key === "Escape" && elInput.value) {
      e.preventDefault();
      elInput.value = "";
      runSearch();
    }
  });

  elSite.addEventListener("change", function () {
    chosenSiteId = elSite.value;
    refreshSitePicker();
    resultsFor = "";
    runSearch(true);
  });

  tab.onShow(function () {
    refreshSitePicker();
    setTimeout(function () { elInput.focus(); elInput.select(); }, 0);
  });

  api.sites.onRegistered(function () { refreshSitePicker(); });
  api.events.on("tab:activated", function () { if (tab.isActive() && !chosenSiteId) refreshSitePicker(); });

  // Other plugins (e.g. a command palette) can open the tab with a term.
  api.events.on("ticket-search:open", function (data) {
    tab.activate();
    refreshSitePicker();
    const term = data && typeof data.term === "string" ? data.term.substring(0, MAX_TERM) : "";
    if (term) {
      elInput.value = term;
      resultsFor = "";
      runSearch(true);
    }
    setTimeout(function () { elInput.focus(); }, 0);
  });

  // ===================== Command palette (Ctrl+K) =====================
  // Two providers: one answers straight away with "Search tickets for …"
  // (opens this tab), the other searches the site once typing pauses and adds
  // the tickets it finds. Enter opens a ticket the way this plugin's setting
  // says; Ctrl+Enter always opens a new tab.

  const PALETTE_DEBOUNCE_MS = 350;
  const PALETTE_MAX = 15;
  const PALETTE_CACHE_MS = 60000;
  const paletteCache = new Map(); // site + term → { at, tickets }
  let paletteSeq = 0;

  async function paletteSearch(site, term) {
    const key = searchKey(site, term) + "\u0000" + (Number(settings.ticketSearchDays) || 30);
    const hit = paletteCache.get(key);
    if (hit && Date.now() - hit.at < PALETTE_CACHE_MS) return hit.tickets;
    let res;
    try {
      res = await site.ticketSearch.search(term, { days: Number(settings.ticketSearchDays) || 30 });
    } catch (err) {
      console.error("[Ticket Search] palette search:", err);
      return [];
    }
    if (!res || res.error || !Array.isArray(res.tickets)) return [];
    const tickets = res.tickets.filter(function (t) { return t && /^https?:\/\//i.test(t.url || ""); });
    paletteCache.set(key, { at: Date.now(), tickets: tickets });
    if (paletteCache.size > 20) paletteCache.delete(paletteCache.keys().next().value);
    return tickets;
  }

  if (api.commands && typeof api.commands.addProvider === "function") {
    api.commands.addProvider({
      id: "ticket-search-open",
      group: "Ticket Search",
      items: function (query) {
        const term = String(query || "").trim();
        if (!shouldSearch(term) || !currentSite()) return [];
        return [{
          id: "open-tab",
          title: "Search tickets for \u201c" + term + "\u201d",
          subtitle: "Opens the Search tab in the side panel",
          keywords: [term],
          run: function () { api.events.emit("ticket-search:open", { term: term }); },
        }];
      },
    });

    api.commands.addProvider({
      id: "ticket-search",
      group: "Ticket Search",
      timeout: 12000, // the first subject search lists recent tickets, which can take a while
      items: function (query) {
        const term = String(query || "").trim();
        const mine = ++paletteSeq;
        const site = currentSite();
        if (!site || !shouldSearch(term)) return [];
        return new Promise(function (resolve) { setTimeout(resolve, PALETTE_DEBOUNCE_MS); })
          .then(function () {
            if (mine !== paletteSeq) return [];
            return paletteSearch(site, term);
          })
          .then(function (tickets) {
            if (mine !== paletteSeq) return [];
            const now = Date.now();
            return tickets.slice(0, PALETTE_MAX).map(function (t, i) {
              return Object.assign(paletteEntry(t, term, i, now), {
                run: function () { openResult(t, null); },
                runInNewTab: function () { api.browser.newTab(t.url); },
              });
            });
          });
      },
    });
  }

  refreshSitePicker();
  if (currentSite()) renderHint();
}());
