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

  function redirectToGeneral() {
    document.querySelectorAll(".settings-nav-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.panel === "general");
    });
    document.querySelectorAll(".settings-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "panel-general");
    });
  }

  function updateAiNavVisibility() {
    if (!aiNavItem) return;
    const enabled = appSettings.aiEnabled !== false;
    aiNavItem.style.display = enabled ? "" : "none";
    if (!enabled && aiNavItem.classList.contains("active")) redirectToGeneral();
  }

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
    aiEnabled: true,
    aiProvider: "hatz",
    aiModelName: "",
    aiApiKey: "",
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
  const settingAiEnabled      = document.getElementById("setting-ai-enabled");
  const aiNavItem             = document.querySelector('[data-panel="ai"]');
  const settingAiProvider     = document.getElementById("setting-ai-provider");
  const settingAiModel        = document.getElementById("setting-ai-model");
  const settingAiKey          = document.getElementById("setting-ai-key");
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

    if (settingAiEnabled) settingAiEnabled.checked = settings.aiEnabled !== false;
    updateAiNavVisibility();
    const savedProvider = settings.aiProvider && settings.aiProvider !== "none" ? settings.aiProvider : "hatz";
    if (settingAiProvider) settingAiProvider.value = savedProvider;
    if (settingAiKey) {
      settingAiKey.value = "";
      settingAiKey.placeholder = settings.aiApiKey ? "••••••••  (saved)" : "Paste your API key here";
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

  if (settingAiEnabled) {
    settingAiEnabled.addEventListener("change", function () {
      appSettings.aiEnabled = settingAiEnabled.checked;
      updateAiNavVisibility();
      saveSettings();
    });
  }

  if (settingAiProvider) {
    settingAiProvider.addEventListener("change", function () {
      appSettings.aiProvider = settingAiProvider.value;
      saveSettings();
      populateAiModelDropdown();
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
    if (appSettings.aiProvider && appSettings.aiProvider !== "none") {
      populateAiModelDropdown();
    }

    // Build the pluginSettingsAPI before injecting plugin settings scripts so
    // plugins can call addPanel() synchronously during their top-level execution.
    const pluginPanels = [];
    window.pluginSettingsAPI = Object.freeze({
      addPanel: function (id, label, setupFn) {
        // Add a nav item
        const nav = document.querySelector(".settings-nav");
        if (nav) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "settings-nav-item";
          btn.dataset.panel = "plugin-" + id;
          btn.textContent = label;
          btn.addEventListener("click", function () {
            document.querySelectorAll(".settings-nav-item").forEach(function (b) {
              b.classList.toggle("active", b === btn);
            });
            document.querySelectorAll(".settings-panel").forEach(function (p) {
              p.classList.toggle("active", p.id === "panel-plugin-" + id);
            });
          });
          nav.appendChild(btn);
        }

        // Add the panel div
        const content = document.querySelector(".settings-content");
        const panel = document.createElement("div");
        panel.className = "settings-panel";
        panel.id = "panel-plugin-" + id;
        if (content) content.appendChild(panel);

        pluginPanels.push({ id, panel });

        // Let the plugin populate the panel
        if (typeof setupFn === "function") setupFn(panel);
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
  }).catch(function (err) {
    console.error("[Settings] Error loading settings:", err);
  });

  loadAndRenderPlugins();

});
