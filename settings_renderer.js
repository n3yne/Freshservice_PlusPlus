"use strict";

// ===================================================
// ConnectWise Manage++ — Settings Window Renderer
// Handles all settings form logic. Saves via backupAPI.saveSettings;
// main.js broadcasts settings-changed to the main window so it can
// update its UI without needing to reload.
// ===================================================

document.addEventListener("DOMContentLoaded", function () {

  // ==================== Category Navigation ====================
  // switchPanel queries the DOM live so plugin-added panels and nav items
  // (injected after DOMContentLoaded) are always included.
  function switchPanel(id) {
    document.querySelectorAll(".settings-nav-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.panel === id);
    });
    document.querySelectorAll(".settings-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "panel-" + id);
    });
  }
  // Event delegation covers both core and plugin-added nav buttons.
  (function () {
    const nav = document.querySelector(".settings-nav");
    if (nav) {
      nav.addEventListener("click", function (e) {
        const btn = e.target.closest(".settings-nav-item");
        if (btn) switchPanel(btn.dataset.panel);
      });
    }
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
    dismissedReleaseVersion: "",
    backupStorageWarningMb: 100,
    metricsBarEnabled: false,
    metricsBarInterval: 15,
    metricsBarDashboards: [],
    metricsProgressEnabled: false,
    metricsWorkDays: [1, 2, 3, 4, 5],
    metricsWorkHoursStart: "08:00",
    metricsWorkHoursEnd: "17:00",
    metricsWorkWeekEndDay: 5,
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
  const templateList          = document.getElementById("template-list");
  const btnAddTemplate        = document.getElementById("btn-add-template");
  const templateAddForm       = document.getElementById("template-add-form");
  const templateNameInput     = document.getElementById("template-name-input");
  const templateContentInput  = document.getElementById("template-content-input");
  const btnSaveTemplate       = document.getElementById("btn-save-template");
  const btnCancelTemplate     = document.getElementById("btn-cancel-template");
  const pluginList            = document.getElementById("plugin-list");
  const pluginRestartNotice   = document.getElementById("plugin-restart-notice");
  const btnImportPlugin       = document.getElementById("btn-import-plugin");
  const pluginImportStatus    = document.getElementById("plugin-import-status");

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

  // ==================== Plugins Panel ====================

  let pluginRestartPending = false;

  function renderPluginList(plugins) {
    if (!pluginList) return;
    pluginList.innerHTML = "";

    if (!plugins || plugins.length === 0) {
      const empty = document.createElement("p");
      empty.className = "plugin-list-empty";
      empty.textContent = "No plugins installed.";
      pluginList.appendChild(empty);
      return;
    }

    plugins.forEach(function (plugin) {
      const item = document.createElement("div");
      item.className = "plugin-list-item";

      // Left: info block
      const info = document.createElement("div");
      info.className = "plugin-item-info";

      const header = document.createElement("div");
      header.className = "plugin-item-header";

      const nameSpan = document.createElement("span");
      nameSpan.className = "plugin-item-name";
      nameSpan.textContent = plugin.name || plugin.id;
      header.appendChild(nameSpan);

      if (plugin.version) {
        const ver = document.createElement("span");
        ver.className = "plugin-item-version";
        ver.textContent = "v" + plugin.version;
        header.appendChild(ver);
      }

      const sourceBadge = document.createElement("span");
      sourceBadge.className = "plugin-badge " +
        (plugin.source === "bundled" ? "plugin-badge-bundled" : "plugin-badge-user");
      sourceBadge.textContent = plugin.source === "bundled" ? "Bundled" : "Installed";
      header.appendChild(sourceBadge);

      if (!plugin.enabled) {
        const disabledBadge = document.createElement("span");
        disabledBadge.className = "plugin-badge plugin-badge-disabled";
        disabledBadge.textContent = "Disabled";
        header.appendChild(disabledBadge);
      } else if (plugin.loadError) {
        const errBadge = document.createElement("span");
        errBadge.className = "plugin-badge plugin-badge-error";
        errBadge.title = plugin.loadError;
        errBadge.textContent = "Error";
        header.appendChild(errBadge);
      }

      info.appendChild(header);

      if (plugin.description) {
        const desc = document.createElement("div");
        desc.className = "plugin-item-desc";
        desc.textContent = plugin.description;
        desc.title = plugin.description;
        info.appendChild(desc);
      }

      item.appendChild(info);

      // Right: toggle
      const toggle = document.createElement("label");
      toggle.className = "settings-toggle";
      toggle.title = plugin.enabled ? "Disable plugin" : "Enable plugin";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = plugin.enabled;
      checkbox.addEventListener("change", function () {
        window.backupAPI.setPluginEnabled(plugin.id, checkbox.checked).then(function () {
          pluginRestartPending = true;
          if (pluginRestartNotice) pluginRestartNotice.classList.add("visible");
          plugin.enabled = checkbox.checked;
          // Refresh badges without rebuilding the whole list
          renderPluginList(window._loadedPlugins || []);
        });
      });

      const slider = document.createElement("span");
      slider.className = "settings-toggle-slider";

      toggle.appendChild(checkbox);
      toggle.appendChild(slider);
      item.appendChild(toggle);

      pluginList.appendChild(item);
    });
  }

  function loadAndRenderPlugins() {
    window.backupAPI.getPluginInfo().then(function (plugins) {
      window._loadedPlugins = plugins;
      renderPluginList(plugins);
      if (pluginRestartPending && pluginRestartNotice) {
        pluginRestartNotice.classList.add("visible");
      }
    }).catch(function (err) {
      console.error("[Settings] Failed to load plugin info:", err);
    });
  }

  if (btnImportPlugin) {
    btnImportPlugin.addEventListener("click", function () {
      pluginImportStatus.textContent = "";
      pluginImportStatus.className = "plugin-import-status";
      window.backupAPI.importPlugin().then(function (result) {
        if (result.cancelled) return;
        if (result.success) {
          pluginImportStatus.textContent = "Imported \"" + (result.name || result.id) + "\". Restart to activate.";
          pluginImportStatus.className = "plugin-import-status success";
          pluginRestartPending = true;
          if (pluginRestartNotice) pluginRestartNotice.classList.add("visible");
          loadAndRenderPlugins();
        } else {
          pluginImportStatus.textContent = result.error || "Import failed.";
          pluginImportStatus.className = "plugin-import-status error";
        }
      }).catch(function (err) {
        pluginImportStatus.textContent = "Import error: " + (err.message || err);
        pluginImportStatus.className = "plugin-import-status error";
      });
    });
  }

  // ==================== Startup ====================

  window.backupAPI.onSettingsChanged(function (settings) {
    applySettingsForm(settings);
  });

  window.backupAPI.loadSettings().then(function (settings) {
    applySettingsForm(settings);

    // Build the pluginSettingsAPI before injecting plugin settings scripts so
    // plugins can call addPanel() synchronously during their top-level execution.
    const pluginPanels = [];
    window.pluginSettingsAPI = Object.freeze({
      addPanel: function (id, label, setupFn) {
        // Add a nav item, indented under the Plugins button
        const nav = document.querySelector(".settings-nav");
        if (nav) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "settings-nav-item settings-nav-subitem";
          btn.dataset.panel = "plugin-" + id;
          btn.textContent = label;
          // Insert after the last existing sub-item, or directly after Plugins if none yet
          const subItems = nav.querySelectorAll(".settings-nav-subitem");
          const lastSubItem = subItems.length ? subItems[subItems.length - 1] : null;
          const pluginsBtn = nav.querySelector('[data-panel="plugins"]');
          const anchor = lastSubItem || pluginsBtn;
          if (anchor && anchor.nextSibling) {
            nav.insertBefore(btn, anchor.nextSibling);
          } else {
            nav.appendChild(btn);
          }
        }

        // Add the panel div
        const content = document.querySelector(".settings-content");
        const panel = document.createElement("div");
        panel.className = "settings-panel";
        panel.id = "panel-plugin-" + id;
        if (content) content.appendChild(panel);

        pluginPanels.push({ id, panel });

        // Let the plugin populate the panel
        if (typeof setupFn === "function") {
          try { setupFn(panel); } catch (err) {
            console.error("[PluginSettings] Panel setup for \"" + id + "\" failed:", err);
          }
        }
      },
      getSettings: function () { return Object.assign({}, appSettings); },
      saveSettings: function (patch) {
        appSettings = Object.assign({}, appSettings, patch);
        saveSettings();
      },
      onSettingsChanged: function (fn) {
        window.backupAPI.onSettingsChanged(fn);
      },
    });

    // Inject plugin settings scripts
    window.backupAPI.getPluginSettingsScripts().then(function (scriptPaths) {
      (scriptPaths || []).forEach(function (src) {
        const s = document.createElement("script");
        s.src = src;
        document.body.appendChild(s);
      });
    }).catch(function (err) {
      console.error("[Settings] Failed to load plugin settings scripts:", err);
    });

    // Inject stylesheets from installed plugins
    window.backupAPI.getPluginStylesheets().then(function (sheetPaths) {
      (sheetPaths || []).forEach(function (href) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        document.head.appendChild(link);
      });
    }).catch(function (err) {
      console.error("[Settings] Failed to load plugin stylesheets:", err);
    });
  }).catch(function (err) {
    console.error("[Settings] Error loading settings:", err);
  });

  loadAndRenderPlugins();

});
