// Quick Actions plugin — main window renderer
//
// Adds a ⚡ Actions tab to the side panel for the ticket open in the active
// tab: change its status, priority, group and agent, or press Assign to me /
// Pending / Resolve, without opening the ticket's edit form. The changes go
// through the site plugin (its ticketActions adapter part; Freshservice uses
// its REST API), so this plugin knows nothing about any particular site.
//
// After a change the ticket's tab is reloaded so the page shows it (and a
// later save on the page can't put the old values back), unless something has
// been typed on the page, in which case a Reload button is offered instead.
//
// Command palette: "Assign Ticket to Me", "Resolve Ticket", "Set Ticket
// Status: …" and "Set Ticket Priority: …".
//
// The pure helpers at the top are exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  const TAB_ID = "quick-actions";

  // ==================== Pure helpers ====================

  // The fields that differ between the ticket and the form: { status, … }.
  function diffChanges(ticket, form) {
    const out = {};
    if (!ticket || !form) return out;
    ["status", "priority", "groupId", "agentId"].forEach(function (k) {
      if (form[k] !== undefined && form[k] !== ticket[k]) out[k] = form[k];
    });
    return out;
  }

  // A <select> value ("" for none) → a number or null.
  function parseChoice(v) {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  }

  // The label for a value in [{ value, label }] / [{ id, name }], or a stand-in.
  function labelFor(list, value, fallback) {
    if (value == null) return fallback || "None";
    const hit = (list || []).find(function (x) { return (x.value != null ? x.value : x.id) === value; });
    return hit ? (hit.label || hit.name || hit.email) : (fallback ? fallback + " " : "#") + value;
  }

  // The status meaning "resolved": the one labelled Resolved, else Freshservice's 4.
  function resolvedStatus(statuses) {
    const hit = (statuses || []).find(function (s) { return /^resolved$/i.test(s.label); });
    if (hit) return hit.value;
    return (statuses || []).some(function (s) { return s.value === 4; }) ? 4 : null;
  }

  function pendingStatus(statuses) {
    const hit = (statuses || []).find(function (s) { return /^pending$/i.test(s.label); });
    if (hit) return hit.value;
    return (statuses || []).some(function (s) { return s.value === 3; }) ? 3 : null;
  }

  // "Status Open → Resolved, agent Pat Lee" for a change just saved.
  function describeChanges(before, changes, options) {
    const o = options || {};
    const parts = [];
    if ("status" in changes) parts.push("status " + labelFor(o.statuses, before.status, "Status") + " → " + labelFor(o.statuses, changes.status, "Status"));
    if ("priority" in changes) parts.push("priority " + labelFor(o.priorities, before.priority, "Priority") + " → " + labelFor(o.priorities, changes.priority, "Priority"));
    if ("groupId" in changes) parts.push("group → " + (changes.groupId == null ? "none" : labelFor(o.groups, changes.groupId, "Group")));
    if ("agentId" in changes) {
      const who = changes.agentId == null ? "unassigned" : (changes.agentId === o.me ? "you" : labelFor(o.agents, changes.agentId, "Agent"));
      parts.push("agent → " + who);
    }
    const text = parts.join(", ");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { diffChanges, parseChoice, labelFor, resolvedStatus, pendingStatus, describeChanges };
    return;
  }
  if (typeof window === "undefined" || !window.pluginAPI) return;

  // ===================== State =====================

  const api = window.pluginAPI;
  if (!api.ui || typeof api.ui.addSidePanelTab !== "function") return;

  let settings = api.getSettings();
  let current = null;   // { site, record, url, tabId, webview } for the active tab's ticket
  let ticket = null;    // the ticket as the site last returned it
  let options = null;   // { statuses, priorities, agents, groups, me } for current.site
  let optionsSite = null;
  let busy = false;
  let loadSeq = 0;
  let lastNote = null;  // { text, kind, reload } shown under the form

  api.events.on("settings:changed", function (s) { settings = s; });

  // ===================== UI =====================

  const tab = api.ui.addSidePanelTab({ id: TAB_ID, label: "Actions", icon: "⚡", title: "Quick ticket actions", order: 16 });
  const panel = tab.element;
  panel.classList.add("qa-panel");
  panel.innerHTML =
    '<div class="qa-header">' +
    '  <div class="qa-title"><span id="qa-num" class="qa-num"></span><span id="qa-subject" class="qa-subject"></span></div>' +
    '  <button type="button" id="qa-refresh" class="qa-icon-btn" title="Reload the ticket and the lists of agents and groups">↻</button>' +
    "</div>" +
    '<div id="qa-body" class="qa-body">' +
    '  <div class="qa-quick">' +
    '    <button type="button" id="qa-me" class="btn btn-small btn-secondary" title="Make yourself the ticket\'s agent">👤 Assign to me</button>' +
    '    <button type="button" id="qa-pending" class="btn btn-small btn-secondary">⏸ Pending</button>' +
    '    <button type="button" id="qa-resolve" class="btn btn-small btn-secondary">✔ Resolve</button>' +
    "  </div>" +
    '  <label class="qa-field"><span>Status</span><select id="qa-status" class="qa-select"></select></label>' +
    '  <label class="qa-field"><span>Priority</span><select id="qa-priority" class="qa-select"></select></label>' +
    '  <label class="qa-field"><span>Group</span><select id="qa-group" class="qa-select"></select></label>' +
    '  <label class="qa-field"><span>Agent</span><select id="qa-agent" class="qa-select"></select></label>' +
    '  <div class="qa-actions">' +
    '    <button type="button" id="qa-save" class="btn btn-small btn-primary" disabled>Save changes</button>' +
    '    <button type="button" id="qa-reset" class="btn btn-small btn-secondary" disabled>Undo</button>' +
    "  </div>" +
    "</div>" +
    '<div id="qa-empty" class="qa-empty" hidden></div>' +
    '<div id="qa-status-line" class="qa-note" aria-live="polite"></div>';

  const $ = function (id) { return panel.querySelector("#" + id); };
  const el = {
    num: $("qa-num"), subject: $("qa-subject"), refresh: $("qa-refresh"), body: $("qa-body"), empty: $("qa-empty"),
    me: $("qa-me"), pending: $("qa-pending"), resolve: $("qa-resolve"),
    status: $("qa-status"), priority: $("qa-priority"), group: $("qa-group"), agent: $("qa-agent"),
    save: $("qa-save"), reset: $("qa-reset"), note: $("qa-status-line"),
  };

  function openSettings() {
    if (window.backupAPI && typeof window.backupAPI.openSettingsWindow === "function") {
      window.backupAPI.openSettingsWindow({ plugin: current && current.site ? current.site.id : undefined });
    }
  }

  function showEmpty(text, withSettings) {
    el.body.hidden = true;
    el.empty.hidden = false;
    el.empty.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = text;
    el.empty.appendChild(p);
    if (withSettings) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small btn-secondary";
      b.textContent = "Open Settings";
      b.addEventListener("click", openSettings);
      el.empty.appendChild(b);
    }
  }

  function setNote(text, kind, reload) {
    lastNote = text ? { text: text, kind: kind || "", reload: !!reload } : null;
    el.note.innerHTML = "";
    el.note.className = "qa-note" + (kind ? " qa-note-" + kind : "");
    if (!text) return;
    const span = document.createElement("span");
    span.textContent = text;
    el.note.appendChild(span);
    if (reload) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small btn-secondary qa-reload";
      b.textContent = "Reload tab";
      b.addEventListener("click", function () { reloadTicketTab(true); });
      el.note.appendChild(b);
    }
  }

  function fillSelect(select, list, value, noneLabel, fallbackWord) {
    select.innerHTML = "";
    if (noneLabel) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = noneLabel;
      select.appendChild(o);
    }
    let found = value == null;
    (list || []).forEach(function (x) {
      const v = x.value != null ? x.value : x.id;
      const o = document.createElement("option");
      o.value = String(v);
      o.textContent = x.label || x.name || x.email;
      if (x.email && x.name && x.name !== x.email) o.title = x.email;
      if (v === value) found = true;
      select.appendChild(o);
    });
    // A value the lists don't have (a deactivated agent, say) still shows.
    if (!found) {
      const o = document.createElement("option");
      o.value = String(value);
      o.textContent = fallbackWord + " #" + value;
      select.appendChild(o);
    }
    select.value = value == null ? "" : String(value);
  }

  function formValues() {
    return {
      status: parseChoice(el.status.value),
      priority: parseChoice(el.priority.value),
      groupId: parseChoice(el.group.value),
      agentId: parseChoice(el.agent.value),
    };
  }

  function updateButtons() {
    const dirty = ticket && Object.keys(diffChanges(ticket, formValues())).length > 0;
    el.save.disabled = busy || !dirty;
    el.reset.disabled = busy || !dirty;
    [el.status, el.priority, el.group, el.agent, el.refresh].forEach(function (x) { x.disabled = busy; });
    const st = options ? options.statuses : [];
    el.me.disabled = busy || !ticket || !options || options.me == null || ticket.agentId === options.me;
    el.me.title = options && options.me == null ? "Couldn't tell which agent the API key belongs to" : "Make yourself the ticket's agent";
    const pend = pendingStatus(st);
    const res = resolvedStatus(st);
    el.pending.disabled = busy || !ticket || pend == null || ticket.status === pend;
    el.resolve.disabled = busy || !ticket || res == null || ticket.status === res;
  }

  function renderTicket() {
    el.body.hidden = false;
    el.empty.hidden = true;
    el.num.textContent = "#" + ticket.id;
    el.subject.textContent = ticket.subject || "(no subject)";
    el.subject.title = ticket.subject || "";
    const o = options || { statuses: [], priorities: [], groups: [], agents: [] };
    fillSelect(el.status, o.statuses, ticket.status, null, "Status");
    fillSelect(el.priority, o.priorities, ticket.priority, null, "Priority");
    fillSelect(el.group, o.groups, ticket.groupId, "— No group —", "Group");
    const agents = (o.agents || []).map(function (a) {
      return Object.assign({}, a, { name: a.id === o.me ? (a.name || a.email) + " (me)" : a.name });
    });
    fillSelect(el.agent, agents, ticket.agentId, "— Unassigned —", "Agent");
    updateButtons();
  }

  function clearHeader() {
    el.num.textContent = "";
    el.subject.textContent = "";
  }

  // ===================== Finding the ticket =====================

  async function recordInActiveTab() {
    const active = api.browser.getActiveTab();
    const webview = active && active.webview;
    if (!webview) return null;
    const site = api.sites.forWebview(webview);
    if (!site) return { site: null };
    if (!site.ticketActions) return { site: site, unsupported: true };
    if (!site.recordScript) return { site: site, record: null };
    let rec = null;
    try { rec = await webview.executeJavaScript(site.recordScript); } catch { /* page busy */ }
    let url = "";
    try { url = webview.getURL(); } catch { /* tab gone */ }
    return { site: site, record: rec && rec.ticket ? rec : null, url: url, tabId: active.id, webview: webview };
  }

  async function loadOptions(site, force) {
    if (!force && options && optionsSite === site.id) return options;
    const res = await site.ticketActions.options({ force: !!force });
    if (!res || res.error) throw Object.assign(new Error((res && res.error) || "Couldn't load the ticket choices."), { skipped: !!(res && res.skipped) });
    options = res;
    optionsSite = site.id;
    return options;
  }

  async function load(force) {
    const seq = ++loadSeq;
    const found = await recordInActiveTab();
    if (seq !== loadSeq) return;
    const sameTicket = current && found && found.record && current.tabId === found.tabId &&
      current.record.ticket === found.record.ticket;
    if (!sameTicket && lastNote && !lastNote.reload) setNote("");
    if (!found || !found.site) {
      current = null; ticket = null; clearHeader();
      showEmpty("Open a ticket to change its status, priority, group or agent here.");
      return;
    }
    if (found.unsupported) {
      current = null; ticket = null; clearHeader();
      showEmpty((found.site.shortName || found.site.name) + " doesn't support quick actions yet. They work on Freshservice tickets.");
      return;
    }
    if (!found.record) {
      current = null; ticket = null; clearHeader();
      showEmpty("Open a ticket to change its status, priority, group or agent here.");
      return;
    }
    current = found;
    if (!sameTicket || force) {
      ticket = null;
      clearHeader();
      el.num.textContent = found.record.label || found.record.ticket;
      showEmpty("Loading…");
    }
    let res;
    try {
      const [, got] = await Promise.all([loadOptions(found.site, force), found.site.ticketActions.get(found)]);
      res = got;
    } catch (err) {
      res = { error: err.message || String(err), skipped: err.skipped };
    }
    if (seq !== loadSeq) return;
    if (!res || res.error || !res.ticket) {
      ticket = null;
      showEmpty((res && res.error) || "Couldn't read the ticket.", !!(res && res.skipped));
      return;
    }
    ticket = res.ticket;
    renderTicket();
    if (options && options.warnings && options.warnings.length && !lastNote) setNote(options.warnings.join(" "), "error");
  }

  let loadTimer = null;
  function scheduleLoad(delay) {
    if (!tab.isActive()) return;
    clearTimeout(loadTimer);
    loadTimer = setTimeout(function () { load(false); }, delay == null ? 500 : delay);
  }

  // ===================== Saving =====================

  // Whether anything has been typed into the page's editors (so a reload would lose it).
  const TYPED_SCRIPT = "(function(){try{var els=document.querySelectorAll('textarea,[contenteditable=\"true\"]');" +
    "for(var i=0;i<els.length;i++){var e=els[i];if(!e.offsetParent)continue;" +
    "var t=(e.value!=null&&e.tagName==='TEXTAREA'?e.value:(e.innerText||'')).replace(/\\s+/g,'');if(t)return true;}" +
    "return false;}catch(x){return true;}})()";

  async function reloadTicketTab(forced) {
    const target = current;
    if (!target || !target.webview) return false;
    if (!forced) {
      let typed = true;
      try { typed = await target.webview.executeJavaScript(TYPED_SCRIPT); } catch { /* assume typed */ }
      if (typed) return false;
    }
    try { target.webview.reload(); } catch { return false; }
    if (lastNote) setNote(lastNote.text, lastNote.kind, false);
    return true;
  }

  async function apply(changes, what) {
    if (!current || !ticket || busy) return;
    if (!Object.keys(changes).length) return;
    const before = ticket;
    const target = current;
    busy = true;
    updateButtons();
    setNote((what || "Saving") + "…", "busy");
    let res;
    try { res = await target.site.ticketActions.update(target, changes); } catch (err) { res = { error: err.message || String(err) }; }
    busy = false;
    if (current !== target) { updateButtons(); return; }
    if (!res || !res.ok) {
      setNote((res && res.error) || "The change wasn't saved.", "error");
      renderTicket();
      return;
    }
    const resolved = Object.assign({}, changes);
    if (resolved.agentId === "me") resolved.agentId = options ? options.me : null;
    ticket = res.ticket || Object.assign({}, before, resolved);
    renderTicket();
    const text = "Saved. " + describeChanges(before, resolved, options) + ".";
    let reloaded = false;
    if (settings.quickActionsReloadTab !== false) reloaded = await reloadTicketTab(false);
    if (reloaded) setNote(text, "ok", false);
    else setNote(text + " The page still shows the old values" + (settings.quickActionsReloadTab !== false ? " (it wasn't reloaded because something is typed on it)" : "") + ".", "ok", true);
  }

  async function confirmResolve() {
    if (settings.quickActionsConfirmResolve === false) return true;
    const msg = "Resolve ticket #" + ticket.id + "? Freshservice may email the requester.";
    if (api.ui.confirm) return api.ui.confirm(msg, { defaultYes: true });
    return true;
  }

  el.save.addEventListener("click", async function () {
    const changes = diffChanges(ticket, formValues());
    if ("status" in changes && changes.status === resolvedStatus(options && options.statuses) && !(await confirmResolve())) return;
    apply(changes);
  });
  el.reset.addEventListener("click", function () { renderTicket(); });
  [el.status, el.priority, el.group, el.agent].forEach(function (s) { s.addEventListener("change", updateButtons); });
  el.refresh.addEventListener("click", function () { setNote(""); load(true); });

  function assignToMe() { if (ticket) apply({ agentId: "me" }, "Assigning to you"); }
  function setPending() {
    const v = pendingStatus(options && options.statuses);
    if (ticket && v != null) apply({ status: v }, "Setting pending");
  }
  async function resolve() {
    const v = resolvedStatus(options && options.statuses);
    if (!ticket || v == null) return;
    if (!(await confirmResolve())) return;
    apply({ status: v }, "Resolving");
  }
  el.me.addEventListener("click", assignToMe);
  el.pending.addEventListener("click", setPending);
  el.resolve.addEventListener("click", resolve);

  // ===================== Keeping up with the active tab =====================

  const NAV_EVENTS = ["did-navigate", "did-navigate-in-page", "did-finish-load"];
  const watched = new Map();
  function watchWebview(webview) {
    if (!webview || watched.has(webview)) return;
    const onNav = function () {
      const active = api.browser.getActiveTab();
      if (active && active.webview === webview) scheduleLoad(800);
    };
    NAV_EVENTS.forEach(function (ev) { webview.addEventListener(ev, onNav); });
    watched.set(webview, onNav);
  }
  api.browser.getTabs().forEach(function (t) { watchWebview(t.webview); });
  api.events.on("tab:created", function (t) { watchWebview(t && t.webview); });
  api.events.on("tab:closed", function (t) { if (t && t.webview) watched.delete(t.webview); scheduleLoad(150); });
  api.events.on("tab:activated", function () { scheduleLoad(150); });
  api.events.on("ticket:changed", function () { scheduleLoad(300); });
  api.sites.onRegistered(function () { scheduleLoad(300); });
  tab.onShow(function () { load(false); });

  // ===================== Command palette =====================

  // Runs fn once the active tab's ticket (and the choices) are loaded.
  async function withTicket(fn) {
    if (!ticket || !current) await load(false);
    if (!ticket) { tab.activate(); return; }
    fn();
  }

  if (api.commands && typeof api.commands.register === "function") {
    api.commands.register({ id: "quick-actions.assign-me", title: "Assign Ticket to Me", group: "Quick Actions",
      keywords: ["take", "mine", "agent", "responder"], run: function () { withTicket(assignToMe); } });
    api.commands.register({ id: "quick-actions.resolve", title: "Resolve Ticket", group: "Quick Actions",
      keywords: ["close", "done", "status"], run: function () { withTicket(resolve); } });
    api.commands.register({ id: "quick-actions.open", title: "Quick Actions: Change Status, Priority, Group or Agent…", group: "Quick Actions",
      keywords: ["assign", "status", "priority", "group"], run: function () { tab.activate(); } });
    if (typeof api.commands.addProvider === "function") {
      // "Set Ticket Status: Pending" etc., from the choices already loaded.
      api.commands.addProvider({
        id: "quick-actions.set",
        group: "Quick Actions",
        items: function (query) {
          if (!options || !ticket || !query || query.length < 3) return [];
          const out = [];
          (options.statuses || []).forEach(function (s) {
            if (s.value === ticket.status) return;
            out.push({ id: "status-" + s.value, title: "Set Ticket Status: " + s.label, subtitle: "#" + ticket.id,
              run: function () {
                if (s.value === resolvedStatus(options.statuses)) withTicket(resolve);
                else withTicket(function () { apply({ status: s.value }, "Saving"); });
              } });
          });
          (options.priorities || []).forEach(function (p) {
            if (p.value === ticket.priority) return;
            out.push({ id: "priority-" + p.value, title: "Set Ticket Priority: " + p.label, subtitle: "#" + ticket.id,
              run: function () { withTicket(function () { apply({ priority: p.value }, "Saving"); }); } });
          });
          return out;
        },
      });
    }
  }

  showEmpty("Open a ticket to change its status, priority, group or agent here.");
}());
