// Time Tracker plugin — main window renderer
//
// Adds a ⏱ Time tab to the side panel with a timer per ticket. The ticket comes
// from the site plugin that claims the active tab (pluginAPI.sites: its
// recordScript), so it works on any site with one. When the work is done,
// "Log time" hands the time and a note to the site's timeEntry adapter:
// Freshservice adds a time entry through its REST API, ConnectWise Manage fills
// the hours of the time entry open on the page. Copy works everywhere.
//
// Timers are saved by main.js (timers.json). A running timer stores when it was
// started (runningSince), so the clock is always computed from Date.now() and
// never drifts; running timers are paused when the window closes.
//
// The pure helpers at the top are exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  const PLUGIN_ID = "time-tracker";
  const MAX_TIMERS = 200;
  const MAX_NOTE = 4000;
  const MAX_LOG_MINUTES = 24 * 60;
  const ADJUST_MINUTES = 5;

  // ==================== Pure helpers ====================

  function elapsedMs(timer, now) {
    if (!timer) return 0;
    const base = Math.max(0, Number(timer.accumulatedMs) || 0);
    const since = Number(timer.runningSince) || 0;
    return since > 0 ? base + Math.max(0, now - since) : base;
  }

  // Exact time → whole minutes to log: up to the next minute, then up to the
  // next multiple of roundTo. Nothing tracked → 0.
  function roundMinutes(ms, roundTo) {
    const m = Math.ceil(Math.max(0, Number(ms) || 0) / 60000);
    if (m === 0) return 0;
    const step = Number.isInteger(roundTo) && roundTo > 1 ? roundTo : 1;
    return Math.ceil(m / step) * step;
  }

  // 3725000 → "1:02:05"
  function formatClock(ms) {
    const total = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  // 65 → "1:05"
  function formatHM(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0");
  }

  // 65 → "1.08"
  function decimalHours(minutes) {
    return (Math.round((Math.max(0, Number(minutes) || 0) / 60) * 100) / 100).toFixed(2);
  }

  // What someone types in the time box → minutes, or null.
  //   "1:05" → 65, "1h 5m" → 65, "90m" → 90, "1.5h" → 90, "1.5" → 90 (a
  //   decimal on its own is hours), "45" → 45 (a whole number is minutes).
  function parseDuration(input) {
    const s = String(input == null ? "" : input).trim().toLowerCase();
    if (!s) return null;
    let m = s.match(/^(\d{1,3}):([0-5]?\d)$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?$/);
    if (m && (m[1] || m[2])) return Math.round(Number(m[1] || 0) * 60) + Number(m[2] || 0);
    if (/^\d+$/.test(s)) return Number(s);
    if (/^\d*\.\d+$/.test(s)) return Math.round(Number(s) * 60);
    return null;
  }

  function timerName(timer) {
    const label = timer.label || timer.key;
    return (timer.siteName ? timer.siteName + " · " : "") + label;
  }

  // The text Copy puts on the clipboard.
  function buildCopyText(timer, minutes, note) {
    const lines = [formatHM(minutes) + " (" + decimalHours(minutes) + " h) — " + timerName(timer) +
      (timer.title ? ": " + timer.title : "")];
    const n = String(note || "").trim();
    if (n) lines.push(n);
    return lines.join("\n");
  }

  function sameRecord(timer, rec) {
    return !!(timer && rec && timer.siteId === rec.siteId && timer.key === rec.key);
  }

  // Stops a timer, folding the running stretch into accumulatedMs.
  function pauseTimer(timer, now) {
    if (!timer || !timer.runningSince) return timer;
    timer.accumulatedMs = elapsedMs(timer, now);
    timer.runningSince = null;
    return timer;
  }

  // Starts one timer; with oneAtATime, pauses every other one first.
  function startTimer(timers, timer, now, oneAtATime) {
    if (oneAtATime) timers.forEach(function (t) { if (t !== timer) pauseTimer(t, now); });
    if (!timer.runningSince) timer.runningSince = now;
    return timer;
  }

  // Moves a timer by deltaMinutes (never below zero), running or not.
  function adjustTimer(timer, deltaMinutes, now) {
    const running = !!timer.runningSince;
    pauseTimer(timer, now);
    timer.accumulatedMs = Math.max(0, timer.accumulatedMs + deltaMinutes * 60000);
    if (running) timer.runningSince = now;
    return timer;
  }

  // Keeps the list under MAX_TIMERS by dropping the oldest timers that aren't
  // running and have nothing unlogged on them first, then the oldest of the rest.
  function pruneTimers(timers, max) {
    const limit = max || MAX_TIMERS;
    if (timers.length <= limit) return timers;
    const out = timers.slice();
    for (let i = out.length - 1; i >= 0 && out.length > limit; i--) {
      if (!out[i].runningSince && !out[i].accumulatedMs) out.splice(i, 1);
    }
    return out.slice(0, limit);
  }

  // Timers still marked running when they're loaded weren't paused at close
  // (the app crashed or was killed). Count them up to the last save, then pause.
  function resumeAfterCrash(timers, savedAt, now) {
    const until = Math.min(Number(savedAt) || 0, now);
    timers.forEach(function (t) {
      if (!t.runningSince) return;
      t.accumulatedMs = (Number(t.accumulatedMs) || 0) + Math.max(0, until - t.runningSince);
      t.runningSince = null;
    });
    return timers;
  }

  function newId() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      elapsedMs, roundMinutes, formatClock, formatHM, decimalHours, parseDuration,
      buildCopyText, timerName, sameRecord, pauseTimer, startTimer, adjustTimer, pruneTimers, resumeAfterCrash,
    };
    return;
  }
  if (typeof window === "undefined" || !window.pluginAPI) return;

  // ===================== State =====================

  const api = window.pluginAPI;
  if (!api.ui || typeof api.ui.addSidePanelTab !== "function") return;

  let settings = api.getSettings();
  let timers = [];          // most recently started first
  let loaded = false;
  let current = null;       // the record open in the active tab, or null
  let openLogId = null;     // the timer whose Log form is open
  let logDraft = null;      // { id, time, note, billable } while the form is open
  let logBusy = false;

  function roundTo() { return Number(settings.timeTrackerRoundTo) || 1; }
  function oneAtATime() { return settings.timeTrackerOneAtATime !== false; }

  api.events.on("settings:changed", function (s) {
    settings = s;
    render();
  });

  // ===================== Saving =====================

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      api.invoke(PLUGIN_ID, "save", { timers: timers, savedAt: Date.now() }).catch(function (err) {
        console.error("[Time Tracker] save:", err);
      });
    }, 400);
  }

  window.addEventListener("beforeunload", function () {
    if (!loaded) return;
    const now = Date.now();
    timers.forEach(function (t) { pauseTimer(t, now); });
    clearTimeout(saveTimer);
    try { api.send(PLUGIN_ID, "save-sync", { timers: timers, savedAt: now }); } catch { /* closing anyway */ }
  });

  // ===================== Finding the open ticket =====================

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
    let link = url;
    if (typeof site.recordLink === "function") {
      try { link = site.recordLink(url) || url; } catch { /* keep the page URL */ }
    }
    return {
      siteId: site.id,
      siteName: site.shortName || site.name,
      key: String(rec.ticket).substring(0, 100),
      recordId: rec.id != null && /^\d{1,20}$/.test(String(rec.id)) ? String(rec.id) : "",
      kind: typeof rec.kind === "string" ? rec.kind : "",
      label: String(rec.label || rec.ticket).substring(0, 300),
      title: String(title).substring(0, 300),
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
    current = rec;
    if (rec) {
      // Keep a timer's title and link fresh (the subject loads after the URL).
      const t = findTimer(rec);
      if (t && rec.title && (t.title !== rec.title || t.url !== rec.url)) {
        t.title = rec.title;
        t.url = rec.url || t.url;
        scheduleSave();
      }
    }
    if (changed && rec && loaded && settings.timeTrackerAutoStart === true) {
      const t = findTimer(rec);
      if (!t || !t.runningSince) start(rec);
    }
    render();
  }

  let detectTimer = null;
  function scheduleDetect(delay) {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detectActive, delay == null ? 400 : delay);
  }

  const watched = new Map(); // webview → listener
  function watchWebview(webview) {
    if (!webview || watched.has(webview)) return;
    const onNav = function () {
      const active = api.browser.getActiveTab();
      if (active && active.webview === webview) scheduleDetect(600);
    };
    ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-finish-load"].forEach(function (ev) {
      webview.addEventListener(ev, onNav);
    });
    watched.set(webview, onNav);
  }

  api.browser.getTabs().forEach(function (t) { watchWebview(t.webview); });
  api.events.on("tab:created", function (t) { watchWebview(t && t.webview); });
  api.events.on("tab:activated", function () { scheduleDetect(100); });
  api.events.on("tab:closed", function (t) {
    const wv = t && t.webview;
    const fn = wv && watched.get(wv);
    if (fn) {
      ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-finish-load"].forEach(function (ev) {
        try { wv.removeEventListener(ev, fn); } catch { /* already gone */ }
      });
      watched.delete(wv);
    }
    scheduleDetect(100);
  });
  api.events.on("ticket:changed", function () { scheduleDetect(100); });
  api.sites.onRegistered(function () { scheduleDetect(300); });

  // ===================== Timer actions =====================

  function findTimer(rec) {
    return timers.find(function (t) { return sameRecord(t, rec); }) || null;
  }

  function start(rec) {
    const now = Date.now();
    let t = findTimer(rec);
    if (!t) {
      t = {
        id: newId(),
        siteId: rec.siteId,
        siteName: rec.siteName,
        key: rec.key,
        recordId: rec.recordId,
        kind: rec.kind,
        label: rec.label,
        title: rec.title,
        url: rec.url,
        accumulatedMs: 0,
        runningSince: null,
        createdAt: new Date(now).toISOString(),
        note: "",
        billable: settings.timeTrackerBillable !== false,
        loggedAt: null,
        loggedMinutes: 0,
      };
    }
    timers = [t].concat(timers.filter(function (x) { return x !== t; }));
    startTimer(timers, t, now, oneAtATime());
    timers = pruneTimers(timers, MAX_TIMERS);
    scheduleSave();
    render();
  }

  function pause(t) {
    pauseTimer(t, Date.now());
    scheduleSave();
    render();
  }

  function resume(t) {
    startTimer(timers, t, Date.now(), oneAtATime());
    scheduleSave();
    render();
  }

  function adjust(t, delta) {
    adjustTimer(t, delta, Date.now());
    if (logDraft && logDraft.id === t.id) logDraft.time = formatHM(roundMinutes(elapsedMs(t, Date.now()), roundTo()));
    scheduleSave();
    render();
  }

  async function remove(t) {
    const ms = elapsedMs(t, Date.now());
    if (ms >= 60000) {
      const ok = await api.ui.confirm("Delete the timer for " + timerName(t) + "? It has " + formatClock(ms) + " that hasn't been logged.");
      if (!ok) return;
    }
    timers = timers.filter(function (x) { return x !== t; });
    if (openLogId === t.id) closeLog();
    scheduleSave();
    render();
  }

  function clearLogged() {
    timers = timers.filter(function (t) { return t.runningSince || t.accumulatedMs > 0 || !t.loggedAt; });
    scheduleSave();
    render();
  }

  function openLog(t) {
    openLogId = t.id;
    logDraft = {
      id: t.id,
      time: formatHM(roundMinutes(elapsedMs(t, Date.now()), roundTo())),
      note: t.note || "",
      billable: t.billable !== false,
      status: "",
      statusKind: "",
    };
    render();
    const box = panel.querySelector('.tmr-log textarea');
    if (box) box.focus();
  }

  function closeLog() {
    openLogId = null;
    logDraft = null;
    render();
  }

  function markLogged(t, minutes) {
    pauseTimer(t, Date.now());
    t.accumulatedMs = 0;
    t.loggedMinutes = (t.loggedMinutes || 0) + minutes;
    t.loggedAt = new Date().toISOString();
    t.note = "";
    scheduleSave();
  }

  function draftMinutes() {
    const m = parseDuration(logDraft && logDraft.time);
    return m != null && m >= 1 && m <= MAX_LOG_MINUTES ? m : null;
  }

  // The tab to hand the site adapter: the active tab when it shows this
  // timer's site, else any tab on that site.
  function webviewForSite(siteId) {
    const active = api.browser.getActiveTab();
    const onSite = function (wv) {
      const site = api.sites.forWebview(wv);
      return site && site.id === siteId;
    };
    if (active && onSite(active.webview)) return active.webview;
    const any = api.browser.getTabs().find(function (t) { return onSite(t.webview); });
    return any ? any.webview : null;
  }

  async function logToSite(t) {
    const site = api.sites.get(t.siteId);
    const minutes = draftMinutes();
    if (!site || !site.timeEntry || minutes == null || logBusy) return;
    logBusy = true;
    setLogStatus("Saving…", "");
    const webview = webviewForSite(t.siteId);
    let url = t.url;
    try { if (webview) url = webview.getURL() || url; } catch { /* use the saved link */ }
    let res;
    try {
      res = await site.timeEntry.log({
        webview: webview,
        url: url,
        record: { ticket: t.key, kind: t.kind || "ticket", id: t.recordId, label: t.label },
        minutes: minutes,
        note: logDraft.note,
        billable: site.timeEntry.billable ? logDraft.billable : undefined,
        startedAt: t.createdAt,
      });
    } catch (err) {
      res = { error: err && err.message ? err.message : String(err) };
    }
    logBusy = false;
    if (res && res.ok) {
      markLogged(t, minutes);
      openLogId = null;
      logDraft = null;
      flash(res.message || ("Logged " + formatHM(minutes) + " on " + timerName(t) + "."), "ok");
      render();
    } else {
      setLogStatus(((res && res.error) || "The time wasn't logged.") + " Copy it instead and paste it into the site.", "error");
    }
  }

  async function copyLog(t) {
    const minutes = draftMinutes();
    if (minutes == null) return;
    try {
      await navigator.clipboard.writeText(buildCopyText(t, minutes, logDraft.note));
      setLogStatus("Copied. Paste it into the time entry, then choose Mark logged.", "ok");
    } catch {
      setLogStatus("Couldn't copy to the clipboard.", "error");
    }
  }

  function markLoggedFromForm(t) {
    const minutes = draftMinutes();
    if (minutes == null) return;
    markLogged(t, minutes);
    openLogId = null;
    logDraft = null;
    flash("Marked " + formatHM(minutes) + " as logged on " + timerName(t) + ".", "ok");
    render();
  }

  // ===================== UI =====================

  const sidePanelTab = api.ui.addSidePanelTab({
    id: PLUGIN_ID,
    label: "Time",
    icon: "⏱",
    title: "Time Tracker: time the ticket you're working on and log it",
    order: 40,
  });
  const panel = sidePanelTab.element;
  panel.classList.add("tmr-panel");

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

  function button(label, cls, title, onClick, disabled) {
    return h("button", { type: "button", className: "btn btn-small " + cls, title: title, onclick: onClick, disabled: !!disabled }, [label]);
  }

  let flashMsg = null;
  let flashTimer = null;
  function flash(text, kind) {
    flashMsg = { text: text, kind: kind };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashMsg = null; render(); }, 8000);
  }

  function setLogStatus(text, kind) {
    if (!logDraft) return;
    logDraft.status = text;
    logDraft.statusKind = kind;
    const el = panel.querySelector(".tmr-log-status");
    if (el) {
      el.textContent = text;
      el.className = "tmr-log-status" + (kind ? " tmr-" + kind : "");
    }
  }

  function renderCurrent() {
    const box = h("div", { className: "tmr-current" });
    if (!current) {
      box.appendChild(h("div", { className: "tmr-current-empty" }, [
        "Open a ticket in the active tab to time it.",
      ]));
      return box;
    }
    const t = findTimer(current);
    const running = !!(t && t.runningSince);
    box.appendChild(h("div", { className: "tmr-current-label" }, [timerName(current)]));
    if (current.title) box.appendChild(h("div", { className: "tmr-current-title", title: current.title }, [current.title]));
    const row = h("div", { className: "tmr-current-row" }, [
      h("span", { className: "tmr-clock tmr-clock-big" + (running ? " tmr-running" : ""), "data-timer": t ? t.id : "" },
        [formatClock(t ? elapsedMs(t, Date.now()) : 0)]),
    ]);
    const buttons = h("div", { className: "tmr-buttons" });
    if (running) buttons.appendChild(button("Pause", "btn-secondary", "Pause this ticket's timer", function () { pause(t); }));
    else buttons.appendChild(button(t && t.accumulatedMs ? "Resume" : "Start", "btn-primary", "Start timing this ticket", function () { start(current); }));
    if (t) {
      buttons.appendChild(button("−" + ADJUST_MINUTES, "btn-secondary", "Take " + ADJUST_MINUTES + " minutes off", function () { adjust(t, -ADJUST_MINUTES); }));
      buttons.appendChild(button("+" + ADJUST_MINUTES, "btn-secondary", "Add " + ADJUST_MINUTES + " minutes", function () { adjust(t, ADJUST_MINUTES); }));
      buttons.appendChild(button("Log time…", "btn-secondary", "Log this time on the ticket", function () { openLog(t); }, elapsedMs(t, Date.now()) === 0));
    }
    row.appendChild(buttons);
    box.appendChild(row);
    if (t && t.loggedMinutes) {
      box.appendChild(h("div", { className: "tmr-muted" }, ["Logged so far: " + formatHM(t.loggedMinutes)]));
    }
    return box;
  }

  function renderLogForm(t) {
    const site = api.sites.get(t.siteId);
    const te = site && site.timeEntry;
    const form = h("div", { className: "tmr-log" });
    const minutes = draftMinutes();

    const timeInput = h("input", {
      type: "text", className: "settings-text-input tmr-log-time", value: logDraft.time,
      placeholder: "h:mm", "aria-label": "Time to log", spellcheck: "false", autocomplete: "off", maxlength: "12",
    });
    const hint = h("span", { className: "tmr-muted tmr-log-hint" }, [minutes != null ? "= " + decimalHours(minutes) + " h" : "Enter h:mm, e.g. 0:45"]);
    timeInput.addEventListener("input", function () {
      logDraft.time = timeInput.value;
      const m = draftMinutes();
      hint.textContent = m != null ? "= " + decimalHours(m) + " h" : "Enter h:mm, e.g. 0:45";
      form.querySelectorAll(".tmr-needs-time").forEach(function (b) { b.disabled = m == null || logBusy; });
    });
    form.appendChild(h("div", { className: "tmr-log-row" }, [h("label", { className: "tmr-log-label" }, ["Time"]), timeInput, hint]));

    const note = h("textarea", {
      className: "tmr-log-note", rows: "3", maxlength: String(MAX_NOTE),
      placeholder: "What you did (goes in the time entry's note)",
    });
    note.value = logDraft.note;
    note.addEventListener("input", function () {
      logDraft.note = note.value;
      t.note = note.value;
      scheduleSave();
    });
    form.appendChild(note);

    if (te && te.billable) {
      const cb = h("input", { type: "checkbox", checked: logDraft.billable });
      cb.addEventListener("change", function () { logDraft.billable = cb.checked; t.billable = cb.checked; scheduleSave(); });
      form.appendChild(h("label", { className: "tmr-log-check" }, [cb, " Billable"]));
    }

    const actions = h("div", { className: "tmr-buttons" });
    if (te) {
      const b = button(te.label, "btn-primary tmr-needs-time", "Send this time to " + (site.name || "the site"), function () { logToSite(t); }, minutes == null || logBusy);
      actions.appendChild(b);
    }
    actions.appendChild(button("📋 Copy", "btn-secondary tmr-needs-time", "Copy the time and note", function () { copyLog(t); }, minutes == null));
    actions.appendChild(button("Mark logged", "btn-secondary tmr-needs-time", "You logged it yourself: reset this timer", function () { markLoggedFromForm(t); }, minutes == null));
    actions.appendChild(button("Cancel", "btn-secondary", null, closeLog));
    form.appendChild(actions);
    if (!te) {
      form.appendChild(h("div", { className: "tmr-muted" }, [
        (site ? site.name : "This site") + " can't take time entries from MSP++ yet, so copy the time and paste it in.",
      ]));
    }
    form.appendChild(h("div", { className: "tmr-log-status" + (logDraft.statusKind ? " tmr-" + logDraft.statusKind : ""), "aria-live": "polite" }, [logDraft.status || ""]));
    return form;
  }

  function renderRow(t) {
    const running = !!t.runningSince;
    const ms = elapsedMs(t, Date.now());
    const isCurrent = sameRecord(t, current);
    const row = h("div", { className: "tmr-row" + (running ? " tmr-row-running" : "") + (isCurrent ? " tmr-row-current" : "") });
    const name = t.url
      ? h("a", { href: "#", className: "tmr-row-label", title: "Open " + timerName(t), onclick: function (e) { e.preventDefault(); api.browser.newTab(t.url); } }, [timerName(t)])
      : h("span", { className: "tmr-row-label" }, [timerName(t)]);
    row.appendChild(h("div", { className: "tmr-row-main" }, [
      h("div", { className: "tmr-row-text" }, [
        name,
        t.title ? h("div", { className: "tmr-row-title", title: t.title }, [t.title]) : null,
        t.loggedAt ? h("div", { className: "tmr-muted" }, [
          "Logged " + formatHM(t.loggedMinutes) + " · last " + new Date(t.loggedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
        ]) : null,
      ]),
      h("span", { className: "tmr-clock" + (running ? " tmr-running" : ""), "data-timer": t.id }, [formatClock(ms)]),
    ]));
    const actions = h("div", { className: "tmr-buttons tmr-row-actions" }, [
      running
        ? button("Pause", "btn-secondary", "Pause this timer", function () { pause(t); })
        : button(ms ? "Resume" : "Start", "btn-secondary", ms ? "Resume this timer" : "Start this timer", function () { resume(t); }),
      button("Log…", "btn-secondary", "Log this time on the ticket", function () { openLog(t); }, ms === 0),
      button("🗑", "btn-secondary", "Delete this timer", function () { remove(t); }),
    ]);
    row.appendChild(actions);
    if (openLogId === t.id && logDraft) row.appendChild(renderLogForm(t));
    return row;
  }

  function render() {
    if (!loaded) return;
    const focused = document.activeElement;
    const focusClass = focused && panel.contains(focused) ? focused.className : null;
    const caret = focused && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;

    panel.textContent = "";
    const now = Date.now();
    const unlogged = timers.reduce(function (sum, t) { return sum + elapsedMs(t, now); }, 0);
    panel.appendChild(h("div", { className: "tmr-header" }, [
      h("span", { className: "tmr-title" }, ["Time Tracker"]),
      h("span", { className: "tmr-muted", title: "Time on all timers that hasn't been logged yet" }, ["Unlogged ", h("span", { className: "tmr-total" }, [formatClock(unlogged)])]),
    ]));
    if (flashMsg) panel.appendChild(h("div", { className: "tmr-flash tmr-" + flashMsg.kind, "aria-live": "polite" }, [flashMsg.text]));
    panel.appendChild(renderCurrent());

    const list = h("div", { className: "tmr-list" });
    const hasLogged = timers.some(function (t) { return t.loggedAt && !t.runningSince && !t.accumulatedMs; });
    list.appendChild(h("div", { className: "tmr-list-header" }, [
      h("span", null, ["Timers"]),
      hasLogged ? button("Clear logged", "btn-secondary", "Remove timers that are logged and have no new time", clearLogged) : null,
    ]));
    if (!timers.length) list.appendChild(h("div", { className: "tmr-muted tmr-empty" }, ["No timers yet."]));
    timers.forEach(function (t) { list.appendChild(renderRow(t)); });
    panel.appendChild(list);

    // Put the cursor back where it was if a re-render replaced the focused field.
    if (focusClass) {
      const again = panel.querySelector("." + String(focusClass).split(/\s+/).filter(Boolean).join("."));
      if (again) {
        again.focus();
        if (caret && typeof again.setSelectionRange === "function") {
          try { again.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ }
        }
      }
    }
  }

  // Ticks the clocks once a second while a timer runs and the tab is showing.
  setInterval(function () {
    if (!loaded || !sidePanelTab.isActive()) return;
    if (!timers.some(function (t) { return t.runningSince; })) return;
    const now = Date.now();
    panel.querySelectorAll(".tmr-clock[data-timer]").forEach(function (el) {
      const t = timers.find(function (x) { return x.id === el.getAttribute("data-timer"); });
      if (t) el.textContent = formatClock(elapsedMs(t, now));
    });
    const total = panel.querySelector(".tmr-total");
    if (total) total.textContent = formatClock(timers.reduce(function (sum, t) { return sum + elapsedMs(t, now); }, 0));
  }, 1000);

  // Saves running timers once a minute, so a crash loses at most a minute.
  setInterval(function () {
    if (loaded && timers.some(function (t) { return t.runningSince; })) scheduleSave();
  }, 60000);

  // Single-page sites don't always fire navigation events; look again now and
  // then while the tab is showing.
  setInterval(function () {
    if (sidePanelTab.isActive()) detectActive();
  }, 5000);

  sidePanelTab.onShow(function () { render(); scheduleDetect(0); });

  if (typeof api.ui.addTabMenuItem === "function") {
    api.ui.addTabMenuItem({
      id: "time-tracker-start",
      icon: "⏱",
      label: "Start Timer for This Ticket",
      isVisible: function (tab) {
        const site = api.sites.forUrl(tab.url);
        return !!(site && site.recordScript);
      },
      onClick: async function (tab) {
        const rec = await recordInWebview(tab.webview);
        if (!rec) {
          api.ui.notify({ type: "time-tracker", title: "No ticket found", desc: "That tab isn't showing a ticket the timer can use." });
          return;
        }
        start(rec);
        sidePanelTab.activate();
      },
    });
  }

  api.invoke(PLUGIN_ID, "load").then(function (store) {
    timers = store && Array.isArray(store.timers) ? store.timers : [];
    resumeAfterCrash(timers, store && store.savedAt, Date.now());
  }).catch(function (err) {
    console.error("[Time Tracker] load:", err);
  }).then(function () {
    loaded = true;
    render();
    scheduleDetect(0);
  });
})();
