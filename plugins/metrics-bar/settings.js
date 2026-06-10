// Metrics Bar plugin — settings window
// Adds the Metrics Bar configuration panel to the settings window.
(function () {
  if (!window.pluginSettingsAPI) return;

  // ==================== Picker overlay (full-screen, outside .settings-content) ====================

  const metricsPickerOverlay = document.createElement("div");
  metricsPickerOverlay.id = "metrics-picker-overlay";
  metricsPickerOverlay.className = "metrics-picker-overlay";
  metricsPickerOverlay.innerHTML =
    '<div class="metrics-picker-header">' +
    '<span class="metrics-picker-instruction">Hover and click any value on the dashboard to track it</span>' +
    '<button type="button" id="btn-metrics-picker-cancel" class="btn btn-secondary">Cancel</button>' +
    '</div>' +
    '<webview id="metrics-picker-webview" class="metrics-picker-webview" src="about:blank"></webview>' +
    '<div id="metrics-picker-capture-bar" class="metrics-picker-capture-bar">' +
    '<div class="metrics-picker-capture-row">' +
    '<span class="metrics-picker-capture-label">Value:</span>' +
    '<code id="metrics-picker-value-preview" class="metrics-picker-value-preview"></code>' +
    '<input type="text" id="metrics-picker-label-input" class="settings-text-input metrics-picker-label-input" placeholder="Label (e.g. Closed Tickets)" maxlength="50" />' +
    '<button type="button" id="btn-metrics-picker-save" class="btn btn-primary">Add Metric</button>' +
    '<button type="button" id="btn-metrics-picker-reselect" class="btn btn-secondary">Re-select</button>' +
    '</div>' +
    '<div class="metrics-picker-selector-row">' +
    '<span class="metrics-picker-capture-label">CSS selector:</span>' +
    '<input type="text" id="metrics-picker-selector-input" class="settings-text-input metrics-picker-selector-input" spellcheck="false" placeholder="auto-generated — edit if needed" />' +
    '</div>' +
    '</div>';
  document.body.appendChild(metricsPickerOverlay);

  // Off-screen scraper webview used by "Test selectors"
  const metricsScraperWebview = document.createElement("webview");
  metricsScraperWebview.id = "metrics-scraper-webview";
  metricsScraperWebview.className = "metrics-scraper-webview";
  metricsScraperWebview.src = "about:blank";
  document.body.appendChild(metricsScraperWebview);

  // ==================== Picker element refs ====================

  const metricsPickerWebview = document.getElementById("metrics-picker-webview");
  const metricsPickerCaptureBar = document.getElementById("metrics-picker-capture-bar");
  const metricsPickerValuePreview = document.getElementById("metrics-picker-value-preview");
  const metricsPickerSelectorInput = document.getElementById("metrics-picker-selector-input");
  const metricsPickerLabelInput = document.getElementById("metrics-picker-label-input");
  const btnMetricsPickerSave = document.getElementById("btn-metrics-picker-save");
  const btnMetricsPickerReselect = document.getElementById("btn-metrics-picker-reselect");
  const btnMetricsPickerCancel = document.getElementById("btn-metrics-picker-cancel");

  // ==================== State ====================

  let appSettings = window.pluginSettingsAPI.getSettings();
  let metricsScraperBusy = false;
  let metricsPickerViewOnly = false;
  const metricsValues = {};
  const metricsTestStatuses = {};
  let metricsPickerPendingSelector = null;
  let metricsPickerDashboardId = null;
  let metricsPickerTargetFieldId = null;

  // Panel element refs — set after addPanel() creates the DOM
  let metricsDashboardsList = null;
  let settingMetricsEnabled = null;
  let settingMetricsInterval = null;
  let settingMetricsProgressEnabled = null;
  let metricsProgressConfig = null;
  let metricsWorkDayCheckboxes = null;
  let settingMetricsWeekEndDay = null;
  let settingMetricsWorkStart = null;
  let settingMetricsWorkEnd = null;

  // ==================== Utilities ====================

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function saveSettings() {
    window.pluginSettingsAPI.saveSettings(appSettings);
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

  // ==================== Picker inject script ====================

  const METRICS_PICKER_INJECT_SCRIPT = `(function() {
    if (window.__mpInject) return;
    window.__mpInject = true;
    var hi = document.createElement('div');
    hi.style.cssText = 'position:fixed;outline:3px solid #e67e22;background:rgba(230,126,34,0.12);pointer-events:none;border-radius:2px;z-index:999999;display:none;box-sizing:border-box;';
    document.body.appendChild(hi);

    function getTableCellExpr(cellEl) {
      var tr = cellEl.parentElement;
      while (tr && tr.tagName !== 'TR') tr = tr.parentElement;
      if (!tr || !tr.cells) return null;
      var colIdx = Array.from(tr.cells).indexOf(cellEl);
      if (colIdx < 0) return null;
      var anchorIdx = -1;
      var anchorText = '';
      for (var k = 0; k < tr.cells.length; k++) {
        if (k === colIdx) continue;
        var ct = tr.cells[k] ? tr.cells[k].textContent.trim() : '';
        if (ct && isNaN(parseFloat(ct))) { anchorIdx = k; anchorText = ct; break; }
      }
      if (anchorIdx < 0) return null;
      var tbl = tr.closest ? tr.closest('table') : null;
      if (!tbl) return null;
      var tblClasses = tbl.classList ? Array.from(tbl.classList).slice(0, 2) : [];
      var tblSel = tblClasses.length > 0 ? ('table.' + tblClasses.join('.')) : 'table';
      var tblIdx = Array.from(document.querySelectorAll(tblSel)).indexOf(tbl);
      if (tblIdx < 0) tblIdx = 0;
      return '(function(){' +
        'var tbls=Array.from(document.querySelectorAll(' + JSON.stringify(tblSel) + '));' +
        'var tbl=tbls[' + tblIdx + ']||null;' +
        'if(!tbl)return null;' +
        'var rows=Array.from(tbl.querySelectorAll("tbody tr"));' +
        'var row=rows.find(function(r){return r.cells&&r.cells[' + anchorIdx + ']&&r.cells[' + anchorIdx + '].textContent.trim()===' + JSON.stringify(anchorText) + ';});' +
        'return row&&row.cells[' + colIdx + ']?row.cells[' + colIdx + '].textContent.trim():null;' +
        '})()';
    }

    function getPath(el) {
      function qsaLen(sel) {
        try { return document.querySelectorAll(sel).length; } catch(err) { return -1; }
      }
      function buildPart(node) {
        var elId = node.getAttribute('id');
        if (elId) return '#' + elId;
        var tag = node.tagName.toLowerCase();
        var classes = Array.from(node.classList || []);
        if (classes.length > 0) {
          var cls = '.' + classes.slice(0, 2).join('.');
          var sameCls = Array.from(node.parentNode ? node.parentNode.children : []).filter(function(s) {
            return s.tagName === node.tagName && s.className === node.className;
          });
          if (sameCls.length > 1) {
            var idx = Array.from(node.parentNode.children).indexOf(node) + 1;
            return tag + cls + ':nth-child(' + idx + ')';
          }
          return tag + cls;
        }
        var tagSiblings = Array.from(node.parentNode ? node.parentNode.children : []).filter(function(s) {
          return s.tagName === node.tagName;
        });
        if (tagSiblings.length > 1) {
          var idx = Array.from(node.parentNode.children).indexOf(node) + 1;
          return tag + ':nth-child(' + idx + ')';
        }
        return tag;
      }
      if (el.id) return '#' + el.id;
      var parts = [];
      var cur = el;
      while (cur && cur !== document.body) {
        var part = buildPart(cur);
        if (part.startsWith('#')) { parts.unshift(part); break; }
        parts.unshift(part);
        cur = cur.parentElement;
        if (parts.length >= 2 && qsaLen(parts.join(' > ')) === 1) break;
      }
      return parts.join(' > ');
    }

    document.addEventListener('mouseover', function(e) {
      var r = e.target.getBoundingClientRect();
      hi.style.display = 'block';
      hi.style.top = r.top + 'px';
      hi.style.left = r.left + 'px';
      hi.style.width = r.width + 'px';
      hi.style.height = r.height + 'px';
    }, true);
    document.addEventListener('mouseout', function() { hi.style.display = 'none'; }, true);
    document.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var target = e.target;
      var cellEl = target;
      while (cellEl && cellEl !== document.body && cellEl.tagName !== 'TD' && cellEl.tagName !== 'TH') {
        cellEl = cellEl.parentElement;
      }
      if (cellEl && (cellEl.tagName === 'TD' || cellEl.tagName === 'TH')) {
        var expr = getTableCellExpr(cellEl);
        if (expr) {
          var cellText = (cellEl.innerText || cellEl.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 100);
          console.log('[METRICS-PICK] ' + JSON.stringify({selector: expr, text: cellText}));
          return;
        }
      }
      var sel = getPath(target);
      var text = (target.innerText || target.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 100);
      console.log('[METRICS-PICK] ' + JSON.stringify({selector: sel, text: text}));
    }, true);
  })()`;

  // ==================== Render helpers ====================

  function renderMetricsFieldsConfig(dbId, containerEl) {
    containerEl.innerHTML = "";
    const db = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
    const fields = db ? (db.fields || []) : [];
    if (fields.length === 0) {
      const p = document.createElement("p");
      p.className = "metrics-fields-empty";
      p.textContent = "No fields configured. Click \"+ Add Field\" to pick values from the dashboard.";
      containerEl.appendChild(p);
      return;
    }
    fields.forEach(function (f) {
      const wrap = document.createElement("div");
      wrap.className = "metrics-field-config-wrap";

      const row = document.createElement("div");
      row.className = "metrics-field-config-row";

      const info = document.createElement("div");
      info.className = "metrics-field-config-info";
      const lbl = document.createElement("span");
      lbl.className = "metrics-field-config-label";
      lbl.textContent = f.label;
      const found = metricsValues[f.id];
      const badge = document.createElement("span");
      badge.className = "metrics-field-config-found";
      badge.textContent = found !== undefined
        ? (found !== null ? "→ " + found : "(not found — check selector)")
        : "(not yet scraped)";
      info.appendChild(lbl);
      info.appendChild(badge);

      const btns = document.createElement("div");
      btns.className = "metrics-field-config-btns";

      const repick = document.createElement("button");
      repick.type = "button";
      repick.className = "btn btn-small btn-secondary";
      repick.textContent = "Re-pick";
      repick.title = "Re-open dashboard and click a new element for this field";
      repick.addEventListener("click", function () {
        const db_ = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
        if (!db_ || !db_.url) return;
        openMetricsPicker(dbId, f.id);
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-small";
      del.style.color = "var(--warning, #e74c3c)";
      del.textContent = "Remove";
      del.addEventListener("click", function () {
        const db_ = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
        if (db_) db_.fields = (db_.fields || []).filter(function (x) { return x.id !== f.id; });
        saveSettings();
        renderDashboardList();
      });

      btns.appendChild(repick);
      btns.appendChild(del);
      row.appendChild(info);
      row.appendChild(btns);

      const selRow = document.createElement("div");
      selRow.className = "metrics-field-selector-row";
      const selLabel = document.createElement("span");
      selLabel.className = "metrics-field-selector-label";
      selLabel.textContent = "Selector:";
      const selInput = document.createElement("input");
      selInput.type = "text";
      selInput.className = "settings-text-input metrics-field-selector-input";
      selInput.value = f.selector;
      selInput.spellcheck = false;
      selInput.title = "CSS selector used to find this value. Edit manually if needed.";
      selInput.addEventListener("change", function () {
        const updated = selInput.value.trim();
        if (!updated) return;
        const db_ = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
        if (db_) db_.fields = (db_.fields || []).map(function (x) {
          return x.id === f.id ? Object.assign({}, x, { selector: updated }) : x;
        });
        saveSettings();
      });
      selRow.appendChild(selLabel);
      selRow.appendChild(selInput);

      wrap.appendChild(row);
      wrap.appendChild(selRow);

      if (appSettings.metricsProgressEnabled) {
        const targetRow = document.createElement("div");
        targetRow.className = "metrics-field-target-row";
        const targetLabel = document.createElement("span");
        targetLabel.className = "metrics-field-target-label";
        targetLabel.textContent = "Weekly target:";
        const targetInput = document.createElement("input");
        targetInput.type = "text";
        targetInput.className = "settings-text-input metrics-field-target-input";
        targetInput.value = f.weeklyTarget !== undefined ? String(f.weeklyTarget) : "";
        targetInput.placeholder = "e.g. 40";
        targetInput.title = "Minimum value to reach by end of work week";
        targetInput.addEventListener("change", function () {
          const updated = targetInput.value.trim();
          const db_ = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
          if (db_) db_.fields = (db_.fields || []).map(function (x) {
            return x.id === f.id ? Object.assign({}, x, { weeklyTarget: updated }) : x;
          });
          saveSettings();
        });
        targetRow.appendChild(targetLabel);
        targetRow.appendChild(targetInput);
        wrap.appendChild(targetRow);
      }

      containerEl.appendChild(wrap);
    });
  }

  function renderDashboardList() {
    if (!metricsDashboardsList) return;
    metricsDashboardsList.innerHTML = "";
    const dashboards = appSettings.metricsBarDashboards || [];
    dashboards.forEach(function (db, dbIdx) {
      const section = document.createElement("div");
      section.className = "metrics-dashboard-section";

      const header = document.createElement("div");
      header.className = "metrics-dashboard-header";
      const title = document.createElement("span");
      title.className = "metrics-dashboard-title";
      title.textContent = "Dashboard " + (dbIdx + 1);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-small";
      removeBtn.style.color = "var(--warning, #e74c3c)";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", function () {
        (db.fields || []).forEach(function (f) { delete metricsValues[f.id]; });
        delete metricsTestStatuses[db.id];
        appSettings.metricsBarDashboards = (appSettings.metricsBarDashboards || []).filter(function (d) { return d.id !== db.id; });
        saveSettings();
        renderDashboardList();
      });
      header.appendChild(title);
      header.appendChild(removeBtn);

      const urlWrap = document.createElement("div");
      urlWrap.className = "settings-field settings-field-column";
      const urlLabel = document.createElement("label");
      urlLabel.className = "settings-field-label";
      urlLabel.textContent = "Dashboard URL";
      const urlInput = document.createElement("input");
      urlInput.type = "text";
      urlInput.className = "settings-text-input";
      urlInput.placeholder = "https://contoso.brightgauge.co/public/dashboards/…";
      urlInput.maxLength = 500;
      urlInput.spellcheck = false;
      urlInput.autocomplete = "off";
      urlInput.value = db.url || "";
      const urlSave = debounce(function () {
        const db_ = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === db.id; });
        if (db_) { db_.url = urlInput.value.trim(); saveSettings(); }
      }, 800);
      urlInput.addEventListener("input", urlSave);
      urlWrap.appendChild(urlLabel);
      urlWrap.appendChild(urlInput);

      const fieldsWrap = document.createElement("div");
      fieldsWrap.className = "settings-field-column";

      const fieldsHeader = document.createElement("div");
      fieldsHeader.className = "metrics-fields-header";
      const fieldsLabel = document.createElement("span");
      fieldsLabel.className = "settings-field-label";
      fieldsLabel.textContent = "Tracked Fields";

      const headerBtns = document.createElement("div");
      headerBtns.className = "metrics-fields-header-btns";

      const testBtn = document.createElement("button");
      testBtn.type = "button";
      testBtn.className = "btn btn-small btn-secondary";
      testBtn.textContent = "Test selectors";
      testBtn.title = "Reload the dashboard and re-run selectors to verify they find the right values";
      testBtn.addEventListener("click", function () { scrapeMetrics(db.id); });

      const addFieldBtn = document.createElement("button");
      addFieldBtn.type = "button";
      addFieldBtn.className = "btn btn-small btn-secondary";
      addFieldBtn.textContent = "+ Add Field";
      addFieldBtn.addEventListener("click", function () {
        const db_ = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === db.id; });
        if (!db_ || !db_.url) { urlInput.focus(); return; }
        openMetricsPicker(db.id, null);
      });

      headerBtns.appendChild(testBtn);
      headerBtns.appendChild(addFieldBtn);
      fieldsHeader.appendChild(fieldsLabel);
      fieldsHeader.appendChild(headerBtns);

      const testStatus = document.createElement("span");
      testStatus.className = "metrics-test-status";
      testStatus.id = "metrics-test-status-" + db.id;
      testStatus.textContent = metricsTestStatuses[db.id] || "";

      const fieldsList = document.createElement("div");
      fieldsList.className = "metrics-fields-config-list";

      fieldsWrap.appendChild(fieldsHeader);
      fieldsWrap.appendChild(testStatus);
      fieldsWrap.appendChild(fieldsList);

      section.appendChild(header);
      section.appendChild(urlWrap);
      section.appendChild(fieldsWrap);
      metricsDashboardsList.appendChild(section);

      renderMetricsFieldsConfig(db.id, fieldsList);
    });
  }

  async function scrapeMetrics(dbId) {
    if (metricsScraperBusy) return;
    const db = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
    if (!db || !db.url || !(db.fields || []).length) return;

    metricsScraperBusy = true;
    metricsTestStatuses[dbId] = "Testing…";
    const statusEl = document.getElementById("metrics-test-status-" + dbId);
    if (statusEl) statusEl.textContent = "Testing…";

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

      const db_ = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
      const currentFields = db_ ? (db_.fields || []) : [];
      const results = await metricsScraperWebview.executeJavaScript(
        buildMetricsScrapeScript(currentFields)
      );
      Object.assign(metricsValues, results || {});
      const now = new Date();
      metricsTestStatuses[dbId] = "Tested " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const statusEl2 = document.getElementById("metrics-test-status-" + dbId);
      if (statusEl2) statusEl2.textContent = metricsTestStatuses[dbId];
      renderDashboardList();
    } catch {
      metricsTestStatuses[dbId] = "Test failed";
      const statusEl3 = document.getElementById("metrics-test-status-" + dbId);
      if (statusEl3) statusEl3.textContent = "Test failed";
    }

    metricsScraperBusy = false;
  }

  // ==================== Picker logic ====================

  function openMetricsPicker(dbId, targetFieldId) {
    metricsPickerViewOnly = false;
    metricsPickerDashboardId = dbId;
    metricsPickerTargetFieldId = targetFieldId || null;
    const instr = metricsPickerOverlay.querySelector(".metrics-picker-instruction");
    if (instr) instr.textContent = "Hover and click any value on the dashboard to track it";
    btnMetricsPickerCancel.textContent = "Cancel";
    metricsPickerPendingSelector = null;
    if (targetFieldId) {
      const db = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
      const target = db ? (db.fields || []).find(function (f) { return f.id === targetFieldId; }) : null;
      metricsPickerLabelInput.value = target ? target.label : "";
    } else {
      metricsPickerLabelInput.value = "";
    }
    metricsPickerCaptureBar.classList.remove("visible");
    metricsPickerOverlay.classList.add("visible");
    const db = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === dbId; });
    metricsPickerWebview.src = db ? db.url : "about:blank";
  }

  function closeMetricsPicker() {
    metricsPickerViewOnly = false;
    metricsPickerOverlay.classList.remove("visible");
    metricsPickerWebview.src = "about:blank";
    metricsPickerPendingSelector = null;
    metricsPickerDashboardId = null;
    metricsPickerTargetFieldId = null;
  }

  metricsPickerWebview.addEventListener("did-finish-load", function () {
    if (metricsPickerViewOnly) return;
    setTimeout(function () {
      if (!metricsPickerViewOnly) {
        metricsPickerWebview.executeJavaScript(METRICS_PICKER_INJECT_SCRIPT).catch(function () { /* ignore */ });
      }
    }, 2000);
  });

  metricsPickerWebview.addEventListener("console-message", function (e) {
    const msg = e.message || "";
    const PREFIX = "[METRICS-PICK] ";
    if (!msg.startsWith(PREFIX)) return;
    try {
      const data = JSON.parse(msg.slice(PREFIX.length));
      metricsPickerPendingSelector = data.selector;
      metricsPickerValuePreview.textContent = data.text || "(no text)";
      metricsPickerSelectorInput.value = data.selector;
      metricsPickerCaptureBar.classList.add("visible");
      metricsPickerLabelInput.focus();
    } catch { /* ignore malformed messages */ }
  });

  btnMetricsPickerCancel.addEventListener("click", closeMetricsPicker);

  btnMetricsPickerReselect.addEventListener("click", function () {
    metricsPickerCaptureBar.classList.remove("visible");
    metricsPickerSelectorInput.value = "";
    metricsPickerPendingSelector = null;
  });

  btnMetricsPickerSave.addEventListener("click", function () {
    const label = metricsPickerLabelInput.value.trim();
    const selector = metricsPickerSelectorInput.value.trim() || metricsPickerPendingSelector;
    if (!label || !selector) return;
    const db = (appSettings.metricsBarDashboards || []).find(function (d) { return d.id === metricsPickerDashboardId; });
    if (!db) return;
    if (metricsPickerTargetFieldId) {
      db.fields = (db.fields || []).map(function (f) {
        return f.id === metricsPickerTargetFieldId ? Object.assign({}, f, { label, selector }) : f;
      });
    } else {
      db.fields = (db.fields || []).concat([{ id: "mf-" + Date.now(), label, selector }]);
    }
    saveSettings();
    closeMetricsPicker();
    renderDashboardList();
  });

  metricsPickerLabelInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") btnMetricsPickerSave.click();
  });

  // ==================== Form population ====================

  function populateForm(settings) {
    appSettings = settings;
    if (settingMetricsEnabled) settingMetricsEnabled.checked = !!settings.metricsBarEnabled;
    if (settingMetricsInterval) settingMetricsInterval.value = String(settings.metricsBarInterval || 15);
    if (settingMetricsProgressEnabled) settingMetricsProgressEnabled.checked = !!settings.metricsProgressEnabled;
    if (metricsProgressConfig) {
      if (settings.metricsProgressEnabled) metricsProgressConfig.classList.add("visible");
      else metricsProgressConfig.classList.remove("visible");
    }
    const workDays = settings.metricsWorkDays || [1, 2, 3, 4, 5];
    if (metricsWorkDayCheckboxes) {
      metricsWorkDayCheckboxes.forEach(function (cb) {
        cb.checked = workDays.includes(parseInt(cb.value, 10));
      });
    }
    if (settingMetricsWeekEndDay) settingMetricsWeekEndDay.value = String(settings.metricsWorkWeekEndDay !== undefined ? settings.metricsWorkWeekEndDay : 5);
    if (settingMetricsWorkStart) settingMetricsWorkStart.value = settings.metricsWorkHoursStart || "08:00";
    if (settingMetricsWorkEnd) settingMetricsWorkEnd.value = settings.metricsWorkHoursEnd || "17:00";
    renderDashboardList();
  }

  // ==================== Panel setup ====================

  window.pluginSettingsAPI.addPanel("metrics", "Metrics Bar", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '<h3 class="settings-section-title">Metrics Bar</h3>' +
      '<label class="settings-toggle settings-toggle-spaced">' +
      '<input type="checkbox" id="plugin-setting-metrics-enabled" />' +
      '<span class="settings-toggle-slider"></span>' +
      '<span class="settings-toggle-label">Enable Metrics Bar</span>' +
      '</label>' +
      '<p class="settings-description">Show live stats from one or more dashboards (e.g. BrightGauge) above the tab bar.</p>' +
      '<div id="plugin-metrics-bar-config" class="metrics-bar-config">' +
      '<div class="settings-field">' +
      '<label class="settings-field-label" for="plugin-setting-metrics-interval">Refresh interval</label>' +
      '<div class="settings-field-row">' +
      '<select id="plugin-setting-metrics-interval" class="settings-select-input">' +
      '<option value="5">Every 5 minutes</option>' +
      '<option value="15">Every 15 minutes</option>' +
      '<option value="30">Every 30 minutes</option>' +
      '<option value="60">Every hour</option>' +
      '</select>' +
      '</div>' +
      '</div>' +
      '<label class="settings-toggle settings-toggle-spaced">' +
      '<input type="checkbox" id="plugin-setting-metrics-progress-enabled" />' +
      '<span class="settings-toggle-slider"></span>' +
      '<span class="settings-toggle-label">Progress Tracking</span>' +
      '</label>' +
      '<div id="plugin-metrics-progress-config" class="metrics-progress-config">' +
      '<div class="settings-field">' +
      '<span class="settings-field-label">Work days</span>' +
      '<div class="metrics-work-days">' +
      '<label class="metrics-work-day-label"><input type="checkbox" class="metrics-work-day" value="1"> Mon</label>' +
      '<label class="metrics-work-day-label"><input type="checkbox" class="metrics-work-day" value="2"> Tue</label>' +
      '<label class="metrics-work-day-label"><input type="checkbox" class="metrics-work-day" value="3"> Wed</label>' +
      '<label class="metrics-work-day-label"><input type="checkbox" class="metrics-work-day" value="4"> Thu</label>' +
      '<label class="metrics-work-day-label"><input type="checkbox" class="metrics-work-day" value="5"> Fri</label>' +
      '<label class="metrics-work-day-label"><input type="checkbox" class="metrics-work-day" value="6"> Sat</label>' +
      '<label class="metrics-work-day-label"><input type="checkbox" class="metrics-work-day" value="0"> Sun</label>' +
      '</div>' +
      '</div>' +
      '<div class="settings-field">' +
      '<label class="settings-field-label" for="plugin-setting-metrics-week-end-day">Week ends on</label>' +
      '<select id="plugin-setting-metrics-week-end-day" class="settings-select-input settings-select-sm">' +
      '<option value="0">Sunday</option>' +
      '<option value="1">Monday</option>' +
      '<option value="2">Tuesday</option>' +
      '<option value="3">Wednesday</option>' +
      '<option value="4">Thursday</option>' +
      '<option value="5">Friday</option>' +
      '<option value="6">Saturday</option>' +
      '</select>' +
      '</div>' +
      '<div class="settings-field">' +
      '<span class="settings-field-label">Work hours</span>' +
      '<div class="metrics-work-hours-row">' +
      '<label class="metrics-work-hours-label" for="plugin-setting-metrics-work-start">Start</label>' +
      '<input type="time" id="plugin-setting-metrics-work-start" class="settings-time-input" />' +
      '<label class="metrics-work-hours-label" for="plugin-setting-metrics-work-end">End</label>' +
      '<input type="time" id="plugin-setting-metrics-work-end" class="settings-time-input" />' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div id="plugin-metrics-dashboards-list"></div>' +
      '<button type="button" id="plugin-btn-metrics-add-dashboard" class="btn btn-small btn-secondary metrics-add-dashboard-btn">+ Add Dashboard</button>' +
      '</div>' +
      '</div>';

    settingMetricsEnabled        = panel.querySelector("#plugin-setting-metrics-enabled");
    settingMetricsInterval       = panel.querySelector("#plugin-setting-metrics-interval");
    settingMetricsProgressEnabled = panel.querySelector("#plugin-setting-metrics-progress-enabled");
    metricsProgressConfig        = panel.querySelector("#plugin-metrics-progress-config");
    metricsWorkDayCheckboxes     = Array.from(panel.querySelectorAll(".metrics-work-day"));
    settingMetricsWeekEndDay     = panel.querySelector("#plugin-setting-metrics-week-end-day");
    settingMetricsWorkStart      = panel.querySelector("#plugin-setting-metrics-work-start");
    settingMetricsWorkEnd        = panel.querySelector("#plugin-setting-metrics-work-end");
    metricsDashboardsList        = panel.querySelector("#plugin-metrics-dashboards-list");
    const btnMetricsAddDashboard  = panel.querySelector("#plugin-btn-metrics-add-dashboard");

    settingMetricsEnabled.addEventListener("change", function () {
      appSettings.metricsBarEnabled = settingMetricsEnabled.checked;
      saveSettings();
    });

    settingMetricsInterval.addEventListener("change", function () {
      const val = parseInt(settingMetricsInterval.value, 10);
      appSettings.metricsBarInterval = [5, 15, 30, 60].includes(val) ? val : 15;
      saveSettings();
    });

    settingMetricsProgressEnabled.addEventListener("change", function () {
      appSettings.metricsProgressEnabled = settingMetricsProgressEnabled.checked;
      if (appSettings.metricsProgressEnabled) metricsProgressConfig.classList.add("visible");
      else metricsProgressConfig.classList.remove("visible");
      saveSettings();
      renderDashboardList();
    });

    metricsWorkDayCheckboxes.forEach(function (cb) {
      cb.addEventListener("change", function () {
        appSettings.metricsWorkDays = metricsWorkDayCheckboxes
          .filter(function (c) { return c.checked; })
          .map(function (c) { return parseInt(c.value, 10); });
        saveSettings();
      });
    });

    settingMetricsWeekEndDay.addEventListener("change", function () {
      appSettings.metricsWorkWeekEndDay = parseInt(settingMetricsWeekEndDay.value, 10);
      saveSettings();
    });

    settingMetricsWorkStart.addEventListener("change", function () {
      appSettings.metricsWorkHoursStart = settingMetricsWorkStart.value;
      saveSettings();
    });

    settingMetricsWorkEnd.addEventListener("change", function () {
      appSettings.metricsWorkHoursEnd = settingMetricsWorkEnd.value;
      saveSettings();
    });

    if (btnMetricsAddDashboard) {
      btnMetricsAddDashboard.addEventListener("click", function () {
        if (!appSettings.metricsBarDashboards) appSettings.metricsBarDashboards = [];
        appSettings.metricsBarDashboards.push({ id: "db-" + Date.now(), url: "", fields: [] });
        saveSettings();
        renderDashboardList();
      });
    }

    populateForm(appSettings);
  });

  window.pluginSettingsAPI.onSettingsChanged(function (settings) {
    populateForm(settings);
  });

})();
