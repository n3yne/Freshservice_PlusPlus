// Follow-up Reminders plugin — main window renderer
//
// Adds a ⏰ Follow-ups tab to the side panel. On a ticket (any site whose
// plugin knows its tickets through pluginAPI.sites, or failing that any web
// page) you pick when to be reminded: in an hour, in 3 hours, tomorrow
// morning, next Monday or a date and time of your own, with an optional note.
// When the time comes MSP++ shows a desktop alert and a notification under the
// bell; clicking either opens the ticket. A reminder that has gone off stays at
// the top of the list under "Due" until you mark it done or snooze it.
//
// One reminder per ticket: setting a new time replaces the old one. Reminders
// that came due while MSP++ was closed go off when it next starts.
//
// The list is saved by main.js (reminders.json). The pure helpers at the top
// are exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  const PLUGIN_ID = "follow-ups";
  const HARD_MAX = 500;
  const MAX_NOTE = 1000;
  const MAX_POPUPS = 3;
  const DEFAULT_MORNING = 9;
  const CHECK_MAX_MS = 30000;
  const MIN = 60000;
  const HOUR = 60 * MIN;

  // ==================== Pure helpers ====================

  function sameRecord(a, b) {
    return !!(a && b && a.siteId === b.siteId && a.key === b.key);
  }

  function morningHour(h) {
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_MORNING;
  }

  function atHour(t, dayOffset, hour) {
    const d = new Date(t);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }

  function timeLabel(t) {
    return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // The quick choices for a new reminder, soonest first.
  function presetTimes(now, morning) {
    const hour = morningHour(morning);
    const list = [
      { id: "1h", label: "In 1 hour", at: now + HOUR },
      { id: "3h", label: "In 3 hours", at: now + 3 * HOUR },
    ];
    // "5 PM today" while there's still a useful gap before it.
    const eod = atHour(now, 0, 17);
    if (eod > now + 3 * HOUR + 30 * MIN) {
      list.push({ id: "eod", label: timeLabel(eod) + " today", at: eod });
    }
    list.push({ id: "tomorrow", label: "Tomorrow " + timeLabel(atHour(now, 1, hour)), at: atHour(now, 1, hour) });
    // Next Monday morning; a week today when it's Monday already.
    const day = new Date(now).getDay();
    const toMonday = ((8 - day) % 7) || 7;
    if (toMonday !== 1) {
      list.push({ id: "monday", label: (toMonday === 7 ? "Next Monday " : "Monday ") + timeLabel(atHour(now, toMonday, hour)), at: atHour(now, toMonday, hour) });
    } else {
      list.push({ id: "week", label: "In a week", at: atHour(now, 7, hour) });
    }
    return list;
  }

  // The quick choices for putting off a reminder.
  function snoozeTimes(now, morning) {
    const hour = morningHour(morning);
    return [
      { id: "15m", label: "15 min", at: now + 15 * MIN },
      { id: "1h", label: "1 hour", at: now + HOUR },
      { id: "3h", label: "3 hours", at: now + 3 * HOUR },
      { id: "tomorrow", label: "Tomorrow " + timeLabel(atHour(now, 1, hour)), at: atHour(now, 1, hour) },
    ];
  }

  function newId(now) {
    return now.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  // Adds a reminder for rec at dueAt, replacing any reminder already on that
  // ticket. Returns { list, reminder }; the list is sorted by due time.
  function setReminder(list, rec, dueAt, note, now, id) {
    const old = list.find(function (r) { return sameRecord(r, rec); });
    const reminder = {
      id: (old && old.id) || id || newId(now),
      siteId: rec.siteId || "",
      siteName: rec.siteName || (old && old.siteName) || "",
      key: rec.key,
      kind: rec.kind || (old && old.kind) || "",
      label: rec.label || (old && old.label) || rec.key,
      title: rec.title || (old && old.title) || "",
      url: rec.url || (old && old.url) || "",
      note: String(note == null ? (old ? old.note : "") : note).substring(0, MAX_NOTE),
      dueAt: new Date(dueAt).toISOString(),
      createdAt: (old && old.createdAt) || new Date(now).toISOString(),
      firedAt: null,
      snoozes: old ? old.snoozes || 0 : 0,
    };
    const rest = list.filter(function (r) { return !sameRecord(r, rec); });
    return { list: sortReminders([reminder].concat(rest)).slice(0, HARD_MAX), reminder };
  }

  // Moves a reminder to a new time so it goes off again. Returns a new list.
  function snoozeReminder(list, id, dueAt) {
    return sortReminders(list.map(function (r) {
      if (r.id !== id) return r;
      return Object.assign({}, r, {
        dueAt: new Date(dueAt).toISOString(),
        firedAt: null,
        snoozes: (r.snoozes || 0) + 1,
      });
    }));
  }

  function sortReminders(list) {
    return list.slice().sort(function (a, b) {
      return (Date.parse(a.dueAt) || 0) - (Date.parse(b.dueAt) || 0);
    });
  }

  // Reminders whose time has come and that haven't gone off yet.
  function dueToFire(list, now) {
    return list.filter(function (r) {
      return !r.firedAt && (Date.parse(r.dueAt) || 0) <= now;
    });
  }

  // How long to wait before looking again: until the next reminder is due,
  // but never more than 30 seconds (sleep and clock changes throw timers off).
  function nextDelay(list, now) {
    let next = Infinity;
    list.forEach(function (r) {
      if (r.firedAt) return;
      const t = Date.parse(r.dueAt);
      if (Number.isFinite(t) && t < next) next = t;
    });
    return Math.max(0, Math.min(CHECK_MAX_MS, next - now));
  }

  function startOfDay(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function spanText(ms) {
    const m = Math.round(ms / MIN);
    if (m < 60) return m + " min";
    const hrs = Math.floor(m / 60);
    const rem = m % 60;
    if (hrs < 24) return hrs + " h" + (rem && hrs < 6 ? " " + rem + " min" : "");
    const days = Math.round(hrs / 24);
    return days + (days === 1 ? " day" : " days");
  }

  // "in 25 min", "in 2 h 10 min", "tomorrow 9:00 AM", "Mon 9:00 AM",
  // "due now", "overdue by 3 h".
  function formatDue(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const diff = t - now;
    if (diff <= 0) {
      if (-diff < MIN) return "due now";
      return "overdue by " + spanText(-diff);
    }
    if (diff < 6 * HOUR) return "in " + spanText(Math.max(MIN, diff));
    const days = Math.round((startOfDay(t) - startOfDay(now)) / 86400000);
    if (days === 0) return "today " + timeLabel(t);
    if (days === 1) return "tomorrow " + timeLabel(t);
    if (days < 7) return new Date(t).toLocaleDateString([], { weekday: "short" }) + " " + timeLabel(t);
    return new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  // Splits the list into Due, Today, Tomorrow and Later, leaving out empty
  // groups. The list should already be sorted.
  function groupReminders(list, now) {
    const tomorrow = startOfDay(now) + 86400000;
    const dayAfter = tomorrow + 86400000;
    const groups = [
      { id: "due", label: "Due", items: [] },
      { id: "today", label: "Later today", items: [] },
      { id: "tomorrow", label: "Tomorrow", items: [] },
      { id: "later", label: "Later", items: [] },
    ];
    list.forEach(function (r) {
      const t = Date.parse(r.dueAt) || 0;
      if (r.firedAt || t <= now) groups[0].items.push(r);
      else if (t < tomorrow) groups[1].items.push(r);
      else if (t < dayAfter) groups[2].items.push(r);
      else groups[3].items.push(r);
    });
    return groups.filter(function (g) { return g.items.length; });
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // The value for an <input type="datetime-local"> showing t in local time.
  function toLocalInput(t) {
    const d = new Date(t);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // Reads a datetime-local value as local time; NaN when it isn't one.
  function parseLocalInput(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s || ""));
    if (!m) return NaN;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
    return d.getMonth() === +m[2] - 1 ? d.getTime() : NaN;
  }

  function reminderName(r) {
    return (r.siteName ? r.siteName + " · " : "") + (r.label || r.key);
  }

  // The words of a reminder's desktop alert.
  function alertText(r) {
    const lines = [];
    if (r.note) lines.push(r.note);
    if (r.title) lines.push(r.title);
    return { title: "Follow up: " + reminderName(r), body: lines.join("\n") || "Your follow-up reminder is due." };
  }

  function summaryText(list) {
    const names = list.slice(0, 4).map(reminderName);
    return {
      title: list.length + " follow-ups are due",
      body: names.join(", ") + (list.length > names.length ? " and " + (list.length - names.length) + " more" : ""),
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      sameRecord, presetTimes, snoozeTimes, setReminder, snoozeReminder, sortReminders,
      dueToFire, nextDelay, formatDue, groupReminders, toLocalInput, parseLocalInput,
      reminderName, alertText, summaryText, HARD_MAX, MAX_NOTE,
    };
    return;
  }
  if (typeof window === "undefined" || !window.pluginAPI) return;

  // ===================== State =====================

  const api = window.pluginAPI;
  if (!api.ui || typeof api.ui.addSidePanelTab !== "function") return;

  let settings = api.getSettings();
  let reminders = [];      // sorted by due time
  let loaded = false;
  let current = null;      // the ticket (or page) in the active tab, or null
  let picked = null;       // a ticket chosen from a tab's right-click menu
  let snoozeOpenId = null; // the row whose snooze choices are showing
  let undo = null;         // { reminder } after Done, for the Undo button

  function morning() { return morningHour(Number(settings.followUpMorningHour)); }
  function target() { return picked || current; }

  api.events.on("settings:changed", function (s) {
    settings = s;
    render();
  });

  // ===================== Saving =====================

  let saveTimer = null;
  function scheduleSave() {
    if (!loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      api.invoke(PLUGIN_ID, "save", { reminders: reminders }).catch(function (err) {
        console.error("[Follow-ups] save:", err);
      });
    }, 300);
  }

  window.addEventListener("beforeunload", function () {
    if (!loaded || !saveTimer) return;
    clearTimeout(saveTimer);
    try { api.send(PLUGIN_ID, "save-sync", { reminders: reminders }); } catch { /* closing anyway */ }
  });

  // ===================== Finding the ticket in a tab =====================

  function cleanLink(site, url) {
    if (site && typeof site.recordLink === "function") {
      try { return site.recordLink(url) || url; } catch { /* keep the page URL */ }
    }
    return url;
  }

  // The ticket shown in a webview, or the page itself when no site plugin
  // knows it as a ticket. Null for blank pages and the like.
  async function recordInWebview(webview) {
    if (!webview) return null;
    let url;
    let title = "";
    try { url = webview.getURL(); } catch { return null; }
    try { title = webview.getTitle() || ""; } catch { /* tab gone */ }
    if (!/^https?:\/\//i.test(url)) return null;
    const site = api.sites.forWebview(webview);
    if (site && typeof site.formatTitle === "function") {
      try { title = site.formatTitle(title); } catch { /* keep the raw title */ }
    }
    if (title === url) title = "";
    let rec = null;
    if (site && site.recordScript) {
      try { rec = await webview.executeJavaScript(site.recordScript); } catch { rec = null; }
    }
    if (rec && rec.ticket) {
      const link = cleanLink(site, url);
      if (!/^https?:\/\//i.test(link)) return null;
      return {
        siteId: site.id,
        siteName: site.shortName || site.name || "",
        key: String(rec.ticket).substring(0, 100),
        kind: typeof rec.kind === "string" ? rec.kind : "",
        label: String(rec.label || rec.ticket).substring(0, 300),
        title: String(title).substring(0, 300),
        url: link,
        isTicket: true,
      };
    }
    let host = "";
    try { host = new URL(url).hostname; } catch { /* checked above */ }
    return {
      siteId: "",
      siteName: "",
      key: url.substring(0, 2048),
      kind: "page",
      label: String(title || host).substring(0, 300),
      title: title ? host : "",
      url: url.substring(0, 2048),
      isTicket: false,
    };
  }

  let detectSeq = 0;
  async function detectActive() {
    const seq = ++detectSeq;
    const active = api.browser.getActiveTab();
    const rec = active ? await recordInWebview(active.webview) : null;
    if (seq !== detectSeq) return;
    const changed = !sameRecord(current, rec) || (rec && current && rec.title !== current.title);
    current = rec;
    if (changed && sidePanelTab.isActive()) render();
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
  api.events.on("tab:activated", function () { picked = null; scheduleDetect(150); });
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

  // ===================== Opening a ticket =====================

  function findOpenTab(r) {
    const site = r.siteId ? api.sites.get(r.siteId) : null;
    for (const t of api.browser.getTabs()) {
      if (!t.url) continue;
      if (t.url === r.url) return t;
      if (!site) continue;
      const s = api.sites.forUrl(t.url);
      if (s && s.id === site.id && cleanLink(site, t.url) === r.url) return t;
    }
    return null;
  }

  function open(r, forceNewTab) {
    if (!r.url) return;
    if (!forceNewTab) {
      const t = findOpenTab(r);
      if (t) { api.browser.activateTab(t.tabId); return; }
    }
    api.browser.newTab(r.url);
  }

  // ===================== Alerts =====================

  function focusWindow() {
    api.invoke(PLUGIN_ID, "focus-window", {}).catch(function () {});
  }

  function popup(text, tag, onClick) {
    if (typeof Notification !== "function") return;
    try {
      const n = new Notification(text.title, { body: text.body, tag: tag, silent: settings.followUpSound === false });
      n.onclick = function () {
        focusWindow();
        if (onClick) onClick();
        n.close();
      };
    } catch (err) {
      console.warn("[Follow-ups] Could not show a desktop notification:", err);
    }
  }

  function fire(list) {
    if (!list.length) return;
    const at = new Date().toISOString();
    const ids = new Set(list.map(function (r) { return r.id; }));
    reminders = reminders.map(function (r) {
      return ids.has(r.id) ? Object.assign({}, r, { firedAt: at }) : r;
    });
    scheduleSave();
    list.forEach(function (r) {
      const text = alertText(r);
      api.ui.notify({
        type: "follow-up-" + r.id,
        title: text.title,
        desc: text.body,
        action: { label: "Open ticket", onClick: function () { open(r, false); } },
      });
    });
    if (settings.followUpDesktop !== false) {
      if (list.length > MAX_POPUPS) {
        popup(summaryText(list), "follow-ups-summary", function () { sidePanelTab.activate(); });
      } else {
        list.forEach(function (r) {
          popup(alertText(r), "follow-up-" + r.id, function () { open(r, false); sidePanelTab.activate(); });
        });
      }
    }
    render();
  }

  let checkTimer = null;
  function check() {
    clearTimeout(checkTimer);
    if (!loaded) return;
    const now = Date.now();
    fire(dueToFire(reminders, now));
    checkTimer = setTimeout(check, Math.max(1000, nextDelay(reminders, Date.now())));
  }

  // ===================== Actions =====================

  function setFor(rec, dueAt, note) {
    if (!rec || !Number.isFinite(dueAt)) return;
    const result = setReminder(reminders, rec, dueAt, note, Date.now());
    reminders = result.list;
    picked = null;
    undo = null;
    leaveForm();
    scheduleSave();
    flash("Follow-up for " + reminderName(result.reminder) + " set " + formatDue(result.reminder.dueAt, Date.now()) + ".");
    check();
  }

  // Lets the form re-render after it's used (render() leaves it alone while
  // it has the focus, so typing isn't interrupted).
  function leaveForm() {
    const el = document.activeElement;
    if (el && targetEl.contains(el) && typeof el.blur === "function") el.blur();
  }

  // Changes the note on the target's reminder without moving its time.
  function saveNote() {
    const rec = target();
    const note = noteInput.value.trim().substring(0, MAX_NOTE);
    let changed = null;
    reminders = reminders.map(function (r) {
      if (!sameRecord(r, rec)) return r;
      changed = Object.assign({}, r, { note: note });
      return changed;
    });
    if (!changed) return;
    leaveForm();
    scheduleSave();
    flash("Saved the note for " + reminderName(changed) + ".");
  }

  function snooze(r, dueAt) {
    reminders = snoozeReminder(reminders, r.id, dueAt);
    snoozeOpenId = null;
    scheduleSave();
    const again = reminders.find(function (x) { return x.id === r.id; });
    flash("Snoozed " + reminderName(r) + " until " + formatDue(again.dueAt, Date.now()) + ".");
    check();
  }

  function done(r) {
    reminders = reminders.filter(function (x) { return x.id !== r.id; });
    if (snoozeOpenId === r.id) snoozeOpenId = null;
    undo = { reminder: r };
    scheduleSave();
    flash("Done: " + reminderName(r) + ".");
  }

  function undoDone() {
    if (!undo) return;
    const r = undo.reminder;
    undo = null;
    reminders = sortReminders(reminders.filter(function (x) { return !sameRecord(x, r); }).concat([r]));
    scheduleSave();
    flash("Brought back " + reminderName(r) + ".");
    check();
  }

  // ===================== UI =====================

  const sidePanelTab = api.ui.addSidePanelTab({
    id: PLUGIN_ID,
    label: "Follow-ups",
    icon: "⏰",
    title: "Follow-up Reminders: get reminded to come back to a ticket",
    order: 45,
  });
  const panel = sidePanelTab.element;
  panel.classList.add("fup-panel");

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
      type: "button", className: "fup-icon-btn" + (cls ? " " + cls : ""), title: title, "aria-label": title,
      onclick: function (ev) { ev.stopPropagation(); onClick(); },
    }, [label]);
  }

  let flashMsg = "";
  let flashTimer = null;
  function flash(text) {
    flashMsg = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashMsg = ""; undo = null; render(); }, 6000);
    render();
  }

  // A row of time choices plus a date-and-time box, calling pick(time).
  function timeChooser(choices, pick, idPrefix, setLabel) {
    const wrap = h("div", { className: "fup-chooser" });
    const row = h("div", { className: "fup-presets" });
    choices.forEach(function (c) {
      row.appendChild(h("button", {
        type: "button", className: "btn btn-small btn-secondary fup-preset",
        title: new Date(c.at).toLocaleString([], { dateStyle: "full", timeStyle: "short" }),
        onclick: function (ev) { ev.stopPropagation(); pick(c.at); },
      }, [c.label]));
    });
    wrap.appendChild(row);
    const input = h("input", {
      type: "datetime-local", className: "settings-text-input fup-when", id: idPrefix + "-when",
      "aria-label": "Pick a date and time",
    });
    input.value = toLocalInput(Date.now() + HOUR);
    input.min = toLocalInput(Date.now());
    const err = h("div", { className: "fup-error", "aria-live": "polite" });
    const go = function () {
      const t = parseLocalInput(input.value);
      if (!Number.isFinite(t)) { err.textContent = "Pick a date and time."; return; }
      if (t <= Date.now()) { err.textContent = "Pick a time in the future."; return; }
      err.textContent = "";
      pick(t);
    };
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
    input.addEventListener("click", function (ev) { ev.stopPropagation(); });
    wrap.appendChild(h("div", { className: "fup-custom" }, [
      input,
      h("button", { type: "button", className: "btn btn-small btn-primary", onclick: function (ev) { ev.stopPropagation(); go(); } }, [setLabel]),
    ]));
    wrap.appendChild(err);
    return wrap;
  }

  // Built once so typing in the note never loses focus on a re-render.
  const header = h("div", { className: "fup-header" }, [h("span", { className: "fup-title" }, ["Follow-ups"])]);
  const countEl = h("span", { className: "fup-count" });
  header.appendChild(countEl);
  const flashEl = h("div", { className: "fup-flash", "aria-live": "polite" });
  const targetEl = h("div", { className: "fup-target" });
  const listEl = h("div", { className: "fup-list" });
  const noteInput = h("input", {
    type: "text", className: "settings-text-input fup-note", placeholder: "Note (optional), e.g. chase the user for a reply",
    maxlength: String(MAX_NOTE), "aria-label": "Reminder note", spellcheck: "true",
  });
  let noteFor = "";  // which ticket the note box was filled for
  const saveNoteBtn = h("button", {
    type: "button", className: "btn btn-small btn-secondary fup-save-note",
    onclick: function () { saveNote(); },
  }, ["Save note"]);

  function noteDiffers() {
    const rec = target();
    const existing = rec && reminders.find(function (r) { return sameRecord(r, rec); });
    return !!existing && noteInput.value.trim() !== (existing.note || "");
  }
  panel.appendChild(header);
  panel.appendChild(targetEl);
  panel.appendChild(flashEl);
  panel.appendChild(listEl);

  function renderTarget(now) {
    targetEl.textContent = "";
    const rec = target();
    if (!rec) {
      targetEl.appendChild(h("div", { className: "fup-muted" }, [
        "Open a ticket to set a follow-up reminder on it.",
      ]));
      return;
    }
    const existing = reminders.find(function (r) { return sameRecord(r, rec); });
    const recKey = rec.siteId + "|" + rec.key;
    if (noteFor !== recKey) {
      noteFor = recKey;
      noteInput.value = existing ? existing.note || "" : "";
    }
    targetEl.appendChild(h("div", { className: "fup-target-head" }, [
      rec.siteName ? h("span", { className: "fup-site" }, [rec.siteName]) : null,
      h("span", { className: "fup-label", title: rec.url }, [rec.label || rec.key]),
      picked ? h("span", { className: "fup-muted" }, ["(from tab menu)"]) : null,
    ]));
    if (rec.title) targetEl.appendChild(h("div", { className: "fup-target-title" }, [rec.title]));
    if (existing) {
      targetEl.appendChild(h("div", { className: "fup-existing" + (existing.firedAt ? " fup-overdue" : "") }, [
        "⏰ Reminder " + (existing.firedAt ? "went off, " : "") + formatDue(existing.dueAt, now) + ". Pick a new time to change it.",
      ]));
    }
    targetEl.appendChild(h("div", { className: "fup-section-label" }, [existing ? "Change the reminder to" : "Remind me"]));
    targetEl.appendChild(timeChooser(presetTimes(now, morning()), function (t) {
      setFor(rec, t, noteInput.value.trim());
    }, "fup-new", "Set"));
    targetEl.appendChild(noteInput);
    targetEl.appendChild(saveNoteBtn);
    saveNoteBtn.style.display = noteDiffers() ? "" : "none";
  }
  noteInput.addEventListener("input", function () {
    saveNoteBtn.style.display = noteDiffers() ? "" : "none";
  });
  noteInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && noteDiffers()) { ev.preventDefault(); saveNote(); }
  });

  function renderRow(r, now) {
    const due = !!r.firedAt || (Date.parse(r.dueAt) || 0) <= now;
    const isCurrent = sameRecord(r, current);
    const row = h("div", {
      className: "fup-row" + (due ? " fup-row-due" : "") + (isCurrent ? " fup-row-current" : ""),
      role: "button", tabindex: "0",
      title: "Open " + reminderName(r) + (r.title ? ": " + r.title : "") + "\nCtrl+click for a new tab",
    });
    row.addEventListener("click", function (ev) { open(r, ev.ctrlKey || ev.metaKey || ev.shiftKey); });
    row.addEventListener("keydown", function (ev) {
      if (ev.target !== row) return;
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(r, ev.ctrlKey || ev.metaKey); }
    });
    const text = h("div", { className: "fup-row-text" }, [
      h("div", { className: "fup-row-top" }, [
        r.siteName ? h("span", { className: "fup-site" }, [r.siteName]) : null,
        h("span", { className: "fup-label" }, [r.label || r.key]),
        isCurrent ? h("span", { className: "fup-open-badge" }, ["open"]) : null,
      ]),
      r.title ? h("div", { className: "fup-row-title" }, [r.title]) : null,
      r.note ? h("div", { className: "fup-row-note" }, [r.note]) : null,
      h("div", { className: "fup-due" + (due ? " fup-overdue" : "") }, [
        formatDue(r.dueAt, now) + (r.snoozes ? " · snoozed " + r.snoozes + "×" : ""),
      ]),
    ]);
    row.appendChild(text);
    row.appendChild(h("div", { className: "fup-row-actions" }, [
      iconButton("💤", "Snooze", function () {
        snoozeOpenId = snoozeOpenId === r.id ? null : r.id;
        renderList();
      }, snoozeOpenId === r.id ? "fup-active" : ""),
      iconButton("✓", "Done (remove the reminder)", function () { done(r); }, "fup-done"),
    ]));
    if (snoozeOpenId !== r.id) return row;
    const wrap = h("div", { className: "fup-row-wrap" }, [row]);
    const box = h("div", { className: "fup-snooze" }, [h("div", { className: "fup-section-label" }, ["Snooze until"])]);
    box.appendChild(timeChooser(snoozeTimes(now, morning()), function (t) { snooze(r, t); }, "fup-snz-" + r.id, "Snooze"));
    wrap.appendChild(box);
    return wrap;
  }

  function renderList() {
    if (!loaded) return;
    const now = Date.now();
    listEl.textContent = "";
    if (!reminders.length) {
      listEl.appendChild(h("div", { className: "fup-muted fup-empty" }, [
        "No follow-ups yet. Reminders you set show here, soonest first, and pop up on your desktop when they're due.",
      ]));
      return;
    }
    groupReminders(reminders, now).forEach(function (g) {
      listEl.appendChild(h("div", { className: "fup-group" + (g.id === "due" ? " fup-group-due" : "") }, [
        g.label + " (" + g.items.length + ")",
      ]));
      g.items.forEach(function (r) { listEl.appendChild(renderRow(r, now)); });
    });
  }

  function render() {
    if (!loaded) return;
    const now = Date.now();
    const dueCount = reminders.filter(function (r) { return r.firedAt || (Date.parse(r.dueAt) || 0) <= now; }).length;
    countEl.textContent = reminders.length
      ? reminders.length + " set" + (dueCount ? " · " + dueCount + " due" : "")
      : "";
    countEl.classList.toggle("fup-count-due", dueCount > 0);
    flashEl.textContent = "";
    if (flashMsg) {
      flashEl.appendChild(document.createTextNode(flashMsg + " "));
      if (undo) flashEl.appendChild(h("button", { type: "button", className: "fup-link-btn", onclick: undoDone }, ["Undo"]));
    }
    flashEl.style.display = flashMsg ? "" : "none";
    // Don't rebuild the form while someone is typing in it.
    if (!targetEl.contains(document.activeElement)) renderTarget(now);
    renderList();
  }

  // ===================== Entry points =====================

  if (typeof api.ui.addTabMenuItem === "function") {
    api.ui.addTabMenuItem({
      id: "follow-ups-remind",
      icon: "⏰",
      label: "Remind Me to Follow Up…",
      isVisible: function (tab) { return !!(tab && /^https?:\/\//i.test(tab.url || "")); },
      onClick: async function (tab) {
        const rec = await recordInWebview(tab.webview);
        if (!rec) return;
        const active = api.browser.getActiveTab();
        picked = active && active.tabId === tab.tabId ? null : rec;
        if (!picked) current = rec;
        noteFor = "";
        sidePanelTab.activate();
        render();
      },
    });
  }

  if (api.commands && typeof api.commands.register === "function") {
    const quick = [
      { id: "follow-ups:1h", title: "Follow Up on This Ticket in 1 Hour", at: function (n) { return n + HOUR; } },
      { id: "follow-ups:tomorrow", title: "Follow Up on This Ticket Tomorrow Morning", at: function (n) { return atHour(n, 1, morning()); } },
    ];
    quick.forEach(function (q) {
      api.commands.register({
        id: q.id,
        title: q.title,
        group: "Follow-ups",
        keywords: ["remind", "reminder", "snooze", "follow-up"],
        run: async function () {
          await detectActive();
          if (!current) { flash("Open a ticket first to set a follow-up."); sidePanelTab.activate(); return; }
          setFor(current, q.at(Date.now()), null);
        },
      });
    });
    api.commands.register({
      id: "follow-ups:show",
      title: "Show Follow-ups",
      group: "Follow-ups",
      keywords: ["remind", "reminders", "due"],
      run: function () { sidePanelTab.activate(); },
    });
    if (typeof api.commands.addProvider === "function") {
      api.commands.addProvider({
        id: "follow-ups",
        group: "Follow-ups",
        items: function (query) {
          if (!String(query || "").trim()) return [];
          const now = Date.now();
          return reminders.map(function (r) {
            return {
              id: "follow-up-" + r.id,
              title: "Follow-up: " + reminderName(r),
              subtitle: formatDue(r.dueAt, now) + (r.note ? " · " + r.note : r.title ? " · " + r.title : ""),
              keywords: [r.title || "", r.note || "", "reminder"],
              run: function () { open(r, false); },
              runInNewTab: function () { open(r, true); },
            };
          });
        },
      });
    }
  }

  // Keep "in 5 min" fresh while the tab is showing.
  setInterval(function () { if (loaded && sidePanelTab.isActive() && !targetEl.contains(document.activeElement)) render(); }, 30000);
  // Single-page sites don't always fire navigation events.
  setInterval(function () { if (sidePanelTab.isActive()) detectActive(); }, 5000);
  // A sleeping PC can stall timers; look again when the window comes back.
  window.addEventListener("focus", function () { check(); });

  sidePanelTab.onShow(function () { render(); scheduleDetect(0); });

  api.invoke(PLUGIN_ID, "load").then(function (store) {
    reminders = sortReminders(store && Array.isArray(store.reminders) ? store.reminders : []);
  }).catch(function (err) {
    console.error("[Follow-ups] load:", err);
  }).then(function () {
    loaded = true;
    render();
    scheduleDetect(0);
    // Give the window a moment so missed reminders aren't lost in start-up.
    setTimeout(check, 3000);
  });
})();
