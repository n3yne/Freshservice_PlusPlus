"use strict";

// ===================================================
// MSP++ — Settings Window Renderer
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

  // Core settings fallback — only keys used by applySettingsForm() before the async load resolves.
  // Plugin keys are omitted; plugins handle their own missing-value fallbacks via getSettings().
  let appSettings = {
    sidePanelEnabled: true,
    panelCollapsed: false,
    sidePanelTab: "",
    defaultUrl: "about:blank",
    theme: "dark",
    dismissedReleaseVersion: "",
  };

  // ==================== Element References ====================
  const settingSidePanel      = document.getElementById("setting-side-panel");
  const settingDefaultUrl     = document.getElementById("setting-default-url");
  const settingTheme          = document.getElementById("setting-theme");
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
    return window.backupAPI.saveSettings(appSettings);
  }

  // ==================== Form Population ====================
  function applySettingsForm(settings) {
    appSettings = settings;
    settingSidePanel.checked = settings.sidePanelEnabled !== false;

    const theme = settings.theme || "dark";
    document.body.setAttribute("data-theme", theme);
    settingTheme.checked = theme === "light";

    if (document.activeElement !== settingDefaultUrl) {
      settingDefaultUrl.value = settings.defaultUrl && settings.defaultUrl !== "about:blank" ? settings.defaultUrl : "";
    }
  }

  // ==================== Settings Event Listeners ====================

  settingSidePanel.addEventListener("change", function () {
    appSettings.sidePanelEnabled = settingSidePanel.checked;
    saveSettings();
  });

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

  // ==================== Plugins ====================
  //
  // Every plugin gets a tab under Plugins in the nav. A plugin's settings.js fills
  // it in with pluginSettingsAPI.addPanel(); a plugin without one (or a disabled
  // plugin, whose settings.js isn't loaded) gets a default tab. Each tab starts
  // with the plugin's on/off switch, the same one shown in the Plugins list.

  let plugins = [];                 // from getPluginInfo()
  let pluginRestartPending = false;
  const pluginToggles = new Map();  // plugin id → Set of checkboxes showing its state
  const pluginPanelIds = new Map(); // plugin id → [panel ids added for it]

  function findPlugin(id) {
    return plugins.find(function (p) { return p.id === id; }) || null;
  }

  function showRestartNotice() {
    pluginRestartPending = true;
    if (pluginRestartNotice) pluginRestartNotice.classList.add("visible");
    document.querySelectorAll(".plugin-panel-restart").forEach(function (el) { el.classList.add("visible"); });
  }

  function setPluginEnabled(plugin, enabled) {
    return window.backupAPI.setPluginEnabled(plugin.id, enabled).then(function () {
      plugin.enabled = enabled;
      showRestartNotice();
      renderPluginList();
      (pluginToggles.get(plugin.id) || []).forEach(function (cb) { cb.checked = enabled; });
      document.querySelectorAll('.plugin-panel-header[data-plugin-id="' + plugin.id + '"]').forEach(updatePanelHeaderState);
    }).catch(function (err) {
      console.error("[Settings] Failed to change plugin state:", err);
      (pluginToggles.get(plugin.id) || []).forEach(function (cb) { cb.checked = plugin.enabled; });
    });
  }

  // An on/off switch for a plugin; every switch for the same plugin stays in step.
  function createPluginToggle(plugin, labelText) {
    const toggle = document.createElement("label");
    toggle.className = "settings-toggle";
    toggle.title = (plugin.enabled ? "Turn off " : "Turn on ") + (plugin.name || plugin.id);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = plugin.enabled;
    checkbox.addEventListener("change", function () {
      setPluginEnabled(plugin, checkbox.checked);
    });
    if (!pluginToggles.has(plugin.id)) pluginToggles.set(plugin.id, new Set());
    pluginToggles.get(plugin.id).add(checkbox);

    const slider = document.createElement("span");
    slider.className = "settings-toggle-slider";

    toggle.appendChild(checkbox);
    toggle.appendChild(slider);
    if (labelText) {
      const label = document.createElement("span");
      label.className = "settings-toggle-label";
      label.textContent = labelText;
      toggle.appendChild(label);
    }
    return toggle;
  }

  function createBadges(plugin) {
    const frag = document.createDocumentFragment();
    if (plugin.version) {
      const ver = document.createElement("span");
      ver.className = "plugin-item-version";
      ver.textContent = "v" + plugin.version;
      frag.appendChild(ver);
    }
    const sourceBadge = document.createElement("span");
    sourceBadge.className = "plugin-badge " +
      (plugin.source === "bundled" ? "plugin-badge-bundled" : "plugin-badge-user");
    sourceBadge.textContent = plugin.source === "bundled" ? "Bundled" : "Installed";
    frag.appendChild(sourceBadge);

    if (!plugin.enabled) {
      const disabledBadge = document.createElement("span");
      disabledBadge.className = "plugin-badge plugin-badge-disabled";
      disabledBadge.textContent = "Disabled";
      frag.appendChild(disabledBadge);
    } else if (plugin.loadError) {
      const errBadge = document.createElement("span");
      errBadge.className = "plugin-badge plugin-badge-error";
      errBadge.title = plugin.loadError;
      errBadge.textContent = "Error";
      frag.appendChild(errBadge);
    }
    return frag;
  }

  function renderPluginList() {
    if (!pluginList) return;
    pluginList.innerHTML = "";

    if (plugins.length === 0) {
      const empty = document.createElement("p");
      empty.className = "plugin-list-empty";
      empty.textContent = "No plugins installed.";
      pluginList.appendChild(empty);
      return;
    }

    // The list is rebuilt on every change; drop its old switches from the registry.
    pluginToggles.forEach(function (set) {
      set.forEach(function (cb) { if (!cb.isConnected) set.delete(cb); });
    });

    plugins.forEach(function (plugin) {
      const item = document.createElement("div");
      item.className = "plugin-list-item";

      const info = document.createElement("div");
      info.className = "plugin-item-info";

      const header = document.createElement("div");
      header.className = "plugin-item-header";

      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "plugin-item-name plugin-item-link";
      nameBtn.textContent = plugin.name || plugin.id;
      nameBtn.title = "Open " + (plugin.name || plugin.id) + " settings";
      nameBtn.addEventListener("click", function () {
        const ids = pluginPanelIds.get(plugin.id);
        if (ids && ids.length) switchPanel("plugin-" + ids[0]);
      });
      header.appendChild(nameBtn);
      header.appendChild(createBadges(plugin));
      info.appendChild(header);

      if (plugin.description) {
        const desc = document.createElement("div");
        desc.className = "plugin-item-desc";
        desc.textContent = plugin.description;
        desc.title = plugin.description;
        info.appendChild(desc);
      }

      item.appendChild(info);
      item.appendChild(createPluginToggle(plugin));
      pluginList.appendChild(item);
    });
  }

  function updatePanelHeaderState(header) {
    const plugin = findPlugin(header.dataset.pluginId);
    if (!plugin) return;
    const badges = header.querySelector(".plugin-panel-badges");
    if (badges) {
      badges.innerHTML = "";
      badges.appendChild(createBadges(plugin));
    }
  }

  // The bar at the top of each plugin tab: the on/off switch and the plugin's badges.
  function buildPanelHeader(plugin) {
    const header = document.createElement("div");
    header.className = "plugin-panel-header";
    header.dataset.pluginId = plugin.id;

    const row = document.createElement("div");
    row.className = "plugin-panel-header-row";
    row.appendChild(createPluginToggle(plugin, "Enabled"));
    const badges = document.createElement("span");
    badges.className = "plugin-item-header plugin-panel-badges";
    badges.appendChild(createBadges(plugin));
    row.appendChild(badges);
    header.appendChild(row);

    const notice = document.createElement("div");
    notice.className = "plugin-restart-notice plugin-panel-restart" + (pluginRestartPending ? " visible" : "");
    notice.textContent = "Restart the app to apply plugin changes.";
    header.appendChild(notice);
    return header;
  }

  function addPluginNavItem(panelId, label) {
    const nav = document.querySelector(".settings-nav");
    if (!nav) return null;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-nav-item settings-nav-subitem";
    btn.dataset.panel = "plugin-" + panelId;
    btn.textContent = label;
    nav.appendChild(btn);
    return btn;
  }

  function addPluginPanelElement(panelId, pluginId) {
    const content = document.querySelector(".settings-content");
    const panel = document.createElement("div");
    panel.className = "settings-panel";
    panel.id = "panel-plugin-" + panelId;
    if (pluginId) panel.dataset.pluginId = pluginId;
    if (content) content.appendChild(panel);
    return panel;
  }

  // Tabs for plugins that didn't add one: disabled plugins (their settings.js
  // doesn't load) and plugins with no settings of their own.
  function addDefaultPluginPanel(plugin) {
    const panelId = plugin.id;
    if (document.getElementById("panel-plugin-" + panelId)) return;
    addPluginNavItem(panelId, plugin.name || plugin.id);
    const panel = addPluginPanelElement(panelId, plugin.id);
    panel.appendChild(buildPanelHeader(plugin));

    const section = document.createElement("div");
    section.className = "settings-section";
    const title = document.createElement("h3");
    title.className = "settings-section-title";
    title.textContent = plugin.name || plugin.id;
    section.appendChild(title);
    if (plugin.description) {
      const desc = document.createElement("p");
      desc.className = "settings-description settings-description-field settings-description-field-spaced";
      desc.textContent = plugin.description;
      section.appendChild(desc);
    }
    const msg = document.createElement("p");
    msg.className = "settings-description settings-description-field plugin-panel-empty";
    if (!plugin.enabled) {
      msg.textContent = plugin.hasSettings
        ? "Turn this plugin on and restart the app to see its settings."
        : "This plugin is turned off. There's nothing to configure for it.";
    } else if (plugin.loadError) {
      msg.textContent = "This plugin couldn't load: " + plugin.loadError;
    } else {
      msg.textContent = "There's nothing to configure for this plugin.";
    }
    section.appendChild(msg);
    panel.appendChild(section);
    pluginPanelIds.set(plugin.id, [panelId]);
  }

  // Puts plugin tabs in the nav in the same order as the Plugins list, right after Plugins.
  function sortPluginNav() {
    const nav = document.querySelector(".settings-nav");
    const pluginsBtn = nav && nav.querySelector('[data-panel="plugins"]');
    if (!pluginsBtn) return;
    const rank = new Map(plugins.map(function (p, i) { return [p.id, i]; }));
    const items = Array.from(nav.querySelectorAll(".settings-nav-subitem")).map(function (btn, i) {
      const panel = document.getElementById("panel-" + btn.dataset.panel);
      const pluginId = panel && panel.dataset.pluginId;
      return { btn, i, rank: rank.has(pluginId) ? rank.get(pluginId) : plugins.length };
    });
    items.sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
    let anchor = pluginsBtn;
    items.forEach(function (item) {
      anchor.after(item.btn);
      anchor = item.btn;
    });
  }

  function loadPluginInfo() {
    return window.backupAPI.getPluginInfo().then(function (info) {
      plugins = Array.isArray(info) ? info : [];
      renderPluginList();
      if (pluginRestartPending && pluginRestartNotice) pluginRestartNotice.classList.add("visible");
      return plugins;
    }).catch(function (err) {
      console.error("[Settings] Failed to load plugin info:", err);
      plugins = [];
      return plugins;
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
          showRestartNotice();
          loadPluginInfo();
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

  const pluginInfoLoaded = loadPluginInfo();

  window.backupAPI.loadSettings().then(function (settings) {
    applySettingsForm(settings);

    // Plaintext keys and remove requests for plugin credentials (see "credentials"
    // in plugin manifests); filled in before plugin settings scripts run.
    const oneShotSettingKeys = [];

    // Build the pluginSettingsAPI before injecting plugin settings scripts so
    // plugins can call addPanel() synchronously during their top-level execution.
    window.pluginSettingsAPI = Object.freeze({
      addPanel: function (id, label, setupFn) {
        // Which plugin is adding this panel: the settings script running right now
        // (tagged with its plugin id when injected), else a plugin with the same id.
        const script = document.currentScript;
        const pluginId = (script && script.dataset && script.dataset.pluginId) ||
          (findPlugin(id) ? id : null);
        const plugin = pluginId ? findPlugin(pluginId) : null;

        addPluginNavItem(id, label);
        const panel = addPluginPanelElement(id, pluginId);
        if (plugin) {
          panel.appendChild(buildPanelHeader(plugin));
          if (!pluginPanelIds.has(plugin.id)) pluginPanelIds.set(plugin.id, []);
          pluginPanelIds.get(plugin.id).push(id);
        }
        // The plugin fills its own element, so replacing its innerHTML keeps the header.
        const body = document.createElement("div");
        body.className = "plugin-panel-body";
        panel.appendChild(body);

        // Let the plugin populate the panel
        if (typeof setupFn === "function") {
          try { setupFn(body); } catch (err) {
            console.error("[PluginSettings] Panel setup for \"" + id + "\" failed:", err);
          }
        }
      },
      getSettings: function () { return Object.assign({}, appSettings); },
      saveSettings: function (patch) {
        appSettings = Object.assign({}, appSettings, patch);
        const saved = saveSettings();
        // A new API key (or a request to remove one) is sent once; the plaintext
        // is never kept in this window or resent with later saves.
        oneShotSettingKeys.forEach(function (key) { delete appSettings[key]; });
        return saved;
      },
      onSettingsChanged: function (fn) {
        window.backupAPI.onSettingsChanged(fn);
      },
    });

    // Inject plugin settings scripts, then give every other plugin a default tab.
    pluginInfoLoaded.then(function () {
      plugins.forEach(function (p) {
        (p.credentials || []).forEach(function (name) {
          oneShotSettingKeys.push(name, name + "Remove");
        });
      });
      return window.backupAPI.getPluginSettingsScripts();
    }).then(function (scripts) {
      return Promise.all((scripts || []).map(function (entry) {
        return new Promise(function (resolve) {
          const s = document.createElement("script");
          s.src = entry.url;
          s.dataset.pluginId = entry.id;
          s.async = false;
          s.onload = resolve;
          s.onerror = function (e) {
            console.error("[Settings] Failed to load plugin settings script:", entry.url, e);
            resolve();
          };
          document.body.appendChild(s);
        });
      }));
    }).catch(function (err) {
      console.error("[Settings] Failed to load plugin settings scripts:", err);
    }).then(function () {
      plugins.forEach(function (p) {
        if (!pluginPanelIds.has(p.id)) addDefaultPluginPanel(p);
      });
      sortPluginNav();
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

});
