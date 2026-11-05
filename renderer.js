// ===================================================
// MSP++ - Renderer (UI Logic)
// ===================================================

document.addEventListener("DOMContentLoaded", function () {
  // --- Element References ---
  const sidePanel = document.getElementById("side-panel");
  const sidePanelTabsEl = document.getElementById("side-panel-tabs");
  const sidePanelBody = document.getElementById("side-panel-body");
  const resizeHandle = document.getElementById("resize-handle");
  const btnToggle = document.getElementById("btn-toggle-panel");
  const btnExpand = document.getElementById("btn-expand-panel");

  const btnDownloads = document.getElementById("btn-downloads");
  const downloadsPanel = document.getElementById("downloads-panel");
  const downloadsList = document.getElementById("downloads-list");
  const btnCloseDownloads = document.getElementById("btn-close-downloads");
  let newCompletedCount = 0;
  const downloadSeenStates = new Map();
  const btnClearDownloads = document.getElementById("btn-clear-downloads");
  const btnNotifications = document.getElementById("btn-notifications");
  const notificationsPanel = document.getElementById("notifications-panel");
  const notificationsList = document.getElementById("notifications-list");
  const btnCloseNotifications = document.getElementById("btn-close-notifications");

  // --- Tab Management Elements ---
  const tabList = document.getElementById("tab-list");
  const webviewContainer = document.getElementById("webview-container");
  const btnNewTab = document.getElementById("btn-new-tab");
  const btnBack = document.getElementById("btn-back");
  const btnForward = document.getElementById("btn-forward");
  const btnRefresh = document.getElementById("btn-refresh");

  // --- Find Bar Elements ---
  const findBar = document.getElementById("find-bar");
  const findInput = document.getElementById("find-input");
  const findMatchCount = document.getElementById("find-match-count");
  const btnFindPrev = document.getElementById("find-prev");
  const btnFindNext = document.getElementById("find-next");
  const btnFindClose = document.getElementById("find-close");

  // --- Confirm Dialog Elements (declared early — referenced by Escape handler) ---
  const confirmOverlay = document.getElementById("confirm-overlay");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmYes = document.getElementById("confirm-yes");
  const confirmNo = document.getElementById("confirm-no");
  let confirmResolve = null;

  // ==================== Plugin Event Bus ====================
  const _pluginBus = new Map();
  function _busOn(name, fn) {
    if (!_pluginBus.has(name)) _pluginBus.set(name, new Set());
    _pluginBus.get(name).add(fn);
    return () => _pluginBus.get(name)?.delete(fn);
  }
  function _busOff(name, fn) { _pluginBus.get(name)?.delete(fn); }
  function _busEmit(name, data) {
    (_pluginBus.get(name) || []).forEach(function (fn) {
      try { fn(data); } catch (e) { console.error("[PluginBus]", name, e); }
    });
  }
  window.backupAPI.onPluginEvent(function (payload) {
    if (payload && typeof payload.name === "string") _busEmit(payload.name, payload.data);
  });

  // ==================== Constants ====================
  const MENU_EDGE_PADDING = 4; // px — context menu window-edge padding
  const TAB_HISTORY_MAX = 50; // max entries in tab history stack

  // ==================== Settings ====================
  // Core settings fallback — only keys used by applySettings() before the async load resolves.
  // Plugin keys are omitted; plugins handle their own missing-value fallbacks via getSettings().
  let appSettings = {
    sidePanelEnabled: true,
    panelCollapsed: false,
    sidePanelTab: "",
    defaultUrl: "about:blank",
    theme: "dark",
    dismissedReleaseVersion: "",
  };

  function applySettings(settings) {
    appSettings = settings;
    panelCollapsed = settings.panelCollapsed || false;
    document.body.setAttribute("data-theme", settings.theme || "dark");
    updateSidePanelVisibility();
  }

  // ==================== Download Manager ====================

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
  }

  function renderDownloadItem(dl) {
    function escAttr(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function escText(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    const pct =
      dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
    const isComplete = dl.state === "completed";
    const isFailed = dl.state === "interrupted" || dl.state === "cancelled";
    const inProgress = dl.state === "progressing";

    const stateLabel = isComplete
      ? "Complete"
      : isFailed
        ? escText(dl.state.charAt(0).toUpperCase() + dl.state.slice(1))
        : pct + "%";

    const progressBar = inProgress
      ? `<div class="dl-progress-track"><div class="dl-progress-fill" style="width:${pct}%"></div></div>`
      : "";

    const sizeInfo =
      dl.totalBytes > 0
        ? isComplete
          ? formatBytes(dl.totalBytes)
          : formatBytes(dl.receivedBytes) + " / " + formatBytes(dl.totalBytes)
        : "";

    const safePath = escAttr(dl.savePath);
    const safeFilename = escText(dl.filename);
    const safeTitle = escAttr(dl.savePath || dl.filename);

    return `<div class="dl-item" data-dl-id="${escAttr(dl.id)}">
      <div class="dl-item-name" title="${safeTitle}">${safeFilename}</div>
      <div class="dl-item-meta">
        <span class="dl-state ${isComplete ? "dl-complete" : isFailed ? "dl-failed" : "dl-active"}">${stateLabel}</span>
        ${sizeInfo ? `<span class="dl-size">${sizeInfo}</span>` : ""}
      </div>
      ${progressBar}
      <div class="dl-item-actions">
        ${isComplete ? `<button class="btn btn-small dl-btn-open" data-path="${safePath}">Open File</button>` : ""}
        ${isComplete ? `<button class="btn btn-small dl-btn-folder" data-path="${safePath}">Open Folder</button>` : ""}
      </div>
    </div>`;
  }

  async function openDownloadsPanel() {
    const items = await window.backupAPI.getDownloads();
    if (items.length === 0) {
      downloadsList.innerHTML = '<div class="downloads-empty">No downloads yet</div>';
    } else {
      downloadsList.innerHTML = items.map(renderDownloadItem).join("");
    }
    // Align the panel's right edge with the button's right edge so it opens leftward
    const btnRect = btnDownloads.getBoundingClientRect();
    downloadsPanel.style.top = (btnRect.bottom + 4) + "px";
    downloadsPanel.style.right = (window.innerWidth - btnRect.right) + "px";

    downloadsPanel.classList.add("visible");
    newCompletedCount = 0;
    updateDownloadBadge();
  }

  function closeDownloadsPanel() {
    downloadsPanel.classList.remove("visible");
  }

  function updateDownloadBadge() {
    btnDownloads.setAttribute("data-badge", newCompletedCount > 0 ? String(newCompletedCount) : "");
  }

  btnDownloads.addEventListener("click", () => {
    if (downloadsPanel.classList.contains("visible")) {
      closeDownloadsPanel();
    } else {
      openDownloadsPanel();
    }
  });

  btnCloseDownloads.addEventListener("click", closeDownloadsPanel);

  btnClearDownloads.addEventListener("click", async () => {
    await window.backupAPI.clearDownloads();
    downloadsList.innerHTML = '<div class="downloads-empty">No downloads yet</div>';
    newCompletedCount = 0;
    downloadSeenStates.clear();
    updateDownloadBadge();
  });

  downloadsList.addEventListener("click", function (e) {
    const openBtn = e.target.closest(".dl-btn-open");
    const folderBtn = e.target.closest(".dl-btn-folder");
    if (openBtn) window.backupAPI.openDownloadFile(openBtn.dataset.path);
    if (folderBtn) window.backupAPI.showDownloadFolder(folderBtn.dataset.path);
  });

  window.backupAPI.onDownloadUpdate(function (dl) {
    const prev = downloadSeenStates.get(dl.id);
    downloadSeenStates.set(dl.id, dl.state);

    if (dl.state === "completed" && prev !== "completed" && !downloadsPanel.classList.contains("visible")) {
      newCompletedCount++;
      updateDownloadBadge();
    }

    if (!downloadsPanel.classList.contains("visible")) return;
    const existing = downloadsList.querySelector(`[data-dl-id="${CSS.escape(String(dl.id))}"]`);
    const html = renderDownloadItem(dl);
    if (existing) {
      existing.outerHTML = html;
    } else {
      downloadsList.insertAdjacentHTML("afterbegin", html);
      const empty = downloadsList.querySelector(".downloads-empty");
      if (empty) empty.remove();
    }
  });

  // ==================== Notifications ====================
  // Notification shape: { id, type, title, desc, action?: { label, kind, url? } }
  //   action.kind: "open-url" | "callback" (plugin notifications, via pluginAPI.ui.notify)
  //   type === "update" also has a `version` field for "don't remind me" persistence

  const pendingNotifications = [];
  let notifNextId = 1;

  function isNewerVersion(current, latest) {
    const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
    const [ca, cb, cc] = parse(current);
    const [la, lb, lc] = parse(latest);
    if (la !== ca) return la > ca;
    if (lb !== cb) return lb > cb;
    return lc > cc;
  }

  function addUniqueNotification(notif) {
    if (pendingNotifications.some((n) => n.type === notif.type)) return;
    pendingNotifications.push(notif);
    updateNotificationsBadge();
    if (notif.type === "update") openNotificationsPanel();
  }

  function updateNotificationsBadge() {
    const count = pendingNotifications.length;
    btnNotifications.setAttribute("data-badge", count > 0 ? String(count) : "");
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderNotifications() {
    if (pendingNotifications.length === 0) {
      notificationsList.innerHTML = '<div class="downloads-empty">No notifications</div>';
      return;
    }
    notificationsList.innerHTML = pendingNotifications
      .map((n) => {
        const actionBtn = n.action
          ? `<button class="btn btn-small btn-primary notif-btn-open" data-notif-id="${n.id}">${esc(n.action.label)}</button>`
          : "";
        const dismissLabel = n.type === "update" ? "Don't remind me" : "Dismiss";
        const hideBtn = n.type === "update"
          ? `<button class="btn btn-small notif-btn-hide" data-notif-id="${n.id}">Hide for now</button>`
          : "";
        return `<div class="notif-item" data-notif-id="${n.id}">
  <div class="notif-icon">&#128276;</div>
  <div class="notif-body">
    <div class="notif-title">${esc(n.title)}</div>
    <div class="notif-desc">${esc(n.desc)}</div>
    <div class="notif-actions">
      ${actionBtn}
      ${hideBtn}
      <button class="btn btn-small notif-btn-dismiss" data-notif-id="${n.id}">${esc(dismissLabel)}</button>
    </div>
  </div>
</div>`;
      })
      .join("");
  }

  function openNotificationsPanel() {
    renderNotifications();
    const btnRect = btnNotifications.getBoundingClientRect();
    notificationsPanel.style.top = btnRect.bottom + 4 + "px";
    notificationsPanel.style.right = window.innerWidth - btnRect.right + "px";
    notificationsPanel.classList.add("visible");
    updateNotificationsBadge();
  }

  function closeNotificationsPanel() {
    notificationsPanel.classList.remove("visible");
  }

  btnNotifications.addEventListener("click", () => {
    if (notificationsPanel.classList.contains("visible")) {
      closeNotificationsPanel();
    } else {
      openNotificationsPanel();
    }
  });

  btnCloseNotifications.addEventListener("click", closeNotificationsPanel);

  notificationsList.addEventListener("click", function (e) {
    const openBtn = e.target.closest(".notif-btn-open");
    const hideBtn = e.target.closest(".notif-btn-hide");
    const dismissBtn = e.target.closest(".notif-btn-dismiss");

    if (openBtn) {
      const id = parseInt(openBtn.dataset.notifId, 10);
      const notif = pendingNotifications.find((n) => n.id === id);
      if (notif?.action?.kind === "open-url" && notif.action.url) {
        window.backupAPI.openInBrowser(notif.action.url);
      } else if (notif?.action?.kind === "callback" && typeof notif.action.onClick === "function") {
        try { notif.action.onClick(); } catch (err) { console.error("[Notifications] Action failed:", err); }
      }
    }

    if (hideBtn) {
      const id = parseInt(hideBtn.dataset.notifId, 10);
      const idx = pendingNotifications.findIndex((n) => n.id === id);
      if (idx !== -1) pendingNotifications.splice(idx, 1);
      renderNotifications();
      updateNotificationsBadge();
    }

    if (dismissBtn) {
      const id = parseInt(dismissBtn.dataset.notifId, 10);
      const notif = pendingNotifications.find((n) => n.id === id);
      if (notif?.type === "update") {
        appSettings.dismissedReleaseVersion = notif.version;
        window.backupAPI.saveSettings(appSettings);
      }
      const idx = pendingNotifications.findIndex((n) => n.id === id);
      if (idx !== -1) pendingNotifications.splice(idx, 1);
      renderNotifications();
      updateNotificationsBadge();
    }
  });

  async function checkForUpdates() {
    try {
      const result = await window.backupAPI.checkForUpdates();
      if (result.error || !result.latestVersion || !result.currentVersion) return;
      if (!isNewerVersion(result.currentVersion, result.latestVersion)) return;
      if (appSettings.dismissedReleaseVersion === result.latestVersion) return;
      addUniqueNotification({
        id: notifNextId++,
        type: "update",
        version: result.latestVersion,
        title: `Update Available: v${result.latestVersion}`,
        desc: `A newer version is available. You are running v${result.currentVersion}.`,
        action: { label: "View Release", kind: "open-url", url: result.releaseUrl },
      });
    } catch {
      // Network failure — silently skip
    }
  }

  // ==================== Side Panel Host ====================
  //
  // The side panel holds one tab per plugin view (pluginAPI.ui.addSidePanelTab).
  // It is shown when the "Side Panel" setting is on and at least one tab exists.

  const sidePanelTabs = []; // { id, order, button, view, onShow: Set, onHide: Set }
  let activeSidePanelTab = null;
  const SIDE_PANEL_TAB_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

  function updateSidePanelVisibility() {
    const show = appSettings.sidePanelEnabled !== false && sidePanelTabs.length > 0;
    if (!show) {
      sidePanel.style.display = "none";
      resizeHandle.style.display = "none";
      btnExpand.classList.remove("visible");
      return;
    }
    sidePanel.style.display = "";
    sidePanel.classList.toggle("collapsed", panelCollapsed);
    resizeHandle.style.display = panelCollapsed ? "none" : "";
    btnExpand.classList.toggle("visible", panelCollapsed);
  }

  function activateSidePanelTab(id, remember) {
    const tab = sidePanelTabs.find(function (t) { return t.id === id; });
    if (!tab) return;
    const previous = activeSidePanelTab;
    activeSidePanelTab = tab;
    sidePanelTabs.forEach(function (t) {
      const on = t === tab;
      t.button.classList.toggle("active", on);
      t.button.setAttribute("aria-selected", on ? "true" : "false");
      t.button.tabIndex = on ? 0 : -1;
      t.view.classList.toggle("active", on);
    });
    if (previous && previous !== tab) previous.onHide.forEach(function (fn) { try { fn(); } catch (e) { console.error("[SidePanel]", e); } });
    if (previous !== tab) tab.onShow.forEach(function (fn) { try { fn(); } catch (e) { console.error("[SidePanel]", e); } });
    if (remember && appSettings.sidePanelTab !== id) {
      appSettings.sidePanelTab = id;
      window.backupAPI.saveSettings(appSettings);
    }
  }

  // opts: { id, label, icon?, title?, order? } → handle { id, element, activate, isActive, onShow, onHide }
  function addSidePanelTab(opts) {
    const id = opts && String(opts.id || "");
    if (!SIDE_PANEL_TAB_ID.test(id)) throw new Error("addSidePanelTab: invalid id");
    if (sidePanelTabs.some(function (t) { return t.id === id; })) throw new Error("addSidePanelTab: duplicate id \"" + id + "\"");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "side-panel-tab";
    button.id = "side-panel-tab-" + id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "side-panel-view-" + id);
    button.title = opts.title || opts.label || id;
    if (opts.icon) {
      const icon = document.createElement("span");
      icon.className = "side-panel-tab-icon";
      icon.textContent = opts.icon;
      button.appendChild(icon);
    }
    const label = document.createElement("span");
    label.className = "side-panel-tab-label";
    label.textContent = opts.label || id;
    button.appendChild(label);

    const view = document.createElement("div");
    view.className = "side-panel-view";
    view.id = "side-panel-view-" + id;
    view.setAttribute("role", "tabpanel");
    view.setAttribute("aria-labelledby", button.id);

    const tab = {
      id,
      order: typeof opts.order === "number" ? opts.order : 100,
      button,
      view,
      onShow: new Set(),
      onHide: new Set(),
    };

    // Keep tabs sorted by order, then by the order they were added.
    let index = sidePanelTabs.findIndex(function (t) { return t.order > tab.order; });
    if (index === -1) index = sidePanelTabs.length;
    const before = sidePanelTabs[index];
    sidePanelTabs.splice(index, 0, tab);
    sidePanelTabsEl.insertBefore(button, before ? before.button : null);
    sidePanelBody.insertBefore(view, before ? before.view : null);

    button.addEventListener("click", function () { activateSidePanelTab(id, true); });

    if (!activeSidePanelTab || appSettings.sidePanelTab === id ||
        (activeSidePanelTab.id !== appSettings.sidePanelTab && tab.order < activeSidePanelTab.order)) {
      activateSidePanelTab(id, false);
    } else {
      button.setAttribute("aria-selected", "false");
      button.tabIndex = -1;
    }
    updateSidePanelVisibility();

    return Object.freeze({
      id,
      element: view,
      activate: function () {
        activateSidePanelTab(id, true);
        if (panelCollapsed) togglePanel();
      },
      isActive: function () { return activeSidePanelTab === tab; },
      onShow: function (fn) { if (typeof fn === "function") tab.onShow.add(fn); },
      onHide: function (fn) { if (typeof fn === "function") tab.onHide.add(fn); },
    });
  }

  // Arrow keys move between side panel tabs.
  sidePanelTabsEl.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const idx = sidePanelTabs.indexOf(activeSidePanelTab);
    if (idx === -1) return;
    const next = sidePanelTabs[(idx + (e.key === "ArrowRight" ? 1 : sidePanelTabs.length - 1)) % sidePanelTabs.length];
    activateSidePanelTab(next.id, true);
    next.button.focus();
    e.preventDefault();
  });

  // ==================== Notes Facade ====================
  //
  // pluginAPI.notes is backed by whichever plugin registers as the notes provider
  // (the bundled Note Backup plugin). Without one, reads return empty values and
  // writes do nothing, so other plugins can check isAvailable() and hide note actions.

  let notesProvider = null;
  const notesReadyCallbacks = [];

  const notesFacade = Object.freeze({
    isAvailable:  function () { return !!notesProvider; },
    getContent:   function () { return notesProvider ? notesProvider.getContent() : ""; },
    setContent:   function (html) { if (notesProvider) notesProvider.setContent(html); },
    getTicketId:  function () { return notesProvider ? notesProvider.getTicketId() : null; },
    getPlainText: function () { return notesProvider ? notesProvider.getPlainText() : ""; },
    saveSnapshot: function (incomingText, options) {
      return notesProvider ? Promise.resolve(notesProvider.saveSnapshot(incomingText, options)) : Promise.resolve();
    },
    // Runs fn(provider) once a notes provider is registered (straight away if one is).
    onReady: function (fn) {
      if (typeof fn !== "function") return;
      if (notesProvider) {
        try { fn(notesProvider); } catch (e) { console.error("[Notes]", e); }
      } else {
        notesReadyCallbacks.push(fn);
      }
    },
    // Called once by the plugin that owns the note editor.
    registerProvider: function (provider) {
      if (notesProvider) throw new Error("A notes provider is already registered");
      const required = ["getContent", "setContent", "getTicketId", "getPlainText", "saveSnapshot"];
      if (!provider || required.some(function (k) { return typeof provider[k] !== "function"; })) {
        throw new Error("registerProvider: provider is missing required methods");
      }
      notesProvider = Object.freeze(Object.assign({}, provider));
      notesReadyCallbacks.splice(0).forEach(function (fn) {
        try { fn(notesProvider); } catch (e) { console.error("[Notes]", e); }
      });
    },
  });

  // ==================== Sites ====================
  //
  // pluginAPI.sites: site plugins (Freshservice, ConnectWise Manage, …) register an
  // adapter that knows their pages: which URLs are theirs, how to find the open
  // record, how to read and write the page's notes field, and how to read a record
  // for the AI features. Feature plugins look the adapter up per tab by URL, so
  // several sites can be open side by side. The full contract is in docs/sites.md.

  const siteAdapters = [];
  const siteRegisteredCallbacks = new Set();
  const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

  function isPageScript(v) { return typeof v === "string" && v.length > 0; }

  function validateSiteAdapter(a) {
    if (!a || typeof a !== "object") return "adapter must be an object";
    if (typeof a.id !== "string" || !SITE_ID_PATTERN.test(a.id)) return "id must be a plugin-style id";
    if (typeof a.name !== "string" || !a.name.trim()) return "name is required";
    if (typeof a.matchesUrl !== "function") return "matchesUrl(url) is required";
    if (a.recordScript !== undefined && !isPageScript(a.recordScript)) return "recordScript must be a script string";
    if (a.scrapeScript !== undefined && !isPageScript(a.scrapeScript)) return "scrapeScript must be a script string";
    if (a.readRecord !== undefined && typeof a.readRecord !== "function") return "readRecord must be a function";
    if (a.formatTitle !== undefined && typeof a.formatTitle !== "function") return "formatTitle must be a function";
    if (a.notes !== undefined) {
      const n = a.notes;
      if (!n || typeof n !== "object") return "notes must be an object";
      if (!isPageScript(n.readScript)) return "notes.readScript is required";
      if (typeof n.buildPushScript !== "function") return "notes.buildPushScript(text) is required";
      if (!isPageScript(n.watcherScript)) return "notes.watcherScript is required";
      if (typeof n.watcherPrefix !== "string" || n.watcherPrefix.length < 3) return "notes.watcherPrefix is required";
      if (!Array.isArray(n.fieldTypes) || !n.fieldTypes.length || n.fieldTypes.some(function (t) { return typeof t !== "string"; })) {
        return "notes.fieldTypes must list the field type names";
      }
      for (const k of ["fieldTypeLabel", "pushDelay", "onWatcherMessage"]) {
        if (n[k] !== undefined && typeof n[k] !== "function") return "notes." + k + " must be a function";
      }
    }
    if (a.knowledge !== undefined) {
      const kb = a.knowledge;
      if (!kb || typeof kb !== "object" || typeof kb.search !== "function" || typeof kb.getArticle !== "function") {
        return "knowledge needs search(term) and getArticle(id)";
      }
    }
    return null;
  }

  function freezeSiteAdapter(a) {
    const out = Object.assign({}, a, { shortName: a.shortName || a.name });
    if (a.notes) {
      out.notes = Object.freeze(Object.assign({}, a.notes, {
        fieldTypes: Object.freeze(a.notes.fieldTypes.slice()),
        fieldTypeLabel: typeof a.notes.fieldTypeLabel === "function"
          ? a.notes.fieldTypeLabel
          : function (type) { return String(type || "notes field"); },
      }));
    }
    if (a.knowledge) out.knowledge = Object.freeze(Object.assign({ name: "Knowledge base" }, a.knowledge));
    return Object.freeze(out);
  }

  function siteMatches(site, url) {
    try { return site.matchesUrl(url) === true; } catch (e) {
      console.error("[Sites] " + site.id + " matchesUrl:", e);
      return false;
    }
  }

  // The adapter for a web page URL, or null. Sites are asked in registration order.
  // If none claims the URL but it is on the configured home page's host (a custom
  // helpdesk domain, say) and only one site is installed, that site is used.
  function siteForUrl(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const hit = siteAdapters.find(function (si) { return siteMatches(si, url); });
    if (hit) return hit;
    if (siteAdapters.length === 1) {
      try {
        if (parsed.hostname === new URL(appSettings.defaultUrl).hostname) return siteAdapters[0];
      } catch { /* no usable home page */ }
    }
    return null;
  }

  function siteForWebview(webview) {
    if (!webview) return null;
    try { return siteForUrl(webview.getURL()); } catch { return null; }
  }

  // Reads the open record in the active tab: { site, record, text, source, label }
  // or null when the tab isn't on a known site. text comes from the site's
  // readRecord() (e.g. its REST API) when that returns something, else from its
  // scrapeScript.
  async function readActiveRecord() {
    const webview = getActiveWebview();
    const site = siteForWebview(webview);
    if (!site) return null;
    let url;
    try { url = webview.getURL(); } catch { return null; }
    let record = null;
    if (site.recordScript) {
      try { record = await webview.executeJavaScript(site.recordScript); } catch { record = null; }
    }
    let text = "";
    let source = "page";
    if (site.readRecord) {
      try {
        const res = await site.readRecord({ webview: webview, url: url, record: record });
        if (res && typeof res.text === "string" && res.text.trim()) {
          text = res.text;
          source = res.source === "api" ? "api" : "page";
        }
      } catch (e) { console.warn("[Sites] " + site.id + " readRecord:", e); }
    }
    if (!text && site.scrapeScript) {
      try { text = String(await webview.executeJavaScript(site.scrapeScript) || ""); } catch { text = ""; }
      source = "page";
    }
    const label = record && (record.label || record.ticket) ? String(record.label || record.ticket) : "";
    return { site: site, record: record, text: text, source: source, label: label };
  }

  const sitesFacade = Object.freeze({
    register: function (adapter) {
      const problem = validateSiteAdapter(adapter);
      if (problem) throw new Error("sites.register: " + problem);
      if (siteAdapters.some(function (si) { return si.id === adapter.id; })) {
        throw new Error("sites.register: a site with id \"" + adapter.id + "\" is already registered");
      }
      const site = freezeSiteAdapter(adapter);
      siteAdapters.push(site);
      siteRegisteredCallbacks.forEach(function (fn) {
        try { fn(site); } catch (e) { console.error("[Sites]", e); }
      });
      _busEmit("site:registered", { siteId: site.id });
      return site;
    },
    list: function () { return siteAdapters.slice(); },
    get: function (id) { return siteAdapters.find(function (si) { return si.id === id; }) || null; },
    forUrl: siteForUrl,
    forWebview: siteForWebview,
    forActiveTab: function () {
      const tab = tabs.find(function (t) { return t.id === activeTabId; });
      if (!tab) return null;
      const site = siteForWebview(tab.webview);
      return site ? { site: site, tabId: tab.id, webview: tab.webview } : null;
    },
    readActiveRecord: readActiveRecord,
    // Runs fn(site) for every site already registered and each one registered later.
    // Returns a function that stops future calls.
    onRegistered: function (fn) {
      if (typeof fn !== "function") return function () {};
      siteAdapters.forEach(function (si) {
        try { fn(si); } catch (e) { console.error("[Sites]", e); }
      });
      siteRegisteredCallbacks.add(fn);
      return function () { siteRegisteredCallbacks.delete(fn); };
    },
  });

  // Plugins' events.emit(): ticket:changed is also forwarded to main-process plugins.
  const RENDERER_TO_MAIN_EVENTS = new Set(["ticket:changed"]);
  function emitFromPlugin(name, data) {
    _busEmit(name, data);
    if (RENDERER_TO_MAIN_EVENTS.has(name)) window.backupAPI.emitPluginEvent(name, data);
  }

  // Open settings window from menu bar
  window.backupAPI.onOpenSettings(function () {
    window.backupAPI.openSettingsWindow();
  });

  // Listen for menu bar "Edit > Find..."
  window.backupAPI.onFindInPage(function () {
    showFindBar();
  });

  window.backupAPI.onRefreshAllTabs(function () {
    tabs.forEach(function (t) {
      try { t.webview.reload(); } catch { /* ignore */ }
    });
  });

  // Listen for settings changed from main process
  window.backupAPI.onSettingsChanged(function (settings) {
    applySettings(settings);
    _busEmit("settings:changed", settings);
  });

  // Load settings on startup
  window.backupAPI
    .loadSettings()
    .then(function (settings) {
      applySettings(settings);
      checkForUpdates();

      // Construct the frozen plugin API surface (depends on element refs + helpers
      // defined above, so it must be built here inside DOMContentLoaded).
      window.pluginAPI = Object.freeze({
        events: Object.freeze({ on: _busOn, off: _busOff, emit: emitFromPlugin }),

        invoke: function (pluginId, action, data) {
          return window.backupAPI.pluginInvoke("plugin:" + pluginId + ":" + action, data);
        },

        // Fire-and-forget message to a main-process handler registered with
        // api.onMessage(). Unlike invoke() it is delivered even while the window
        // is closing, so it suits beforeunload saves.
        send: function (pluginId, action, data) {
          window.backupAPI.pluginSend("plugin-msg:" + pluginId + ":" + action, data);
        },

        browser: Object.freeze({
          newTab: function (url) { createTab(url, { activate: true }); },
          executeInActiveTab: function (script) {
            const webview = getActiveWebview();
            if (!webview) return Promise.reject(new Error("No active tab"));
            return webview.executeJavaScript(script);
          },
          getActiveTab: function () {
            const tab = tabs.find(function (t) { return t.id === activeTabId; });
            return tab ? { tabId: tab.id, webview: tab.webview } : null;
          },
          getTabs: function () {
            return tabs.map(function (t) { return { tabId: t.id, webview: t.webview }; });
          },
        }),

        ui: Object.freeze({
          addSidePanelTab: addSidePanelTab,
          addToolbarButton: function (opts) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "toolbar-btn plugin-toolbar-btn";
            btn.id = "plugin-btn-" + (opts.id || Math.random().toString(36).slice(2));
            btn.textContent = opts.label || "";
            if (opts.title) btn.title = opts.title;
            btn.addEventListener("click", function () {
              try { opts.onClick(); } catch (e) { console.error("[PluginUI]", e); }
            });
            // The toolbar belongs to the notes provider (the Note Backup plugin),
            // which may load after the plugin adding the button.
            notesFacade.onReady(function (provider) {
              if (provider.toolbar) provider.toolbar.appendChild(btn);
            });
            return btn;
          },
          notify: function (opts) {
            if (!opts || typeof opts.title !== "string") return;
            const action = opts.action && typeof opts.action.onClick === "function"
              ? { label: String(opts.action.label || "Open"), kind: "callback", onClick: opts.action.onClick }
              : undefined;
            addUniqueNotification({
              id: notifNextId++,
              type: "plugin:" + String(opts.type || opts.title),
              title: opts.title,
              desc: String(opts.desc || ""),
              action,
            });
          },
          confirm: function (message, options) {
            return showConfirm(String(message || ""), !!(options && options.defaultYes));
          },
        }),

        notes: notesFacade,

        sites: sitesFacade,

        getSettings: function () { return Object.assign({}, appSettings); },
      });

      // Notify the plugin bus that the app is ready
      _busEmit("app:ready", {});
      window.backupAPI.emitPluginEvent("app:ready", {});

      // Inject renderer scripts from installed plugins
      window.backupAPI.getPluginScripts().then(function (scriptPaths) {
        if (!Array.isArray(scriptPaths)) return;
        scriptPaths.forEach(function (scriptPath) {
          if (typeof scriptPath !== "string") return;
          const s = document.createElement("script");
          s.src = scriptPath;
          // Run in the listed order, so a plugin can rely on ones loaded before it.
          s.async = false;
          s.onerror = function (e) {
            console.error("[Plugin loader] Failed to load:", scriptPath, e);
          };
          document.body.appendChild(s);
        });
      }).catch(function (err) {
        console.error("[Plugin loader]", err);
      });

      // Inject stylesheets from installed plugins
      window.backupAPI.getPluginStylesheets().then(function (sheetPaths) {
        if (!Array.isArray(sheetPaths)) return;
        sheetPaths.forEach(function (sheetPath) {
          if (typeof sheetPath !== "string") return;
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = sheetPath;
          document.head.appendChild(link);
        });
      }).catch(function (err) {
        console.error("[Plugin loader]", err);
      });
    })
    .catch(function (err) {
      console.error("[Settings] Error loading settings:", err);
    });

  // ==================== Tab Management ======================================
  const tabs = []; // Array of { id, webview, tabEl, titleSpan, title }
  let activeTabId = null;
  let tabIdCounter = 0;
  let tabHistory = []; // Stack of previously active tab IDs (most recent last, capped at TAB_HISTORY_MAX)
  const closedTabHistory = []; // Stack of recently closed {url, pinned} — for "Reopen Closed Tab"
  const CLOSED_TAB_HISTORY_MAX = 10;
  let findActive = false;

  function isWebUrl(url) {
    try {
      const p = new URL(url);
      return p.protocol === "http:" || p.protocol === "https:";
    } catch { return false; }
  }

  // --- Title cleanup: the tab's site plugin may shorten the page title ---
  function cleanTitle(raw, webview) {
    if (!raw) return "Untitled";
    let cleaned = raw;
    const site = siteForWebview(webview);
    if (site && typeof site.formatTitle === "function") {
      try {
        const out = site.formatTitle(raw);
        if (typeof out === "string") cleaned = out.trim();
      } catch (e) { console.error("[Sites] formatTitle:", e); }
    }
    return cleaned || "Untitled";
  }

  function generateTabId() {
    return "tab-" + ++tabIdCounter;
  }

  function getActiveWebview() {
    const tab = tabs.find(function (t) {
      return t.id === activeTabId;
    });
    return tab ? tab.webview : null;
  }

  // --- Persist open tabs (debounced) ---
  let saveTabsTimer = null;
  function saveTabSession() {
    clearTimeout(saveTabsTimer);
    saveTabsTimer = setTimeout(function () {
      const tabData = [];
      for (let i = 0; i < tabs.length; i++) {
        try {
          const url = tabs[i].webview.getURL();
          if (url && url !== "" && url !== "about:blank") {
            tabData.push({ url, pinned: tabs[i].pinned || false });
          }
        } catch {
          // webview may not be ready yet
        }
      }
      if (tabData.length > 0) {
        window.backupAPI.saveTabs(tabData);
      }
    }, 1000);
  }

  function createTab(url, opts = {}) {
    const id = generateTabId();
    const activate = opts.activate !== false; // default: activate
    const startPinned = opts.pinned || false;
    const _listeners = [];
    function on(target, event, fn) {
      target.addEventListener(event, fn);
      _listeners.push({ target, event, fn });
    }

    // Create webview element
    const webview = document.createElement("webview");
    webview.setAttribute("src", isWebUrl(url) ? url : appSettings.defaultUrl);
    webview.setAttribute("allowpopups", "");
    webview.style.width = "100%";
    webview.style.height = "100%";
    webviewContainer.appendChild(webview);

    // Clicks inside a webview don't bubble to document, so close floating panels on webview focus
    on(webview, "focus", function () {
      closeDownloadsPanel();
      closeNotificationsPanel();
      hideTabContextMenu();
    });

    // Create tab button
    const tabEl = document.createElement("div");
    tabEl.className = "tab-item";
    tabEl.dataset.tabId = id;

    const titleSpan = document.createElement("span");
    titleSpan.className = "tab-title";
    titleSpan.textContent = "Loading...";

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close tab";

    tabEl.appendChild(titleSpan);
    tabEl.appendChild(closeBtn);
    tabList.appendChild(tabEl);

    const tabData = {
      id: id,
      webview: webview,
      tabEl: tabEl,
      titleSpan: titleSpan,
      title: "Loading...",
      pinned: false,
      _listeners: _listeners,
    };
    tabs.push(tabData);

    if (startPinned) {
      tabData.pinned = true;
      tabEl.classList.add("tab-pinned");
      closeBtn.style.display = "none";
    }

    // click (not mousedown) to avoid activating the tab while the user is starting a drag
    on(tabEl, "click", function (e) {
      if (e.target.closest(".tab-close")) return;
      activateTab(id);
    });

    on(tabEl, "auxclick", function (e) {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(id);
      }
    });

    on(closeBtn, "click", function (e) {
      e.stopPropagation();
      closeTab(id);
    });

    on(tabEl, "contextmenu", function (e) {
      showTabContextMenu(e, id);
    });

    tabEl.setAttribute("draggable", "true");

    on(tabEl, "dragstart", function (e) {
      draggedTabId = id;
      tabEl.classList.add("tab-dragging");
      e.dataTransfer.effectAllowed = "move";
      // Set minimal drag data (required for Firefox compatibility)
      e.dataTransfer.setData("text/plain", id);
    });

    on(tabEl, "dragend", function () {
      draggedTabId = null;
      tabEl.classList.remove("tab-dragging");
      clearTabDragIndicators();
    });

    on(tabEl, "dragover", function (e) {
      if (!draggedTabId || draggedTabId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      // Determine if cursor is on left or right half of the tab
      const rect = tabEl.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const onLeft = e.clientX < midpoint;

      // Only update classes if the indicator position actually changed
      const hasLeft = tabEl.classList.contains("tab-drag-over-left");
      const hasRight = tabEl.classList.contains("tab-drag-over-right");
      if (onLeft && !hasLeft) {
        clearTabDragIndicators();
        tabEl.classList.add("tab-drag-over-left");
      } else if (!onLeft && !hasRight) {
        clearTabDragIndicators();
        tabEl.classList.add("tab-drag-over-right");
      }
    });

    on(tabEl, "dragleave", function () {
      tabEl.classList.remove("tab-drag-over-left", "tab-drag-over-right");
    });

    on(tabEl, "drop", function (e) {
      e.preventDefault();
      if (!draggedTabId || draggedTabId === id) return;

      const rect = tabEl.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const insertAfter = e.clientX >= midpoint;

      moveTab(draggedTabId, id, insertAfter);
      clearTabDragIndicators();
      draggedTabId = null;
    });

    function updateTabTitle() {
      try {
        const raw = webview.getTitle();
        if (raw && raw !== "") {
          const display = cleanTitle(raw, webview);
          tabData.title = display;
          titleSpan.textContent = display;
        }
      } catch {
        // webview may have been removed
      }
    }

    on(webview, "did-stop-loading", function () {
      updateTabTitle();
      saveTabSession();
    });

    on(webview, "page-title-updated", function (e) {
      if (e.title && e.title !== "") {
        const display = cleanTitle(e.title, webview);
        tabData.title = display;
        titleSpan.textContent = display;
      }
    });

    on(webview, "did-start-loading", function () {
      titleSpan.textContent = "Loading...";
    });

    on(webview, "did-navigate", function () {
      updateTabTitle();
      saveTabSession();
      if (activeTabId === id) updateNavButtons();
    });

    on(webview, "did-navigate-in-page", function () {
      updateTabTitle();
      saveTabSession();
      if (activeTabId === id) updateNavButtons();
    });

    on(webview, "found-in-page", function (e) {
      if (findActive && activeTabId === id) {
        if (e.result.matches > 0) {
          findMatchCount.textContent =
            e.result.activeMatchOrdinal + " of " + e.result.matches;
        } else {
          findMatchCount.textContent = "No results";
        }
      }
    });

    // Pages that call window.close() (e.g. a popped-out record) close their tab.
    on(webview, "close", function () {
      console.log("[Tab] Webview requested close for tab:", id);
      closeTab(id);
    });

    // Plugins attach their own webview listeners (navigation, console messages…).
    _busEmit("tab:created", { tabId: id, webview: webview });

    if (activate) {
      activateTab(id);
    }

    return tabData;
  }

  function updateNavButtons() {
    const wv = getActiveWebview();
    try {
      btnBack.disabled = wv ? !wv.canGoBack() : true;
      btnForward.disabled = wv ? !wv.canGoForward() : true;
    } catch {
      btnBack.disabled = true;
      btnForward.disabled = true;
    }
  }

  function activateTab(id) {
    // Stop an active find so it doesn't persist in a background tab.
    if (findActive && activeTabId && activeTabId !== id) {
      const prevTab = tabs.find(function (t) { return t.id === activeTabId; });
      if (prevTab) {
        try { prevTab.webview.stopFindInPage("clearSelection"); } catch { /* ignore */ }
      }
    }

    if (activeTabId && activeTabId !== id) {
      // Deduplicate so the stack always tracks the most-recent visit order.
      tabHistory = tabHistory.filter(function (hId) { return hId !== activeTabId; });
      tabHistory.push(activeTabId);
      if (tabHistory.length > TAB_HISTORY_MAX) {
        tabHistory = tabHistory.slice(tabHistory.length - TAB_HISTORY_MAX);
      }
    }
    activeTabId = id;

    tabs.forEach(function (t) {
      if (t.id === id) {
        t.webview.classList.add("active-webview");
        t.tabEl.classList.add("active");
      } else {
        t.webview.classList.remove("active-webview");
        t.tabEl.classList.remove("active");
      }
    });

    updateNavButtons();
    const activated = tabs.find(function (t) { return t.id === id; });
    if (activated) _busEmit("tab:activated", { tabId: id, webview: activated.webview });

    if (findActive && findInput.value) {
      const wv = getActiveWebview();
      if (wv) {
        findMatchCount.textContent = "";
        try { wv.findInPage(findInput.value); } catch { /* ignore */ }
      }
    }
  }

  function closeTab(id) {
    const idx = tabs.findIndex(function (t) {
      return t.id === id;
    });
    if (idx === -1) return;

    if (tabs[idx].pinned) return;

    // Closing the last tab navigates home instead of leaving an empty window.
    if (tabs.length === 1) {
      tabs[0].webview.setAttribute("src", appSettings.defaultUrl);
      return;
    }

    const tab = tabs[idx];

    if (activeTabId === id) {
      let nextId = null;
      // Walk back through history — stale IDs accumulate so we scan until finding one that still exists.
      while (tabHistory.length > 0) {
        const candidate = tabHistory.pop();
        if (
          candidate !== id &&
          tabs.some(function (t) {
            return t.id === candidate;
          })
        ) {
          nextId = candidate;
          break;
        }
      }
      if (!nextId) {
        const newIdx = idx > 0 ? idx - 1 : idx + 1;
        nextId = tabs[newIdx] ? tabs[newIdx].id : null;
      }
      if (nextId) activateTab(nextId);
    }

    tabHistory = tabHistory.filter(function (hId) { return hId !== id; });

    try {
      const closedUrl = tab.webview.getURL() || tab.webview.getAttribute("src");
      if (closedUrl) {
        closedTabHistory.push({ url: closedUrl, pinned: tab.pinned });
        if (closedTabHistory.length > CLOSED_TAB_HISTORY_MAX) closedTabHistory.shift();
      }
    } catch { /* webview may not be ready */ }

    _busEmit("tab:closed", { tabId: id, webview: tab.webview });
    (tab._listeners || []).forEach(function (l) {
      try { l.target.removeEventListener(l.event, l.fn); } catch { /* ignore */ }
    });
    tab._listeners = [];
    tab.webview.remove();
    tab.tabEl.remove();
    tabs.splice(idx, 1);
    saveTabSession();
  }

  // ==================== Tab Drag & Drop ======================================
  let draggedTabId = null;

  function clearTabDragIndicators() {
    for (let i = 0; i < tabs.length; i++) {
      tabs[i].tabEl.classList.remove(
        "tab-drag-over-left",
        "tab-drag-over-right",
      );
    }
  }

  function moveTab(fromId, toId, insertAfter) {
    if (fromId === toId) return;

    const fromIdx = tabs.findIndex(function (t) {
      return t.id === fromId;
    });
    const toIdx = tabs.findIndex(function (t) {
      return t.id === toId;
    });
    if (fromIdx === -1 || toIdx === -1) return;

    const movedTab = tabs.splice(fromIdx, 1)[0];

    // Re-find the target index after splicing out the moved tab; offset by 1 if inserting after.
    let newIdx = tabs.findIndex(function (t) { return t.id === toId; });
    if (insertAfter) newIdx = newIdx + 1;
    tabs.splice(newIdx, 0, movedTab);

    for (let i = 0; i < tabs.length; i++) {
      tabList.appendChild(tabs[i].tabEl);
    }

    saveTabSession();
  }

  // ==================== Tab Pin / Unpin ====================

  function pinTab(id) {
    const tab = tabs.find(function (t) { return t.id === id; });
    if (!tab || tab.pinned) return;
    tab.pinned = true;
    tab.tabEl.classList.add("tab-pinned");
    const closeBtn = tab.tabEl.querySelector(".tab-close");
    if (closeBtn) closeBtn.style.display = "none";

    const idx = tabs.indexOf(tab);
    if (idx > 0) {
      tabs.splice(idx, 1);
      let insertIdx = 0;
      while (insertIdx < tabs.length && tabs[insertIdx].pinned) insertIdx++;
      tabs.splice(insertIdx, 0, tab);
      for (let i = 0; i < tabs.length; i++) tabList.appendChild(tabs[i].tabEl);
    }

    saveTabSession();
  }

  function unpinTab(id) {
    const tab = tabs.find(function (t) { return t.id === id; });
    if (!tab || !tab.pinned) return;
    tab.pinned = false;
    tab.tabEl.classList.remove("tab-pinned");
    const closeBtn = tab.tabEl.querySelector(".tab-close");
    if (closeBtn) closeBtn.style.display = "";
    saveTabSession();
  }

  // ==================== Tab Context Menu ====================
  const tabContextMenu = document.getElementById("tab-context-menu");
  let contextMenuTabId = null; // which tab was right-clicked

  function getTabUrl(tabId) {
    const tab = tabs.find(function (t) {
      return t.id === tabId;
    });
    if (!tab) return null;
    try {
      return tab.webview.getURL();
    } catch {
      return null;
    }
  }

  function showTabContextMenu(e, tabId) {
    e.preventDefault();
    contextMenuTabId = tabId;

    const ctxTab = tabs.find(function (t) { return t.id === tabId; });
    const isTabPinned = ctxTab && ctxTab.pinned;
    const pinItem = tabContextMenu.querySelector('[data-action="pin"]');
    const unpinItem = tabContextMenu.querySelector('[data-action="unpin"]');
    if (pinItem) pinItem.style.display = isTabPinned ? "none" : "";
    if (unpinItem) unpinItem.style.display = isTabPinned ? "" : "none";

    tabContextMenu.style.left = e.clientX + "px";
    tabContextMenu.style.top = e.clientY + "px";
    tabContextMenu.classList.add("visible");

    const rect = tabContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      tabContextMenu.style.left =
        window.innerWidth - rect.width - MENU_EDGE_PADDING + "px";
    }
    if (rect.bottom > window.innerHeight) {
      tabContextMenu.style.top =
        window.innerHeight - rect.height - MENU_EDGE_PADDING + "px";
    }
  }

  function hideTabContextMenu() {
    tabContextMenu.classList.remove("visible");
    contextMenuTabId = null;
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#tab-context-menu")) {
      hideTabContextMenu();
    }
    if (!e.target.closest("#downloads-panel") && !e.target.closest("#btn-downloads")) {
      closeDownloadsPanel();
    }
    if (!e.target.closest("#notifications-panel") && !e.target.closest("#btn-notifications")) {
      closeNotificationsPanel();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      hideTabContextMenu();
      closeDownloadsPanel();
      closeNotificationsPanel();
      if (findActive) hideFindBar();
      if (confirmOverlay.classList.contains("visible")) closeConfirm(false);
    }
  });

  tabContextMenu.addEventListener("click", function (e) {
    const item = e.target.closest(".context-menu-item");
    if (!item || !contextMenuTabId) return;

    const action = item.dataset.action;
    const targetTabId = contextMenuTabId;
    hideTabContextMenu();

    switch (action) {
      case "refresh": {
        const tab = tabs.find(function (t) { return t.id === targetTabId; });
        if (tab) try { tab.webview.reload(); } catch { /* ignore */ }
        break;
      }

      case "reopen-closed": {
        const closed = closedTabHistory.pop();
        if (closed) {
          createTab(closed.url, { activate: true, pinned: closed.pinned });
        }
        break;
      }

      case "copy-url": {
        const urlToCopy = getTabUrl(targetTabId);
        if (urlToCopy) navigator.clipboard.writeText(urlToCopy).catch(() => {});
        break;
      }

      case "open-browser": {
        const url = getTabUrl(targetTabId);
        if (url) {
          window.backupAPI.openInBrowser(url);
        }
        break;
      }

      case "duplicate": {
        const dupUrl = getTabUrl(targetTabId);
        if (dupUrl) {
          createTab(dupUrl, { activate: true });
        }
        break;
      }

      case "pin":
        pinTab(targetTabId);
        break;

      case "unpin":
        unpinTab(targetTabId);
        break;

      case "close":
        closeTab(targetTabId);
        break;

      case "close-others": {
        const otherIds = tabs
          .filter(function (t) {
            return t.id !== targetTabId;
          })
          .map(function (t) {
            return t.id;
          });
        // Close in reverse order so index shifting doesn't skip tabs,
        // and the kept tab never becomes the "last tab" mid-loop.
        for (let i = otherIds.length - 1; i >= 0; i--) {
          closeTab(otherIds[i]);
        }
        break;
      }

      case "close-right": {
        const targetIdx = tabs.findIndex(function (t) {
          return t.id === targetTabId;
        });
        if (targetIdx !== -1) {
          const rightIds = tabs.slice(targetIdx + 1).map(function (t) {
            return t.id;
          });
          // Close in reverse order so index shifting doesn't skip tabs
          for (let j = rightIds.length - 1; j >= 0; j--) {
            closeTab(rightIds[j]);
          }
        }
        break;
      }
    }
  });

  btnNewTab.addEventListener("click", function () {
    createTab(appSettings.defaultUrl, { activate: true });
  });

  window.backupAPI.onOpenInNewTab(function (url) {
    console.log("[Tab] Opening in new tab:", url);
    createTab(url, { activate: true });
  });

  window.backupAPI.onWebviewClose(function (webContentsId) {
    console.log(
      "[Tab] Webview close request for webContentsId:",
      webContentsId,
    );
    for (let i = 0; i < tabs.length; i++) {
      try {
        if (tabs[i].webview.getWebContentsId() === webContentsId) {
          console.log("[Tab] Closing tab:", tabs[i].id);
          closeTab(tabs[i].id);
          return;
        }
      } catch {
        /* webview may not be ready */
      }
    }
  });

  async function initTabs() {
    try {
      const savedData = await window.backupAPI.loadTabs();
      if (savedData && savedData.length > 0) {
        for (let i = 0; i < savedData.length; i++) {
          // Backwards-compatible with the old string[] format written before the {url,pinned} shape.
          const item = savedData[i];
          const url = typeof item === "string" ? item : (item.url || appSettings.defaultUrl);
          const pinned = typeof item === "object" && !!item.pinned;
          createTab(url, { activate: i === 0, pinned });
        }
        console.log("[Tab] Restored " + savedData.length + " tab(s) from previous session");
        return;
      }
    } catch (err) {
      console.error("[Tab] Error loading saved tabs:", err);
    }
    createTab(appSettings.defaultUrl);
  }

  initTabs();

  // ==================== Back / Forward Navigation ====================
  btnBack.addEventListener("click", function () {
    const wv = getActiveWebview();
    if (wv) try { wv.goBack(); } catch { /* ignore */ }
  });

  btnForward.addEventListener("click", function () {
    const wv = getActiveWebview();
    if (wv) try { wv.goForward(); } catch { /* ignore */ }
  });

  btnRefresh.addEventListener("click", function () {
    const wv = getActiveWebview();
    if (wv) try { wv.reload(); } catch { /* ignore */ }
  });

  // ==================== Find in Page ====================
  function showFindBar() {
    if (findActive) { hideFindBar(); return; }
    findBar.classList.add("visible");
    findInput.focus();
    findInput.select();
    findActive = true;
    if (findInput.value) runFind(false);
  }

  function hideFindBar() {
    findBar.classList.remove("visible");
    findMatchCount.textContent = "";
    findActive = false;
    const wv = getActiveWebview();
    if (wv) try { wv.stopFindInPage("clearSelection"); } catch { /* ignore */ }
  }

  function runFind(findNext) {
    const text = findInput.value;
    const wv = getActiveWebview();
    if (!wv) return;
    if (!text) {
      findMatchCount.textContent = "";
      try { wv.stopFindInPage("clearSelection"); } catch { /* ignore */ }
      return;
    }
    try { wv.findInPage(text, { forward: true, findNext }); } catch { /* ignore */ }
  }

  findInput.addEventListener("input", function () {
    runFind(false);
  });

  findInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        const wv = getActiveWebview();
        if (wv && findInput.value) {
          try { wv.findInPage(findInput.value, { forward: false, findNext: true }); } catch { /* ignore */ }
        }
      } else {
        runFind(true);
      }
    } else if (e.key === "Escape") {
      hideFindBar();
    }
  });

  btnFindPrev.addEventListener("click", function () {
    const wv = getActiveWebview();
    if (wv && findInput.value) {
      try { wv.findInPage(findInput.value, { forward: false, findNext: true }); } catch { /* ignore */ }
    }
  });

  btnFindNext.addEventListener("click", function () { runFind(true); });
  btnFindClose.addEventListener("click", hideFindBar);

  // ==================== Panel Toggle ====================
  let panelCollapsed = false;

  function togglePanel() {
    if (appSettings.sidePanelEnabled === false || sidePanelTabs.length === 0) return;

    panelCollapsed = !panelCollapsed;
    updateSidePanelVisibility();

    appSettings.panelCollapsed = panelCollapsed;
    window.backupAPI.saveSettings(appSettings);
  }

  btnToggle.addEventListener("click", togglePanel);
  btnExpand.addEventListener("click", togglePanel);

  // ==================== Panel Resize ====================
  let isResizing = false;

  resizeHandle.addEventListener("mousedown", function (e) {
    isResizing = true;
    document.body.style.cursor = "col-resize";
    tabs.forEach(function (t) {
      t.webview.style.pointerEvents = "none";
    });
    e.preventDefault();
  });

  document.addEventListener("mousemove", function (e) {
    if (!isResizing) return;
    const containerRect = document
      .getElementById("app-container")
      .getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;
    if (newWidth >= 280 && newWidth <= 700) {
      sidePanel.style.width = newWidth + "px";
    }
  });

  document.addEventListener("mouseup", function () {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = "";
      tabs.forEach(function (t) {
        t.webview.style.pointerEvents = "";
      });
    }
  });

  // ==================== Focus Management ======================================
  // The <webview> guest process holds OS-level focus independently of the renderer.
  // Native confirm()/alert() hand focus to the guest and never return it, which is
  // why we use a custom in-page confirm dialog instead of the native one.

  // Mousedown on the panel explicitly reclaims focus before the user's click lands,
  // so inputs and the contenteditable respond immediately without a second click.
  sidePanel.addEventListener("mousedown", function () {
    const webview = getActiveWebview();
    if (webview) webview.blur();
    window.focus();
  });

  // Elements declared at the top of DOMContentLoaded so the Escape keydown handler can access them.
  function showConfirm(message, defaultYes = false) {
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      confirmMessage.textContent = message;
      confirmOverlay.classList.add("visible");
      (defaultYes ? confirmYes : confirmNo).focus();
    });
  }

  function closeConfirm(result) {
    confirmOverlay.classList.remove("visible");
    if (confirmResolve) {
      confirmResolve(result);
      confirmResolve = null;
    }
  }

  confirmYes.addEventListener("click", function () {
    closeConfirm(true);
  });
  confirmNo.addEventListener("click", function () {
    closeConfirm(false);
  });
  confirmOverlay.addEventListener("click", function (e) {
    if (e.target === confirmOverlay) closeConfirm(false);
  });

  // ==================== Keyboard Shortcuts ====================
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === "B" || e.key === "b")) {
      e.preventDefault();
      togglePanel();
    }
    if (e.ctrlKey && !e.shiftKey && e.key === ",") {
      e.preventDefault();
      window.backupAPI.openSettingsWindow();
    }
    if (e.ctrlKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      showFindBar();
    }
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      const wv = getActiveWebview();
      if (wv) try { wv.goBack(); } catch { /* ignore */ }
    }
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      const wv = getActiveWebview();
      if (wv) try { wv.goForward(); } catch { /* ignore */ }
    }
    if (e.key === "F5" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      const wv = getActiveWebview();
      if (wv) try { wv.reload(); } catch { /* ignore */ }
    }
    if (e.ctrlKey && !e.shiftKey && e.key === "t") {
      e.preventDefault();
      createTab(appSettings.defaultUrl, { activate: true });
    }
    if (e.ctrlKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
      e.preventDefault();
      const closed = closedTabHistory.pop();
      if (closed) createTab(closed.url, { activate: true, pinned: closed.pinned });
    }
    // Ctrl+W is skipped while typing in the side panel — the user may be typing a "w".
    if (e.ctrlKey && !e.shiftKey && e.key === "w") {
      if (!isTypingInSidePanel()) {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
    }
    if (e.ctrlKey && !e.shiftKey && e.key === "Tab") {
      e.preventDefault();
      const idx = tabs.findIndex(function (t) { return t.id === activeTabId; });
      if (idx !== -1 && tabs.length > 1) {
        activateTab(tabs[(idx + 1) % tabs.length].id);
      }
    }
    if (e.ctrlKey && e.shiftKey && e.key === "Tab") {
      e.preventDefault();
      const idx = tabs.findIndex(function (t) { return t.id === activeTabId; });
      if (idx !== -1 && tabs.length > 1) {
        activateTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
      }
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
      const tabIdx = parseInt(e.key, 10) - 1;
      if (tabIdx < tabs.length) {
        e.preventDefault();
        activateTab(tabs[tabIdx].id);
      }
    }
  });

  function isTypingInSidePanel() {
    const el = document.activeElement;
    if (!el || !sidePanel.contains(el)) return false;
    return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  }

  window.addEventListener("beforeunload", function () {
    const tabData = [];
    for (let i = 0; i < tabs.length; i++) {
      try {
        const url = tabs[i].webview.getURL();
        if (url && url !== "" && url !== "about:blank") {
          tabData.push({ url, pinned: tabs[i].pinned || false });
        }
      } catch { /* webview may have been destroyed already */ }
    }
    if (tabData.length > 0) {
      // ipcRenderer.send (not invoke) because the renderer may be destroyed before an async
      // round-trip completes; main handles this with synchronous fs.writeFileSync.
      window.backupAPI.saveTabsSync(tabData);
    }
  });
});
