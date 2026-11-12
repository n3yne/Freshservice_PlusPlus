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
  // Opening Settings at a given part (from the command palette):
  // { panel: "general" | "plugins" } or { plugin: id } for that plugin's tab,
  // which exists once the plugin settings scripts have run (pluginPanelsReady).
  let pluginPanelsReady = null;
  function showSettingsTarget(target) {
    if (!target) return;
    if (target.panel === "general" || target.panel === "plugins") { switchPanel(target.panel); return; }
    if (target.panel === "browse") { switchPanel("plugins"); showPluginView("browse"); return; }
    if (typeof target.plugin !== "string" || !pluginPanelsReady) return;
    pluginPanelsReady.then(function () {
      const ids = pluginPanelIds.get(target.plugin);
      if (ids && ids.length) switchPanel("plugin-" + ids[0]);
    });
  }
  window.backupAPI.onSettingsShow(showSettingsTarget);
  // The part to show when the window opened, from its address (?panel= or ?plugin=).
  const startTarget = (function () {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("panel")) return { panel: q.get("panel") };
      if (q.get("plugin")) return { plugin: q.get("plugin") };
    } catch { /* no query */ }
    return null;
  }());

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
    sidePanelTabScroll: false,
    defaultUrl: "about:blank",
    theme: "dark",
    dismissedReleaseVersion: "",
    autoUpdate: true,
    restoreTabs: true,
    unreadTabBadges: true,
    siteTabColors: true,
    pluginAutoUpdate: false,
  };

  // ==================== Element References ====================
  const settingSidePanel      = document.getElementById("setting-side-panel");
  const settingTabScroll      = document.getElementById("setting-side-panel-tab-scroll");
  const settingDefaultUrl     = document.getElementById("setting-default-url");
  const settingRestoreTabs    = document.getElementById("setting-restore-tabs");
  const settingUnreadBadges   = document.getElementById("setting-unread-tab-badges");
  const settingSiteColors     = document.getElementById("setting-site-tab-colors");
  const siteColorList         = document.getElementById("site-tab-color-list");
  const settingTheme          = document.getElementById("setting-theme");
  const settingAutoUpdate     = document.getElementById("setting-auto-update");
  const updateModeNote        = document.getElementById("update-mode-note");
  const btnCheckUpdates       = document.getElementById("btn-check-updates");
  const updateStatusEl        = document.getElementById("update-status");
  const pluginList            = document.getElementById("plugin-list");
  const pluginRestartNotice   = document.getElementById("plugin-restart-notice");
  const btnImportPlugin       = document.getElementById("btn-import-plugin");
  const pluginImportStatus    = document.getElementById("plugin-import-status");
  const pluginSummary         = document.getElementById("plugin-summary");
  const pluginFilterBtns      = document.querySelectorAll(".plugin-filter-btn:not(.plugin-browse-filter-btn)");
  const btnImportFolder       = document.getElementById("btn-import-plugin-folder");
  const pluginViewTabs        = document.querySelectorAll(".plugin-view-tab");
  const pluginBrowseList      = document.getElementById("plugin-browse-list");
  const pluginDirectoryStatus = document.getElementById("plugin-directory-status");
  const pluginBrowseStatus    = document.getElementById("plugin-browse-action-status");
  const pluginBrowseFilterBtns = document.querySelectorAll(".plugin-browse-filter-btn");
  const btnPluginUpdateAll    = document.getElementById("btn-plugin-update-all");
  const btnPluginDirCheck     = document.getElementById("btn-plugin-directory-check");
  const settingPluginAutoUpd  = document.getElementById("setting-plugin-auto-update");
  const pluginUpdateCounts    = [document.getElementById("plugin-update-count"), document.getElementById("nav-plugin-update-count")];

  // ==================== Utilities ====================
  function debounce(fn, ms) {
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  // Sends only the keys that changed. Other windows and plugin panels save too,
  // so this window's copy can be out of date and is never sent whole.
  function saveSettings(patch) {
    return window.backupAPI.saveSettings(patch);
  }

  // ==================== Form Population ====================
  function applySettingsForm(settings) {
    appSettings = settings;
    settingSidePanel.checked = settings.sidePanelEnabled !== false;
    settingTabScroll.checked = settings.sidePanelTabScroll === true;

    const theme = settings.theme || "dark";
    document.body.setAttribute("data-theme", theme);
    settingTheme.checked = theme === "light";
    settingAutoUpdate.checked = settings.autoUpdate !== false;
    if (settingPluginAutoUpd) settingPluginAutoUpd.checked = settings.pluginAutoUpdate === true;
    settingRestoreTabs.checked = settings.restoreTabs !== false;
    settingUnreadBadges.checked = settings.unreadTabBadges !== false;
    settingSiteColors.checked = settings.siteTabColors !== false;
    renderSiteColorList();

    if (document.activeElement !== settingDefaultUrl) {
      settingDefaultUrl.value = settings.defaultUrl && settings.defaultUrl !== "about:blank" ? settings.defaultUrl : "";
    }
  }

  // ==================== Settings Event Listeners ====================

  settingSidePanel.addEventListener("change", function () {
    appSettings.sidePanelEnabled = settingSidePanel.checked;
    saveSettings({ sidePanelEnabled: appSettings.sidePanelEnabled });
  });

  settingTabScroll.addEventListener("change", function () {
    appSettings.sidePanelTabScroll = settingTabScroll.checked;
    saveSettings({ sidePanelTabScroll: appSettings.sidePanelTabScroll });
  });

  settingRestoreTabs.addEventListener("change", function () {
    appSettings.restoreTabs = settingRestoreTabs.checked;
    saveSettings({ restoreTabs: appSettings.restoreTabs });
  });

  settingUnreadBadges.addEventListener("change", function () {
    appSettings.unreadTabBadges = settingUnreadBadges.checked;
    saveSettings({ unreadTabBadges: appSettings.unreadTabBadges });
  });

  settingSiteColors.addEventListener("change", function () {
    appSettings.siteTabColors = settingSiteColors.checked;
    saveSettings({ siteTabColors: appSettings.siteTabColors });
    renderSiteColorList();
  });

  // ==================== Site Tab Colours ====================
  // One row per loaded site plugin: a colour picker, "No colour" and "Default"
  // (the plugin's own colour). Saved as siteTabColorOverrides; see site-colors.js.

  const FALLBACK_SITE_COLOR = "#7c8a9e"; // picker value for a site with no colour

  function saveSiteColor(siteId, color, reset) {
    const next = window.SiteColors.withOverride(appSettings.siteTabColorOverrides, siteId, color, reset);
    appSettings.siteTabColorOverrides = next;
    saveSettings({ siteTabColorOverrides: next });
    renderSiteColorList();
  }

  function renderSiteColorList() {
    if (!siteColorList) return;
    // Don't rebuild under an open colour picker; its own change handler re-renders.
    if (siteColorList.contains(document.activeElement) && document.activeElement.type === "color") return;
    siteColorList.innerHTML = "";
    const sites = plugins.filter(function (p) { return p.site; });
    siteColorList.hidden = sites.length === 0;
    const enabled = appSettings.siteTabColors !== false;
    siteColorList.classList.toggle("site-color-list-disabled", !enabled);
    const overrides = appSettings.siteTabColorOverrides || {};

    sites.forEach(function (p) {
      const defaultColor = window.SiteColors.normalizeColor(p.site.color);
      const color = window.SiteColors.colorForSite(p.id, defaultColor, { siteTabColorOverrides: overrides });
      const changed = Object.prototype.hasOwnProperty.call(overrides, p.id);

      const row = document.createElement("div");
      row.className = "site-color-row";

      const picker = document.createElement("input");
      picker.type = "color";
      picker.className = "site-color-picker";
      picker.value = color || defaultColor || FALLBACK_SITE_COLOR;
      picker.disabled = !enabled;
      picker.title = "Choose the colour for " + p.site.name + " tabs";
      picker.setAttribute("aria-label", p.site.name + " tab colour");
      picker.classList.toggle("site-color-none", !color);
      picker.addEventListener("change", function () {
        picker.blur();
        saveSiteColor(p.id, picker.value, false);
      });

      const name = document.createElement("span");
      name.className = "site-color-name";
      name.textContent = p.site.name + (color ? "" : " (no colour)");

      const off = document.createElement("button");
      off.type = "button";
      off.className = "btn btn-small btn-secondary";
      off.textContent = "No colour";
      off.disabled = !enabled || !color;
      off.addEventListener("click", function () { saveSiteColor(p.id, "", false); });

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "btn btn-small btn-secondary";
      reset.textContent = "Default";
      reset.title = defaultColor ? "Use the colour " + p.site.name + " comes with" : "This site has no colour of its own";
      reset.disabled = !enabled || !changed;
      reset.addEventListener("click", function () { saveSiteColor(p.id, "", true); });

      row.appendChild(picker);
      row.appendChild(name);
      row.appendChild(off);
      row.appendChild(reset);
      siteColorList.appendChild(row);
    });
  }

  settingTheme.addEventListener("change", function () {
    appSettings.theme = settingTheme.checked ? "light" : "dark";
    document.body.setAttribute("data-theme", appSettings.theme);
    saveSettings({ theme: appSettings.theme });
  });

  settingAutoUpdate.addEventListener("change", function () {
    appSettings.autoUpdate = settingAutoUpdate.checked;
    saveSettings({ autoUpdate: appSettings.autoUpdate });
  });

  if (settingPluginAutoUpd) {
    settingPluginAutoUpd.addEventListener("change", function () {
      appSettings.pluginAutoUpdate = settingPluginAutoUpd.checked;
      saveSettings({ pluginAutoUpdate: appSettings.pluginAutoUpdate });
    });
  }

  // ==================== Updates ====================

  const UPDATE_MODE_NOTES = {
    portable: "This is the portable copy, which can't update itself. You'll get a notification with a link to the new version. Use the installer to get automatic updates.",
    mac: "The Mac app can't update itself yet. You'll get a notification with a link to the new version.",
    dev: "Running from source: updates aren't installed, you'll only be told about new releases.",
    "no-config": "This build has no update information, so it can't update itself. You'll get a notification with a link to the new version.",
    platform: "Automatic updates aren't available on this system. You'll get a notification with a link to the new version.",
  };

  function showUpdateStatus(st) {
    if (!st) return;
    const note = st.mode === "auto" ? "" : (UPDATE_MODE_NOTES[st.reason] || "");
    updateModeNote.textContent = note;
    updateModeNote.hidden = !note;
    settingAutoUpdate.disabled = st.mode !== "auto";

    let text;
    let cls = "";
    switch (st.state) {
      case "checking": text = "Checking…"; break;
      case "none": text = "You're on the latest version (v" + st.currentVersion + ")."; cls = "success"; break;
      case "available": text = "v" + st.version + " is available. You have v" + st.currentVersion + "."; break;
      case "downloading": text = "Downloading v" + st.version + (st.percent ? " (" + st.percent + "%)" : "") + "…"; break;
      case "downloaded": text = "v" + st.version + " is ready and installs when you close MSP++."; cls = "success"; break;
      case "error": text = "Couldn't check for updates: " + (st.error || "unknown error"); cls = "error"; break;
      default: text = "Version v" + st.currentVersion + ".";
    }
    updateStatusEl.textContent = text;
    updateStatusEl.className = "plugin-import-status" + (cls ? " " + cls : "");
  }

  window.backupAPI.onAppUpdateStatus(showUpdateStatus);
  window.backupAPI.getUpdateStatus().then(showUpdateStatus).catch(function () {});

  btnCheckUpdates.addEventListener("click", function () {
    btnCheckUpdates.disabled = true;
    window.backupAPI.checkForUpdates()
      .then(showUpdateStatus)
      .catch(function () {})
      .finally(function () { btnCheckUpdates.disabled = false; });
  });

  // ==================== Site Permissions ====================

  const btnClearSitePermissions = document.getElementById("btn-clear-site-permissions");
  const sitePermissionsStatus = document.getElementById("site-permissions-status");

  function showSitePermissions(info, justCleared) {
    const answers = info && info.answers ? info.answers : 0;
    const sites = info && info.sites ? info.sites : 0;
    btnClearSitePermissions.disabled = answers === 0;
    if (justCleared) sitePermissionsStatus.textContent = "Forgotten. Sites will ask again.";
    else if (answers === 0) sitePermissionsStatus.textContent = "No saved answers";
    else {
      sitePermissionsStatus.textContent =
        answers + (answers === 1 ? " answer" : " answers") + " saved for " +
        sites + (sites === 1 ? " site" : " sites");
    }
  }

  function refreshSitePermissions() {
    window.backupAPI.getSitePermissions().then(function (info) { showSitePermissions(info, false); }).catch(function () {});
  }

  btnClearSitePermissions.addEventListener("click", function () {
    window.backupAPI.clearSitePermissions()
      .then(function (info) { showSitePermissions(info, true); })
      .catch(function () { sitePermissionsStatus.textContent = "Could not forget the saved answers"; });
  });
  // A site may have been answered while this window was in the background.
  window.addEventListener("focus", refreshSitePermissions);
  refreshSitePermissions();

  // ==================== Settings Export / Import ====================

  const btnExportSettings = document.getElementById("btn-export-settings");
  const btnImportSettings = document.getElementById("btn-import-settings");
  const settingsTransferStatus = document.getElementById("settings-transfer-status");

  function runSettingsTransfer(action, done) {
    btnExportSettings.disabled = true;
    btnImportSettings.disabled = true;
    settingsTransferStatus.textContent = "";
    action()
      .then(function (result) {
        if (!result || result.cancelled) return;
        if (!result.success) {
          settingsTransferStatus.textContent = result.error || "Something went wrong.";
          return;
        }
        done(result);
      })
      .catch(function () { settingsTransferStatus.textContent = "Something went wrong."; })
      .finally(function () {
        btnExportSettings.disabled = false;
        btnImportSettings.disabled = false;
      });
  }

  btnExportSettings.addEventListener("click", function () {
    runSettingsTransfer(window.backupAPI.exportSettings, function () {
      settingsTransferStatus.textContent = "Exported. API keys weren't included.";
    });
  });

  btnImportSettings.addEventListener("click", function () {
    runSettingsTransfer(window.backupAPI.importSettings, function (result) {
      settingsTransferStatus.textContent = result.restartNeeded
        ? "Imported. Restart the app to apply the plugin changes."
        : "Imported.";
      // Plugin on/off switches may have changed; the settings themselves arrive
      // through settings-changed like any other save.
      loadPluginInfo().then(function () {
        plugins.forEach(function (p) {
          (pluginToggles.get(p.id) || []).forEach(function (cb) { cb.checked = p.enabled; });
        });
        if (result.restartNeeded) showRestartNotice();
      });
    });
  });

  const defaultUrlSave = debounce(function () {
    const val = settingDefaultUrl.value.trim();
    try {
      const parsed = new URL(val);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        appSettings.defaultUrl = val;
        saveSettings({ defaultUrl: val });
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
    const source = SOURCE_BADGES[plugin.source] || SOURCE_BADGES.user;
    const sourceBadge = document.createElement("span");
    sourceBadge.className = "plugin-badge " + source.className;
    sourceBadge.textContent = source.label;
    sourceBadge.title = plugin.replacesBundled
      ? source.title + " It replaces the bundled v" + plugin.replacesBundled + "."
      : source.title;
    frag.appendChild(sourceBadge);

    const pendingLabel = pendingBadgeText(plugin.id);
    if (pendingLabel) {
      const pendingBadge = document.createElement("span");
      pendingBadge.className = "plugin-badge plugin-badge-pending";
      pendingBadge.textContent = pendingLabel;
      frag.appendChild(pendingBadge);
    }

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

  const SOURCE_BADGES = {
    bundled: { label: "Bundled", className: "plugin-badge-bundled", title: "Comes with MSP++." },
    directory: { label: "Directory", className: "plugin-badge-directory", title: "Installed from the plugin directory." },
    imported: { label: "Imported", className: "plugin-badge-user", title: "Imported from a file or folder." },
    user: {
      label: "Imported", className: "plugin-badge-user",
      title: "Imported before MSP++ 0.8. Its code and saved data share one folder, so removing it removes its data too.",
    },
  };

  // "Removed on restart" etc. for a plugin with a change waiting for restart.
  function pendingBadgeText(id) {
    const pending = directoryState && directoryState.pending;
    if (!pending) return "";
    if (pending.remove.includes(id)) return "Removed on restart";
    if (pending.install.includes(id)) return "Updated on restart";
    return "";
  }

  // Which plugins the list shows: "all", "on" or "off" (the buttons above it).
  let pluginFilter = "all";

  pluginFilterBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      pluginFilter = btn.dataset.filter || "all";
      pluginFilterBtns.forEach(function (b) {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      renderPluginList();
    });
  });

  function buildPluginItem(plugin) {
    const item = document.createElement("div");
    item.className = "plugin-list-item" + (plugin.enabled ? "" : " plugin-list-item-off");

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
    const actions = document.createElement("div");
    actions.className = "plugin-item-actions";
    if (plugin.source !== "bundled") {
      const pendingRemove = directoryState && directoryState.pending.remove.includes(plugin.id);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-link-danger";
      removeBtn.textContent = pendingRemove ? "Keep" : "Remove";
      removeBtn.title = pendingRemove
        ? "Don't remove " + (plugin.name || plugin.id)
        : "Remove " + (plugin.name || plugin.id) + " from MSP++";
      removeBtn.addEventListener("click", function () {
        if (pendingRemove) cancelPluginChange(plugin.id);
        else showRemoveConfirm(item, plugin);
      });
      actions.appendChild(removeBtn);
    }
    actions.appendChild(createPluginToggle(plugin));
    item.appendChild(actions);
    return item;
  }

  function cancelPluginChange(id) {
    window.backupAPI.cancelPluginChange(id).then(refreshDirectoryState);
  }

  // Inline "Remove X?" row under a plugin, with the "also delete its data" choice.
  function showRemoveConfirm(item, plugin) {
    if (item.querySelector(".plugin-remove-confirm")) return;
    item.classList.add("confirming");
    const row = document.createElement("div");
    row.className = "plugin-remove-confirm";
    const text = document.createElement("span");
    const name = plugin.name || plugin.id;
    text.textContent = plugin.source === "user"
      ? "Remove " + name + "? It was imported before MSP++ 0.8, so its saved data is removed with it."
      : "Remove " + name + " at the next restart?";
    row.appendChild(text);

    let dataBox = null;
    if (plugin.source !== "user") {
      const label = document.createElement("label");
      dataBox = document.createElement("input");
      dataBox.type = "checkbox";
      label.appendChild(dataBox);
      label.appendChild(document.createTextNode(" Also delete its saved data"));
      row.appendChild(label);
    }

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-small btn-warning";
    confirmBtn.textContent = "Remove";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-small btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function () {
      row.remove();
      item.classList.remove("confirming");
    });
    confirmBtn.addEventListener("click", function () {
      confirmBtn.disabled = true;
      window.backupAPI.removePlugin(plugin.id, !!(dataBox && dataBox.checked)).then(function (result) {
        if (!result || !result.success) {
          text.textContent = (result && result.error) || "Couldn't remove the plugin.";
          confirmBtn.disabled = false;
          return;
        }
        if (result.neededBy && result.neededBy.length) {
          pluginImportStatus.textContent = name + " will be removed. " + result.neededBy.join(", ") +
            (result.neededBy.length === 1 ? " needs" : " need") + " it and may stop working.";
          pluginImportStatus.className = "plugin-import-status error";
        }
        if (!result.cancelled) showRestartNotice();
        refreshDirectoryState();
      });
    });
    row.appendChild(confirmBtn);
    row.appendChild(cancelBtn);
    item.appendChild(row);
  }

  // The Plugins list, one section per category (see plugin-categories.js), each
  // with a count of how many of its plugins are on.
  function renderPluginList() {
    if (!pluginList) return;
    pluginList.innerHTML = "";

    const enabledTotal = plugins.filter(function (p) { return p.enabled; }).length;
    if (pluginSummary) {
      pluginSummary.textContent = plugins.length
        ? enabledTotal + " of " + plugins.length + " plugins on"
        : "";
    }

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

    let shown = 0;
    window.PluginCategories.groupPlugins(plugins).forEach(function (group) {
      const visible = group.plugins.filter(function (p) {
        if (pluginFilter === "on") return p.enabled;
        if (pluginFilter === "off") return !p.enabled;
        return true;
      });
      if (visible.length === 0) return;
      shown += visible.length;

      const section = document.createElement("section");
      section.className = "plugin-category";
      section.dataset.category = group.name;

      const head = document.createElement("div");
      head.className = "plugin-category-header";
      const title = document.createElement("h4");
      title.className = "plugin-category-title";
      title.textContent = group.name;
      head.appendChild(title);
      const count = document.createElement("span");
      count.className = "plugin-category-count" +
        (group.enabledCount === group.plugins.length ? " all-on" : group.enabledCount === 0 ? " all-off" : "");
      count.textContent = group.enabledCount + " of " + group.plugins.length + " on";
      head.appendChild(count);
      section.appendChild(head);

      if (group.description) {
        const desc = document.createElement("div");
        desc.className = "plugin-category-desc";
        desc.textContent = group.description;
        section.appendChild(desc);
      }

      const items = document.createElement("div");
      items.className = "plugin-category-items";
      visible.forEach(function (plugin) { items.appendChild(buildPluginItem(plugin)); });
      section.appendChild(items);
      pluginList.appendChild(section);
    });

    if (shown === 0) {
      const empty = document.createElement("p");
      empty.className = "plugin-list-empty";
      empty.textContent = pluginFilter === "on" ? "No plugins are on." : "Every plugin is on.";
      pluginList.appendChild(empty);
    }
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
    const noticeText = document.createElement("span");
    noticeText.textContent = "Restart the app to apply plugin changes.";
    notice.appendChild(noticeText);
    notice.appendChild(createRestartButton());
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

  // Puts plugin tabs in the nav in the same order as the Plugins list, right after
  // Plugins, under a small heading for each category.
  function sortPluginNav() {
    const nav = document.querySelector(".settings-nav");
    const pluginsBtn = nav && nav.querySelector('[data-panel="plugins"]');
    if (!pluginsBtn) return;
    nav.querySelectorAll(".settings-nav-group").forEach(function (el) { el.remove(); });
    const rank = new Map(plugins.map(function (p, i) { return [p.id, i]; }));
    const items = Array.from(nav.querySelectorAll(".settings-nav-subitem")).map(function (btn, i) {
      const panel = document.getElementById("panel-" + btn.dataset.panel);
      const plugin = findPlugin(panel && panel.dataset.pluginId);
      return {
        btn, i,
        rank: plugin ? rank.get(plugin.id) : plugins.length,
        category: plugin ? window.PluginCategories.categoryOf(plugin) : "",
      };
    });
    items.sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
    let anchor = pluginsBtn;
    let lastCategory = null;
    items.forEach(function (item) {
      if (item.category && item.category !== lastCategory) {
        const heading = document.createElement("div");
        heading.className = "settings-nav-group";
        heading.textContent = item.category;
        anchor.after(heading);
        anchor = heading;
        lastCategory = item.category;
      }
      anchor.after(item.btn);
      anchor = item.btn;
    });
  }

  function loadPluginInfo() {
    return window.backupAPI.getPluginInfo().then(function (info) {
      // In category order, the same order as the Plugins list and the nav.
      plugins = window.PluginCategories.sortPlugins(Array.isArray(info) ? info : []);
      renderPluginList();
      renderSiteColorList();
      if (pluginRestartPending && pluginRestartNotice) pluginRestartNotice.classList.add("visible");
      return plugins;
    }).catch(function (err) {
      console.error("[Settings] Failed to load plugin info:", err);
      plugins = [];
      return plugins;
    });
  }

  function importPlugin(kind) {
    pluginImportStatus.textContent = "";
    pluginImportStatus.className = "plugin-import-status";
    window.backupAPI.importPlugin(kind).then(function (result) {
      if (result.cancelled) return;
      if (result.success) {
        pluginImportStatus.textContent = "Imported \"" + (result.name || result.id) + "\". Restart to activate.";
        pluginImportStatus.className = "plugin-import-status success";
        showRestartNotice();
        refreshDirectoryState();
      } else {
        pluginImportStatus.textContent = result.error || "Import failed.";
        pluginImportStatus.className = "plugin-import-status error";
      }
    }).catch(function (err) {
      pluginImportStatus.textContent = "Import error: " + (err.message || err);
      pluginImportStatus.className = "plugin-import-status error";
    });
  }

  if (btnImportPlugin) btnImportPlugin.addEventListener("click", function () { importPlugin("file"); });
  if (btnImportFolder) btnImportFolder.addEventListener("click", function () { importPlugin("folder"); });

  // ==================== Plugin directory (Browse) ====================
  //
  // main.js (plugin-directory.js) fetches the directory's index and keeps track
  // of installs waiting for restart. This view lists the directory by category.

  let directoryState = null;
  let browseFilter = "all";
  let browseChecked = false;

  function createRestartButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-small btn-secondary plugin-restart-now";
    btn.textContent = "Restart Now";
    btn.addEventListener("click", restartApp);
    return btn;
  }

  function restartApp() {
    window.backupAPI.restartApp();
  }
  document.querySelectorAll("#plugin-restart-notice .plugin-restart-now").forEach(function (btn) {
    btn.addEventListener("click", restartApp);
  });

  function showPluginView(view) {
    pluginViewTabs.forEach(function (tab) {
      const on = tab.dataset.view === view;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".plugin-view").forEach(function (el) {
      const on = el.id === "plugin-view-" + view;
      el.classList.toggle("active", on);
      el.hidden = !on;
    });
    if (view === "browse" && !browseChecked) {
      browseChecked = true;
      if (!directoryState || !directoryState.fetchedAt) checkDirectory();
    }
  }

  pluginViewTabs.forEach(function (tab) {
    tab.addEventListener("click", function () { showPluginView(tab.dataset.view); });
  });

  pluginBrowseFilterBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      browseFilter = btn.dataset.filter || "all";
      pluginBrowseFilterBtns.forEach(function (b) {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      renderBrowseList();
    });
  });

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function formatAgo(ms) {
    const mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + (mins === 1 ? " minute ago" : " minutes ago");
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    return new Date(ms).toLocaleDateString();
  }

  function setDirectoryState(state) {
    if (!state) return;
    directoryState = state;
    const count = state.updates.length;
    pluginUpdateCounts.forEach(function (el) {
      if (!el) return;
      el.hidden = count === 0;
      el.textContent = String(count);
      el.title = count + (count === 1 ? " plugin update" : " plugin updates");
    });
    if (btnPluginUpdateAll) {
      btnPluginUpdateAll.hidden = count === 0;
      btnPluginUpdateAll.textContent = count > 1 ? "Update All (" + count + ")" : "Update";
    }
    if (pluginDirectoryStatus) {
      if (state.error) pluginDirectoryStatus.textContent = "Can't reach the plugin directory: " + state.error;
      else if (state.fetchedAt) pluginDirectoryStatus.textContent = state.plugins.length + " plugins in the directory · checked " + formatAgo(state.fetchedAt);
      else pluginDirectoryStatus.textContent = "Not checked yet.";
    }
    if (state.pending.install.length || state.pending.remove.length) showRestartNotice();
    renderBrowseList();
    renderPluginList();
  }

  function refreshDirectoryState() {
    return Promise.all([window.backupAPI.getPluginDirectory(), loadPluginInfo()]).then(function (r) {
      setDirectoryState(r[0]);
    }).catch(function (err) {
      console.error("[Settings] Failed to load the plugin directory:", err);
    });
  }

  function checkDirectory() {
    if (btnPluginDirCheck) btnPluginDirCheck.disabled = true;
    if (pluginDirectoryStatus) pluginDirectoryStatus.textContent = "Checking the plugin directory…";
    return window.backupAPI.checkPluginDirectory().then(setDirectoryState).catch(function (err) {
      if (pluginDirectoryStatus) pluginDirectoryStatus.textContent = "Check failed: " + (err.message || err);
    }).finally(function () {
      if (btnPluginDirCheck) btnPluginDirCheck.disabled = false;
    });
  }

  if (btnPluginDirCheck) btnPluginDirCheck.addEventListener("click", checkDirectory);

  function reportInstall(promise, busyText) {
    pluginBrowseStatus.textContent = busyText;
    pluginBrowseStatus.className = "plugin-import-status";
    pluginBrowseList.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    if (btnPluginUpdateAll) btnPluginUpdateAll.disabled = true;
    return promise.then(function (result) {
      const names = (result && result.staged || []).map(function (s) { return s.name + " " + s.version; });
      if (result && result.success) {
        pluginBrowseStatus.textContent = names.length
          ? "Downloaded " + names.join(", ") + ". Restart to finish."
          : "Nothing to update.";
        pluginBrowseStatus.className = "plugin-import-status success";
        if (names.length) showRestartNotice();
      } else {
        pluginBrowseStatus.textContent = (names.length ? "Downloaded " + names.join(", ") + ", then: " : "") +
          ((result && result.error) || "Install failed.");
        pluginBrowseStatus.className = "plugin-import-status error";
        if (names.length) showRestartNotice();
      }
    }).catch(function (err) {
      pluginBrowseStatus.textContent = "Install error: " + (err.message || err);
      pluginBrowseStatus.className = "plugin-import-status error";
    }).finally(function () {
      if (btnPluginUpdateAll) btnPluginUpdateAll.disabled = false;
      refreshDirectoryState();
    });
  }

  if (btnPluginUpdateAll) {
    btnPluginUpdateAll.addEventListener("click", function () {
      reportInstall(window.backupAPI.updateAllPlugins(), "Downloading updates…");
    });
  }

  function directoryName(id) {
    const e = directoryState && directoryState.plugins.find(function (p) { return p.id === id; });
    if (e) return e.name;
    const p = findPlugin(id);
    return p ? p.name || id : id;
  }

  // The button (or state text) on the right of a directory card.
  function buildBrowseAction(entry) {
    const wrap = document.createElement("div");
    wrap.className = "plugin-item-actions";
    function stateText(text) {
      const el = document.createElement("span");
      el.className = "plugin-item-state";
      el.textContent = text;
      wrap.appendChild(el);
    }
    function button(label, cls, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-small " + cls;
      btn.textContent = label;
      btn.addEventListener("click", onClick);
      wrap.appendChild(btn);
      return btn;
    }
    const install = function () {
      const needs = entry.requires.filter(function (r) { return !findPlugin(r); });
      const label = needs.length
        ? "Downloading " + entry.name + " and " + needs.map(directoryName).join(", ") + "…"
        : "Downloading " + entry.name + "…";
      reportInstall(window.backupAPI.installFromDirectory([entry.id]), label);
    };

    if (entry.pendingAction === "remove") {
      stateText("Removed on restart");
      button("Keep", "btn-secondary", function () { cancelPluginChange(entry.id); });
    } else if (entry.pendingAction) {
      stateText((entry.pendingAction === "install" ? "Installs" : "Updates to v" + entry.pendingVersion) + " on restart");
      button("Cancel", "btn-secondary", function () { cancelPluginChange(entry.id); });
    } else if (entry.status === "incompatible") {
      stateText("Needs MSP++ " + entry.minAppVersion);
    } else if (entry.status === "update") {
      button("Update to v" + entry.version, "btn-primary", install);
    } else if (entry.status === "installed") {
      stateText("Installed");
    } else {
      button("Install", "btn-primary", install);
    }
    return wrap;
  }

  function buildBrowseItem(entry) {
    const item = document.createElement("div");
    item.className = "plugin-list-item plugin-browse-item";
    const info = document.createElement("div");
    info.className = "plugin-item-info";

    const header = document.createElement("div");
    header.className = "plugin-item-header";
    const name = document.createElement("span");
    name.className = "plugin-item-name";
    name.textContent = entry.name;
    header.appendChild(name);
    const ver = document.createElement("span");
    ver.className = "plugin-item-version";
    ver.textContent = entry.status === "update"
      ? "v" + entry.installedVersion + " → v" + entry.version
      : "v" + (entry.installedVersion && entry.status === "installed" ? entry.installedVersion : entry.version);
    header.appendChild(ver);
    if (entry.installedSource === "bundled") {
      const b = document.createElement("span");
      b.className = "plugin-badge plugin-badge-bundled";
      b.textContent = "Bundled";
      header.appendChild(b);
    }
    info.appendChild(header);

    if (entry.description) {
      const desc = document.createElement("div");
      desc.className = "plugin-item-desc";
      desc.textContent = entry.description;
      info.appendChild(desc);
    }
    const meta = [formatSize(entry.size)];
    if (entry.requires.length) meta.push("Needs " + entry.requires.map(directoryName).join(", "));
    if (entry.minAppVersion) meta.push("MSP++ " + entry.minAppVersion + "+");
    const metaEl = document.createElement("div");
    metaEl.className = "plugin-item-meta";
    metaEl.textContent = meta.join(" · ");
    if (entry.changelog) metaEl.title = entry.changelog;
    info.appendChild(metaEl);

    item.appendChild(info);
    item.appendChild(buildBrowseAction(entry));
    return item;
  }

  function renderBrowseList() {
    if (!pluginBrowseList) return;
    pluginBrowseList.innerHTML = "";
    const entries = directoryState ? directoryState.plugins : [];
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "plugin-list-empty";
      empty.textContent = directoryState && directoryState.error
        ? "The plugin directory couldn't be loaded. Your installed plugins still work."
        : directoryState && directoryState.fetchedAt ? "The plugin directory is empty." : "Loading the plugin directory…";
      pluginBrowseList.appendChild(empty);
      return;
    }
    // groupPlugins counts "enabled"; here that means installed.
    const forGrouping = entries.map(function (e) {
      return Object.assign({}, e, { enabled: e.status === "installed" || e.status === "update" });
    });
    let shown = 0;
    window.PluginCategories.groupPlugins(forGrouping).forEach(function (group) {
      const visible = group.plugins.filter(function (e) {
        if (browseFilter === "available") return e.status === "available" || e.status === "incompatible";
        if (browseFilter === "updates") return e.status === "update";
        return true;
      });
      if (visible.length === 0) return;
      shown += visible.length;
      const section = document.createElement("section");
      section.className = "plugin-category";
      section.dataset.category = group.name;
      const head = document.createElement("div");
      head.className = "plugin-category-header";
      const title = document.createElement("h4");
      title.className = "plugin-category-title";
      title.textContent = group.name;
      head.appendChild(title);
      const count = document.createElement("span");
      count.className = "plugin-category-count" + (group.enabledCount === 0 ? " all-off" : "");
      count.textContent = group.enabledCount + " of " + group.plugins.length + " installed";
      head.appendChild(count);
      section.appendChild(head);
      const items = document.createElement("div");
      items.className = "plugin-category-items";
      visible.forEach(function (e) { items.appendChild(buildBrowseItem(e)); });
      section.appendChild(items);
      pluginBrowseList.appendChild(section);
    });
    if (shown === 0) {
      const empty = document.createElement("p");
      empty.className = "plugin-list-empty";
      empty.textContent = browseFilter === "updates" ? "Your plugins are up to date." : "You've installed everything in the directory.";
      pluginBrowseList.appendChild(empty);
    }
  }

  window.backupAPI.onPluginDirectoryStatus(function (state) {
    loadPluginInfo().then(function () { setDirectoryState(state); });
  });

  // ==================== Startup ====================

  window.backupAPI.onSettingsChanged(function (settings) {
    applySettingsForm(settings);
  });

  const pluginInfoLoaded = loadPluginInfo();
  window.backupAPI.getPluginDirectory().then(setDirectoryState).catch(function () { /* shown when Browse opens */ });

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
        const saved = saveSettings(Object.assign({}, patch));
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
    pluginPanelsReady = pluginInfoLoaded.then(function () {
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
    showSettingsTarget(startTarget);

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
