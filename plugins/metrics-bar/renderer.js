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
  metricsScraperWebview.src = "about:blank";
  document.body.appendChild(metricsScraperWebview);

  // --- State ---
  let appSettings = window.pluginAPI.getSettings();
  let metricsPollTimer = null;
  let metricsScraperBusy = false;
  let metricsRescheduleNeeded = false;
  const metricsValues = {};
  const metricsCache = {};
  const metricsStale = new Set();

  try {
    const _c = JSON.parse(localStorage.getItem("cwpp-metrics-cache") || "{}");
    Object.keys(_c).forEach(function (id) {
      if (_c[id] && _c[id].value !== null && _c[id].value !== undefined) {
        metricsCache[id] = _c[id];
        metricsValues[id] = _c[id].value;
      }
    });
  } catch { /* start fresh */ }

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

    function ptoMinsForOffset(offset) {
      const d = new Date(weekStartDate);
      d.setDate(d.getDate() + offset);
      const dateStr = d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
      const entry = timeOff.find(function (e) { return e.date === dateStr; });
      return entry ? Math.min((parseFloat(entry.hours) || 0) * 60, dayMinutes) : 0;
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
      if (od.offset < daysSinceStart) {
        elapsed += effectiveMins;
      } else if (od.offset === daysSinceStart) {
        if (nowMins >= dayEndMins)       elapsed += effectiveMins;
        else if (nowMins > dayStartMins) elapsed += Math.min(nowMins - dayStartMins, effectiveMins);
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
          staleEl.title = "Could not refresh — last updated " + ts.toLocaleString();
          card.appendChild(staleEl);
        }
        const tooltipLines = [];

        if (appSettings.metricsProgressEnabled && f.weeklyTarget) {
          const target = parseFloat(String(f.weeklyTarget).replace(/[^0-9.]/g, ""));
          if (!isNaN(target) && target > 0) {
            const currentNum = parseFloat(String(val || "0").replace(/[^0-9.]/g, ""));
            if (!isNaN(currentNum)) {
              const { progress, ptoRatio } = getWeekProgress(appSettings);
              const adjustedTarget = Math.round(target * ptoRatio * 10) / 10;
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
      for (let i = 0; i < dashboards.length; i++) {
        const db = dashboards[i];
        const dbFieldIds = (db.fields || []).map(function (f) { return f.id; });
        try {
          await new Promise(function (resolve, reject) {
            const loadTimer = setTimeout(function () { reject(new Error("load timeout")); }, 30000);
            function handler() {
              metricsScraperWebview.removeEventListener("did-finish-load", handler);
              clearTimeout(loadTimer);
              resolve();
            }
            metricsScraperWebview.addEventListener("did-finish-load", handler);
            const sep = db.url.includes("?") ? "&" : "?";
            metricsScraperWebview.src = db.url + sep + "_ms=" + Date.now();
          });

          await new Promise(function (resolve) { setTimeout(resolve, 5000); });

          const live = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === db.id; });
          const currentFields = live ? (live.fields || []) : db.fields;
          const results = await metricsScraperWebview.executeJavaScript(
            buildMetricsScrapeScript(currentFields)
          );

          if (results) {
            const now = Date.now();
            let hasNewValues = false;
            Object.keys(results).forEach(function (id) {
              if (results[id] !== null) {
                metricsValues[id] = results[id];
                metricsCache[id] = { value: results[id], ts: now };
                metricsStale.delete(id);
                hasNewValues = true;
              } else {
                metricsStale.add(id);
              }
            });
            if (hasNewValues) {
              try { localStorage.setItem("cwpp-metrics-cache", JSON.stringify(metricsCache)); } catch { /* storage unavailable */ }
            }
            anySuccess = true;
          } else {
            dbFieldIds.forEach(function (id) { metricsStale.add(id); });
          }
        } catch {
          dbFieldIds.forEach(function (id) { metricsStale.add(id); });
        }
      }

      const now = new Date();
      metricsBarStatus.textContent = anySuccess
        ? "Updated " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "Refresh failed";
      renderMetricsBar();
    } finally {
      metricsScraperBusy = false;
    }
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
      try { localStorage.setItem("cwpp-metrics-cache", JSON.stringify(metricsCache)); } catch { /* storage unavailable */ }
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
