// Canned Responses plugin — main window renderer
//
// A "Replies" tab in the side panel lists the saved responses (managed in
// Settings → Canned Responses). Clicking one fills in its placeholders and
// inserts it at the cursor in the reply box of the ticket open in the active tab.
// The reply box is reached through the tab's site plugin (pluginAPI.sites, the
// adapter's "reply" part), so it works on any site that supports it: Freshservice
// and ConnectWise Manage today. Copy puts the filled-in text on the clipboard for
// anywhere else.
//
// The pure helpers at the top are exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  // {{ name }} placeholders, case-insensitive, spaces allowed inside the braces.
  const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
  const KNOWN_PLACEHOLDERS = [
    "requester", "requester_first", "subject", "ticket", "agent", "agent_first", "date", "time", "site",
  ];
  // Placeholders that need the site to read the ticket.
  const CONTEXT_PLACEHOLDERS = new Set(["requester", "requester_first", "subject"]);

  function firstWord(name) {
    return String(name || "").trim().split(/\s+/)[0] || "";
  }

  // Placeholder names used in a body (lowercase, known ones only, no repeats).
  function placeholdersIn(body) {
    const out = [];
    String(body || "").replace(PLACEHOLDER_PATTERN, function (whole, name) {
      const key = name.toLowerCase();
      if (KNOWN_PLACEHOLDERS.includes(key) && !out.includes(key)) out.push(key);
      return whole;
    });
    return out;
  }

  function needsContext(body) {
    return placeholdersIn(body).some(function (k) { return CONTEXT_PLACEHOLDERS.has(k); });
  }

  // The values placeholders are filled with. ctx: { record, context, agentName,
  // siteName, now }. Missing values are left out.
  function placeholderValues(ctx) {
    const c = (ctx && ctx.context) || {};
    const record = (ctx && ctx.record) || {};
    const now = (ctx && ctx.now) || new Date();
    const values = {};
    const set = function (k, v) { const s = String(v || "").trim(); if (s) values[k] = s; };
    set("requester", c.requester);
    set("requester_first", c.requesterFirstName || firstWord(c.requester));
    set("subject", c.subject);
    set("ticket", record.id || record.ticket);
    set("agent", ctx && ctx.agentName);
    set("agent_first", firstWord(ctx && ctx.agentName));
    set("site", ctx && ctx.siteName);
    set("date", now.toLocaleDateString());
    set("time", now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    return values;
  }

  // Fills the known placeholders. Ones with no value stay in the text, so they
  // stand out in the reply box, and are listed in `missing`. Unknown names are
  // left alone.
  function fillPlaceholders(body, values) {
    const missing = [];
    const text = String(body || "").replace(PLACEHOLDER_PATTERN, function (whole, name) {
      const key = name.toLowerCase();
      if (!KNOWN_PLACEHOLDERS.includes(key)) return whole;
      if (values && Object.prototype.hasOwnProperty.call(values, key)) return values[key];
      if (!missing.includes(key)) missing.push(key);
      return whole;
    });
    return { text: text, missing: missing };
  }

  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (r) {
      return r && typeof r.id === "string" && typeof r.title === "string" && typeof r.body === "string";
    }).map(function (r) {
      return { id: r.id, title: r.title, body: r.body, category: typeof r.category === "string" ? r.category.trim() : "" };
    });
  }

  // Responses matching every word of the query (in title, category or body),
  // grouped by category in the order categories first appear. Uncategorised first.
  function filterAndGroup(list, query) {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hits = list.filter(function (r) {
      if (!words.length) return true;
      const hay = (r.title + "\n" + (r.category || "") + "\n" + r.body).toLowerCase();
      return words.every(function (w) { return hay.includes(w); });
    });
    const groups = [];
    const byName = new Map();
    const none = { category: "", items: [] };
    hits.forEach(function (r) {
      const cat = r.category || "";
      if (!cat) { none.items.push(r); return; }
      let g = byName.get(cat.toLowerCase());
      if (!g) { g = { category: cat, items: [] }; byName.set(cat.toLowerCase(), g); groups.push(g); }
      g.items.push(r);
    });
    if (none.items.length) groups.unshift(none);
    return groups;
  }

  function preview(body) {
    const line = String(body || "").replace(/\s+/g, " ").trim();
    return line.length > 90 ? line.substring(0, 90) + "…" : line;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      placeholdersIn, needsContext, placeholderValues, fillPlaceholders, sanitize, filterAndGroup, preview,
      KNOWN_PLACEHOLDERS,
    };
    return;
  }

  // ==================== Side panel tab ====================

  const api = window.pluginAPI;
  if (!api || !api.ui || typeof api.ui.addSidePanelTab !== "function") return;

  let settings = api.getSettings();
  let responses = sanitize(settings.cannedResponses);

  const tab = api.ui.addSidePanelTab({
    id: "canned-responses",
    label: "Replies",
    icon: "💬",
    title: "Canned Responses: insert a saved reply into the ticket",
    order: 30,
  });
  const panel = tab.element;
  panel.classList.add("cr-panel");
  panel.innerHTML =
    '<div class="cr-header">' +
    '  <input type="search" id="cr-search" class="cr-search" placeholder="Search replies… (Enter inserts)" spellcheck="false" autocomplete="off" />' +
    '  <button type="button" id="cr-manage" class="btn btn-small btn-secondary" title="Add and edit replies in Settings">Manage</button>' +
    "</div>" +
    '<div id="cr-list" class="cr-list" role="listbox" aria-label="Canned responses"></div>' +
    '<div id="cr-status" class="cr-status" aria-live="polite"></div>';

  const elSearch = panel.querySelector("#cr-search");
  const elList = panel.querySelector("#cr-list");
  const elStatus = panel.querySelector("#cr-status");
  let highlightId = null;
  let busy = false;

  function setStatus(text, kind) {
    elStatus.textContent = text || "";
    elStatus.className = "cr-status" + (kind ? " cr-status-" + kind : "");
  }

  function visibleItems() {
    return Array.prototype.slice.call(elList.querySelectorAll(".cr-item"));
  }

  function openSettings() {
    if (window.backupAPI && typeof window.backupAPI.openSettingsWindow === "function") {
      window.backupAPI.openSettingsWindow();
    }
  }

  function render() {
    elList.innerHTML = "";
    if (!responses.length) {
      const empty = document.createElement("div");
      empty.className = "cr-empty";
      empty.innerHTML = "<p>No canned responses yet.</p><p>Add replies you send often in " +
        "<strong>Settings → Canned Responses</strong>, then click one here to put it in the reply box.</p>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-small btn-primary";
      btn.textContent = "Add replies";
      btn.addEventListener("click", openSettings);
      empty.appendChild(btn);
      elList.appendChild(empty);
      return;
    }
    const groups = filterAndGroup(responses, elSearch.value);
    if (!groups.length) {
      const none = document.createElement("div");
      none.className = "cr-empty";
      none.textContent = "No replies match.";
      elList.appendChild(none);
      return;
    }
    const ids = [];
    groups.forEach(function (g) {
      if (g.category) {
        const h = document.createElement("div");
        h.className = "cr-group";
        h.textContent = g.category;
        elList.appendChild(h);
      }
      g.items.forEach(function (r) {
        ids.push(r.id);
        const row = document.createElement("div");
        row.className = "cr-row";

        const item = document.createElement("button");
        item.type = "button";
        item.className = "cr-item";
        item.dataset.id = r.id;
        item.setAttribute("role", "option");
        item.title = "Insert into the reply box\n\n" + r.body.substring(0, 600);
        const t = document.createElement("span");
        t.className = "cr-item-title";
        t.textContent = r.title;
        const p = document.createElement("span");
        p.className = "cr-item-preview";
        p.textContent = preview(r.body);
        item.appendChild(t);
        item.appendChild(p);
        item.addEventListener("click", function () { insert(r); });

        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "btn btn-small btn-secondary cr-copy";
        copy.textContent = "Copy";
        copy.title = "Copy to the clipboard with the placeholders filled in";
        copy.addEventListener("click", function () { copyResponse(r); });

        row.appendChild(item);
        row.appendChild(copy);
        elList.appendChild(row);
      });
    });
    if (!ids.includes(highlightId)) highlightId = elSearch.value.trim() ? ids[0] : null;
    applyHighlight();
  }

  function applyHighlight() {
    visibleItems().forEach(function (el) {
      const on = el.dataset.id === highlightId;
      el.classList.toggle("cr-item-active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  }

  function findResponse(id) {
    return responses.find(function (r) { return r.id === id; }) || null;
  }

  function label(name) { return "{{" + name + "}}"; }

  // Fills a response's placeholders for the active tab. Returns { text, missing, at }.
  async function prepare(r) {
    const at = api.sites && typeof api.sites.forActiveTab === "function" ? api.sites.forActiveTab() : null;
    let record = null;
    let context = {};
    if (at && at.site.recordScript) {
      try { record = await at.webview.executeJavaScript(at.site.recordScript); } catch { record = null; }
    }
    if (at && at.site.reply && typeof at.site.reply.readContext === "function" && needsContext(r.body)) {
      try {
        let url = "";
        try { url = at.webview.getURL(); } catch { /* no url */ }
        context = (await at.site.reply.readContext({ webview: at.webview, url: url, record: record })) || {};
      } catch (e) { console.warn("[Canned Responses] readContext:", e); context = {}; }
    }
    const values = placeholderValues({
      record: record && record.ticket ? record : null,
      context: context,
      agentName: settings.cannedResponsesAgentName,
      siteName: at ? at.site.name : "",
    });
    const filled = fillPlaceholders(r.body, values);
    return { text: filled.text, missing: filled.missing, at: at };
  }

  function missingNote(missing) {
    if (!missing.length) return "";
    return " Fill in " + missing.map(label).join(", ") + " before sending" +
      (missing.some(function (k) { return k.startsWith("agent"); }) ? " (set your name in Settings → Canned Responses)" : "") + ".";
  }

  async function insert(r) {
    if (busy) return;
    busy = true;
    highlightId = r.id;
    applyHighlight();
    try {
      const at = api.sites && typeof api.sites.forActiveTab === "function" ? api.sites.forActiveTab() : null;
      if (!at || !at.site.reply) {
        setStatus("This tab isn't a ticket on a site that supports inserting replies. Use Copy instead.", "error");
        return;
      }
      setStatus("Inserting…");
      const prepared = await prepare(r);
      let result = null;
      try {
        result = await at.webview.executeJavaScript(at.site.reply.buildInsertScript(prepared.text));
      } catch (e) {
        console.error("[Canned Responses] insert:", e);
        setStatus("Couldn't insert into the page. Use Copy instead.", "error");
        return;
      }
      if (!result) {
        setStatus("No " + at.site.reply.label + " is open. Open it on the ticket (for example click Reply), then try again.", "error");
        return;
      }
      setStatus("Inserted “" + r.title + "”." + missingNote(prepared.missing), prepared.missing.length ? "warn" : "ok");
      try { at.webview.focus(); } catch { /* ignore */ }
    } finally {
      busy = false;
    }
  }

  async function copyResponse(r) {
    try {
      const prepared = await prepare(r);
      await navigator.clipboard.writeText(prepared.text);
      setStatus("Copied “" + r.title + "”." + missingNote(prepared.missing), prepared.missing.length ? "warn" : "ok");
    } catch (e) {
      console.error("[Canned Responses] copy:", e);
      setStatus("Couldn't copy to the clipboard.", "error");
    }
  }

  elSearch.addEventListener("input", function () { highlightId = null; render(); });
  elSearch.addEventListener("keydown", function (e) {
    const items = visibleItems();
    if (!items.length) return;
    let idx = items.findIndex(function (el) { return el.dataset.id === highlightId; });
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      idx = e.key === "ArrowDown" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
      highlightId = items[idx].dataset.id;
      applyHighlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = findResponse(highlightId || items[0].dataset.id);
      if (r) insert(r);
    } else if (e.key === "Escape" && elSearch.value) {
      e.preventDefault();
      elSearch.value = "";
      highlightId = null;
      render();
    }
  });
  panel.querySelector("#cr-manage").addEventListener("click", openSettings);
  tab.onShow(function () { setTimeout(function () { elSearch.focus(); }, 0); });

  api.events.on("settings:changed", function (s) {
    settings = s || {};
    responses = sanitize(settings.cannedResponses);
    render();
  });

  render();
})();
