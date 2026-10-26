// ===================================================
// Freshservice++ - Renderer (UI Logic)
// ===================================================

document.addEventListener("DOMContentLoaded", function () {
  // --- Element References ---
  const sidePanel = document.getElementById("side-panel");
  const resizeHandle = document.getElementById("resize-handle");
  const btnToggle = document.getElementById("btn-toggle-panel");
  const btnExpand = document.getElementById("btn-expand-panel");
  const ticketIdInput = document.getElementById("ticket-id");
  const noteContent = document.getElementById("note-content");
  const autosaveStatus = document.getElementById("autosave-status");
  const btnSave = document.getElementById("btn-save");
  const btnClear = document.getElementById("btn-clear");
  const btnCopy = document.getElementById("btn-copy");
  const btnPullFromFs = document.getElementById("btn-pull-from-fs");
  const btnPushToFs = document.getElementById("btn-push-to-fs");
  const btnOpenFolder = document.getElementById("btn-open-folder");
  const ticketSelect = document.getElementById("ticket-select");
  const btnLoadHistory = document.getElementById("btn-load-history");
  const historyList = document.getElementById("history-list");
  const btnGrabTicket = document.getElementById("btn-grab-ticket");
  const btnDeleteTicket = document.getElementById("btn-delete-ticket");

  // --- Sync Status (main window) ---
  const syncStatus = document.getElementById("sync-status");

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
  const btnInsertSignature = document.getElementById("btn-insert-signature");

  // --- Template Elements ---
  const btnInsertTemplate = document.getElementById("btn-insert-template");
  const templateDropdown = document.getElementById("template-dropdown");

  // --- HTML Source Toggle ---
  const btnHtmlToggle = document.getElementById("btn-html-toggle");
  const noteHtmlSource = document.getElementById("note-html-source");
  let htmlEditMode = false;

  // --- Note Search Elements ---
  const noteSearchInput = document.getElementById("note-search-input");
  const noteSearchResults = document.getElementById("note-search-results");

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

  // --- Diff Overlay Elements (declared early — referenced by Escape handler) ---
  const diffOverlay = document.getElementById("diff-overlay");
  const diffSnapshotName = document.getElementById("diff-snapshot-name");
  const diffBody = document.getElementById("diff-body");
  const btnDiffClose = document.getElementById("btn-diff-close");
  const btnDiffRestore = document.getElementById("btn-diff-restore");
  const btnDiffCancel = document.getElementById("btn-diff-cancel");

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
  const PREVIEW_MAX_LENGTH = 100; // chars — history preview truncation
  const TAB_HISTORY_MAX = 50; // max entries in tab history stack
  const MAX_GRAB_ELEMENTS = 5000; // max DOM elements scanned during ticket grab
  const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2 MB — max pasted/dropped image size

  // ==================== Settings ====================
  // Core settings fallback — only keys used by applySettings() before the async load resolves.
  // Plugin keys are omitted; plugins handle their own missing-value fallbacks via getSettings().
  let appSettings = {
    notePanelEnabled: true,
    backupRetentionDays: 7,
    signatureHtml: "",
    ticketSortField: "lastUpdated",
    ticketSortDirection: "desc",
    panelCollapsed: false,
    defaultUrl: "https://freshservice.com/login",
    theme: "dark",
    noteTemplates: [],
    liveSyncEnabled: true,
    snapshotThreshold: 5,
    dismissedReleaseVersion: "",
    backupStorageWarningMb: 100,
  };

  function applySettings(settings) {
    appSettings = settings;
    panelCollapsed = settings.panelCollapsed || false;

    document.body.setAttribute("data-theme", settings.theme || "dark");
    btnInsertSignature.style.display = settings.signatureHtml ? "" : "none";

    btnInsertTemplate.style.display = (settings.noteTemplates && settings.noteTemplates.length > 0) ? "inline-block" : "none";
    refreshTicketList();
    updateSyncPill();

    if (settings.notePanelEnabled) {
      sidePanel.style.display = "";
      btnToggle.style.display = "";
      if (panelCollapsed) {
        sidePanel.classList.add("collapsed");
        resizeHandle.style.display = "none";
        btnExpand.classList.add("visible");
      } else {
        sidePanel.classList.remove("collapsed");
        resizeHandle.style.display = "";
        btnExpand.classList.remove("visible");
      }
    } else {
      sidePanel.style.display = "none";
      resizeHandle.style.display = "none";
      btnExpand.classList.remove("visible");
      btnToggle.style.display = "none";
    }
  }

  btnInsertSignature.addEventListener("click", function () {
    const sigHtml = appSettings.signatureHtml;
    if (!sigHtml) {
      autosaveStatus.textContent =
        "No signature configured - set one in Edit > Settings";
      autosaveStatus.className = "";
      return;
    }

    // Leading <br> adds a blank line before the signature; no trailing <br> so
    // the cursor stays at the end of the signature content, not a blank line after.
    const block = "<br>" + sigHtml;

    noteContent.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(noteContent);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("insertHTML", false, block);

    autosaveStatus.textContent = "Signature inserted";
    autosaveStatus.className = "saved";
  });

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
  //   action.kind: "open-url" | "open-backup-folder"
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
      } else if (notif?.action?.kind === "open-backup-folder") {
        window.backupAPI.openBackupFolder();
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

  async function checkBackupSize() {
    const warningMb = appSettings.backupStorageWarningMb ?? 100;
    if (!warningMb) return;
    try {
      const result = await window.backupAPI.checkBackupSize();
      if (result.error || result.totalMb === undefined) return;
      if (result.totalMb < warningMb) return;
      addUniqueNotification({
        id: notifNextId++,
        type: "storage-warning",
        title: "Backup Storage Warning",
        desc: `Your note backups are using ${result.totalMb} MB (threshold: ${warningMb} MB). Consider reducing the backup retention period or clearing old snapshots.`,
        action: { label: "Open Backup Folder", kind: "open-backup-folder" },
      });
    } catch {
      // Silently skip
    }
  }

  // ==================== Freshservice Notes Sync ====================
  //
  // Reads from / writes to whichever Freshservice notes field is currently on screen.
  // Supported field types:
  //   - 'editor'   — rich-text contenteditable (Froala .fr-element, used for ticket
  //                  notes and replies; legacy Redactor and other editors as fallbacks)
  //   - 'textarea' — plain textarea whose name/id/placeholder/label mentions "note"
  //                  (e.g. the note field on the Add Time Entry form)
  //
  // When several fields are visible, the focused one wins, then the one the user
  // last focused (tagged with data-fspp-sync by the watcher), then the first visible.
  //
  // Pull: FS field → panel (asks for confirmation if panel already has content)
  // Push: panel → FS field (plain text; uses the Froala API when available so the
  //        editor's model and Freshservice's form bindings see the change)

  // Live sync, ticket detection and pushes only run on Freshservice/Freshworks pages
  // (or the host of the configured home page, for custom Freshservice domains).
  // Any other site open in a tab could otherwise feed the panel fake notes or a
  // fake ticket number through the watcher's console channel.
  const FRESHWORKS_HOSTNAME_PATTERN = /(?:^|\.)(?:freshservice|freshworks|myfreshworks)\.com$/i;

  function isWebUrl(url) {
    try {
      const p = new URL(url);
      return p.protocol === "http:" || p.protocol === "https:";
    } catch { return false; }
  }

  function isFreshworksUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
      if (FRESHWORKS_HOSTNAME_PATTERN.test(parsed.hostname)) return true;
      return parsed.hostname === new URL(appSettings.defaultUrl).hostname;
    } catch { return false; }
  }

  function isFreshworksTab(tab) {
    try { return isFreshworksUrl(tab.webview.getURL()); } catch { return false; }
  }

  // Shared helpers injected into every script that touches the page's notes field.
  const FS_FIELD_HELPERS = `
    var FS_RICH_SELECTORS = [
      '.fr-element[contenteditable="true"]',
      '.redactor-editor[contenteditable="true"]',
      '.redactor_editor[contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      '.ProseMirror[contenteditable="true"]'
    ];

    function fsIsVisible(el) {
      return !!(el && el.isConnected && el.getClientRects().length > 0);
    }

    function fsIsRichEditor(el) {
      if (!el || el.nodeType !== 1) return false;
      for (var i = 0; i < FS_RICH_SELECTORS.length; i++) {
        if (el.matches(FS_RICH_SELECTORS[i])) return true;
      }
      return false;
    }

    function fsIsNoteTextarea(el) {
      if (!el || el.tagName !== 'TEXTAREA' || el.disabled || el.readOnly) return false;
      var hint = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' ');
      return /note/i.test(hint);
    }

    function fsIsField(el) {
      return fsIsRichEditor(el) || fsIsNoteTextarea(el);
    }

    // Resolve an arbitrary node (e.g. an event target inside an editor) to its field.
    function fsFieldFor(node) {
      var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
      if (!el) return null;
      if (fsIsNoteTextarea(el)) return el;
      var rich = el.closest(FS_RICH_SELECTORS.join(','));
      return rich || null;
    }

    function fsFindField() {
      var active = fsFieldFor(document.activeElement);
      if (active && fsIsVisible(active)) return active;
      var marked = document.querySelector('[data-fspp-sync]');
      if (marked && fsIsField(marked) && fsIsVisible(marked)) return marked;
      for (var i = 0; i < FS_RICH_SELECTORS.length; i++) {
        var els = document.querySelectorAll(FS_RICH_SELECTORS[i]);
        for (var j = 0; j < els.length; j++) {
          if (fsIsVisible(els[j])) return els[j];
        }
      }
      var tas = document.querySelectorAll('textarea');
      for (var k = 0; k < tas.length; k++) {
        if (fsIsNoteTextarea(tas[k]) && fsIsVisible(tas[k])) return tas[k];
      }
      return null;
    }

    function fsFieldType(el) {
      return el.tagName === 'TEXTAREA' ? 'textarea' : 'editor';
    }

    function fsNormalize(text) {
      return (text || '').replace(/\\u00a0/g, ' ').trim().replace(/\\n{3,}/g, '\\n\\n');
    }

    function fsReadField(el) {
      return fsNormalize(el.tagName === 'TEXTAREA' ? el.value : el.innerText);
    }
  `;

  const FS_NOTES_READ_SCRIPT = `(function() {
    ${FS_FIELD_HELPERS}
    var el = fsFindField();
    if (!el) return null;
    return { type: fsFieldType(el), text: fsReadField(el) };
  })()`;

  // Matches fsNormalize() in FS_FIELD_HELPERS so panel text and page text compare equal.
  function normalizeSyncText(text) {
    return (text || "").replace(/\u00a0/g, " ").trim().replace(/\n{3,}/g, "\n\n");
  }

  function fieldTypeLabel(type) {
    return type === "editor" ? "note editor" : "notes field";
  }

  btnPullFromFs.addEventListener("click", async function () {
    const webview = getActiveWebview();
    if (!webview) {
      autosaveStatus.textContent = "No active tab";
      autosaveStatus.className = "";
      return;
    }

    let result;
    try {
      result = await webview.executeJavaScript(FS_NOTES_READ_SCRIPT);
    } catch (err) {
      autosaveStatus.textContent = "Error reading Freshservice notes field";
      autosaveStatus.className = "";
      console.error("[FS Sync] Pull error:", err);
      return;
    }

    if (!result) {
      autosaveStatus.textContent = "No Freshservice notes field found — open a note or reply first";
      autosaveStatus.className = "";
      return;
    }

    if (result.text.trim() === "") {
      autosaveStatus.textContent = "Freshservice notes field is empty";
      autosaveStatus.className = "";
      return;
    }

    if (!isEditorEmpty()) {
      const confirmed = await showConfirm(
        "Replace the current panel notes with content pulled from Freshservice?"
      );
      if (!confirmed) return;
    }

    // Snapshot current content before overwriting if the change is substantial
    await snapshotBeforeBulkImport(result.text);

    // Convert plain text to safe HTML for the contenteditable panel
    const html = result.text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    setEditorContent(html);

    // Auto-grab ticket number from the same page if the field is empty
    if (!ticketIdInput.value.trim()) {
      try {
        const grabResult = await webview.executeJavaScript(TICKET_GRAB_SCRIPT);
        if (grabResult && grabResult.ticket) {
          ticketIdInput.value = grabResult.ticket;
          refreshTicketList(grabResult.ticket);
        }
      } catch { /* grab failure is non-fatal */ }
    }

    autosaveStatus.textContent = "Pulled from Freshservice (" + fieldTypeLabel(result.type) + ")";
    autosaveStatus.className = "saved";

    // Queue an autosave so the pulled content is persisted
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
  });

  btnPushToFs.addEventListener("click", async function () {
    const webview = getActiveWebview();
    if (!webview) {
      autosaveStatus.textContent = "No active tab";
      autosaveStatus.className = "";
      return;
    }

    if (isEditorEmpty()) {
      autosaveStatus.textContent = "Nothing to push";
      autosaveStatus.className = "";
      return;
    }

    // Strip HTML formatting — pushed as plain text with line breaks preserved
    const plainText = getEditorPlainText();

    // Suppress the live sync echo for this push: mark the text as already-pushed
    // so the watcher's input events don't trigger a pull-then-repush feedback loop.
    if (activeTabId) {
      const state = getSyncState(activeTabId);
      state.lastPushedText = plainText;
      clearTimeout(state.pushTimer);
      clearTimeout(state.pullTimer);
    }

    try {
      const result = await webview.executeJavaScript(buildFsPushScript(plainText));
      if (!result) {
        autosaveStatus.textContent = "No Freshservice notes field found — open a note or reply first";
        autosaveStatus.className = "";
        return;
      }
      autosaveStatus.textContent = "Pushed to Freshservice (" + fieldTypeLabel(result.type) + ")";
      autosaveStatus.className = "saved";
    } catch (err) {
      autosaveStatus.textContent = "Error pushing to Freshservice notes field";
      autosaveStatus.className = "";
      console.error("[FS Push] manual push error:", err);
    }
  });

  // ==================== Freshservice Live Sync Engine ====================
  //
  // Three subsystems:
  //   1. FS_WATCHER_SCRIPT — injected into each webview to emit field/focus/input events
  //   2. syncEngine        — per-tab state machine driving push (panel→FS) and pull (FS→panel)
  //   3. ticketSwapper     — auto-loads content when the detected ticket changes

  const SYNC_PUSH_EDITOR = 500;          // ms — rich-text editor push debounce
  const SYNC_PUSH_TEXTAREA = 300;        // ms — plain textarea push debounce
  const SYNC_PULL_DEBOUNCE = 300;        // ms — incoming FS change pull
  const SYNC_WATCHER_MIN_INTERVAL = 50;  // ms — minimum gap between processed watcher messages per tab

  // Injected once per page load. Uses console.log as the outbound channel so it
  // works without an extra IPC registration — the renderer filters by the [FS-SYNC]
  // prefix in the webview console-message event. Freshservice is a single-page
  // app, so the watcher stays installed across in-page navigation and keeps
  // re-detecting fields as editors open and close.
  const FS_WATCHER_SCRIPT = `(function() {
    if (window.__fsSyncWatcherInstalled) return;
    window.__fsSyncWatcherInstalled = true;
    ${FS_FIELD_HELPERS}

    function emit(payload) {
      console.log('[FS-SYNC] ' + JSON.stringify(payload));
    }

    var currentField = null;
    var currentType = null;
    var inputDebounce = null;
    var scanTimer = null;

    function mark(el) {
      var prev = document.querySelectorAll('[data-fspp-sync]');
      for (var i = 0; i < prev.length; i++) {
        if (prev[i] !== el) prev[i].removeAttribute('data-fspp-sync');
      }
      if (el) el.setAttribute('data-fspp-sync', '1');
    }

    function scan() {
      scanTimer = null;
      var el = fsFindField();
      var type = el ? fsFieldType(el) : null;
      if (el !== currentField || type !== currentType) {
        currentField = el;
        currentType = type;
        if (el) mark(el);
        emit({ kind: 'fields', type: type });
      }
    }

    function scheduleScan() {
      if (!scanTimer) scanTimer = setTimeout(scan, 250);
    }

    document.addEventListener('focusin', function(e) {
      var field = fsFieldFor(e.target);
      if (!field) return;
      mark(field);
      scan();
      emit({ kind: 'focus', focused: true });
    }, true);

    document.addEventListener('focusout', function(e) {
      if (fsFieldFor(e.target)) emit({ kind: 'focus', focused: false });
    }, true);

    document.addEventListener('input', function(e) {
      var field = fsFieldFor(e.target);
      if (!field) return;
      clearTimeout(inputDebounce);
      inputDebounce = setTimeout(function() {
        emit({ kind: 'input', field: fsFieldType(field), text: fsReadField(field) });
      }, 150);
    }, true);

    scan();

    var obs = new MutationObserver(scheduleScan);
    obs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'class', 'contenteditable']
    });
  })()`;

  const syncStates = new Map();

  function getSyncState(tabId) {
    if (!syncStates.has(tabId)) {
      syncStates.set(tabId, {
        fsFieldType: null,     // 'editor' | 'textarea' | null
        fsFocused: false,
        panelFocused: false,
        lastPushedText: null,  // echo suppression: text we last wrote to FS
        lastPulledText: null,  // change detection: text we last read from FS
        pushTimer: null,
        pullTimer: null,
        pushInFlight: false,
        pullInFlight: false,
        lastWatcherMsgAt: 0,
        consecutivePushFailures: 0,
      });
    }
    return syncStates.get(tabId);
  }

  function clearSyncState(tabId) {
    const s = syncStates.get(tabId);
    if (s) {
      clearTimeout(s.pushTimer);
      clearTimeout(s.pullTimer);
      syncStates.delete(tabId);
    }
  }

  function updateSyncPill() {
    if (!syncStatus) return;
    if (!appSettings.liveSyncEnabled) {
      syncStatus.textContent = "⇅ Sync off";
      syncStatus.className = "sync-status sync-off";
      return;
    }
    const state = activeTabId ? syncStates.get(activeTabId) : null;
    if (!state || !state.fsFieldType) {
      syncStatus.textContent = "⇅ No FS field";
      syncStatus.className = "sync-status sync-off";
    } else if (state.pushInFlight) {
      syncStatus.textContent = "⇅ Pushing…";
      syncStatus.className = "sync-status sync-active";
    } else {
      syncStatus.textContent = "⇅ Synced";
      syncStatus.className = "sync-status sync-idle";
    }
  }

  function handleWatcherMessage(tabId, msg) {
    if (!appSettings.liveSyncEnabled) return;
    if (tabId !== activeTabId) return;

    const state = getSyncState(tabId);

    switch (msg.kind) {
      case "fields":
        state.fsFieldType = msg.type === "editor" || msg.type === "textarea" ? msg.type : null;
        // A different field (or none) is now the target — forget what we last wrote/read
        // so the next push isn't skipped as a duplicate of text sent to the old field.
        state.lastPushedText = null;
        state.lastPulledText = null;
        updateSyncPill();
        break;
      case "focus":
        state.fsFocused = msg.focused;
        break;
      case "input":
        // FS field changed while panel is not focused → schedule a pull
        if (!state.panelFocused) {
          clearTimeout(state.pullTimer);
          state.pullTimer = setTimeout(function () {
            executePull(tabId, normalizeSyncText(msg.text), msg.field);
          }, SYNC_PULL_DEBOUNCE);
        }
        break;
    }
  }

  async function executePull(tabId, text, field) {
    if (tabId !== activeTabId) return;
    const state = getSyncState(tabId);
    if (state.panelFocused) return;
    if (text === state.lastPulledText) return;  // no change
    if (text === state.lastPushedText) return;  // echo from our own push
    if (state.pullInFlight) return;             // previous pull not yet complete

    state.pullInFlight = true;
    state.lastPulledText = text;
    try {
      await snapshotBeforeBulkImport(text);
      const html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      setEditorContent(html);

      if (syncStatus) {
        syncStatus.textContent = "⇅ Pulled (" + fieldTypeLabel(field) + ")";
        syncStatus.className = "sync-status sync-active";
        setTimeout(updateSyncPill, 1500);
      }

      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
    } finally {
      state.pullInFlight = false;
    }
  }

  function schedulePush(tabId) {
    if (!appSettings.liveSyncEnabled) return;
    if (tabId !== activeTabId) return;
    const state = getSyncState(tabId);
    if (!state.fsFieldType) return;

    const delay = state.fsFieldType === "editor" ? SYNC_PUSH_EDITOR : SYNC_PUSH_TEXTAREA;

    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(function () { executePush(tabId); }, delay);
  }

  async function executePush(tabId) {
    if (tabId !== activeTabId) return;
    const state = getSyncState(tabId);
    if (state.pushInFlight) return;

    const plainText = getEditorPlainText();
    if (!plainText) return;
    if (plainText === state.lastPushedText) return;

    const webview = getActiveWebview();
    if (!webview) return;
    try {
      if (!isFreshworksUrl(webview.getURL())) return;
    } catch { return; }

    state.pushInFlight = true;
    updateSyncPill();

    const pushScript = buildFsPushScript(plainText);
    try {
      const result = await webview.executeJavaScript(pushScript);
      if (result) {
        state.lastPushedText = plainText;
        state.consecutivePushFailures = 0;
        if (syncStatus) {
          syncStatus.textContent = "⇅ Synced";
          syncStatus.className = "sync-status sync-idle";
        }
      }
    } catch (pushErr) {
      console.error("[FS Push] auto push error:", pushErr);
      state.consecutivePushFailures = (state.consecutivePushFailures || 0) + 1;
      if (state.consecutivePushFailures === 1) {
        addUniqueNotification({
          id: notifNextId++,
          type: "sync-failure",
          title: "Live Sync Push Failed",
          desc: "Could not write notes to the Freshservice notes field. Your Freshservice session may have expired or the note editor is no longer open on this page.",
        });
      }
    } finally {
      state.pushInFlight = false;
      updateSyncPill();
    }
  }

  function buildFsPushScript(plainText) {
    return `(function() {
      var text = ${JSON.stringify(plainText)};
      ${FS_FIELD_HELPERS}

      var el = fsFindField();
      if (!el) return null;

      if (el.tagName === 'TEXTAREA') {
        el.focus();
        // Use the native setter so framework bindings (Ember/React) see a real change.
        var setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { type: 'textarea' };
      }

      // Single paragraph with <br> line breaks: its innerText round-trips to the
      // same plain text, so live-sync echo detection stays stable.
      var html = '<p>' + (text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\\n/g, '<br>') || '<br>') + '</p>';

      // Prefer the Froala API (v3/v4 global, then the v2 jQuery plugin) so Froala's
      // model, undo stack, and Freshservice's contentChanged bindings all update.
      try {
        var inst = null;
        if (window.FroalaEditor && Array.isArray(window.FroalaEditor.INSTANCES)) {
          inst = window.FroalaEditor.INSTANCES.find(function(i) {
            return i && i.el === el;
          }) || null;
        }
        if (!inst && window.jQuery) {
          var box = window.jQuery(el).closest('.fr-box').prev();
          var data = box.length ? box.data('froala.editor') : null;
          if (data && data.html) inst = data;
        }
        if (inst && inst.html && typeof inst.html.set === 'function') {
          inst.html.set(html);
          if (inst.undo && typeof inst.undo.saveStep === 'function') inst.undo.saveStep();
          if (inst.events && typeof inst.events.trigger === 'function') {
            inst.events.trigger('contentChanged');
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return { type: 'editor' };
        }
      } catch (froalaErr) { /* fall through to the DOM path */ }

      // Generic contenteditable path: select everything inside the editor and
      // replace it via execCommand so the browser fires native input events.
      el.focus();
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = false;
      try { ok = document.execCommand('insertHTML', false, html); } catch (cmdErr) { ok = false; }
      if (!ok) {
        el.innerHTML = html;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Some editors only sync their model on key events.
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      return { type: 'editor' };
    })()`;
  }

  // ==================== Ticket Swapper ====================
  //
  // Runs on tab activation and did-finish-load. When the detected ticket differs
  // from currentPanelTicket: snapshot the outgoing content (if changed), then
  // load the incoming ticket from the open Freshservice notes field first, falling
  // back to local backup.

  let currentPanelTicket = null;  // ticket currently bound to the panel
  let userTypedTicket = false;    // set when the user types in ticketIdInput — suppresses auto-swap
  const lastSnapshotContent = new Map();  // ticketId → html — skips saves when content is unchanged
  const swapQueue = new Map();            // tabId → Promise — serializes swaps so rapid navigation doesn't race

  function ticketSwapRun(tabId) {
    if (!appSettings.liveSyncEnabled) return;
    const prev = swapQueue.get(tabId) || Promise.resolve();
    const next = prev
      .then(function () { return doTicketSwap(tabId); })
      .catch(function () {});
    swapQueue.set(tabId, next);
  }

  async function doTicketSwap(tabId) {
    if (tabId !== activeTabId) return;

    const tab = tabs.find(function (t) { return t.id === tabId; });
    if (!tab) return;
    if (!isFreshworksTab(tab)) return;

    let grabResult;
    try {
      grabResult = await tab.webview.executeJavaScript(TICKET_GRAB_SCRIPT);
    } catch { return; }

    if (!grabResult || !grabResult.ticket) return;

    const newTicket = grabResult.ticket;

    if (userTypedTicket && ticketIdInput.value.trim() && ticketIdInput.value.trim() !== newTicket) return;
    if (newTicket === currentPanelTicket) return;
    if (tabId !== activeTabId) return;

    // A pending autosave reads the ticket field and the panel when it fires. Left
    // running, it could fire after the panel holds the incoming ticket's notes but
    // before the field changes, and save them under the outgoing ticket's number.
    // The outgoing content is saved just below instead.
    clearTimeout(autosaveTimer);

    if (currentPanelTicket && !isEditorEmpty()) {
      const outgoingHtml = getEditorContent();
      if (outgoingHtml !== lastSnapshotContent.get(currentPanelTicket)) {
        try {
          await window.backupAPI.saveNote({
            ticketId: currentPanelTicket,
            noteContent: outgoingHtml,
            isManual: true,
          });
          lastSnapshotContent.set(currentPanelTicket, outgoingHtml);
        } catch { /* non-fatal */ }
      }
    }

    // Each await below can let the user switch tabs; stop before touching the
    // panel if this tab is no longer the active one.
    if (tabId !== activeTabId) return;

    let fsResult = null;
    try {
      fsResult = await tab.webview.executeJavaScript(FS_NOTES_READ_SCRIPT);
    } catch { /* FS read failed — fall through to local */ }
    if (tabId !== activeTabId) return;

    const state = getSyncState(tabId);
    if (fsResult && fsResult.text && fsResult.text.trim()) {
      await snapshotBeforeBulkImport(fsResult.text);
      if (tabId !== activeTabId) return;
      const html = fsResult.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      setEditorContent(html);
      state.fsFieldType = fsResult.type;
      state.lastPulledText = fsResult.text;
      state.lastPushedText = null;
    } else {
      const localHtml = await readLocalTicketContent(newTicket);
      if (tabId !== activeTabId) return;
      setEditorContent(localHtml);
      // Still record the field type for sync even if the FS field was empty
      if (fsResult) state.fsFieldType = fsResult.type;
    }

    // Bind the panel to the new ticket in the same step as its content, so an
    // autosave can never pair one ticket's number with another ticket's notes.
    _busEmit("ticket:changed", { ticketId: newTicket, previous: currentPanelTicket });
    ticketIdInput.value = newTicket;
    currentPanelTicket = newTicket;
    userTypedTicket = false;
    lastSavedTicketId = newTicket;
    hasAttemptedAutoGrab = true;

    autosaveStatus.textContent = "Loaded ticket #" + newTicket;
    autosaveStatus.className = "saved";
    updateSyncPill();

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);

    await refreshTicketList(newTicket);
  }

  // Save a snapshot before any bulk import that changes the panel beyond the configured threshold.
  // Prevents losing panel content when live sync or a manual pull overwrites it.
  // force skips the size check — used before replacing the note with a rewrite of
  // similar length (e.g. an AI suggestion), which the threshold would let through.
  async function snapshotBeforeBulkImport(incomingPlainText, force) {
    if (isEditorEmpty()) return;
    const currentText = getEditorPlainText();
    const threshold = appSettings.snapshotThreshold ?? 5;
    if (!force && Math.abs(currentText.length - incomingPlainText.length) < threshold) return;
    const ticketId = ticketIdInput.value.trim() || "general";
    try {
      const html = getEditorContent();
      if (html !== lastSnapshotContent.get(ticketId)) {
        await window.backupAPI.saveNote({ ticketId, noteContent: html, isManual: true });
        lastSnapshotContent.set(ticketId, html);
        refreshTicketList();
      }
    } catch { /* non-fatal */ }
  }

  // Returns the saved HTML for a ticket: its autosaved draft, else its newest
  // snapshot, else "".
  async function readLocalTicketContent(ticketId) {
    try {
      const autosaveData = await window.backupAPI.loadAutosave();
      if (autosaveData[ticketId] && autosaveData[ticketId].content) {
        return autosaveData[ticketId].content;
      }
      const history = await window.backupAPI.getHistory(ticketId);
      return history.length > 0 ? history[0].content : "";
    } catch {
      return "";
    }
  }

  // ==================== Note Templates (insert into panel) ====================

  function insertTemplate(content) {
    noteContent.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      const range = document.createRange();
      range.selectNodeContents(noteContent);
      range.collapse(false);
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    }
    const html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    document.execCommand("insertHTML", false, html);
  }

  btnInsertTemplate.addEventListener("click", function (e) {
    e.stopPropagation();
    if (templateDropdown.classList.contains("visible")) {
      templateDropdown.classList.remove("visible");
      return;
    }

    templateDropdown.innerHTML = "";
    const templates = appSettings.noteTemplates || [];
    if (templates.length === 0) {
      templateDropdown.classList.remove("visible");
      return;
    }
    templates.forEach(function (tmpl) {
      const item = document.createElement("div");
      item.className = "context-menu-item";
      item.textContent = tmpl.name;
      item.addEventListener("click", function () {
        insertTemplate(tmpl.content);
        templateDropdown.classList.remove("visible");
      });
      templateDropdown.appendChild(item);
    });

    const rect = btnInsertTemplate.getBoundingClientRect();
    templateDropdown.style.left = rect.left + "px";
    templateDropdown.style.top = (rect.bottom + 2) + "px";
    templateDropdown.classList.add("visible");

    const menuRect = templateDropdown.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
      templateDropdown.style.left = (window.innerWidth - menuRect.width - MENU_EDGE_PADDING) + "px";
    }
    if (menuRect.bottom > window.innerHeight) {
      templateDropdown.style.top = (rect.top - menuRect.height - 2) + "px";
    }
  });

  // ==================== Note Search ====================

  let noteSearchTimer = null;
  const NOTE_SEARCH_DELAY = 300;

  noteSearchInput.addEventListener("input", function () {
    clearTimeout(noteSearchTimer);
    const query = noteSearchInput.value.trim();
    if (!query) {
      noteSearchResults.innerHTML = "";
      noteSearchResults.style.display = "none";
      return;
    }
    noteSearchTimer = setTimeout(function () {
      runNoteSearch(query);
    }, NOTE_SEARCH_DELAY);
  });

  async function runNoteSearch(query) {
    try {
      const results = await window.backupAPI.searchNotes(query);
      noteSearchResults.innerHTML = "";

      if (results.length === 0) {
        const msg = document.createElement("div");
        msg.className = "search-no-results";
        msg.textContent = "No matching notes found";
        noteSearchResults.appendChild(msg);
        noteSearchResults.style.display = "block";
        return;
      }

      results.forEach(function (r) {
        const item = document.createElement("div");
        item.className = "search-result-item";

        const ticketEl = document.createElement("div");
        ticketEl.className = "search-result-ticket";
        ticketEl.textContent = r.ticketId;

        const previewEl = document.createElement("div");
        previewEl.className = "search-result-preview";
        previewEl.textContent = r.preview;

        item.appendChild(ticketEl);
        item.appendChild(previewEl);

        item.addEventListener("click", function () {
          loadAutosaveForTicket(r.ticketId);
          noteSearchInput.value = "";
          noteSearchResults.innerHTML = "";
          noteSearchResults.style.display = "none";
        });

        noteSearchResults.appendChild(item);
      });

      noteSearchResults.style.display = "block";
    } catch (err) {
      console.error("[Search] Error:", err);
    }
  }

  async function loadAutosaveForTicket(ticketId) {
    try {
      const data = await window.backupAPI.loadAutosave();
      if (data[ticketId]) {
        setEditorContent(data[ticketId].content || "");
        ticketIdInput.value = ticketId === "general" ? "" : ticketId;
        lastSavedTicketId = ticketId;
        autosaveStatus.textContent = "Loaded from search";
        autosaveStatus.className = "saved";
        ticketSelect.value = ticketId;
      }
    } catch (err) {
      console.error("[Search] Error loading ticket:", err);
    }
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
      checkBackupSize();

      // Construct the frozen plugin API surface (depends on element refs + helpers
      // defined above, so it must be built here inside DOMContentLoaded).
      window.pluginAPI = Object.freeze({
        events: Object.freeze({ on: _busOn, off: _busOff, emit: _busEmit }),

        invoke: function (pluginId, action, data) {
          return window.backupAPI.pluginInvoke("plugin:" + pluginId + ":" + action, data);
        },

        browser: Object.freeze({
          newTab: function (url) { createTab(url, { activate: true }); },
          executeInActiveTab: function (script) {
            const webview = getActiveWebview();
            if (!webview) return Promise.reject(new Error("No active tab"));
            return webview.executeJavaScript(script);
          },
        }),

        ui: Object.freeze({
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
            const toolbar = document.getElementById("editor-toolbar");
            if (toolbar) toolbar.appendChild(btn);
            return btn;
          },
        }),

        notes: Object.freeze({
          getContent:   function () { return getEditorContent(); },
          setContent:   function (html) {
            setEditorContent(html);
            clearTimeout(autosaveTimer);
            autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
          },
          getTicketId:  function () { return ticketIdInput.value.trim() || null; },
          getPlainText: function () { return getEditorPlainText(); },
          saveSnapshot: function (incomingText, options) {
            return snapshotBeforeBulkImport(incomingText, !!(options && options.force));
          },
        }),

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

  // --- Title cleanup: strip common prefixes ---
  function cleanTitle(raw) {
    if (!raw) return "Untitled";
    // Strip leading "Manage: " or "Manage:" (case-insensitive)
    const cleaned = raw.replace(/^Manage:\s*/i, "");
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
      templateDropdown.classList.remove("visible");
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
          const display = cleanTitle(raw);
          tabData.title = display;
          titleSpan.textContent = display;
        }
      } catch {
        // webview may have been removed
      }
    }

    // Messages emitted by the injected FS watcher arrive here.
    on(webview, "console-message", function (e) {
      const msg = e.message || "";
      if (!msg.startsWith("[FS-SYNC] ")) return;
      if (!isFreshworksTab(tabData)) return;
      const wState = getSyncState(id);
      const now = Date.now();
      if (now - wState.lastWatcherMsgAt < SYNC_WATCHER_MIN_INTERVAL) return;
      wState.lastWatcherMsgAt = now;
      try {
        handleWatcherMessage(id, JSON.parse(msg.slice(10)));
      } catch { /* malformed payload — ignore */ }
    });

    on(webview, "did-stop-loading", function () {
      updateTabTitle();
      saveTabSession();
    });

    on(webview, "page-title-updated", function (e) {
      if (e.title && e.title !== "") {
        const display = cleanTitle(e.title);
        tabData.title = display;
        titleSpan.textContent = display;
      }
    });

    on(webview, "did-start-loading", function () {
      titleSpan.textContent = "Loading...";
    });

    on(webview, "did-navigate", function () {
      debouncedRefreshTicketList();
      updateTabTitle();
      saveTabSession();
      if (activeTabId === id) updateNavButtons();
      // Reset sync state so the watcher re-detects the fields on the new page.
      const navState = syncStates.get(id);
      if (navState) {
        navState.fsFieldType = null;
        navState.lastPushedText = null;
        navState.lastPulledText = null;
        navState.fsFocused = false;
      }
    });

    on(webview, "did-finish-load", function () {
      if (isFreshworksTab(tabData)) webview.executeJavaScript(FS_WATCHER_SCRIPT).catch(function () {});
      if (activeTabId === id) ticketSwapRun(id);
    });

    on(webview, "did-navigate-in-page", function () {
      debouncedRefreshTicketList();
      updateTabTitle();
      saveTabSession();
      if (activeTabId === id) {
        updateNavButtons();
        ticketSwapRun(id);
      }
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

    // Each tab has its own page context, so the previous auto-grab result doesn't apply.
    hasAttemptedAutoGrab = false;

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
    updateSyncPill();
    ticketSwapRun(id);

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

    clearSyncState(id);
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
    if (!e.target.closest("#template-dropdown") && !e.target.closest("#btn-insert-template")) {
      templateDropdown.classList.remove("visible");
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      hideTabContextMenu();
      closeDownloadsPanel();
      closeNotificationsPanel();
      if (findActive) hideFindBar();
      if (confirmOverlay.classList.contains("visible")) closeConfirm(false);
      if (diffOverlay.classList.contains("visible")) closeDiffOverlay();
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

  // ==================== Rich Text Editor Helpers ====================

  function getEditorContent() {
    if (htmlEditMode) return noteHtmlSource.value;
    return noteContent.innerHTML;
  }

  function setEditorContent(html) {
    if (htmlEditMode) exitHtmlMode(false);
    noteContent.innerHTML = html;
  }

  function isEditorEmpty() {
    let text, hasImg;
    if (htmlEditMode) {
      const tmp = document.createElement("div");
      tmp.innerHTML = noteHtmlSource.value;
      text = tmp.innerText.trim();
      hasImg = !!tmp.querySelector("img");
    } else {
      text = noteContent.innerText.trim();
      hasImg = !!noteContent.querySelector("img");
    }
    return text.length === 0 && !hasImg;
  }

  function getEditorPlainText() {
    let el;
    if (htmlEditMode) {
      el = document.createElement("div");
      el.innerHTML = noteHtmlSource.value;
    } else {
      el = noteContent;
    }
    return el.innerText.trim().replace(/\n{3,}/g, "\n\n");
  }

  function enterHtmlMode() {
    noteHtmlSource.value = noteContent.innerHTML;
    noteContent.style.display = "none";
    noteHtmlSource.style.display = "block";
    btnHtmlToggle.classList.add("active");
    htmlEditMode = true;
    document.querySelectorAll("#editor-toolbar .toolbar-btn:not(#btn-html-toggle)").forEach(function (b) { b.disabled = true; });
  }

  function exitHtmlMode(saveContent) {
    if (!htmlEditMode) return;
    if (!noteHtmlSource) return;
    if (saveContent !== false) noteContent.innerHTML = noteHtmlSource.value;
    noteHtmlSource.style.display = "none";
    noteContent.style.display = "";
    btnHtmlToggle.classList.remove("active");
    htmlEditMode = false;
    document.querySelectorAll("#editor-toolbar .toolbar-btn:not(#btn-html-toggle)").forEach(function (b) { b.disabled = false; });
    if (saveContent !== false) {
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
    }
  }

  btnHtmlToggle.addEventListener("click", function () {
    if (htmlEditMode) {
      exitHtmlMode();
    } else {
      enterHtmlMode();
    }
  });

  // ==================== Formatting Toolbar ====================

  document
    .getElementById("editor-toolbar")
    .addEventListener("click", function (e) {
      const btn = e.target.closest(".toolbar-btn");
      if (!btn) return;

      const command = btn.dataset.command;
      const value = btn.dataset.value || null;

      noteContent.focus();
      document.execCommand(command, false, value);
      updateToolbarState();
    });

  function updateToolbarState() {
    document
      .querySelectorAll(".toolbar-btn[data-command]")
      .forEach(function (btn) {
        const command = btn.dataset.command;
        if (
          [
            "bold",
            "italic",
            "underline",
            "strikeThrough",
            "insertUnorderedList",
            "insertOrderedList",
          ].indexOf(command) !== -1
        ) {
          btn.classList.toggle("active", document.queryCommandState(command));
        }
      });
  }

  document.addEventListener("selectionchange", function () {
    if (document.activeElement === noteContent) {
      updateToolbarState();
    }
  });

  // ==================== Image Paste Handler ====================

  noteContent.addEventListener("paste", function (e) {
    const items = (e.clipboardData || {}).items;
    if (!items) return;

    const imageItems = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image/") === 0) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length > 0) {
      e.preventDefault();

      imageItems.forEach(function (imageItem) {
        const blob = imageItem.getAsFile();
        if (blob.size > MAX_IMAGE_SIZE) {
          autosaveStatus.textContent = `Image too large (${(blob.size / 1024 / 1024).toFixed(1)} MB — max 2 MB)`;
          autosaveStatus.className = "";
          return;
        }
        const reader = new FileReader();
        reader.onload = function (event) {
          const img = document.createElement("img");
          img.src = event.target.result;
          img.style.maxWidth = "100%";

          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(img);
            range.setStartAfter(img);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          } else {
            noteContent.appendChild(img);
          }

          noteContent.dispatchEvent(new Event("input"));
        };
        reader.readAsDataURL(blob);
      });
    }
  });

  // Drag-and-drop images
  noteContent.addEventListener("dragover", function (e) {
    e.preventDefault();
  });

  noteContent.addEventListener("drop", function (e) {
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const imageFiles = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.indexOf("image/") === 0) {
        imageFiles.push(files[i]);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();

      imageFiles.forEach(function (file) {
        if (file.size > MAX_IMAGE_SIZE) {
          autosaveStatus.textContent = `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB — max 2 MB)`;
          autosaveStatus.className = "";
          return;
        }
        const reader = new FileReader();
        reader.onload = function (event) {
          const img = document.createElement("img");
          img.src = event.target.result;
          img.style.maxWidth = "100%";
          noteContent.appendChild(img);
          noteContent.dispatchEvent(new Event("input"));
        };
        reader.readAsDataURL(file);
      });
    }
  });

  // ==================== Panel Toggle ====================
  let panelCollapsed = false;

  function togglePanel() {
    if (!appSettings.notePanelEnabled) return;

    panelCollapsed = !panelCollapsed;
    if (panelCollapsed) {
      sidePanel.classList.add("collapsed");
      resizeHandle.style.display = "none";
      btnExpand.classList.add("visible");
    } else {
      sidePanel.classList.remove("collapsed");
      resizeHandle.style.display = "";
      btnExpand.classList.remove("visible");
    }

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

  // ==================== Grab Ticket from Freshservice ====================
  //
  // Freshservice is a single-page app whose record URLs carry the numeric ID:
  //   /a/tickets/123   (/helpdesk/tickets/123 on the legacy UI) → "123"
  //   /a/changes/45    (/itil/changes/45)                        → "CHN-45"
  //   /a/problems/67   (/itil/problems/67)                       → "PRB-67"
  //   /a/releases/89   (/itil/releases/89)                       → "RL-89"
  // Tickets (incidents and service requests share one number sequence) keep a
  // bare number so "Ticket Number" sorting works; other modules are prefixed so
  // they can't collide with ticket numbers. If the URL doesn't match (custom
  // portal routes, etc.) the page title and record header are checked for a
  // display ID such as "INC-123" or "SR-123". List pages intentionally return
  // nothing — they show many IDs and none of them is "the" open record.

  const TICKET_GRAB_SCRIPT = `(function() {
  var routes = [
    { re: /\\/(?:a|helpdesk)\\/tickets\\/(\\d+)(?:[/?#]|$)/i, prefix: "" },
    { re: /\\/(?:a|itil)\\/changes\\/(\\d+)(?:[/?#]|$)/i, prefix: "CHN-" },
    { re: /\\/(?:a|itil)\\/problems\\/(\\d+)(?:[/?#]|$)/i, prefix: "PRB-" },
    { re: /\\/(?:a|itil)\\/releases\\/(\\d+)(?:[/?#]|$)/i, prefix: "RL-" }
  ];
  var path = window.location.pathname + window.location.hash.replace(/^#/, "");
  for (var i = 0; i < routes.length; i++) {
    var m = path.match(routes[i].re);
    if (m) return { ticket: routes[i].prefix + m[1], source: "url", text: path.substring(0, 100) };
  }

  function fromDisplayId(text) {
    var t = (text || "").match(/\\b(INC|SR)-(\\d+)\\b/);
    if (t) return t[2];
    var o = (text || "").match(/\\b(CHN|PRB|RL)-(\\d+)\\b/);
    if (o) return o[1] + "-" + o[2];
    return null;
  }

  // Only trust the title/header on record pages, not list views.
  var onListPage = /\\/(?:a|helpdesk|itil)\\/(?:tickets|changes|problems|releases)\\/?(?:[?#]|$)/i.test(path);
  if (!onListPage) {
    var fromTitle = fromDisplayId(document.title);
    if (fromTitle) return { ticket: fromTitle, source: "title", text: document.title.substring(0, 100) };
    var headers = document.querySelectorAll("h1, h2, [class*=display-id], [class*=displayId], [class*=ticket-id], [class*=ticketId]");
    var maxScan = Math.min(headers.length, ${MAX_GRAB_ELEMENTS});
    for (var h = 0; h < maxScan; h++) {
      var text = headers[h].innerText || headers[h].textContent || "";
      var id = fromDisplayId(text);
      if (id) return { ticket: id, source: "header", text: text.substring(0, 100) };
    }
  }

  return {
    ticket: null,
    source: "not-found",
    debug: {
      title: document.title,
      url: window.location.href,
      h1: (document.querySelector("h1") || {}).innerText || ""
    }
  };
})()`;

  // ==================== Auto-Grab on First Typing ====================
  // Fires once per tab context (reset on tab switch and Clear).
  // Runs fully asynchronously — never focuses the editor or blocks typing.
  let hasAttemptedAutoGrab = false;

  function backgroundAutoGrab() {
    const webview = getActiveWebview();
    if (!webview) return;

    webview
      .executeJavaScript(TICKET_GRAB_SCRIPT)
      .then(function (result) {
        // Abort if the user has already typed a ticket ID while the scan was running.
        if (ticketIdInput.value.trim()) return;
        if (result && result.ticket) {
          ticketIdInput.value = result.ticket;
          autosaveStatus.textContent = "Auto-grabbed ticket #" + result.ticket;
          autosaveStatus.className = "saved";
          refreshTicketList(result.ticket);
        }
      })
      .catch(function () {});
  }

  // ==================== Autosave (Debounced) ====================
  let autosaveTimer = null;
  const AUTOSAVE_DELAY = 1500;
  let lastSavedTicketId = null;

  async function performAutosave() {
    const ticketId = ticketIdInput.value.trim() || "general";
    const content = getEditorContent();

    if (isEditorEmpty() && !ticketIdInput.value.trim()) {
      autosaveStatus.textContent = "Nothing to save";
      autosaveStatus.className = "";
      return;
    }

    try {
      if (lastSavedTicketId && lastSavedTicketId !== ticketId) {
        await window.backupAPI.deleteAutosave(lastSavedTicketId);
      }

      const result = await window.backupAPI.saveNote({
        ticketId: ticketId,
        noteContent: content,
        isManual: false,
      });
      lastSavedTicketId = ticketId;
      autosaveStatus.textContent =
        "Auto-saved at " + new Date(result.timestamp).toLocaleTimeString();
      autosaveStatus.className = "saved";
      _busEmit("note:saved", { ticketId, timestamp: result.timestamp });
    } catch (err) {
      autosaveStatus.textContent = "Auto-save error!";
      autosaveStatus.className = "";
      console.error("Autosave error:", err);
      addUniqueNotification({
        id: notifNextId++,
        type: "autosave-failure",
        title: "Auto-save Failed",
        desc: "A note could not be saved to disk. Check that the backup folder is accessible and you have write permissions.",
      });
    }
  }

  noteContent.addEventListener("focus", function () {
    if (activeTabId) getSyncState(activeTabId).panelFocused = true;
  });

  noteContent.addEventListener("blur", function () {
    if (activeTabId) getSyncState(activeTabId).panelFocused = false;
  });

  noteContent.addEventListener("input", function () {
    if (!ticketIdInput.value.trim() && !hasAttemptedAutoGrab) {
      hasAttemptedAutoGrab = true;
      backgroundAutoGrab();
    }
    autosaveStatus.textContent = "Typing...";
    autosaveStatus.className = "saving";
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
    if (activeTabId) schedulePush(activeTabId);
  });

  ticketIdInput.addEventListener("input", function () {
    userTypedTicket = true;
  });

  ticketIdInput.addEventListener("blur", function () {
    if (!isEditorEmpty()) {
      clearTimeout(autosaveTimer);
      performAutosave();
    }
  });

  btnGrabTicket.addEventListener("click", async function () {
    const webview = getActiveWebview();
    if (!webview) {
      autosaveStatus.textContent = "No active tab";
      return;
    }

    try {
      const result = await webview.executeJavaScript(TICKET_GRAB_SCRIPT);

      if (result && result.ticket) {
        ticketIdInput.value = result.ticket;
        autosaveStatus.textContent = "Grabbed ticket #" + result.ticket;
        autosaveStatus.className = "saved";
        refreshTicketList(result.ticket);
        if (!isEditorEmpty()) {
          performAutosave();
        }
      } else {
        autosaveStatus.textContent =
          "Could not detect ticket # - open a ticket first";
        autosaveStatus.className = "";
      }
    } catch (err) {
      autosaveStatus.textContent = "Error grabbing ticket";
      console.error("Grab error:", err);
    }
  });

  // ==================== Manual Save ====================
  btnSave.addEventListener("click", async function () {
    const ticketId = ticketIdInput.value.trim() || "general";
    const content = getEditorContent();

    if (isEditorEmpty()) {
      autosaveStatus.textContent = "Nothing to save!";
      autosaveStatus.className = "";
      return;
    }

    try {
      const result = await window.backupAPI.saveNote({
        ticketId: ticketId,
        noteContent: content,
        isManual: true,
      });
      lastSavedTicketId = ticketId;
      autosaveStatus.textContent =
        "Snapshot saved at " + new Date(result.timestamp).toLocaleTimeString();
      autosaveStatus.className = "saved";

      if (ticketSelect.value === ticketId) {
        loadHistory(ticketId);
      }
      refreshTicketList();
    } catch (err) {
      autosaveStatus.textContent = "Save error!";
      console.error("Save error:", err);
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

  // ==================== Clear ====================
  btnClear.addEventListener("click", async function () {
    if (!isEditorEmpty()) {
      const confirmed = await showConfirm(
        "Clear the current note? A snapshot will be saved before clearing.",
        true,
      );
      if (!confirmed) return;
    }
    clearTimeout(autosaveTimer);

    const snapTicketId = ticketIdInput.value.trim() || "general";
    try {
      await window.backupAPI.saveNote({ ticketId: snapTicketId, noteContent: getEditorContent(), isManual: true });
      refreshTicketList();
    } catch (err) {
      console.error("[Clear] Auto-snapshot error:", err);
    }

    // Delete the autosave entry so the next launch doesn't restore a note the user explicitly cleared.
    if (lastSavedTicketId) {
      await window.backupAPI.deleteAutosave(lastSavedTicketId);
    }

    setEditorContent("");
    ticketIdInput.value = "";
    hasAttemptedAutoGrab = false;
    lastSavedTicketId = null;
    currentPanelTicket = null;
    userTypedTicket = false;
    if (activeTabId) {
      const cs = getSyncState(activeTabId);
      cs.lastPushedText = null;
      cs.lastPulledText = null;
    }
    autosaveStatus.textContent = "Cleared";
    autosaveStatus.className = "";
    updateSyncPill();
  });

  // ==================== Copy to Clipboard ====================
  btnCopy.addEventListener("click", function () {
    if (isEditorEmpty()) {
      autosaveStatus.textContent = "Nothing to copy";
      return;
    }

    const htmlContent = getEditorContent();
    const plainText = getEditorPlainText();

    const htmlBlob = new Blob([htmlContent], { type: "text/html" });
    const textBlob = new Blob([plainText], { type: "text/plain" });
    const clipItem = new ClipboardItem({
      "text/html": htmlBlob,
      "text/plain": textBlob,
    });
    navigator.clipboard
      .write([clipItem])
      .then(function () {
        autosaveStatus.textContent = "Copied to clipboard (with formatting)";
        autosaveStatus.className = "saved";
      })
      .catch(function () {
        navigator.clipboard
          .writeText(plainText)
          .then(function () {
            autosaveStatus.textContent = "Copied to clipboard (plain text)";
            autosaveStatus.className = "saved";
          })
          .catch(function (err) {
            autosaveStatus.textContent = "Failed to copy to clipboard";
            autosaveStatus.className = "";
            console.error("Clipboard error:", err);
          });
      });
  });

  // ==================== Open Backup Folder ====================
  btnOpenFolder.addEventListener("click", function () {
    window.backupAPI.openBackupFolder();
  });

  // ==================== History ====================
  let refreshTicketListTimer = null;
  function debouncedRefreshTicketList() {
    clearTimeout(refreshTicketListTimer);
    refreshTicketListTimer = setTimeout(refreshTicketList, 500);
  }

  async function refreshTicketList(selectTicketId = null) {
    try {
      const tickets = await window.backupAPI.getAllTickets();
      const sortField = appSettings.ticketSortField || "lastUpdated";
      const sortDir = appSettings.ticketSortDirection || "desc";

      tickets.sort(function (a, b) {
        let result;
        if (sortField === "lastUpdated") {
          const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          result = timeA - timeB;
        } else {
          // ticketNumber — extract leading digits for numeric comparison,
          // fall back to locale string compare for non-numeric IDs
          const numA = parseInt(a.ticketId, 10);
          const numB = parseInt(b.ticketId, 10);
          if (!isNaN(numA) && !isNaN(numB)) {
            result = numA - numB;
          } else {
            result = a.ticketId.localeCompare(b.ticketId);
          }
        }
        return sortDir === "desc" ? -result : result;
      });

      const previousValue = selectTicketId || ticketSelect.value;
      ticketSelect.innerHTML =
        '<option value="">-- Select a ticket --</option>';
      tickets.forEach(function (t) {
        const opt = document.createElement("option");
        opt.value = t.ticketId;
        let dateLabel = "";
        if (t.updatedAt) {
          const d = new Date(t.updatedAt);
          dateLabel =
            " (" + d.toLocaleDateString() + " " + d.toLocaleTimeString() + ")";
        }
        opt.textContent = t.ticketId + dateLabel;
        ticketSelect.appendChild(opt);
      });

      if (previousValue) {
        ticketSelect.value = previousValue;
        if (selectTicketId && ticketSelect.value === selectTicketId) {
          loadHistory(selectTicketId);
        }
      }
    } catch (err) {
      console.error("Error refreshing ticket list:", err);
    }
  }

  async function loadHistory(ticketId) {
    historyList.innerHTML = "";
    if (!ticketId) return;

    try {
      const items = await window.backupAPI.getHistory(ticketId);
      if (items.length === 0) {
        historyList.innerHTML =
          '<div style="font-size:11px; color:var(--text-muted); padding:8px;">No snapshots yet. Use "Save Snapshot" to create one.</div>';
        return;
      }

      items.forEach(function (item) {
        const div = document.createElement("div");
        div.className = "history-item";

        const preview = new DOMParser()
          .parseFromString(item.content, "text/html")
          .body.innerText.substring(0, PREVIEW_MAX_LENGTH);

        const displayName = item.filename
          .replace(".html", "")
          .replace(".txt", "");

        const timeDiv = document.createElement("div");
        timeDiv.className = "history-time";
        timeDiv.textContent = displayName;

        const previewDiv = document.createElement("div");
        previewDiv.className = "history-preview";
        previewDiv.textContent = preview || "(empty)";

        div.appendChild(timeDiv);
        div.appendChild(previewDiv);

        div.addEventListener("click", function () {
          showDiffOverlay(displayName, item.content, function () {
            setEditorContent(item.content);
            ticketIdInput.value = ticketId;
            lastSavedTicketId = ticketId;
            autosaveStatus.textContent = "Restored from snapshot";
            autosaveStatus.className = "saved";
          });
        });

        historyList.appendChild(div);
      });
    } catch (err) {
      console.error("Error loading history:", err);
    }
  }

  btnLoadHistory.addEventListener("click", function () {
    loadHistory(ticketSelect.value);
  });

  ticketSelect.addEventListener("change", function () {
    loadHistory(ticketSelect.value);
  });

  // ==================== Snapshot Diff Overlay ====================

  function computeLineDiff(oldLines, newLines) {
    const m = oldLines.length;
    const n = newLines.length;
    if (m > 500 || n > 500) return null;
    const dp = [];
    for (let i = 0; i <= m; i++) {
      dp.push(new Array(n + 1).fill(0));
    }
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    const result = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ type: "equal", text: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: "add", text: newLines[j - 1] });
        j--;
      } else {
        result.unshift({ type: "remove", text: oldLines[i - 1] });
        i--;
      }
    }
    return result;
  }

  const DIFF_CONTEXT = 3;

  function renderDiff(currentText, snapshotText) {
    const oldLines = currentText.split("\n");
    const newLines = snapshotText.split("\n");
    const hunks = computeLineDiff(oldLines, newLines);

    if (!hunks) {
      diffBody.innerHTML = '<div class="diff-identical">Notes are too large to compare — click Restore to apply anyway.</div>';
      return;
    }
    if (!hunks.some(function (h) { return h.type !== "equal"; })) {
      diffBody.innerHTML = '<div class="diff-identical">Snapshot is identical to the current content.</div>';
      return;
    }

    const visible = new Array(hunks.length).fill(false);
    for (let k = 0; k < hunks.length; k++) {
      if (hunks[k].type !== "equal") {
        const lo = Math.max(0, k - DIFF_CONTEXT);
        const hi = Math.min(hunks.length - 1, k + DIFF_CONTEXT);
        for (let c = lo; c <= hi; c++) visible[c] = true;
      }
    }

    const frag = document.createDocumentFragment();
    let k = 0;
    while (k < hunks.length) {
      if (!visible[k]) {
        let end = k;
        while (end < hunks.length && !visible[end]) end++;
        const count = end - k;
        const sep = document.createElement("div");
        sep.className = "diff-hunk-sep";
        sep.textContent = "… " + count + " unchanged line" + (count === 1 ? "" : "s") + " …";
        frag.appendChild(sep);
        k = end;
      } else {
        const h = hunks[k];
        const line = document.createElement("div");
        if (h.type === "equal") {
          line.className = "diff-line diff-line-equal";
          line.textContent = "  " + h.text;
        } else if (h.type === "remove") {
          line.className = "diff-line diff-line-remove";
          line.textContent = "- " + h.text;
        } else {
          line.className = "diff-line diff-line-add";
          line.textContent = "+ " + h.text;
        }
        frag.appendChild(line);
        k++;
      }
    }
    diffBody.innerHTML = "";
    diffBody.appendChild(frag);
  }

  let pendingDiffRestore = null;

  function htmlToText(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    div.querySelectorAll("br").forEach(function (br) {
      br.replaceWith(document.createTextNode("\n"));
    });
    div.querySelectorAll("div, p, li, blockquote, h1, h2, h3, h4, h5, h6").forEach(function (el) {
      el.prepend(document.createTextNode("\n"));
    });
    return (div.textContent || "").replace(/^\n/, "").replace(/\n{3,}/g, "\n\n");
  }

  function showDiffOverlay(snapshotName, snapshotContent, onRestore) {
    const currentText = noteContent.innerText;
    const snapshotText = htmlToText(snapshotContent);
    diffSnapshotName.textContent = snapshotName;
    renderDiff(currentText, snapshotText);
    pendingDiffRestore = onRestore;
    diffOverlay.classList.add("visible");
  }

  function closeDiffOverlay() {
    diffOverlay.classList.remove("visible");
    pendingDiffRestore = null;
  }

  btnDiffClose.addEventListener("click", closeDiffOverlay);
  btnDiffCancel.addEventListener("click", closeDiffOverlay);
  diffOverlay.addEventListener("click", function (e) {
    if (e.target === diffOverlay) closeDiffOverlay();
  });
  btnDiffRestore.addEventListener("click", function () {
    if (pendingDiffRestore) pendingDiffRestore();
    closeDiffOverlay();
  });

  // ==================== Delete Saved Ticket ====================
  btnDeleteTicket.addEventListener("click", async function () {
    const selectedTicket = ticketSelect.value;
    if (!selectedTicket) {
      autosaveStatus.textContent = "Select a ticket to delete first";
      autosaveStatus.className = "";
      return;
    }

    const confirmed = await showConfirm(
      'Delete ALL saved data for ticket "' +
        selectedTicket +
        '"? This will remove the autosave entry and all snapshot history. This cannot be undone.',
    );
    if (!confirmed) return;

    try {
      await window.backupAPI.deleteTicket(selectedTicket);
      autosaveStatus.textContent = "Deleted ticket " + selectedTicket;
      autosaveStatus.className = "saved";
      historyList.innerHTML = "";
      await refreshTicketList();
    } catch (err) {
      autosaveStatus.textContent = "Error deleting ticket";
      console.error("Delete error:", err);
    }
  });

  // ==================== Load Autosaved Data on Start ====================
  async function loadAutosaved() {
    try {
      // If the user cleared the editor before closing, don't restore the previous draft.
      const editorState = await window.backupAPI.loadEditorState();
      if (editorState && editorState.blankAtClose) {
        return;
      }

      const data = await window.backupAPI.loadAutosave();
      const keys = Object.keys(data);
      if (keys.length > 0) {
        let latestKey = keys[0];
        let latestTimeMs = data[keys[0]].updatedAt
          ? new Date(data[keys[0]].updatedAt).getTime()
          : 0;
        keys.forEach(function (k) {
          const timeMs = data[k].updatedAt
            ? new Date(data[k].updatedAt).getTime()
            : 0;
          if (timeMs > latestTimeMs) {
            latestTimeMs = timeMs;
            latestKey = k;
          }
        });

        ticketIdInput.value = latestKey === "general" ? "" : latestKey;
        setEditorContent(data[latestKey].content || "");
        lastSavedTicketId = latestKey;
        autosaveStatus.textContent =
          "Restored draft from " + new Date(latestTimeMs).toLocaleString();
        autosaveStatus.className = "saved";
      }
    } catch (err) {
      console.error("Error loading autosave:", err);
    }
  }

  // ==================== Init ====================
  loadAutosaved();
  refreshTicketList();

  // ==================== Keyboard Shortcuts ====================
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) {
      e.preventDefault();
      btnSave.click();
    }
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
    // Ctrl+W is skipped when focus is in the notes panel — the user may be typing a "w".
    if (e.ctrlKey && !e.shiftKey && e.key === "w") {
      if (
        document.activeElement !== noteContent &&
        document.activeElement !== ticketIdInput
      ) {
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
    if (e.ctrlKey && e.shiftKey && (e.key === "V" || e.key === "v")) {
      if (document.activeElement === noteContent || noteContent.contains(document.activeElement)) {
        e.preventDefault();
        navigator.clipboard.readText().then(function (text) {
          if (text) document.execCommand("insertText", false, text);
        }).catch(function () { /* clipboard access denied */ });
      }
    }
  });

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

    // Persisted so the next launch can skip draft restoration when the user closed cleanly.
    const blankAtClose = isEditorEmpty() && !ticketIdInput.value.trim();
    window.backupAPI.saveEditorStateSync({ blankAtClose });
  });
});
