// Metrics Bar plugin — main window renderer
// Injects the metrics bar above the tab strip and handles all polling/scraping.
(function () {
  const webviewArea = document.getElementById("webview-area");
  const tabBar = document.getElementById("tab-bar");
  if (!webviewArea || !tabBar) return;

  // --- Inject metrics bar HTML above the tab bar ---
  const metricsBar = document.createElement("div");
  metricsBar.id = "metrics-bar";
  metricsBar.className = "metrics-bar";
  metricsBar.innerHTML =
    '<div id="metrics-bar-items" class="metrics-bar-items"></div>' +
    '<div class="metrics-bar-end">' +
    '<span id="metrics-bar-status" class="metrics-bar-status"></span>' +
    '<button type="button" id="btn-metrics-refresh" class="metrics-bar-btn" title="Refresh metrics now">&#8635;</button>' +
    '<button type="button" id="btn-metrics-hide" class="metrics-bar-btn" title="Hide metrics bar">&#10005;</button>' +
    '</div>';
  webviewArea.insertBefore(metricsBar, tabBar);

  const metricsBarItems = document.getElementById("metrics-bar-items");
  const metricsBarStatus = document.getElementById("metrics-bar-status");
  const btnMetricsRefresh = document.getElementById("btn-metrics-refresh");
  const btnMetricsHide = document.getElementById("btn-metrics-hide");

  // Off-screen webview for background polling scrapes
  const metricsScraperWebview = document.createElement("webview");
  metricsScraperWebview.id = "metrics-scraper-webview";
  metricsScraperWebview.className = "metrics-scraper-webview";
  // Keep the hidden dashboard rendering at full speed even when MSP++ is
  // minimized or behind other windows. Without this Chromium pauses animation
  // frames and slows timers in the page, and widgets that draw their numbers
  // that way can still show an old value or a placeholder when we read them.
  metricsScraperWebview.setAttribute("webpreferences", "backgroundThrottling=no");
  metricsScraperWebview.src = "about:blank";
  document.body.appendChild(metricsScraperWebview);

  // --- State ---
  let appSettings = window.pluginAPI.getSettings();
  let metricsPollTimer = null;
  let metricsScraperBusy = false;
  let metricsRescheduleNeeded = false;
  let metricsRefreshQueued = false;
  const metricsStaleReason = {};
  // "api" or "dashboard": where each field's current value came from.
  const metricsSource = {};
  const metricsValues = {};
  const metricsCache = {};
  const metricsStale = new Set();
  const WEEK_RESET_STALE_WINDOW_MS = 60 * 60 * 1000;

  try {
    const _c = JSON.parse(localStorage.getItem("fspp-metrics-cache") || "{}");
    Object.keys(_c).forEach(function (id) {
      if (_c[id] && _c[id].value !== null && _c[id].value !== undefined) {
        metricsCache[id] = _c[id];
        metricsValues[id] = _c[id].value;
      }
    });
  } catch { /* start fresh */ }

  // Zero out cached values from a previous work week so stale numbers
  // don't persist into the new week before the first successful scrape.
  (function () {
    const _workDays = appSettings.metricsWorkDays || [1, 2, 3, 4, 5];
    const _weekEndDay = typeof appSettings.metricsWorkWeekEndDay === "number" ? appSettings.metricsWorkWeekEndDay : 5;
    let _weekStartDay = -1;
    for (let i = 1; i <= 7; i++) {
      const c = (_weekEndDay + i) % 7;
      if (_workDays.includes(c)) { _weekStartDay = c; break; }
    }
    if (_weekStartDay === -1) return;
    const _now = new Date();
    const _weekStart = new Date(_now);
    _weekStart.setDate(_weekStart.getDate() - (_now.getDay() - _weekStartDay + 7) % 7);
    _weekStart.setHours(0, 0, 0, 0);
    const _weekStartMs = _weekStart.getTime();
    let _changed = false;
    Object.keys(metricsCache).forEach(function (id) {
      if (metricsCache[id].ts < _weekStartMs) {
        metricsValues[id] = "0";
        metricsCache[id] = { value: "0", ts: Date.now(), prevValue: metricsCache[id].value };
        _changed = true;
      }
    });
    if (_changed) {
      try { localStorage.setItem("fspp-metrics-cache", JSON.stringify(metricsCache)); } catch { /* storage unavailable */ }
    }
  }());

  // Timing for reading a dashboard after it loads. Dashboards such as
  // Freshservice's are single-page apps: the page "finishes loading" first and
  // the widgets fetch and draw their numbers afterwards, sometimes well after.
  // Instead of reading once after a fixed pause, read repeatedly until every
  // field has a value that held steady across two reads, or the time runs out.
  const SCRAPE_TIMING = {
    loadTimeoutMs: 30000,
    firstReadMs: 2000,
    pollMs: 1000,
    settleTimeoutMs: 30000,
  };

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Loads url in the scraper webview. Resolves when the main frame finishes
  // loading; rejects on a load error or after the timeout.
  function loadScraperPage(webview, url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      let timer = null;
      function cleanup() {
        clearTimeout(timer);
        webview.removeEventListener("did-finish-load", onFinish);
        webview.removeEventListener("did-fail-load", onFail);
      }
      function onFinish() { cleanup(); resolve(); }
      function onFail(e) {
        // -3 (ABORTED) is a redirect or a newer navigation replacing this one;
        // the final page still raises did-finish-load.
        if (!e || e.isMainFrame === false || e.errorCode === -3) return;
        cleanup();
        reject(new Error("load failed: " + (e.errorDescription || e.errorCode)));
      }
      timer = setTimeout(function () { cleanup(); reject(new Error("load timeout")); }, timeoutMs);
      webview.addEventListener("did-finish-load", onFinish);
      webview.addEventListener("did-fail-load", onFail);
      webview.src = url;
    });
  }

  // Calls read() until all ids have a non-null value that matches the previous
  // read, or until timing.settleTimeoutMs passes. Returns the last read, which
  // may still contain nulls for fields that never appeared.
  async function readUntilSettled(read, ids, timing) {
    const deadline = Date.now() + timing.settleTimeoutMs;
    await sleep(timing.firstReadMs);
    let prev = null;
    let last = null;
    for (;;) {
      let current = null;
      try { current = await read(); } catch { current = null; }
      if (current && typeof current === "object") {
        last = current;
        const complete = ids.every(function (id) { return current[id] !== null && current[id] !== undefined; });
        const steady = prev !== null && ids.every(function (id) { return current[id] === prev[id]; });
        if (complete && steady) return current;
        prev = current;
      }
      if (Date.now() + timing.pollMs > deadline) return last;
      await sleep(timing.pollMs);
    }
  }

  function buildMetricsScrapeScript(fields) {
    const parts = fields.map(function (f) {
      const idJ = JSON.stringify(f.id);
      const sel = f.selector.trim();
      if (sel.startsWith("(")) {
        return "try{var _v=" + sel + ";r[" + idJ + "]=_v!=null?String(_v).trim():null;}catch(ex){r[" + idJ + "]=null;}";
      }
      const selJ = JSON.stringify(sel);
      return "try{var _el=document.querySelector(" + selJ + ");r[" + idJ + "]=_el?(_el.innerText||_el.textContent||'').trim().split('\\n')[0].trim():null;}catch(ex){r[" + idJ + "]=null;}";
    });
    return "(function(){var r={};" + parts.join("") + "return r;})()";
  }

  function getWeekProgress(settings) {
    const now = new Date();
    const nowDay = now.getDay();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const workDays = settings.metricsWorkDays || [1, 2, 3, 4, 5];
    const weekEndDay = typeof settings.metricsWorkWeekEndDay === "number" ? settings.metricsWorkWeekEndDay : 5;
    const startParts = (settings.metricsWorkHoursStart || "08:00").split(":").map(Number);
    const endParts   = (settings.metricsWorkHoursEnd   || "17:00").split(":").map(Number);
    const dayStartMins = startParts[0] * 60 + (startParts[1] || 0);
    const dayEndMins   = endParts[0]   * 60 + (endParts[1]   || 0);
    const lunchMins  = Math.max(0, parseInt(settings.metricsLunchMinutes || 0, 10));
    const dayMinutes = Math.max(0, dayEndMins - dayStartMins - lunchMins);
    if (dayMinutes <= 0 || workDays.length === 0) return { progress: 0, ptoRatio: 1 };

    let weekStartDay = -1;
    for (let i = 1; i <= 7; i++) {
      const candidate = (weekEndDay + i) % 7;
      if (workDays.includes(candidate)) { weekStartDay = candidate; break; }
    }
    if (weekStartDay === -1) return { progress: 0, ptoRatio: 1 };

    const orderedDays = [];
    for (let i = 0; i < 7; i++) {
      const d = (weekStartDay + i) % 7;
      if (workDays.includes(d)) orderedDays.push({ day: d, offset: i });
      if (d === weekEndDay) break;
    }

    // fullWeekMinutes is the base (no PTO). ptoRatio = totalWorkMinutes / fullWeekMinutes
    // is used to scale the weekly target down for weeks with PTO.
    const fullWeekMinutes = orderedDays.length * dayMinutes;
    if (fullWeekMinutes === 0) return { progress: 0, ptoRatio: 1 };

    const daysSinceStart = (nowDay - weekStartDay + 7) % 7;

    // Determine the calendar date of each work day so we can look up PTO entries.
    const weekStartDate = new Date(now);
    weekStartDate.setDate(weekStartDate.getDate() - daysSinceStart);
    weekStartDate.setHours(0, 0, 0, 0);
    const timeOff = settings.metricsTimeOff || [];
    const recurringBlocks = settings.metricsRecurringBlocks || [];

    function ptoMinsForOffset(offset) {
      const d = new Date(weekStartDate);
      d.setDate(d.getDate() + offset);
      const dateStr = d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
      const entry = timeOff.find(function (e) { return e.date === dateStr; });
      return entry ? Math.min((parseFloat(entry.hours) || 0) * 60, dayMinutes) : 0;
    }

    function meetingMinsForDay(dayOfWeek) {
      return recurringBlocks.reduce(function (sum, b) {
        return sum + (b.dayOfWeek === dayOfWeek ? Math.min((parseFloat(b.hours) || 0) * 60, dayMinutes) : 0);
      }, 0);
    }

    // Total available work minutes this week after subtracting PTO.
    let totalWorkMinutes = 0;
    orderedDays.forEach(function (od) {
      totalWorkMinutes += Math.max(0, dayMinutes - ptoMinsForOffset(od.offset));
    });

    let elapsed = 0;
    for (let i = 0; i < orderedDays.length; i++) {
      const od = orderedDays[i];
      const effectiveMins = Math.max(0, dayMinutes - ptoMinsForOffset(od.offset));
      const meetingMins = meetingMinsForDay(od.day);
      if (od.offset < daysSinceStart) {
        elapsed += Math.max(0, effectiveMins - meetingMins);
      } else if (od.offset === daysSinceStart) {
        if (nowMins >= dayEndMins)       elapsed += Math.max(0, effectiveMins - meetingMins);
        else if (nowMins > dayStartMins) elapsed += Math.max(0, Math.min(nowMins - dayStartMins, effectiveMins) - meetingMins);
        break;
      } else {
        break;
      }
    }

    // progress uses fullWeekMinutes so that target * progress gives the right
    // expected value — PTO days reduce what's expected, not inflate the ratio.
    // ptoRatio scales the target itself for the goal-met threshold.
    return {
      progress: Math.min(1, elapsed / fullWeekMinutes),
      ptoRatio: Math.min(1, totalWorkMinutes / fullWeekMinutes),
    };
  }

  function renderMetricsBar() {
    metricsBarItems.innerHTML = "";
    const dashboards = appSettings.metricsBarDashboards || [];
    dashboards.forEach(function (db) {
      (db.fields || []).forEach(function (f) {
        const card = document.createElement("div");
        card.className = "metrics-card";
        const valEl = document.createElement("span");
        valEl.className = "metrics-card-value";
        const val = metricsValues[f.id];
        valEl.textContent = (val !== null && val !== undefined) ? String(val) : "—";
        const lblEl = document.createElement("span");
        lblEl.className = "metrics-card-label";
        lblEl.textContent = f.label;
        card.appendChild(valEl);
        card.appendChild(lblEl);
        if (metricsStale.has(f.id) && metricsCache[f.id]) {
          const staleEl = document.createElement("span");
          staleEl.className = "metrics-card-stale";
          const ts = new Date(metricsCache[f.id].ts);
          staleEl.title = "Could not refresh" +
            (metricsStaleReason[f.id] ? " (" + metricsStaleReason[f.id] + ")" : "") +
            " — last updated " + ts.toLocaleString();
          card.appendChild(staleEl);
        }
        const tooltipLines = [];

        if (appSettings.metricsProgressEnabled && f.weeklyTarget) {
          const target = parseFloat(String(f.weeklyTarget).replace(/[^0-9.]/g, ""));
          if (!isNaN(target) && target > 0) {
            const currentNum = parseFloat(String(val || "0").replace(/[^0-9.]/g, ""));
            if (!isNaN(currentNum)) {
              const { progress, ptoRatio } = getWeekProgress(appSettings);
              const _rawAdjusted = target * ptoRatio;
              const _rounding = appSettings.metricsTargetRounding || "none";
              const adjustedTarget = _rounding === "floor" ? Math.floor(_rawAdjusted)
                : _rounding === "ceil" ? Math.ceil(_rawAdjusted)
                : Math.round(_rawAdjusted * 10) / 10;
              const expected = target * progress;
              const expectedRounded = Math.round(expected * 10) / 10;
              tooltipLines.push("On track: " + expectedRounded + " of " + adjustedTarget);
              if (adjustedTarget > 0 && currentNum >= adjustedTarget) {
                card.classList.add("metrics-progress-goal-met");
              } else if (expected > 0) {
                if (currentNum < expected * 0.9) {
                  card.classList.add("metrics-progress-behind");
                } else if (currentNum < expected) {
                  card.classList.add("metrics-progress-warning");
                }
              }
            }
          }
        }

        if (metricsSource[f.id] === "api") tooltipLines.push("From the Freshservice API");
        else if (metricsSource[f.id] === "dashboard") tooltipLines.push("From the dashboard");

        if (db.url) {
          card.style.cursor = "pointer";
          tooltipLines.push("Click to open dashboard");
          card.addEventListener("click", function () {
            window.pluginAPI.browser.newTab(db.url);
          });
        }

        if (tooltipLines.length) card.title = tooltipLines.join("\n");
        metricsBarItems.appendChild(card);
      });
    });
  }

  function localDateString(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Dates that API queries can use as {today}, {weekStart} and {monthStart}.
  // The work week starts on the first work day after the configured week-end day.
  function metricsDateVars(settings, now) {
    now = now || new Date();
    const workDays = settings.metricsWorkDays || [1, 2, 3, 4, 5];
    const weekEndDay = typeof settings.metricsWorkWeekEndDay === "number" ? settings.metricsWorkWeekEndDay : 5;
    let weekStartDay = 1;
    for (let i = 1; i <= 7; i++) {
      const c = (weekEndDay + i) % 7;
      if (workDays.includes(c)) { weekStartDay = c; break; }
    }
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (now.getDay() - weekStartDay + 7) % 7);
    return {
      today: localDateString(now),
      weekStart: localDateString(weekStart),
      monthStart: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    };
  }

  // Reads every field that has an API query through the Freshservice plugin.
  // Returns the ids it filled and the error for each one it couldn't, so the
  // dashboard scrape can cover those.
  async function readApiFields(dashboards) {
    const done = new Set();
    const errors = {};
    let anySuccess = false;
    const fields = [];
    dashboards.forEach(function (db) {
      (db.fields || []).forEach(function (f) {
        if (typeof f.apiQuery === "string" && f.apiQuery.trim()) fields.push(f);
      });
    });
    if (!fields.length) return { done, errors, anySuccess };
    const vars = metricsDateVars(appSettings);
    const now = Date.now();
    for (const f of fields) {
      let res;
      try {
        res = await window.pluginAPI.invoke("freshservice", "count-tickets", { query: f.apiQuery, vars: vars });
      } catch {
        res = { error: "the Freshservice plugin isn't available" };
      }
      if (res && typeof res.count === "number") {
        const value = String(res.count);
        metricsValues[f.id] = value;
        metricsCache[f.id] = { value: value, ts: now };
        metricsStale.delete(f.id);
        delete metricsStaleReason[f.id];
        metricsSource[f.id] = "api";
        done.add(f.id);
        anySuccess = true;
      } else {
        errors[f.id] = (res && res.error) || "no count returned";
      }
    }
    if (anySuccess) {
      try { localStorage.setItem("fspp-metrics-cache", JSON.stringify(metricsCache)); } catch { /* storage unavailable */ }
    }
    return { done, errors, anySuccess };
  }

  async function scrapeMetrics() {
    if (metricsScraperBusy) return;
    const dashboards = (appSettings.metricsBarDashboards || []).filter(function (db) {
      return db.url && (db.fields || []).length > 0;
    });
    if (!dashboards.length) return;

    metricsScraperBusy = true;
    metricsBarStatus.textContent = "Refreshing…";
    let anySuccess = false;

    try {
      // 1. Fields with a Freshservice API query: ask the API first.
      const api = await readApiFields(dashboards);
      if (api.anySuccess) anySuccess = true;

      // 2. Everything else, and API fields whose query failed: scrape the dashboard.
      for (let i = 0; i < dashboards.length; i++) {
        const db = dashboards[i];
        const dbFieldIds = (db.fields || []).map(function (f) { return f.id; })
          .filter(function (id) { return !api.done.has(id); });
        if (!dbFieldIds.length) continue;
        const markStale = function (id, reason) {
          metricsStale.add(id);
          metricsStaleReason[id] = api.errors[id] ? "API: " + api.errors[id] + "; dashboard: " + reason : reason;
        };
        try {
          const sep = db.url.includes("?") ? "&" : "?";
          await loadScraperPage(metricsScraperWebview, db.url + sep + "_ms=" + Date.now(), SCRAPE_TIMING.loadTimeoutMs);

          // Read the dashboard's current field list on every pass, so a field
          // added in Settings during a refresh is picked up.
          const currentFields = function () {
            const live = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === db.id; });
            return (live ? (live.fields || []) : db.fields).filter(function (f) { return !api.done.has(f.id); });
          };
          const results = await readUntilSettled(
            function () { return metricsScraperWebview.executeJavaScript(buildMetricsScrapeScript(currentFields())); },
            currentFields().map(function (f) { return f.id; }),
            SCRAPE_TIMING
          );
          const missingReason = describeMissingPage(metricsScraperWebview, db.url);

          if (results) {
            const now = Date.now();
            let hasNewValues = false;
            Object.keys(results).forEach(function (id) {
              if (results[id] !== null) {
                const cached = metricsCache[id];
                // If the entry was zeroed at week start and the dashboard still returns the old
                // value, the page hasn't refreshed yet — keep showing 0. Only for the first
                // hour after the reset, and not for 0 itself: a count that genuinely matches
                // last week's (e.g. still 0) would otherwise stay marked stale all week.
                if (cached && cached.prevValue !== undefined && results[id] === cached.prevValue &&
                    now - cached.ts < WEEK_RESET_STALE_WINDOW_MS &&
                    parseFloat(String(results[id]).replace(/[^0-9.]/g, "")) !== 0) {
                  markStale(id, "the dashboard still shows last week's value");
                } else {
                  metricsValues[id] = results[id];
                  metricsCache[id] = { value: results[id], ts: now };
                  metricsStale.delete(id);
                  delete metricsStaleReason[id];
                  metricsSource[id] = "dashboard";
                  hasNewValues = true;
                }
              } else {
                markStale(id, missingReason || "the value wasn't found on the dashboard");
              }
            });
            if (hasNewValues) {
              try { localStorage.setItem("fspp-metrics-cache", JSON.stringify(metricsCache)); } catch { /* storage unavailable */ }
            }
            anySuccess = true;
          } else {
            dbFieldIds.forEach(function (id) { markStale(id, missingReason || "the dashboard couldn't be read"); });
          }
        } catch (err) {
          const reason = err && /timeout/.test(err.message) ? "the dashboard took too long to load" : "the dashboard didn't load";
          dbFieldIds.forEach(function (id) { markStale(id, reason); });
        }
      }

      const now = new Date();
      const staleCount = dashboards.reduce(function (n, db) {
        return n + (db.fields || []).filter(function (f) { return metricsStale.has(f.id); }).length;
      }, 0);
      metricsBarStatus.textContent = anySuccess
        ? "Updated " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
          (staleCount ? " (" + staleCount + " not refreshed)" : "")
        : "Refresh failed";
      renderMetricsBar();
    } finally {
      metricsScraperBusy = false;
    }
    // Refresh was clicked while this pass was running: run once more so the
    // click isn't silently dropped.
    if (metricsRefreshQueued) {
      metricsRefreshQueued = false;
      await scrapeMetrics();
    }
  }

  // When a dashboard read comes back empty, says why if the scraper ended up on
  // a sign-in page or another site instead of the dashboard.
  function describeMissingPage(webview, dashboardUrl) {
    let current;
    let expected;
    try {
      current = new URL(webview.getURL());
      expected = new URL(dashboardUrl);
    } catch {
      return null;
    }
    if (/(^|\/)(login|signin|sign_in|sso)(\/|$)/i.test(current.pathname) || current.hostname !== expected.hostname) {
      return "signed out of " + expected.hostname + "? Open the dashboard in a tab and sign in";
    }
    return null;
  }

  function scheduleNextMetricsPoll() {
    clearTimeout(metricsPollTimer);
    const intervalMs = (appSettings.metricsBarInterval || 15) * 60 * 1000;
    metricsPollTimer = setTimeout(function () {
      if (appSettings.metricsBarEnabled &&
          (appSettings.metricsBarDashboards || []).some(function (db) { return db.url && (db.fields || []).length > 0; })) {
        scrapeMetrics().finally(scheduleNextMetricsPoll);
      }
    }, intervalMs);
  }

  function startMetricsPoll() {
    stopMetricsPoll();
    if (metricsScraperBusy) {
      metricsRescheduleNeeded = true;
      return;
    }
    metricsRescheduleNeeded = false;
    scrapeMetrics().finally(function () {
      if (metricsRescheduleNeeded) {
        metricsRescheduleNeeded = false;
        startMetricsPoll();
      } else {
        scheduleNextMetricsPoll();
      }
    });
  }

  function stopMetricsPoll() {
    clearTimeout(metricsPollTimer);
    metricsPollTimer = null;
  }

  function applyInitialValues(settings) {
    const now = Date.now();
    let changed = false;
    (settings.metricsBarDashboards || []).forEach(function (db) {
      (db.fields || []).forEach(function (f) {
        if (f.initialValue != null && metricsValues[f.id] == null) {
          metricsValues[f.id] = f.initialValue;
          metricsCache[f.id] = { value: f.initialValue, ts: now };
          changed = true;
        }
      });
    });
    if (changed) {
      try { localStorage.setItem("fspp-metrics-cache", JSON.stringify(metricsCache)); } catch { /* storage unavailable */ }
    }
  }

  function applyMetrics(settings) {
    const metricsActive = settings.metricsBarEnabled &&
      (settings.metricsBarDashboards || []).some(function (db) { return db.url && (db.fields || []).length > 0; });
    if (metricsActive) {
      metricsBar.classList.add("visible");
      applyInitialValues(settings);
      renderMetricsBar();
      startMetricsPoll();
    } else {
      metricsBar.classList.remove("visible");
      stopMetricsPoll();
    }
  }

  window.pluginAPI.events.on("settings:changed", function (settings) {
    appSettings = settings;
    applyMetrics(settings);
  });

  btnMetricsRefresh.addEventListener("click", function () {
    if (metricsScraperBusy) {
      metricsRefreshQueued = true;
      metricsBarStatus.textContent = "Refreshing… (again after this pass)";
      return;
    }
    stopMetricsPoll();
    scrapeMetrics().finally(function () {
      if (appSettings.metricsBarEnabled &&
          (appSettings.metricsBarDashboards || []).some(function (db) { return db.url && (db.fields || []).length > 0; })) {
        scheduleNextMetricsPoll();
      }
    });
  });

  btnMetricsHide.addEventListener("click", function () {
    const updated = Object.assign({}, appSettings, { metricsBarEnabled: false });
    window.backupAPI.saveSettings(updated);
    appSettings = updated;
    applyMetrics(updated);
  });

  applyMetrics(appSettings);
})();
