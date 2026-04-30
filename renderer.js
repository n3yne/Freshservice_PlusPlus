// ===================================================
// ConnectWise Backup - Renderer (UI Logic)
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
  const btnOpenFolder = document.getElementById("btn-open-folder");
  const ticketSelect = document.getElementById("ticket-select");
  const btnLoadHistory = document.getElementById("btn-load-history");
  const historyList = document.getElementById("history-list");
  const btnGrabTicket = document.getElementById("btn-grab-ticket");
  const btnDeleteTicket = document.getElementById("btn-delete-ticket");

  // --- Settings Elements ---
  const settingsOverlay = document.getElementById("settings-overlay");
  const btnCloseSettings = document.getElementById("btn-close-settings");
  const settingNotePanel = document.getElementById("setting-note-panel");
  const settingRetentionDays = document.getElementById("setting-retention-days");
  const settingSortField = document.getElementById("setting-sort-field");
  const settingSortDirection = document.getElementById("setting-sort-direction");
  const settingSignature = document.getElementById("setting-signature");
  const btnInsertSignature = document.getElementById("btn-insert-signature");

  // --- Tab Management Elements ---
  const tabList = document.getElementById("tab-list");
  const webviewContainer = document.getElementById("webview-container");
  const btnNewTab = document.getElementById("btn-new-tab");

  // --- Confirm Dialog Elements (declared early — referenced by Escape handler) ---
  const confirmOverlay = document.getElementById("confirm-overlay");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmYes = document.getElementById("confirm-yes");
  const confirmNo = document.getElementById("confirm-no");
  let confirmResolve = null;

  // ==================== Constants ====================
  const SIG_SAVE_DEBOUNCE = 800; // ms — signature editor save delay
  const MENU_EDGE_PADDING = 4; // px — context menu window-edge padding
  const PREVIEW_MAX_LENGTH = 100; // chars — history preview truncation
  const TAB_HISTORY_MAX = 50; // max entries in tab history stack
  const MAX_GRAB_ELEMENTS = 5000; // max DOM elements scanned during ticket grab
  const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2 MB — max pasted/dropped image size

  // ==================== Settings ====================
  // Mirror of DEFAULT_SETTINGS in utils.js — update both if adding a new key.
  let appSettings = {
    notePanelEnabled: true,
    backupRetentionDays: 7,
    signatureHtml: "",
    ticketSortField: "lastUpdated",
    ticketSortDirection: "desc",
    panelCollapsed: false,
  };

  function applySettings(settings) {
    appSettings = settings;
    // Sync the local collapsed state from persisted settings
    panelCollapsed = settings.panelCollapsed || false;

    // --- Note Panel ---
    settingNotePanel.checked = settings.notePanelEnabled;

    // --- Backup Retention ---
    settingRetentionDays.value = settings.backupRetentionDays;

    // --- Ticket Sort Order ---
    settingSortField.value = settings.ticketSortField || "lastUpdated";
    settingSortDirection.value = settings.ticketSortDirection || "desc";

    // --- Signature ---
    // Only update the contenteditable if it doesn't currently have focus
    // (avoids clobbering the user's cursor while they type)
    if (document.activeElement !== settingSignature) {
      settingSignature.innerHTML = settings.signatureHtml || "";
    }

    // --- Sig toolbar button visibility ---
    btnInsertSignature.style.display = settings.signatureHtml ? "" : "none";

    if (settings.notePanelEnabled) {
      // Restore the panel visibility
      sidePanel.style.display = "";
      btnToggle.style.display = "";
      if (panelCollapsed) {
        // Panel was collapsed before being disabled — keep it collapsed
        sidePanel.classList.add("collapsed");
        resizeHandle.style.display = "none";
        btnExpand.classList.add("visible");
      } else {
        sidePanel.classList.remove("collapsed");
        resizeHandle.style.display = "";
        btnExpand.classList.remove("visible");
      }
    } else {
      // Fully hide the panel, resize handle, and expand button
      sidePanel.style.display = "none";
      resizeHandle.style.display = "none";
      btnExpand.classList.remove("visible");
      btnToggle.style.display = "none";
    }
  }

  function openSettings() {
    // Don't re-open if already visible
    if (settingsOverlay.classList.contains("visible")) return;

    // Sync controls with current settings
    settingNotePanel.checked = appSettings.notePanelEnabled;
    settingRetentionDays.value = appSettings.backupRetentionDays;
    settingSortField.value = appSettings.ticketSortField || "lastUpdated";
    settingSortDirection.value = appSettings.ticketSortDirection || "desc";
    settingSignature.innerHTML = appSettings.signatureHtml || "";
    settingsOverlay.classList.add("visible");
  }

  function closeSettings() {
    settingsOverlay.classList.remove("visible");
  }

  // Close modal
  btnCloseSettings.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", function (e) {
    if (e.target === settingsOverlay) closeSettings();
  });

  // Setting toggles - save immediately on change
  settingNotePanel.addEventListener("change", function () {
    appSettings.notePanelEnabled = settingNotePanel.checked;
    window.backupAPI.saveSettings(appSettings);
    applySettings(appSettings);
  });

  settingRetentionDays.addEventListener("change", function () {
    let val = parseInt(settingRetentionDays.value, 10);
    // Clamp to valid range
    if (isNaN(val) || val < 0) val = 0;
    if (val > 365) val = 365;
    settingRetentionDays.value = val;
    appSettings.backupRetentionDays = val;
    window.backupAPI.saveSettings(appSettings);
  });

  settingSortField.addEventListener("change", function () {
    appSettings.ticketSortField = settingSortField.value;
    window.backupAPI.saveSettings(appSettings);
    refreshTicketList();
  });

  settingSortDirection.addEventListener("change", function () {
    appSettings.ticketSortDirection = settingSortDirection.value;
    window.backupAPI.saveSettings(appSettings);
    refreshTicketList();
  });

  // --- Signature editor: formatting toolbar ---
  document
    .getElementById("signature-toolbar")
    .addEventListener("click", function (e) {
      const btn = e.target.closest("[data-sig-command]");
      if (!btn) return;
      settingSignature.focus();
      document.execCommand(btn.dataset.sigCommand, false, null);
    });

  // --- Signature editor: debounced save on input ---
  let sigSaveTimer = null;
  settingSignature.addEventListener("input", function () {
    clearTimeout(sigSaveTimer);
    sigSaveTimer = setTimeout(function () {
      appSettings.signatureHtml = settingSignature.innerHTML;
      window.backupAPI.saveSettings(appSettings);
    }, SIG_SAVE_DEBOUNCE);
  });

  // --- Insert Signature button on the note toolbar ---
  btnInsertSignature.addEventListener("click", function () {
    const sigHtml = appSettings.signatureHtml;
    if (!sigHtml) {
      autosaveStatus.textContent =
        "No signature configured - set one in Edit > Settings";
      autosaveStatus.className = "";
      return;
    }

    // Build the signature block with a leading line break for spacing,
    // but no trailing line break so the cursor lands right at the end.
    const block = "<br>" + sigHtml;

    // Append to the end of the editor
    noteContent.focus();

    // Move cursor to the very end
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(noteContent);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    // Insert the HTML at the cursor position
    document.execCommand("insertHTML", false, block);

    autosaveStatus.textContent = "Signature inserted";
    autosaveStatus.className = "saved";
  });

  // Listen for menu bar "Edit > Settings"
  window.backupAPI.onOpenSettings(function () {
    openSettings();
  });

  // Listen for settings changed from main process
  window.backupAPI.onSettingsChanged(function (settings) {
    applySettings(settings);
  });

  // Load settings on startup
  window.backupAPI
    .loadSettings()
    .then(function (settings) {
      applySettings(settings);
    })
    .catch(function (err) {
      console.error("[Settings] Error loading settings:", err);
    });

  // ==================== Tab Management ======================================
  const DEFAULT_URL = "https://na.myconnectwise.net/";
  const tabs = []; // Array of { id, webview, tabEl, titleSpan, title }
  let activeTabId = null;
  let tabIdCounter = 0;
  let tabHistory = []; // Stack of previously active tab IDs (most recent last, capped at TAB_HISTORY_MAX)

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
      const urls = [];
      for (let i = 0; i < tabs.length; i++) {
        try {
          const url = tabs[i].webview.getURL();
          if (url && url !== "" && url !== "about:blank") {
            urls.push(url);
          }
        } catch {
          // webview may not be ready yet
        }
      }
      if (urls.length > 0) {
        window.backupAPI.saveTabs(urls);
      }
    }, 1000);
  }

  function createTab(url, opts = {}) {
    const id = generateTabId();
    const activate = opts.activate !== false; // default: activate

    // Create webview element
    const webview = document.createElement("webview");
    webview.setAttribute("src", url || DEFAULT_URL);
    webview.setAttribute("allowpopups", "");
    webview.style.width = "100%";
    webview.style.height = "100%";
    webviewContainer.appendChild(webview);

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
    };
    tabs.push(tabData);

    // --- Tab click to activate (use click instead of mousedown to avoid
    //     activating during drag initiation) ---
    tabEl.addEventListener("click", function (e) {
      if (e.target.closest(".tab-close")) return;
      activateTab(id);
    });

    // --- Middle-click on TAB to close ---
    tabEl.addEventListener("auxclick", function (e) {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(id);
      }
    });

    // --- Close button ---
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeTab(id);
    });

    // --- Right-click context menu ---
    tabEl.addEventListener("contextmenu", function (e) {
      showTabContextMenu(e, id);
    });

    // --- Drag & Drop to reorder ---
    tabEl.setAttribute("draggable", "true");

    tabEl.addEventListener("dragstart", function (e) {
      draggedTabId = id;
      tabEl.classList.add("tab-dragging");
      e.dataTransfer.effectAllowed = "move";
      // Set minimal drag data (required for Firefox compatibility)
      e.dataTransfer.setData("text/plain", id);
    });

    tabEl.addEventListener("dragend", function () {
      draggedTabId = null;
      tabEl.classList.remove("tab-dragging");
      clearTabDragIndicators();
    });

    tabEl.addEventListener("dragover", function (e) {
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

    tabEl.addEventListener("dragleave", function () {
      tabEl.classList.remove("tab-drag-over-left", "tab-drag-over-right");
    });

    tabEl.addEventListener("drop", function (e) {
      e.preventDefault();
      if (!draggedTabId || draggedTabId === id) return;

      const rect = tabEl.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const insertAfter = e.clientX >= midpoint;

      moveTab(draggedTabId, id, insertAfter);
      clearTabDragIndicators();
      draggedTabId = null;
    });

    // --- Helper to set title on the tab ---
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

    // --- Webview events ---
    webview.addEventListener("did-stop-loading", function () {
      updateTabTitle();
      saveTabSession();
    });

    webview.addEventListener("page-title-updated", function (e) {
      if (e.title && e.title !== "") {
        const display = cleanTitle(e.title);
        tabData.title = display;
        titleSpan.textContent = display;
      }
    });

    webview.addEventListener("did-start-loading", function () {
      titleSpan.textContent = "Loading...";
    });

    webview.addEventListener("did-navigate", function () {
      debouncedRefreshTicketList();
      updateTabTitle();
      saveTabSession();
    });

    webview.addEventListener("did-navigate-in-page", function () {
      debouncedRefreshTicketList();
      updateTabTitle();
      saveTabSession();
    });

    // --- Handle webview requesting to close itself (e.g. ConnectWise "Save and Close" button) ---
    webview.addEventListener("close", function () {
      console.log("[Tab] Webview requested close for tab:", id);
      closeTab(id);
    });

    // Activate the tab
    if (activate) {
      activateTab(id);
    }

    return tabData;
  }

  function activateTab(id) {
    // Push the previous tab onto the history stack
    if (activeTabId && activeTabId !== id) {
      // Remove duplicate so the most recent position wins
      tabHistory = tabHistory.filter(function (hId) {
        return hId !== activeTabId;
      });
      tabHistory.push(activeTabId);
      // Cap history size to prevent unbounded growth
      if (tabHistory.length > TAB_HISTORY_MAX) {
        tabHistory = tabHistory.slice(tabHistory.length - TAB_HISTORY_MAX);
      }
    }
    activeTabId = id;

    // Reset auto-grab flag so the new tab context can be detected
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
  }

  function closeTab(id) {
    const idx = tabs.findIndex(function (t) {
      return t.id === id;
    });
    if (idx === -1) return;

    // Don't close the last tab - navigate it home instead
    if (tabs.length === 1) {
      tabs[0].webview.setAttribute("src", DEFAULT_URL);
      return;
    }

    const tab = tabs[idx];

    // If closing the active tab, activate the most recent tab from history
    if (activeTabId === id) {
      let nextId = null;
      // Pop from history until we find a tab that still exists and isn't the one being closed
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
      // Fallback to adjacent tab if no valid history
      if (!nextId) {
        const newIdx = idx > 0 ? idx - 1 : idx + 1;
        nextId = tabs[newIdx].id;
      }
      activateTab(nextId);
    }

    // Remove all references to this tab from history
    tabHistory = tabHistory.filter(function (hId) {
      return hId !== id;
    });

    // Remove DOM elements
    tab.webview.remove();
    tab.tabEl.remove();
    tabs.splice(idx, 1);

    // Save session after closing
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

    // Remove from current position in array
    const movedTab = tabs.splice(fromIdx, 1)[0];

    // Recalculate target index after removal
    let newIdx = tabs.findIndex(function (t) {
      return t.id === toId;
    });
    if (insertAfter) {
      newIdx = newIdx + 1;
    }
    tabs.splice(newIdx, 0, movedTab);

    // Reorder DOM elements to match the tabs array
    for (let i = 0; i < tabs.length; i++) {
      tabList.appendChild(tabs[i].tabEl);
    }

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

    // Position the menu at the cursor
    tabContextMenu.style.left = e.clientX + "px";
    tabContextMenu.style.top = e.clientY + "px";
    tabContextMenu.classList.add("visible");

    // Ensure the menu doesn't overflow the window
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

  // --- Single document click handler for dismissing all context menus ---
  document.addEventListener("click", function (e) {
    // Only dismiss if the click was outside the menu
    if (!e.target.closest("#tab-context-menu")) {
      hideTabContextMenu();
    }
    if (!e.target.closest("#link-context-menu")) {
      hideLinkContextMenu();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      hideTabContextMenu();
      hideLinkContextMenu();
      closeSettings();
      if (confirmOverlay.classList.contains("visible")) closeConfirm(false);
    }
  });

  // Handle context menu actions
  tabContextMenu.addEventListener("click", function (e) {
    const item = e.target.closest(".context-menu-item");
    if (!item || !contextMenuTabId) return;

    const action = item.dataset.action;
    const targetTabId = contextMenuTabId;
    hideTabContextMenu();

    switch (action) {
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

  // --- New Tab button ---
  btnNewTab.addEventListener("click", function () {
    createTab(DEFAULT_URL, { activate: true });
  });

  // ==================== Webview Context Menu (right-click in webviews) ========
  const linkContextMenu = document.getElementById("link-context-menu");
  let contextMenuLinkUrl = null;
  let contextMenuSelectionText = null;

  function showWebviewContextMenu(x, y, linkURL, selectionText) {
    contextMenuLinkUrl = linkURL || null;
    contextMenuSelectionText = selectionText || null;

    // Show/hide menu items based on what was right-clicked
    const linkItems = linkContextMenu.querySelectorAll("[data-action^='link-']");
    const selItems = linkContextMenu.querySelectorAll("[data-action^='sel-']");
    const separators = linkContextMenu.querySelectorAll(
      ".context-menu-separator",
    );

    for (let li = 0; li < linkItems.length; li++) {
      linkItems[li].style.display = linkURL ? "" : "none";
    }
    for (let si = 0; si < selItems.length; si++) {
      selItems[si].style.display = selectionText ? "" : "none";
    }
    // Show separator only if both link and selection items are present
    for (let sp = 0; sp < separators.length; sp++) {
      separators[sp].style.display = linkURL && selectionText ? "" : "none";
    }

    // The x/y from the main process are relative to the webview's content
    // area. We need to offset by the webview's position in the renderer.
    const webview = getActiveWebview();
    let offsetX = 0;
    let offsetY = 0;
    if (webview) {
      const wvRect = webview.getBoundingClientRect();
      offsetX = wvRect.left;
      offsetY = wvRect.top;
    }

    linkContextMenu.style.left = x + offsetX + "px";
    linkContextMenu.style.top = y + offsetY + "px";
    linkContextMenu.classList.add("visible");

    // Ensure the menu doesn't overflow the window
    const rect = linkContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      linkContextMenu.style.left =
        window.innerWidth - rect.width - MENU_EDGE_PADDING + "px";
    }
    if (rect.bottom > window.innerHeight) {
      linkContextMenu.style.top =
        window.innerHeight - rect.height - MENU_EDGE_PADDING + "px";
    }
  }

  function hideLinkContextMenu() {
    linkContextMenu.classList.remove("visible");
    contextMenuLinkUrl = null;
    contextMenuSelectionText = null;
  }

  // Listen for right-click events from webviews via the main process
  window.backupAPI.onWebviewContextMenu(function (params) {
    // Hide the tab context menu if it's open
    hideTabContextMenu();
    showWebviewContextMenu(
      params.x,
      params.y,
      params.linkURL,
      params.selectionText,
    );
  });

  // Handle webview context menu actions
  linkContextMenu.addEventListener("click", function (e) {
    const item = e.target.closest(".context-menu-item");
    if (!item) return;

    const action = item.dataset.action;

    switch (action) {
      case "link-new-tab":
        if (contextMenuLinkUrl)
          createTab(contextMenuLinkUrl, { activate: true });
        break;

      case "link-browser":
        if (contextMenuLinkUrl)
          window.backupAPI.openInBrowser(contextMenuLinkUrl);
        break;

      case "link-copy":
        if (contextMenuLinkUrl) {
          navigator.clipboard.writeText(contextMenuLinkUrl).catch(function () {
            // Silently ignore clipboard errors
          });
        }
        break;

      case "sel-copy":
        if (contextMenuSelectionText) {
          navigator.clipboard
            .writeText(contextMenuSelectionText)
            .catch(function () {
              // Silently ignore clipboard errors
            });
        }
        break;
    }

    hideLinkContextMenu();
  });

  // --- Listen for new-tab requests from the main process ---
  window.backupAPI.onOpenInNewTab(function (url) {
    console.log("[Tab] Opening in new tab:", url);
    createTab(url, { activate: true });
  });

  // --- Listen for webview self-close requests from the main process ---
  // (e.g. ConnectWise "Save and Close" button calls window.close())
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

  // --- Restore tabs from previous session, or create a default tab ---
  async function initTabs() {
    try {
      const savedUrls = await window.backupAPI.loadTabs();
      if (savedUrls && savedUrls.length > 0) {
        for (let i = 0; i < savedUrls.length; i++) {
          // First tab is active, rest are background
          createTab(savedUrls[i], { activate: i === 0 });
        }
        console.log(
          "[Tab] Restored " +
            savedUrls.length +
            " tab(s) from previous session",
        );
        return;
      }
    } catch (err) {
      console.error("[Tab] Error loading saved tabs:", err);
    }
    // Fallback: create a single default tab
    createTab(DEFAULT_URL);
  }

  initTabs();

  // ==================== Rich Text Editor Helpers ====================

  function getEditorContent() {
    return noteContent.innerHTML;
  }

  function setEditorContent(html) {
    noteContent.innerHTML = html;
  }

  function isEditorEmpty() {
    const text = noteContent.innerText.trim();
    return text.length === 0 && !noteContent.querySelector("img");
  }

  function getEditorPlainText() {
    return noteContent.innerText.trim();
  }

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

    // Collect all image items first, then process them all
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

    // Collect all image files, then process them all
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
    // Don't allow toggling if the panel is disabled in settings
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

    // Persist collapsed state
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

  // ==================== Grab Ticket from ConnectWise ====================

  // Shared ticket-grab script injected into webviews.
  // The backgroundAutoGrab() and manual grab button both use this.
  const TICKET_GRAB_SCRIPT = `(function() {
  var selectors = [
    ".cw-header-ticket-number",
    ".ticket-number",
    "[class*=ticketNumber]",
    "[class*=ticket-number]",
    "[class*=TicketNumber]",
    "[data-testid*=ticket]",
    ".sr-number",
    "[class*=srNumber]",
    "[class*=recordId]",
    "[class*=record-id]",
    ".cw-breadcrumb",
    ".breadcrumb",
    ".tab-label.active",
    ".cw-tab.active",
    "[class*=activeTab]",
    ".selected-tab",
    ".panel-title",
    ".card-header",
    "h1", "h2", "h3"
  ];
  for (var i = 0; i < selectors.length; i++) {
    var els = document.querySelectorAll(selectors[i]);
    for (var j = 0; j < els.length; j++) {
      var text = els[j].innerText || els[j].textContent || "";
      var match = text.match(/#\\s*([0-9]{4,})/);
      if (match) return { ticket: match[1], source: selectors[i], text: text.substring(0, 100) };
    }
  }
  var body = document.body.innerText || "";
  var patterns = [
    /(?:Service\\s*Ticket|Ticket|SR)\\s*#\\s*([0-9]{4,})/i,
    /#([0-9]{5,})/
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m = body.match(patterns[p]);
    if (m) return { ticket: m[1], source: "body-scan", text: "" };
  }
  var inputs = document.querySelectorAll("input, [contenteditable], span, div");
  for (var k = 0; k < inputs.length; k++) {
    var el = inputs[k];
    var val = el.value || el.innerText || el.textContent || "";
    var label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "").toLowerCase();
    if (label.match(/ticket|sr\\s*#|record\\s*id|ticket\\s*number/)) {
      var numMatch = val.match(/([0-9]{4,})/);
      if (numMatch) return { ticket: numMatch[1], source: "input-label:" + label, text: val.substring(0, 100) };
    }
  }
  var allEls = document.querySelectorAll("*");
  var maxScan = Math.min(allEls.length, ${MAX_GRAB_ELEMENTS});
  for (var a = 0; a < maxScan; a++) {
    var cls = allEls[a].className || "";
    if (typeof cls === "string" && cls.match(/tab.*active|active.*tab|selected/i)) {
      var tabText = allEls[a].innerText || "";
      var tabMatch = tabText.match(/#\\s*([0-9]{4,})/);
      if (tabMatch) return { ticket: tabMatch[1], source: "active-tab-class", text: tabText.substring(0, 100) };
    }
  }
  return {
    ticket: null,
    source: "not-found",
    debug: {
      title: document.title,
      url: window.location.href,
      h1: (document.querySelector("h1") || {}).innerText || "",
      h2: (document.querySelector("h2") || {}).innerText || "",
      bodySnippet: body.substring(0, 500)
    }
  };
})()`;

  // ==================== Auto-Grab on First Typing ====================
  // Triggered by the first input event when ticket ID is empty.
  // Runs in the background via .then()/.catch() and NEVER calls
  // noteContent.focus() — so the editor is never interrupted.
  // Reset on tab switch (in activateTab) and on Clear.
  let hasAttemptedAutoGrab = false;

  function backgroundAutoGrab() {
    const webview = getActiveWebview();
    if (!webview) return;

    webview
      .executeJavaScript(TICKET_GRAB_SCRIPT)
      .then(function (result) {
        // Only fill if the user hasn't manually entered something while we were scanning
        if (ticketIdInput.value.trim()) return;
        if (result && result.ticket) {
          ticketIdInput.value = result.ticket;
          autosaveStatus.textContent = "Auto-grabbed ticket #" + result.ticket;
          autosaveStatus.className = "saved";
        }
        // If no ticket found, do nothing — the user can keep typing freely
      })
      .catch(function () {
        // Silently ignore errors — don't interrupt the user
      });
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
    } catch (err) {
      autosaveStatus.textContent = "Auto-save error!";
      autosaveStatus.className = "";
      console.error("Autosave error:", err);
    }
  }

  noteContent.addEventListener("input", function () {
    // On first typing with no ticket ID, kick off a background grab
    if (!ticketIdInput.value.trim() && !hasAttemptedAutoGrab) {
      hasAttemptedAutoGrab = true;
      backgroundAutoGrab();
    }
    autosaveStatus.textContent = "Typing...";
    autosaveStatus.className = "saving";
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
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
        console.log(
          "Grab success - source:",
          result.source,
          "text:",
          result.text,
        );
        if (!isEditorEmpty()) {
          performAutosave();
        }
      } else {
        autosaveStatus.textContent =
          "Could not detect ticket # - open a ticket first";
        autosaveStatus.className = "";
        console.log("Grab debug:", JSON.stringify(result, null, 2));
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
  // In Electron, the <webview> runs in a separate guest process that can
  // hold OS-level focus even when the user clicks in the renderer's DOM.
  // Native confirm()/alert() dialogs transfer OS focus to the webview guest
  // and never give it back. We use a custom in-page dialog instead.

  // Any mousedown on the side panel should reclaim focus from the webview
  // so that inputs and the contenteditable editor respond immediately.
  sidePanel.addEventListener("mousedown", function () {
    const webview = getActiveWebview();
    if (webview) webview.blur();
    window.focus();
  });

  // --- Custom confirm dialog (uses elements declared at top of DOMContentLoaded) ---
  function showConfirm(message) {
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      confirmMessage.textContent = message;
      confirmOverlay.classList.add("visible");
      confirmNo.focus();
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
        "Clear the current note? The draft will be removed — saved snapshots are not affected.",
      );
      if (!confirmed) return;
    }
    clearTimeout(autosaveTimer);

    // Remove the autosave entry so the editor starts blank on next launch
    if (lastSavedTicketId) {
      window.backupAPI.deleteAutosave(lastSavedTicketId);
    }

    setEditorContent("");
    ticketIdInput.value = "";
    hasAttemptedAutoGrab = false;
    lastSavedTicketId = null;
    autosaveStatus.textContent = "Cleared";
    autosaveStatus.className = "";
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
  // --- Debounced refreshTicketList for navigation events ---
  let refreshTicketListTimer = null;
  function debouncedRefreshTicketList() {
    clearTimeout(refreshTicketListTimer);
    refreshTicketListTimer = setTimeout(refreshTicketList, 500);
  }

  async function refreshTicketList() {
    try {
      const tickets = await window.backupAPI.getAllTickets();

      // Sort tickets based on current settings
      const sortField = appSettings.ticketSortField || "lastUpdated";
      const sortDir = appSettings.ticketSortDirection || "desc";

      tickets.sort(function (a, b) {
        let result = 0;
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

      const previousValue = ticketSelect.value;
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

      // Restore previously selected value if it still exists
      if (previousValue) {
        ticketSelect.value = previousValue;
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

        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = item.content;
        const preview = tempDiv.innerText.substring(0, PREVIEW_MAX_LENGTH);

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
          setEditorContent(item.content);
          ticketIdInput.value = ticketId;
          lastSavedTicketId = ticketId;
          autosaveStatus.textContent = "Restored from snapshot";
          autosaveStatus.className = "saved";
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
      // If the editor was blank when the app last closed, don't restore anything.
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
    // Ctrl+Shift+S - Save snapshot
    if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) {
      e.preventDefault();
      btnSave.click();
    }
    // Ctrl+Shift+B - Toggle side panel
    if (e.ctrlKey && e.shiftKey && (e.key === "B" || e.key === "b")) {
      e.preventDefault();
      togglePanel();
    }
    // Ctrl+, - Open settings
    if (e.ctrlKey && !e.shiftKey && e.key === ",") {
      e.preventDefault();
      openSettings();
    }
    // Ctrl+T - New tab
    if (e.ctrlKey && !e.shiftKey && e.key === "t") {
      e.preventDefault();
      createTab(DEFAULT_URL, { activate: true });
    }
    // Ctrl+W - Close current tab (only when not typing in notes)
    if (e.ctrlKey && !e.shiftKey && e.key === "w") {
      if (
        document.activeElement !== noteContent &&
        document.activeElement !== ticketIdInput
      ) {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
    }
    // Ctrl+Tab - Next tab
    if (e.ctrlKey && !e.shiftKey && e.key === "Tab") {
      e.preventDefault();
      const idx = tabs.findIndex(function (t) {
        return t.id === activeTabId;
      });
      if (idx !== -1 && tabs.length > 1) {
        const nextIdx = (idx + 1) % tabs.length;
        activateTab(tabs[nextIdx].id);
      }
    }
    // Ctrl+Shift+Tab - Previous tab
    if (e.ctrlKey && e.shiftKey && e.key === "Tab") {
      e.preventDefault();
      const idx = tabs.findIndex(function (t) {
        return t.id === activeTabId;
      });
      if (idx !== -1 && tabs.length > 1) {
        const prevIdx = (idx - 1 + tabs.length) % tabs.length;
        activateTab(tabs[prevIdx].id);
      }
    }
  });

  // ==================== Save tabs before window closes ====================
  window.addEventListener("beforeunload", function () {
    const urls = [];
    for (let i = 0; i < tabs.length; i++) {
      try {
        const url = tabs[i].webview.getURL();
        if (url && url !== "" && url !== "about:blank") {
          urls.push(url);
        }
      } catch {
        /* ignore */
      }
    }
    if (urls.length > 0) {
      // Use fire-and-forget send (not async invoke) so the message is
      // queued synchronously before the renderer process is destroyed.
      window.backupAPI.saveTabsSync(urls);
    }

    // Persist whether the editor was blank at close so we can skip draft
    // restoration on the next launch if the user had cleared the editor.
    const blankAtClose =
      isEditorEmpty() && !ticketIdInput.value.trim();
    window.backupAPI.saveEditorStateSync({ blankAtClose });
  });
});
