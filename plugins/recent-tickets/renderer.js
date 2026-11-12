// Recent Tickets plugin — main window renderer
//
// Adds a 🕘 Recent tab to the side panel listing the tickets you've viewed
// lately, newest first, grouped by day. A ticket is "viewed" when it shows in
// the active tab: the site plugin that claims the tab (pluginAPI.sites, its
// recordScript) says which record it is, so it works on Freshservice,
// ConnectWise Manage and any other site with an adapter.
//
// Clicking an entry switches to a tab already showing that ticket, or opens it
// in a new tab. Ctrl/Cmd-click or middle-click always opens a new tab.
// Pinned entries stay at the top and are never dropped from the list.
// Resting the mouse on an entry shows a preview card with its status,
// requester and latest reply when the site can (pluginAPI.ui.attachTicketPreview).
//
// The list is saved by main.js (recent.json). The pure helpers at the top are
// exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  const PLUGIN_ID = "recent-tickets";
  const HARD_MAX = 200;
  const DEFAULT_MAX = 50;

  // ==================== Pure helpers ====================

  function entryKey(e) {
    return (e && e.siteId ? e.siteId : "") + "|" + (e && e.key ? e.key : "");
  }

  function sameRecord(a, b) {
    return !!(a && b && a.siteId === b.siteId && a.key === b.key);
  }

  // Keeps every pinned entry, then the newest unpinned ones up to max in all.
  // Order is kept as is (newest first).
  function pruneEntries(entries, max) {
    const limit = Number.isInteger(max) && max > 0 ? Math.min(max, HARD_MAX) : DEFAULT_MAX;
    const pinnedCount = entries.filter(function (e) { return e.pinned; }).length;
    let room = Math.max(0, limit - pinnedCount);
    return entries.filter(function (e) {
      if (e.pinned) return true;
      if (room > 0) { room--; return true; }
      return false;
    }).slice(0, HARD_MAX);
  }

  // Puts rec at the top of the list (or moves it there), counting the view.
  // Returns a new array; the entry objects for other records are untouched.
  function recordVisit(entries, rec, now, max) {
    const at = new Date(now).toISOString();
    const old = entries.find(function (e) { return sameRecord(e, rec); });
    const entry = {
      siteId: rec.siteId,
      siteName: rec.siteName || (old && old.siteName) || "",
      key: rec.key,
      kind: rec.kind || (old && old.kind) || "",
      label: rec.label || (old && old.label) || rec.key,
      title: rec.title || (old && old.title) || "",
      url: rec.url || (old && old.url) || "",
      viewedAt: at,
      views: (old && old.views ? old.views : 0) + 1,
      pinned: !!(old && old.pinned),
    };
    const rest = entries.filter(function (e) { return !sameRecord(e, rec); });
    return pruneEntries([entry].concat(rest), max);
  }

  // Updates the title and link of an entry already in the list (the subject
  // often loads after the URL). Returns true when something changed.
  function refreshEntry(entries, rec) {
    const e = entries.find(function (x) { return sameRecord(x, rec); });
    if (!e) return false;
    let changed = false;
    if (rec.title && e.title !== rec.title) { e.title = rec.title; changed = true; }
    if (rec.url && e.url !== rec.url) { e.url = rec.url; changed = true; }
    if (rec.label && e.label !== rec.label) { e.label = rec.label; changed = true; }
    return changed;
  }

  function matchesFilter(e, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    const hay = [e.label, e.key, e.title, e.siteName].join(" ").toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function startOfDay(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // Splits the list into Pinned, Today, Yesterday, This week and Older,
  // leaving out empty groups. Pinned entries only show under Pinned.
  function groupEntries(entries, now) {
    const today = startOfDay(now);
    const yesterday = today - 86400000;
    const week = today - 6 * 86400000;
    const groups = [
      { id: "pinned", label: "Pinned", items: [] },
      { id: "today", label: "Today", items: [] },
      { id: "yesterday", label: "Yesterday", items: [] },
      { id: "week", label: "Earlier this week", items: [] },
      { id: "older", label: "Older", items: [] },
    ];
    entries.forEach(function (e) {
      if (e.pinned) { groups[0].items.push(e); return; }
      const t = Date.parse(e.viewedAt) || 0;
      if (t >= today) groups[1].items.push(e);
      else if (t >= yesterday) groups[2].items.push(e);
      else if (t >= week) groups[3].items.push(e);
      else groups[4].items.push(e);
    });
    return groups.filter(function (g) { return g.items.length; });
  }

  // "just now", "5 min ago", "3 h ago", else a short date and time.
  function timeAgo(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 12 * 3600) return Math.floor(s / 3600) + " h ago";
    return new Date(t).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  }

  function entryName(e) {
    return (e.siteName ? e.siteName + " · " : "") + (e.label || e.key);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      entryKey, sameRecord, pruneEntries, recordVisit, refreshEntry, matchesFilter,
      groupEntries, timeAgo, entryName, HARD_MAX, DEFAULT_MAX,
    };
    return;
  }
  if (typeof window === "undefined" || !window.pluginAPI) return;

  // ===================== State =====================

  const api = window.pluginAPI;
  if (!api.ui || typeof api.ui.addSidePanelTab !== "function") return;

  let settings = api.getSettings();
  let entries = [];       // newest first
  let loaded = false;
  let current = null;     // the record open in the active tab, or null
  let filter = "";

  function maxEntries() { return Number(settings.recentTicketsMax) || DEFAULT_MAX; }
  function reuseTab() { return settings.recentTicketsReuseTab !== false; }

  api.events.on("settings:changed", function (s) {
    const before = maxEntries();
    settings = s;
    if (maxEntries() !== before) {
      entries = pruneEntries(entries, maxEntries());
      scheduleSave();
    }
    render();
  });

  // ===================== Saving =====================

  let saveTimer = null;
  function scheduleSave() {
    if (!loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      api.invoke(PLUGIN_ID, "save", { entries: entries }).catch(function (err) {
        console.error("[Recent Tickets] save:", err);
      });
    }, 500);
  }

  window.addEventListener("beforeunload", function () {
    if (!loaded || !saveTimer) return;
    clearTimeout(saveTimer);
    try { api.send(PLUGIN_ID, "save-sync", { entries: entries }); } catch { /* closing anyway */ }
  });

  // ===================== Finding the open ticket =====================

  function cleanLink(site, url) {
    if (site && typeof site.recordLink === "function") {
      try { return site.recordLink(url) || url; } catch { /* keep the page URL */ }
    }
    return url;
  }

  async function recordInWebview(webview) {
    if (!webview) return null;
    const site = api.sites.forWebview(webview);
    if (!site || !site.recordScript) return null;
    let rec;
    try { rec = await webview.executeJavaScript(site.recordScript); } catch { return null; }
    if (!rec || !rec.ticket) return null;
    let url = "";
    let title = "";
    try { url = webview.getURL(); } catch { /* tab gone */ }
    try { title = webview.getTitle() || ""; } catch { /* tab gone */ }
    if (typeof site.formatTitle === "function") {
      try { title = site.formatTitle(title); } catch { /* keep the raw title */ }
    }
    const link = cleanLink(site, url);
    if (!/^https?:\/\//i.test(link)) return null;
    return {
      siteId: site.id,
      siteName: site.shortName || site.name,
      key: String(rec.ticket).substring(0, 100),
      kind: typeof rec.kind === "string" ? rec.kind : "",
      label: String(rec.label || rec.ticket).substring(0, 300),
      // A title that's just the URL or the site name says nothing.
      title: title && title !== url ? String(title).substring(0, 300) : "",
      url: link,
    };
  }

  let detectSeq = 0;
  async function detectActive() {
    const seq = ++detectSeq;
    const active = api.browser.getActiveTab();
    const rec = active ? await recordInWebview(active.webview) : null;
    if (seq !== detectSeq) return;
    const changed = !sameRecord(current, rec);
    let refreshed = false;
    current = rec;
    if (rec && loaded) {
      if (changed) {
        entries = recordVisit(entries, rec, Date.now(), maxEntries());
        scheduleSave();
      } else if (refreshEntry(entries, rec)) {
        refreshed = true;
        scheduleSave();
      }
    }
    // Re-rendering replaces the rows (and closes a preview card), so only
    // when something shown changed.
    if (changed || refreshed) render();
  }

  let detectTimer = null;
  function scheduleDetect(delay) {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detectActive, delay == null ? 400 : delay);
  }

  const NAV_EVENTS = ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-finish-load"];
  const watched = new Map(); // webview → listener
  function watchWebview(webview) {
    if (!webview || watched.has(webview)) return;
    const onNav = function () {
      const active = api.browser.getActiveTab();
      if (active && active.webview === webview) scheduleDetect(700);
    };
    NAV_EVENTS.forEach(function (ev) { webview.addEventListener(ev, onNav); });
    watched.set(webview, onNav);
  }

  api.browser.getTabs().forEach(function (t) { watchWebview(t.webview); });
  api.events.on("tab:created", function (t) { watchWebview(t && t.webview); });
  api.events.on("tab:activated", function () { scheduleDetect(150); });
  api.events.on("tab:closed", function (t) {
    const wv = t && t.webview;
    const fn = wv && watched.get(wv);
    if (fn) {
      NAV_EVENTS.forEach(function (ev) {
        try { wv.removeEventListener(ev, fn); } catch { /* already gone */ }
      });
      watched.delete(wv);
    }
    scheduleDetect(150);
  });
  api.events.on("ticket:changed", function () { scheduleDetect(150); });
  api.sites.onRegistered(function () { scheduleDetect(300); });

  // ===================== Actions =====================

  // A tab already showing the entry's ticket, or null.
  function findOpenTab(e) {
    const site = api.sites.get(e.siteId);
    const tabs = api.browser.getTabs();
    for (const t of tabs) {
      if (!t.url) continue;
      if (t.url === e.url) return t;
      const s = api.sites.forUrl(t.url);
      if (site && s && s.id === site.id && cleanLink(site, t.url) === e.url) return t;
    }
    return null;
  }

  function open(e, forceNewTab, background) {
    if (!e.url) return;
    if (!forceNewTab && reuseTab()) {
      const t = findOpenTab(e);
      if (t) {
        api.browser.activateTab(t.tabId);
        return;
      }
    }
    api.browser.newTab(e.url, background ? { activate: false } : undefined);
  }

  function togglePin(e) {
    e.pinned = !e.pinned;
    entries = pruneEntries(entries, maxEntries());
    scheduleSave();
    render();
  }

  function remove(e) {
    entries = entries.filter(function (x) { return x !== e; });
    scheduleSave();
    render();
  }

  async function clearAll() {
    const unpinned = entries.filter(function (e) { return !e.pinned; }).length;
    if (!unpinned) return;
    const ok = await api.ui.confirm("Clear " + unpinned + " recent ticket" + (unpinned === 1 ? "" : "s") + " from the list? Pinned tickets stay.");
    if (!ok) return;
    entries = entries.filter(function (e) { return e.pinned; });
    scheduleSave();
    render();
  }

  async function copyLink(e) {
    try {
      await navigator.clipboard.writeText(e.url);
      flash("Copied the link to " + entryName(e) + ".");
    } catch {
      flash("Couldn't copy to the clipboard.");
    }
  }

  // ===================== UI =====================

  const sidePanelTab = api.ui.addSidePanelTab({
    id: PLUGIN_ID,
    label: "Recent",
    icon: "🕘",
    title: "Recent Tickets: tickets you've viewed lately",
    order: 50,
  });
  const panel = sidePanelTab.element;
  panel.classList.add("rct-panel");

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === "className") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function iconButton(label, title, onClick, cls) {
    return h("button", {
      type: "button", className: "rct-icon-btn" + (cls ? " " + cls : ""), title: title, "aria-label": title,
      onclick: function (ev) { ev.stopPropagation(); onClick(); },
    }, [label]);
  }

  let flashMsg = "";
  let flashTimer = null;
  function flash(text) {
    flashMsg = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashMsg = ""; render(); }, 4000);
    render();
  }

  // The header and filter box are built once, so typing never loses focus.
  const header = h("div", { className: "rct-header" }, [h("span", { className: "rct-title" }, ["Recent Tickets"])]);
  const clearBtn = h("button", {
    type: "button", className: "btn btn-small btn-secondary", title: "Clear the list (pinned tickets stay)", onclick: clearAll,
  }, ["Clear"]);
  header.appendChild(clearBtn);
  const filterInput = h("input", {
    type: "search", className: "settings-text-input rct-filter", placeholder: "Filter by number or subject",
    "aria-label": "Filter recent tickets", spellcheck: "false", autocomplete: "off",
  });
  filterInput.addEventListener("input", function () { filter = filterInput.value; renderList(); });
  filterInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      const first = entries.find(function (e) { return matchesFilter(e, filter); });
      if (first) open(first, ev.ctrlKey || ev.metaKey, false);
    } else if (ev.key === "Escape" && filterInput.value) {
      filterInput.value = "";
      filter = "";
      renderList();
    }
  });
  const flashEl = h("div", { className: "rct-flash", "aria-live": "polite" });
  const listEl = h("div", { className: "rct-list" });
  panel.appendChild(header);
  panel.appendChild(h("div", { className: "rct-filter-row" }, [filterInput]));
  panel.appendChild(flashEl);
  panel.appendChild(listEl);

  function renderRow(e, now) {
    const isCurrent = sameRecord(e, current);
    const row = h("div", {
      className: "rct-row" + (isCurrent ? " rct-row-current" : "") + (e.pinned ? " rct-row-pinned" : ""),
      role: "button", tabindex: "0",
      title: "Open " + entryName(e) + (e.title ? ": " + e.title : "") + "\nCtrl+click or middle-click for a new tab",
    });
    row.addEventListener("click", function (ev) { open(e, ev.ctrlKey || ev.metaKey || ev.shiftKey, false); });
    if (typeof api.ui.attachTicketPreview === "function") {
      api.ui.attachTicketPreview(row, {
        enabled: function () { return settings.recentTicketsHoverPreview !== false; },
        ref: { siteId: e.siteId, key: e.key, kind: e.kind, url: e.url, label: e.label, title: e.title },
      });
    }
    row.addEventListener("auxclick", function (ev) { if (ev.button === 1) { ev.preventDefault(); open(e, true, true); } });
    row.addEventListener("mousedown", function (ev) { if (ev.button === 1) ev.preventDefault(); });
    row.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(e, ev.ctrlKey || ev.metaKey, false); }
    });
    row.appendChild(h("div", { className: "rct-row-text" }, [
      h("div", { className: "rct-row-top" }, [
        e.siteName ? h("span", { className: "rct-site" }, [e.siteName]) : null,
        h("span", { className: "rct-label" }, [e.label || e.key]),
        isCurrent ? h("span", { className: "rct-open-badge" }, ["open"]) : null,
      ]),
      e.title ? h("div", { className: "rct-row-title" }, [e.title]) : null,
      h("div", { className: "rct-muted" }, [timeAgo(e.viewedAt, now)]),
    ]));
    row.appendChild(h("div", { className: "rct-row-actions" }, [
      iconButton(e.pinned ? "★" : "☆", e.pinned ? "Unpin" : "Pin to the top", function () { togglePin(e); }, e.pinned ? "rct-pinned" : ""),
      iconButton("🔗", "Copy link", function () { copyLink(e); }),
      iconButton("✕", "Remove from the list", function () { remove(e); }),
    ]));
    return row;
  }

  function renderList() {
    if (!loaded) return;
    const now = Date.now();
    listEl.textContent = "";
    const shown = entries.filter(function (e) { return matchesFilter(e, filter); });
    if (!entries.length) {
      listEl.appendChild(h("div", { className: "rct-muted rct-empty" }, [
        "Tickets you open show up here, newest first. Open a ticket in Freshservice or ConnectWise Manage to start the list.",
      ]));
      return;
    }
    if (!shown.length) {
      listEl.appendChild(h("div", { className: "rct-muted rct-empty" }, ["No recent tickets match “" + filter.trim() + "”."]));
      return;
    }
    groupEntries(shown, now).forEach(function (g) {
      listEl.appendChild(h("div", { className: "rct-group" }, [g.label]));
      g.items.forEach(function (e) { listEl.appendChild(renderRow(e, now)); });
    });
  }

  function render() {
    if (!loaded) return;
    clearBtn.disabled = !entries.some(function (e) { return !e.pinned; });
    flashEl.textContent = flashMsg;
    flashEl.style.display = flashMsg ? "" : "none";
    renderList();
  }

  // Keep the "5 min ago" times fresh while the tab is showing.
  setInterval(function () { if (loaded && sidePanelTab.isActive()) renderList(); }, 60000);

  // Single-page sites don't always fire navigation events; look again now and
  // then while the tab is showing.
  setInterval(function () { if (sidePanelTab.isActive()) detectActive(); }, 5000);

  sidePanelTab.onShow(function () { render(); scheduleDetect(0); });

  api.invoke(PLUGIN_ID, "load").then(function (store) {
    entries = store && Array.isArray(store.entries) ? store.entries : [];
  }).catch(function (err) {
    console.error("[Recent Tickets] load:", err);
  }).then(function () {
    loaded = true;
    // A visit seen before the list loaded would be lost; look again now.
    current = null;
    entries = pruneEntries(entries, maxEntries());
    render();
    scheduleDetect(0);
  });
})();
