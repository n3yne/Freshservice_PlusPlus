"use strict";

// ===================================================
// ConnectWise Manage++ — Settings Window Renderer
// Handles all settings form logic. Saves via backupAPI.saveSettings;
// main.js broadcasts settings-changed to the main window so it can
// update its UI without needing to reload.
// ===================================================

document.addEventListener("DOMContentLoaded", function () {

  // ==================== Category Navigation ====================
  (function () {
    const navItems = document.querySelectorAll(".settings-nav-item");
    const panels = document.querySelectorAll(".settings-panel");
    function switchPanel(id) {
      navItems.forEach(function (btn) { btn.classList.toggle("active", btn.dataset.panel === id); });
      panels.forEach(function (p) { p.classList.toggle("active", p.id === "panel-" + id); });
    }
    navItems.forEach(function (btn) {
      btn.addEventListener("click", function () { switchPanel(btn.dataset.panel); });
    });
  }());

  // ==================== Constants ====================
  const SIG_SAVE_DEBOUNCE = 800;

  // Mirror of DEFAULT_SETTINGS in utils.js — update both if adding a new key.
  let appSettings = {
    notePanelEnabled: true,
    backupRetentionDays: 7,
    signatureHtml: "",
    ticketSortField: "lastUpdated",
    ticketSortDirection: "desc",
    panelCollapsed: false,
    defaultUrl: "https://na.myconnectwise.net/",
    theme: "dark",
    noteTemplates: [],
    liveSyncEnabled: true,
    snapshotThreshold: 5,
    aiProvider: "none",
    aiModelName: "",
    aiApiKey: "",
    dismissedReleaseVersion: "",
    backupStorageWarningMb: 100,
    metricsBarEnabled: false,
    metricsBarInterval: 15,
    metricsBarDashboards: [],
  };

  // ==================== Element References ====================
  const settingNotePanel      = document.getElementById("setting-note-panel");
  const settingLiveSync       = document.getElementById("setting-live-sync");
  const settingDefaultUrl     = document.getElementById("setting-default-url");
  const settingTheme          = document.getElementById("setting-theme");
  const settingRetentionDays  = document.getElementById("setting-retention-days");
  const settingSnapshotThreshold = document.getElementById("setting-snapshot-threshold");
  const settingStorageWarning = document.getElementById("setting-storage-warning");
  const settingSortField      = document.getElementById("setting-sort-field");
  const settingSortDirection  = document.getElementById("setting-sort-direction");
  const settingSignature      = document.getElementById("setting-signature");
  const settingAiProvider     = document.getElementById("setting-ai-provider");
  const settingAiModel        = document.getElementById("setting-ai-model");
  const settingAiKey          = document.getElementById("setting-ai-key");
  const aiProviderFields      = document.getElementById("ai-provider-fields");
  const settingMetricsEnabled  = document.getElementById("setting-metrics-enabled");
  const settingMetricsInterval = document.getElementById("setting-metrics-interval");
  const metricsBarConfig       = document.getElementById("metrics-bar-config");
  const metricsDashboardsList  = document.getElementById("metrics-dashboards-list");
  const btnMetricsAddDashboard = document.getElementById("btn-metrics-add-dashboard");
  const metricsScraperWebview = document.getElementById("metrics-scraper-webview");
  const metricsPickerOverlay  = document.getElementById("metrics-picker-overlay");
  const metricsPickerWebview  = document.getElementById("metrics-picker-webview");
  const metricsPickerCaptureBar = document.getElementById("metrics-picker-capture-bar");
  const metricsPickerValuePreview = document.getElementById("metrics-picker-value-preview");
  const metricsPickerSelectorInput = document.getElementById("metrics-picker-selector-input");
  const metricsPickerLabelInput = document.getElementById("metrics-picker-label-input");
  const btnMetricsPickerSave  = document.getElementById("btn-metrics-picker-save");
  const btnMetricsPickerReselect = document.getElementById("btn-metrics-picker-reselect");
  const btnMetricsPickerCancel = document.getElementById("btn-metrics-picker-cancel");
  const templateList          = document.getElementById("template-list");
  const btnAddTemplate        = document.getElementById("btn-add-template");
  const templateAddForm       = document.getElementById("template-add-form");
  const templateNameInput     = document.getElementById("template-name-input");
  const templateContentInput  = document.getElementById("template-content-input");
  const btnSaveTemplate       = document.getElementById("btn-save-template");
  const btnCancelTemplate     = document.getElementById("btn-cancel-template");

  // ==================== Utilities ====================
  function debounce(fn, ms) {
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function saveSettings() {
    window.backupAPI.saveSettings(appSettings);
  }

  // ==================== Form Population ====================
  function applySettingsForm(settings) {
    appSettings = settings;
    settingNotePanel.checked       = !!settings.notePanelEnabled;
    settingRetentionDays.value     = settings.backupRetentionDays;
    settingSnapshotThreshold.value = settings.snapshotThreshold ?? 5;
    settingStorageWarning.value    = settings.backupStorageWarningMb ?? 100;
    settingSortField.value         = settings.ticketSortField || "lastUpdated";
    settingSortDirection.value     = settings.ticketSortDirection || "desc";

    if (settingLiveSync) settingLiveSync.checked = settings.liveSyncEnabled !== false;

    if (document.activeElement !== settingSignature) {
      settingSignature.innerHTML = settings.signatureHtml || "";
    }

    const theme = settings.theme || "dark";
    document.body.setAttribute("data-theme", theme);
    settingTheme.checked = theme === "light";

    if (document.activeElement !== settingDefaultUrl) {
      settingDefaultUrl.value = settings.defaultUrl || "https://na.myconnectwise.net/";
    }

    const aiEnabled = settings.aiProvider && settings.aiProvider !== "none";
    if (settingAiProvider) settingAiProvider.value = settings.aiProvider || "none";
    if (settingAiKey) {
      settingAiKey.value = "";
      settingAiKey.placeholder = settings.aiApiKey ? "••••••••  (saved)" : "Paste your API key here";
    }
    if (aiProviderFields) aiProviderFields.style.display = aiEnabled ? "" : "none";

    if (settingMetricsEnabled) settingMetricsEnabled.checked = !!settings.metricsBarEnabled;
    if (metricsBarConfig) {
      if (settings.metricsBarEnabled) metricsBarConfig.classList.add("visible");
      else metricsBarConfig.classList.remove("visible");
    }
    if (settingMetricsInterval) {
      settingMetricsInterval.value = String(settings.metricsBarInterval || 15);
    }

    renderDashboardList();
    renderTemplateList();
  }

  // ==================== Settings Event Listeners ====================

  settingNotePanel.addEventListener("change", function () {
    appSettings.notePanelEnabled = settingNotePanel.checked;
    saveSettings();
  });

  if (settingLiveSync) {
    settingLiveSync.addEventListener("change", function () {
      appSettings.liveSyncEnabled = settingLiveSync.checked;
      saveSettings();
    });
  }

  settingTheme.addEventListener("change", function () {
    appSettings.theme = settingTheme.checked ? "light" : "dark";
    document.body.setAttribute("data-theme", appSettings.theme);
    saveSettings();
  });

  const defaultUrlSave = debounce(function () {
    const val = settingDefaultUrl.value.trim();
    try {
      const parsed = new URL(val);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        appSettings.defaultUrl = val;
        saveSettings();
      }
    } catch { /* Invalid URL — don't save */ }
  }, 800);
  settingDefaultUrl.addEventListener("input", defaultUrlSave);

  settingRetentionDays.addEventListener("change", function () {
    let val = parseInt(settingRetentionDays.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > 365) val = 365;
    settingRetentionDays.value = val;
    appSettings.backupRetentionDays = val;
    saveSettings();
  });

  settingSnapshotThreshold.addEventListener("change", function () {
    let val = parseInt(settingSnapshotThreshold.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 9999) val = 9999;
    settingSnapshotThreshold.value = val;
    appSettings.snapshotThreshold = val;
    saveSettings();
  });

  settingStorageWarning.addEventListener("change", function () {
    let val = parseInt(settingStorageWarning.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > 100000) val = 100000;
    settingStorageWarning.value = val;
    appSettings.backupStorageWarningMb = val;
    saveSettings();
  });

  settingSortField.addEventListener("change", function () {
    appSettings.ticketSortField = settingSortField.value;
    saveSettings();
  });

  settingSortDirection.addEventListener("change", function () {
    appSettings.ticketSortDirection = settingSortDirection.value;
    saveSettings();
  });

  // ---- AI ----

  async function populateAiModelDropdown() {
    if (!settingAiModel) return;
    if (!appSettings.aiApiKey) {
      settingAiModel.innerHTML = '<option value="" disabled selected>Enter API key first</option>';
      settingAiModel.disabled = true;
      return;
    }
    settingAiModel.innerHTML = '<option value="" disabled selected>Loading models…</option>';
    settingAiModel.disabled = true;
    const result = await window.backupAPI.aiGetModels({
      aiProvider: appSettings.aiProvider,
      aiApiKey: appSettings.aiApiKey,
    });
    if (result.error || !result.models || result.models.length === 0) {
      const detail = result.error || "Empty model list returned";
      console.error("[AI models]", detail);
      settingAiModel.innerHTML = `<option value="" disabled selected>Error: ${detail.substring(0, 80)}</option>`;
      settingAiModel.disabled = false;
      return;
    }
    settingAiModel.innerHTML = "";
    for (const { value, label } of result.models) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      settingAiModel.appendChild(opt);
    }
    const saved = appSettings.aiModelName;
    const values = result.models.map((m) => m.value);
    if (saved && !values.includes(saved)) {
      const opt = document.createElement("option");
      opt.value = saved;
      opt.textContent = saved;
      settingAiModel.insertBefore(opt, settingAiModel.firstChild);
    }
    settingAiModel.value = saved || values[0] || "";
    settingAiModel.disabled = false;
    if (settingAiModel.value !== saved) {
      appSettings.aiModelName = settingAiModel.value;
      saveSettings();
    }
  }

  if (settingAiProvider) {
    settingAiProvider.addEventListener("change", function () {
      appSettings.aiProvider = settingAiProvider.value;
      const aiEnabled = appSettings.aiProvider !== "none";
      if (aiProviderFields) aiProviderFields.style.display = aiEnabled ? "" : "none";
      saveSettings();
      if (aiEnabled) populateAiModelDropdown();
    });
  }

  if (settingAiModel) {
    settingAiModel.addEventListener("change", function () {
      appSettings.aiModelName = settingAiModel.value;
      saveSettings();
    });
  }

  if (settingAiKey) {
    settingAiKey.addEventListener("change", function () {
      const val = settingAiKey.value.trim();
      if (val) {
        appSettings.aiApiKey = val;
        saveSettings();
        settingAiKey.value = "";
        settingAiKey.placeholder = "••••••••  (saved)";
        populateAiModelDropdown();
      }
    });
  }

  // ---- Signature ----

  document.getElementById("signature-toolbar").addEventListener("click", function (e) {
    const btn = e.target.closest("[data-sig-command]");
    if (!btn) return;
    settingSignature.focus();
    document.execCommand(btn.dataset.sigCommand, false, null);
  });

  const sigSave = debounce(function () {
    appSettings.signatureHtml = settingSignature.innerHTML;
    saveSettings();
  }, SIG_SAVE_DEBOUNCE);
  settingSignature.addEventListener("input", sigSave);

  // ==================== Metrics Bar Settings ====================

  settingMetricsEnabled.addEventListener("change", function () {
    appSettings.metricsBarEnabled = settingMetricsEnabled.checked;
    if (appSettings.metricsBarEnabled) metricsBarConfig.classList.add("visible");
    else metricsBarConfig.classList.remove("visible");
    saveSettings();
  });

  settingMetricsInterval.addEventListener("change", function () {
    const val = parseInt(settingMetricsInterval.value, 10);
    appSettings.metricsBarInterval = [5, 15, 30, 60].includes(val) ? val : 15;
    saveSettings();
  });

  btnMetricsAddDashboard.addEventListener("click", function () {
    if (!appSettings.metricsBarDashboards) appSettings.metricsBarDashboards = [];
    appSettings.metricsBarDashboards.push({ id: "db-" + Date.now(), url: "", fields: [] });
    saveSettings();
    renderDashboardList();
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

  // ==================== Metrics Bar — Scraper & Picker ====================

  let metricsScraperBusy = false;
  let metricsPickerViewOnly = false;
  const metricsValues = {};
  const metricsTestStatuses = {};
  let metricsPickerPendingSelector = null;
  let metricsPickerDashboardId = null;
  let metricsPickerTargetFieldId = null;

  // Script injected into the picker webview so the user can click-to-select an element.
  const METRICS_PICKER_INJECT_SCRIPT = `(function() {
    if (window.__mpInject) return;
    window.__mpInject = true;
    var hi = document.createElement('div');
    hi.style.cssText = 'position:fixed;outline:3px solid #e67e22;background:rgba(230,126,34,0.12);pointer-events:none;border-radius:2px;z-index:999999;display:none;box-sizing:border-box;';
    document.body.appendChild(hi);

    // For table cells: generate a JS expression that finds the row by a stable text
    // anchor (first non-numeric cell — skips rank columns) then returns the clicked
    // column. Searches ALL tables sharing the same class, since BrightGauge reuses
    // one class across every widget table on the page.
    function getTableCellExpr(cellEl) {
      var tr = cellEl.parentElement;
      while (tr && tr.tagName !== 'TR') tr = tr.parentElement;
      if (!tr || !tr.cells) return null;
      var colIdx = Array.from(tr.cells).indexOf(cellEl);
      if (colIdx < 0) return null;
      // Find the best anchor: first non-numeric cell that isn't the target column.
      // Skipping numeric cells avoids anchoring on rank numbers ("1", "2", …).
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
      // Record which table the user clicked so the scraper targets the same widget.
      // All BrightGauge gauge tables share one class, so tblIdx is the only way to
      // distinguish "Closed Tickets table" from "Hours Worked table".
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

    // Returns the shortest CSS selector that uniquely identifies el.
    // Prefers class-based anchors over positional nth-child so that
    // elements that reorder between page loads (e.g. async gauge render)
    // can still be found by their component class name.
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

      // Header: "Dashboard N" label + remove button
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

      // URL input
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

      // Fields section
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

  // ==================== Note Templates ====================

  let editingTemplateIndex = null;

  function renderTemplateList() {
    if (!templateList) return;
    templateList.innerHTML = "";
    const templates = appSettings.noteTemplates || [];
    if (templates.length === 0) {
      templateList.innerHTML = '<p style="font-size:11px;color:var(--text-muted);padding:4px 0;">No templates yet.</p>';
      return;
    }
    templates.forEach(function (tmpl, idx) {
      const item = document.createElement("div");
      item.className = "template-list-item";

      const nameSpan = document.createElement("span");
      nameSpan.className = "template-item-name";
      nameSpan.textContent = tmpl.name;
      nameSpan.title = tmpl.content;

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () {
        editingTemplateIndex = idx;
        templateNameInput.value = tmpl.name;
        templateContentInput.value = tmpl.content;
        templateAddForm.classList.add("visible");
        btnAddTemplate.style.display = "none";
        templateNameInput.focus();
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-small btn-delete";
      delBtn.textContent = "✕";
      delBtn.title = "Delete template";
      delBtn.addEventListener("click", function () {
        appSettings.noteTemplates.splice(idx, 1);
        saveSettings();
        renderTemplateList();
      });

      const btnGroup = document.createElement("div");
      btnGroup.className = "template-item-buttons";
      btnGroup.appendChild(editBtn);
      btnGroup.appendChild(delBtn);

      item.appendChild(nameSpan);
      item.appendChild(btnGroup);
      templateList.appendChild(item);
    });
  }

  btnAddTemplate.addEventListener("click", function () {
    editingTemplateIndex = null;
    templateNameInput.value = "";
    templateContentInput.value = "";
    templateAddForm.classList.add("visible");
    btnAddTemplate.style.display = "none";
    templateNameInput.focus();
  });

  btnCancelTemplate.addEventListener("click", function () {
    templateAddForm.classList.remove("visible");
    btnAddTemplate.style.display = "";
    editingTemplateIndex = null;
  });

  btnSaveTemplate.addEventListener("click", function () {
    const name = templateNameInput.value.trim();
    const content = templateContentInput.value;
    if (!name) { templateNameInput.focus(); return; }
    if (!appSettings.noteTemplates) appSettings.noteTemplates = [];
    if (editingTemplateIndex !== null) {
      appSettings.noteTemplates[editingTemplateIndex] = { name, content };
    } else {
      appSettings.noteTemplates.push({ name, content });
    }
    saveSettings();
    templateAddForm.classList.remove("visible");
    btnAddTemplate.style.display = "";
    editingTemplateIndex = null;
    renderTemplateList();
  });

  // ==================== Startup ====================

  window.backupAPI.onSettingsChanged(function (settings) {
    applySettingsForm(settings);
  });

  window.backupAPI.loadSettings().then(function (settings) {
    applySettingsForm(settings);
    if (appSettings.aiProvider && appSettings.aiProvider !== "none") {
      populateAiModelDropdown();
    }
  }).catch(function (err) {
    console.error("[Settings] Error loading settings:", err);
  });

});
