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
  const btnPullFromCw = document.getElementById("btn-pull-from-cw");
  const btnPushToCw = document.getElementById("btn-push-to-cw");
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
  const settingLiveSync = document.getElementById("setting-live-sync");
  const syncStatus = document.getElementById("sync-status");

  // --- AI Elements ---
  const settingAiProvider = document.getElementById("setting-ai-provider");
  const settingAiModel = document.getElementById("setting-ai-model");
  const settingAiKey = document.getElementById("setting-ai-key");
  const aiProviderFields = document.getElementById("ai-provider-fields");
  const btnAiSuggest = document.getElementById("btn-ai-suggest");
  const btnAiSummarize = document.getElementById("btn-ai-summarize");
  const aiOverlay = document.getElementById("ai-overlay");
  const aiDialogTitle = document.getElementById("ai-dialog-title");
  const aiDialogBody = document.getElementById("ai-dialog-body");
  const btnAiApply = document.getElementById("btn-ai-apply");
  const btnAiCopy = document.getElementById("btn-ai-copy");
  const btnAiCancel = document.getElementById("btn-ai-cancel");
  const btnAiClose = document.getElementById("btn-ai-close");
  const btnDownloads = document.getElementById("btn-downloads");
  const downloadsPanel = document.getElementById("downloads-panel");
  const downloadsList = document.getElementById("downloads-list");
  const btnCloseDownloads = document.getElementById("btn-close-downloads");
  const btnClearDownloads = document.getElementById("btn-clear-downloads");
  const settingRetentionDays = document.getElementById("setting-retention-days");
  const settingSortField = document.getElementById("setting-sort-field");
  const settingSortDirection = document.getElementById("setting-sort-direction");
  const settingSignature = document.getElementById("setting-signature");
  const btnInsertSignature = document.getElementById("btn-insert-signature");

  // --- Template Elements ---
  const btnInsertTemplate = document.getElementById("btn-insert-template");
  const templateDropdown = document.getElementById("template-dropdown");
  const templateList = document.getElementById("template-list");
  const btnAddTemplate = document.getElementById("btn-add-template");
  const templateAddForm = document.getElementById("template-add-form");
  const templateNameInput = document.getElementById("template-name-input");
  const templateContentInput = document.getElementById("template-content-input");
  const btnSaveTemplate = document.getElementById("btn-save-template");
  const btnCancelTemplate = document.getElementById("btn-cancel-template");

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

  // --- Settings — Navigation ---
  const settingDefaultUrl = document.getElementById("setting-default-url");
  const settingTheme = document.getElementById("setting-theme");

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
    defaultUrl: "https://na.myconnectwise.net/",
    theme: "dark",
    noteTemplates: [],
    liveSyncEnabled: true,
    aiProvider: "none",
    aiModelName: "",
    aiApiKey: "",
  };

  function applySettings(settings) {
    appSettings = settings;
    panelCollapsed = settings.panelCollapsed || false;

    settingNotePanel.checked = settings.notePanelEnabled;
    settingRetentionDays.value = settings.backupRetentionDays;
    settingSortField.value = settings.ticketSortField || "lastUpdated";
    settingSortDirection.value = settings.ticketSortDirection || "desc";

    // Skip updating the contenteditable if it has focus — avoids clobbering the cursor mid-edit.
    if (document.activeElement !== settingSignature) {
      settingSignature.innerHTML = settings.signatureHtml || "";
    }

    const theme = settings.theme || "dark";
    document.body.setAttribute("data-theme", theme);
    settingTheme.checked = theme === "light";

    if (document.activeElement !== settingDefaultUrl) {
      settingDefaultUrl.value = settings.defaultUrl || "https://na.myconnectwise.net/";
    }

    btnInsertSignature.style.display = settings.signatureHtml ? "" : "none";
    if (settingLiveSync) settingLiveSync.checked = settings.liveSyncEnabled !== false;

    const aiEnabled = settings.aiProvider && settings.aiProvider !== "none";
    if (settingAiProvider) settingAiProvider.value = settings.aiProvider || "none";
    if (settingAiModel) settingAiModel.value = settings.aiModelName || "";
    if (settingAiKey) {
      settingAiKey.value = "";
      // Never restore the raw key — show a masked placeholder so it's not visible in the DOM.
      settingAiKey.placeholder = settings.aiApiKey ? "••••••••  (saved)" : "Paste your API key here";
    }
    if (aiProviderFields) aiProviderFields.style.display = aiEnabled ? "" : "none";
    if (btnAiSuggest) btnAiSuggest.style.display = aiEnabled ? "" : "none";
    if (btnAiSummarize) btnAiSummarize.style.display = aiEnabled ? "" : "none";

    btnInsertTemplate.style.display = (settings.noteTemplates && settings.noteTemplates.length > 0) ? "inline-block" : "none";
    renderTemplateList();

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

  function openSettings() {
    if (settingsOverlay.classList.contains("visible")) return;

    settingNotePanel.checked = appSettings.notePanelEnabled;
    settingRetentionDays.value = appSettings.backupRetentionDays;
    settingSortField.value = appSettings.ticketSortField || "lastUpdated";
    settingSortDirection.value = appSettings.ticketSortDirection || "desc";
    settingSignature.innerHTML = appSettings.signatureHtml || "";
    settingDefaultUrl.value = appSettings.defaultUrl || "https://na.myconnectwise.net/";
    renderTemplateList();
    settingsOverlay.classList.add("visible");
  }

  function closeSettings() {
    settingsOverlay.classList.remove("visible");
  }

  btnCloseSettings.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", function (e) {
    if (e.target === settingsOverlay) closeSettings();
  });

  settingNotePanel.addEventListener("change", function () {
    appSettings.notePanelEnabled = settingNotePanel.checked;
    window.backupAPI.saveSettings(appSettings);
    applySettings(appSettings);
  });

  if (settingLiveSync) {
    settingLiveSync.addEventListener("change", function () {
      appSettings.liveSyncEnabled = settingLiveSync.checked;
      window.backupAPI.saveSettings(appSettings);
      updateSyncPill();
    });
  }

  if (settingAiProvider) {
    settingAiProvider.addEventListener("change", function () {
      appSettings.aiProvider = settingAiProvider.value;
      window.backupAPI.saveSettings(appSettings);
      applySettings(appSettings);
    });
  }

  let aiModelSaveTimer = null;
  if (settingAiModel) {
    settingAiModel.addEventListener("input", function () {
      clearTimeout(aiModelSaveTimer);
      aiModelSaveTimer = setTimeout(function () {
        appSettings.aiModelName = settingAiModel.value.trim();
        window.backupAPI.saveSettings(appSettings);
      }, 800);
    });
  }

  if (settingAiKey) {
    settingAiKey.addEventListener("change", function () {
      const val = settingAiKey.value.trim();
      if (val) {
        appSettings.aiApiKey = val;
        window.backupAPI.saveSettings(appSettings);
        settingAiKey.value = "";
        settingAiKey.placeholder = "••••••••  (saved)";
      }
    });
  }

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

  document
    .getElementById("signature-toolbar")
    .addEventListener("click", function (e) {
      const btn = e.target.closest("[data-sig-command]");
      if (!btn) return;
      settingSignature.focus();
      document.execCommand(btn.dataset.sigCommand, false, null);
    });

  let sigSaveTimer = null;
  settingSignature.addEventListener("input", function () {
    clearTimeout(sigSaveTimer);
    sigSaveTimer = setTimeout(function () {
      appSettings.signatureHtml = settingSignature.innerHTML;
      window.backupAPI.saveSettings(appSettings);
    }, SIG_SAVE_DEBOUNCE);
  });

  settingTheme.addEventListener("change", function () {
    appSettings.theme = settingTheme.checked ? "light" : "dark";
    document.body.setAttribute("data-theme", appSettings.theme);
    window.backupAPI.saveSettings(appSettings);
  });

  let defaultUrlSaveTimer = null;
  settingDefaultUrl.addEventListener("input", function () {
    clearTimeout(defaultUrlSaveTimer);
    defaultUrlSaveTimer = setTimeout(function () {
      const val = settingDefaultUrl.value.trim();
      try {
        const parsed = new URL(val);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          appSettings.defaultUrl = val;
          window.backupAPI.saveSettings(appSettings);
        }
      } catch {
        // Invalid URL — don't save
      }
    }, 800);
  });

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

  // ==================== AI Assistant ====================

  // Scrapes all ticket note entries from the active CW ticket page.
  // Each note block lives in label.TicketNote-noteLabel; author/date are
  // pulled from the enclosing .TicketNote-rowWrap for context.
  const CW_NOTES_SCRAPE_SCRIPT = `(function() {
    var parts = [];
    document.querySelectorAll('.TicketNote-noteLabel').forEach(function(label) {
      var text = (label.innerText || label.textContent || '').trim();
      if (!text) return;
      var row = label.closest('.TicketNote-rowWrap') || label.closest('.TicketNote-row');
      var author = '';
      var date = '';
      if (row) {
        var authorEl = row.querySelector('.TicketNote-clickableName') || row.querySelector('.TicketNote-basicName');
        if (authorEl) author = (authorEl.innerText || '').trim();
        var dateEl = row.querySelector('.TimeText-date');
        if (dateEl) {
          date = Array.from(dateEl.childNodes)
            .filter(function(n) { return n.nodeType === 3; })
            .map(function(n) { return n.textContent.trim(); })
            .join(' ').trim();
        }
      }
      var header = [author, date].filter(Boolean).join(' — ');
      parts.push((header ? '[' + header + ']\\n' : '') + text);
    });
    return parts.join('\\n\\n---\\n\\n').substring(0, 15000);
  })()`;

  let aiApplyCallback = null;

  // Convert AI markdown output to panel-compatible HTML.
  // Handles bullets (- / * / •), headers (#/##/###), **bold**, *italic*.
  // Uses <br> line breaks so output is compatible with setEditorContent().
  function markdownToHtml(text) {
    function inlineMarkdown(str) {
      return str
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>");
    }
    const lines = text.split("\n");
    const parts = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        parts.push("<br>");
        continue;
      }
      const header = trimmed.match(/^#{1,3}\s+(.+)/);
      if (header) {
        parts.push("<strong>" + inlineMarkdown(header[1]) + "</strong><br>");
        continue;
      }
      const bullet = trimmed.match(/^[-*•]\s+(.*)/);
      if (bullet) {
        parts.push("&nbsp;&nbsp;• " + inlineMarkdown(bullet[1]) + "<br>");
        continue;
      }
      parts.push(inlineMarkdown(trimmed) + "<br>");
    }
    return parts.join("").replace(/(<br>)+$/, "");
  }

  function showAiOverlay(title, bodyHtml, applyCallback, applyLabel) {
    aiDialogTitle.textContent = title;
    aiDialogBody.innerHTML = bodyHtml;
    aiApplyCallback = applyCallback || null;
    btnAiApply.textContent = applyLabel || "Apply";
    btnAiApply.style.display = applyCallback ? "" : "none";
    aiOverlay.classList.add("visible");
  }

  function closeAiOverlay() {
    aiOverlay.classList.remove("visible");
    aiApplyCallback = null;
  }

  btnAiClose.addEventListener("click", closeAiOverlay);
  btnAiCancel.addEventListener("click", closeAiOverlay);
  aiOverlay.addEventListener("click", function (e) {
    if (e.target === aiOverlay) closeAiOverlay();
  });

  btnAiApply.addEventListener("click", async function () {
    if (aiApplyCallback) await aiApplyCallback();
    closeAiOverlay();
  });

  btnAiCopy.addEventListener("click", function () {
    const text = aiDialogBody.innerText;
    navigator.clipboard.writeText(text).catch(function () {});
  });

  function aiSettings() {
    return {
      aiProvider: appSettings.aiProvider,
      aiApiKey: appSettings.aiApiKey,
      aiModelName: appSettings.aiModelName,
    };
  }

  // ---- Suggest button ----
  btnAiSuggest.addEventListener("click", async function () {
    if (isEditorEmpty()) {
      autosaveStatus.textContent = "Nothing to suggest — add some notes first";
      autosaveStatus.className = "";
      return;
    }

    const plainText = getEditorPlainText();
    showAiOverlay("✨ AI Suggestion", '<div class="ai-loading">Thinking…</div>', null);

    let ticketContext = "";
    const suggestWebview = getActiveWebview();
    if (suggestWebview) {
      try {
        ticketContext = await suggestWebview.executeJavaScript(CW_NOTES_SCRAPE_SCRIPT) || "";
      } catch { /* non-fatal — context is optional */ }
    }

    let response;
    try {
      response = await window.backupAPI.aiSuggest({ text: plainText, ticketContext, settings: aiSettings() });
    } catch (err) {
      aiDialogBody.innerHTML = '<p class="ai-error">Request failed — check your connection.</p>';
      console.error("[AI] Suggest error:", err);
      return;
    }

    if (response.error) {
      aiDialogBody.innerHTML = `<p class="ai-error">${response.error.replace(/</g, "&lt;")}</p>`;
      return;
    }

    if (!response.result) {
      aiDialogBody.innerHTML = '<p class="ai-error">AI returned an empty response.</p>';
      return;
    }

    const escaped = response.result
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    aiDialogBody.innerHTML = `<div class="ai-result">${escaped}</div>`;

    const resultText = response.result;
    aiApplyCallback = async function () {
      await snapshotBeforeBulkImport(resultText);
      setEditorContent(escaped);
      autosaveStatus.textContent = "AI suggestion applied";
      autosaveStatus.className = "saved";
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
    };
    btnAiApply.style.display = "";
  });

  // ---- Summarize button ----
  btnAiSummarize.addEventListener("click", async function () {
    const webview = getActiveWebview();
    if (!webview) {
      autosaveStatus.textContent = "No active tab";
      autosaveStatus.className = "";
      return;
    }

    showAiOverlay("📋 Ticket Summary", '<div class="ai-loading">Reading ticket notes…</div>', null);

    let pageText;
    try {
      pageText = await webview.executeJavaScript(CW_NOTES_SCRAPE_SCRIPT);
    } catch {
      aiDialogBody.innerHTML = '<p class="ai-error">Could not read the ticket page.</p>';
      return;
    }

    if (!pageText || pageText.trim().length < 20) {
      aiDialogBody.innerHTML = '<p class="ai-error">No note content found on this page.</p>';
      return;
    }

    aiDialogBody.innerHTML = '<div class="ai-loading">Summarizing…</div>';

    let response;
    try {
      response = await window.backupAPI.aiSummarize({ text: pageText, settings: aiSettings() });
    } catch (err) {
      aiDialogBody.innerHTML = '<p class="ai-error">Request failed — check your connection.</p>';
      console.error("[AI] Summarize error:", err);
      return;
    }

    if (response.error) {
      aiDialogBody.innerHTML = `<p class="ai-error">${response.error.replace(/</g, "&lt;")}</p>`;
      return;
    }

    if (!response.result) {
      aiDialogBody.innerHTML = '<p class="ai-error">AI returned an empty response.</p>';
      return;
    }

    const summaryHtml = markdownToHtml(response.result);
    aiDialogBody.innerHTML = `<div class="ai-result">${summaryHtml}</div>`;

    const summaryResult = response.result;
    aiApplyCallback = async function () {
      const insertHtml =
        "<strong>AI Ticket Summary:</strong><br><br>" + markdownToHtml(summaryResult);
      await snapshotBeforeBulkImport(summaryResult);
      const existing = getEditorContent().trim();
      setEditorContent(existing ? existing + "<br><br>" + insertHtml : insertHtml);
      autosaveStatus.textContent = "Summary inserted";
      autosaveStatus.className = "saved";
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
    };
    btnAiApply.textContent = "Insert";
    btnAiApply.style.display = "";
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

    return `<div class="dl-item" data-dl-id="${dl.id}">
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
    downloadsPanel.classList.add("visible");
    updateDownloadBadge(items);
  }

  function closeDownloadsPanel() {
    downloadsPanel.classList.remove("visible");
  }

  function updateDownloadBadge(items) {
    const active = items.filter((d) => d.state === "progressing").length;
    btnDownloads.setAttribute("data-badge", active > 0 ? String(active) : "");
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
    btnDownloads.setAttribute("data-badge", "");
  });

  downloadsList.addEventListener("click", function (e) {
    const openBtn = e.target.closest(".dl-btn-open");
    const folderBtn = e.target.closest(".dl-btn-folder");
    if (openBtn) window.backupAPI.openDownloadFile(openBtn.dataset.path);
    if (folderBtn) window.backupAPI.showDownloadFolder(folderBtn.dataset.path);
  });

  window.backupAPI.onDownloadUpdate(function (dl) {
    window.backupAPI.getDownloads().then(updateDownloadBadge);

    if (!downloadsPanel.classList.contains("visible")) return;
    const existing = downloadsList.querySelector(`[data-dl-id="${dl.id}"]`);
    const html = renderDownloadItem(dl);
    if (existing) {
      existing.outerHTML = html;
    } else {
      downloadsList.insertAdjacentHTML("afterbegin", html);
      const empty = downloadsList.querySelector(".downloads-empty");
      if (empty) empty.remove();
    }
  });

  // ==================== CW Notes Sync ====================
  //
  // Reads from / writes to whichever CW notes field is currently on screen.
  // Supported field types:
  //   - Draft.js contenteditable (.public-DraftEditor-content) — time-entry notes
  //   - GWT textarea (.cw_PsaResizableTextArea)                — stopwatch notes
  //
  // Pull: CW field → panel (asks for confirmation if panel already has content)
  // Push: panel → CW field (plain text; uses execCommand for Draft.js so that
  //        React's event handlers recognise the change)

  const CW_NOTES_READ_SCRIPT = `(async function() {
    // GWT hides components with inline style.display='none'. Temporarily reveal
    // any such ancestors so innerText and focus() work correctly, then restore.
    function withVisible(el, fn) {
      var chain = [];
      var p = el;
      while (p && p !== document.documentElement) {
        if (p.style.display === 'none') { chain.push(p); p.style.display = 'block'; }
        p = p.parentElement;
      }
      try { return fn(); } finally {
        chain.forEach(function(n) { n.style.display = 'none'; });
      }
    }

    // Build a reusable click function for a toggle element.
    function makeClickFn(el) {
      var rect = el.getBoundingClientRect();
      var mx = rect.left + rect.width / 2, my = rect.top + rect.height / 2;
      return function() {
        ['mousedown', 'mouseup', 'click'].forEach(function(type) {
          el.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window, clientX: mx, clientY: my
          }));
        });
      };
    }

    // Ensure the stopwatch textarea is in the DOM.
    // Injects a CSS rule with !important so GWT's own show() cannot override
    // our hiding after the popup is inserted. Restores visibility before
    // clicking close buttons so GWT processes those events normally.
    async function ensureTextarea() {
      var ta = document.querySelector('textarea.cw_PsaResizableTextArea');
      if (ta) return { ta: ta, wasHidden: false };
      var stopwatch = document.querySelector('.mm_stopwatch');
      if (!stopwatch) return null;
      var firstCwsvg = stopwatch.querySelector('div.cwsvg');
      var toggle = firstCwsvg ? firstCwsvg.parentElement : null;
      if (!toggle) return null;
      // !important rule beats any inline style GWT sets during popup initialisation.
      var styleTag = document.createElement('style');
      styleTag.textContent = '.cw-gxt-wnd.cw-sync-hidden { visibility: hidden !important; }';
      document.head.appendChild(styleTag);
      var popup = null;
      var obs = new MutationObserver(function(muts) {
        for (var mi = 0; mi < muts.length; mi++) {
          for (var ni = 0; ni < muts[mi].addedNodes.length; ni++) {
            var n = muts[mi].addedNodes[ni];
            if (n.nodeType !== 1) continue;
            var w = n.classList.contains('cw-gxt-wnd') ? n
                  : (n.querySelector && n.querySelector('.cw-gxt-wnd'));
            if (w) { w.classList.add('cw-sync-hidden'); popup = w; obs.disconnect(); return; }
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      makeClickFn(toggle)();
      for (var i = 0; i < 10; i++) {
        await new Promise(function(r) { setTimeout(r, 200); });
        ta = document.querySelector('textarea.cw_PsaResizableTextArea');
        if (ta) break;
      }
      obs.disconnect();
      if (!ta) { styleTag.remove(); return null; }
      if (!popup) { popup = ta.closest('.cw-gxt-wnd'); if (popup) popup.classList.add('cw-sync-hidden'); }
      return { ta: ta, wasHidden: true, popup: popup, styleTag: styleTag };
    }

    // Remove the hiding class FIRST (so GWT processes button events normally),
    // then click Save as Draft → X to dismiss the popup cleanly.
    function restoreState(info) {
      if (!info.wasHidden || !info.popup) return;
      info.popup.classList.remove('cw-sync-hidden');
      if (info.styleTag) info.styleTag.remove();
      var saveBtn = info.popup.querySelector('.cw_confirmButton .mm_button');
      var closeBtn = info.popup.querySelector('.cwsvg.mm_icon');
      if (saveBtn) makeClickFn(saveBtn)();
      if (closeBtn) makeClickFn(closeBtn)();
    }

    // Draft.js editor (time-entry notes)
    // innerText returns "" on hidden elements, so reveal before reading.
    var draftEl = document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
    if (draftEl) {
      var text = withVisible(draftEl, function() { return draftEl.innerText.replace(/\\n$/, ''); });
      return { type: 'draft', text: text };
    }

    // GWT textarea (stopwatch notes)
    var info = await ensureTextarea();
    if (!info) return null;
    var text = info.ta.value;
    restoreState(info);
    return { type: 'textarea', text: text };
  })()`;

  btnPullFromCw.addEventListener("click", async function () {
    const webview = getActiveWebview();
    if (!webview) {
      autosaveStatus.textContent = "No active tab";
      autosaveStatus.className = "";
      return;
    }

    let result;
    try {
      result = await webview.executeJavaScript(CW_NOTES_READ_SCRIPT);
    } catch (err) {
      autosaveStatus.textContent = "Error reading CW notes field";
      autosaveStatus.className = "";
      console.error("[CW Sync] Pull error:", err);
      return;
    }

    if (!result) {
      autosaveStatus.textContent = "No CW notes field found on this page";
      autosaveStatus.className = "";
      return;
    }

    if (result.text.trim() === "") {
      autosaveStatus.textContent = "CW notes field is empty";
      autosaveStatus.className = "";
      return;
    }

    if (!isEditorEmpty()) {
      const confirmed = await showConfirm(
        "Replace the current panel notes with content pulled from CW?"
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

    autosaveStatus.textContent =
      "Pulled from CW (" + (result.type === "draft" ? "time entry" : "stopwatch") + ")";
    autosaveStatus.className = "saved";

    // Queue an autosave so the pulled content is persisted
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
  });

  btnPushToCw.addEventListener("click", async function () {
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

    // Strip HTML formatting — CW notes fields accept plain text only
    const plainText = getEditorPlainText();

    try {
      const result = await webview.executeJavaScript(buildCwPushScript(plainText));
      if (!result) {
        autosaveStatus.textContent = "No CW notes field found on this page";
        autosaveStatus.className = "";
        return;
      }
      autosaveStatus.textContent =
        "Pushed to CW (" + (result.type === "draft" ? "time entry" : "stopwatch") + ")";
      autosaveStatus.className = "saved";
    } catch (err) {
      autosaveStatus.textContent = "Error pushing to CW notes field";
      autosaveStatus.className = "";
      console.error("[CW Sync] Push error:", err);
    }
  });

  // ==================== CW Live Sync Engine ====================
  //
  // Three subsystems:
  //   1. CW_WATCHER_SCRIPT — injected into each webview to emit focus/input/popup events
  //   2. syncEngine        — per-tab state machine driving push (panel→CW) and pull (CW→panel)
  //   3. ticketSwapper     — auto-loads content when the detected ticket changes

  const SYNC_PUSH_DRAFT = 500;       // ms — Draft.js push debounce
  const SYNC_PUSH_TA_VISIBLE = 100;  // ms — stopwatch popup visible
  const SYNC_PUSH_TA_HIDDEN = 2000;  // ms — stopwatch hidden (longer debounce avoids rapid popup open/hide)
  const SYNC_PULL_DEBOUNCE = 300;    // ms — incoming CW change pull

  // Injected once per page load. Uses console.log as the outbound channel so it
  // works without an extra IPC registration — the renderer filters by the [CW-SYNC]
  // prefix in the webview console-message event.
  const CW_WATCHER_SCRIPT = `(function() {
    if (window.__cwSyncWatcherInstalled) return;
    window.__cwSyncWatcherInstalled = true;

    function emit(payload) {
      console.log('[CW-SYNC] ' + JSON.stringify(payload));
    }

    var draftEl = null;
    var textareaEl = null;
    var popupVisible = false;
    var inputDebounce = null;

    function onDraftInput() {
      clearTimeout(inputDebounce);
      inputDebounce = setTimeout(function() {
        if (draftEl) emit({ kind: 'input', field: 'draft', text: (draftEl.innerText || '').replace(/\\n$/, '') });
      }, 150);
    }

    function onTextareaInput() {
      clearTimeout(inputDebounce);
      inputDebounce = setTimeout(function() {
        if (textareaEl) emit({ kind: 'input', field: 'textarea', text: textareaEl.value || '' });
      }, 150);
    }

    function attachDraft(el) {
      if (draftEl === el) return;
      draftEl = el;
      el.addEventListener('focus', function() { emit({ kind: 'focus', field: 'draft', focused: true }); });
      el.addEventListener('blur',  function() { emit({ kind: 'focus', field: 'draft', focused: false }); });
      el.addEventListener('input', onDraftInput);
      emit({ kind: 'fields', draft: true, textarea: !!textareaEl });
    }

    function attachTextarea(el) {
      if (textareaEl === el) return;
      textareaEl = el;
      el.addEventListener('focus', function() { emit({ kind: 'focus', field: 'textarea', focused: true }); });
      el.addEventListener('blur',  function() { emit({ kind: 'focus', field: 'textarea', focused: false }); });
      el.addEventListener('input', onTextareaInput);
      emit({ kind: 'fields', draft: !!draftEl, textarea: true });
    }

    function checkPopupVisibility() {
      var popup = document.querySelector('.cw-gxt-wnd');
      var visible = !!(popup && popup.offsetParent !== null && !popup.classList.contains('cw-sync-hidden'));
      if (visible !== popupVisible) {
        popupVisible = visible;
        emit({ kind: 'popup', visible: visible });
      }
    }

    function scanAndAttach() {
      var draft = document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
      if (draft && draft !== draftEl) attachDraft(draft);
      var ta = document.querySelector('textarea.cw_PsaResizableTextArea');
      if (ta && ta !== textareaEl) attachTextarea(ta);
      checkPopupVisibility();
    }

    scanAndAttach();

    var obs = new MutationObserver(function() { scanAndAttach(); });
    obs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'class']
    });
  })()`;

  const syncStates = new Map();

  function getSyncState(tabId) {
    if (!syncStates.has(tabId)) {
      syncStates.set(tabId, {
        cwFieldType: null,     // 'draft' | 'textarea' | null
        cwPopupVisible: false,
        cwFocused: false,
        panelFocused: false,
        lastPushedText: null,  // echo suppression: text we last wrote to CW
        lastPulledText: null,  // change detection: text we last read from CW
        pushTimer: null,
        pullTimer: null,
        pushInFlight: false,
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
    if (!state || !state.cwFieldType) {
      syncStatus.textContent = "⇅ No CW field";
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
        state.cwFieldType = msg.draft ? "draft" : (msg.textarea ? "textarea" : null);
        updateSyncPill();
        break;
      case "focus":
        state.cwFocused = msg.focused;
        break;
      case "popup":
        state.cwPopupVisible = msg.visible;
        break;
      case "input":
        // CW field changed while panel is not focused → schedule a pull
        if (!state.panelFocused) {
          clearTimeout(state.pullTimer);
          state.pullTimer = setTimeout(function () {
            executePull(tabId, msg.text, msg.field);
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

    state.lastPulledText = text;
    await snapshotBeforeBulkImport(text);
    const html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    setEditorContent(html);

    if (syncStatus) {
      syncStatus.textContent = field === "draft" ? "⇅ Pulled (time entry)" : "⇅ Pulled (stopwatch)";
      syncStatus.className = "sync-status sync-active";
      setTimeout(updateSyncPill, 1500);
    }

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
  }

  function schedulePush(tabId) {
    if (!appSettings.liveSyncEnabled) return;
    if (tabId !== activeTabId) return;
    const state = getSyncState(tabId);
    if (!state.cwFieldType) return;

    let delay;
    if (state.cwFieldType === "draft") {
      delay = SYNC_PUSH_DRAFT;
    } else if (state.cwPopupVisible) {
      delay = SYNC_PUSH_TA_VISIBLE;
    } else {
      delay = SYNC_PUSH_TA_HIDDEN;
    }

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

    state.pushInFlight = true;
    updateSyncPill();

    const pushScript = buildCwPushScript(plainText);
    try {
      const result = await webview.executeJavaScript(pushScript);
      if (result) {
        state.lastPushedText = plainText;
        if (syncStatus) {
          syncStatus.textContent = "⇅ Synced";
          syncStatus.className = "sync-status sync-idle";
        }
      }
    } catch {
      // Best-effort — silent failure
    } finally {
      state.pushInFlight = false;
      updateSyncPill();
    }
  }

  function buildCwPushScript(plainText) {
    return `(async function() {
      var text = ${JSON.stringify(plainText)};

      function withVisible(el, fn) {
        var chain = [];
        var p = el;
        while (p && p !== document.documentElement) {
          if (p.style.display === 'none') { chain.push(p); p.style.display = 'block'; }
          p = p.parentElement;
        }
        try { return fn(); } finally {
          chain.forEach(function(n) { n.style.display = 'none'; });
        }
      }

      function makeClickFn(el) {
        var rect = el.getBoundingClientRect();
        var mx = rect.left + rect.width / 2, my = rect.top + rect.height / 2;
        return function() {
          ['mousedown', 'mouseup', 'click'].forEach(function(type) {
            el.dispatchEvent(new MouseEvent(type, {
              bubbles: true, cancelable: true, view: window, clientX: mx, clientY: my
            }));
          });
        };
      }

      async function ensureTextarea() {
        var ta = document.querySelector('textarea.cw_PsaResizableTextArea');
        if (ta) return { ta: ta, wasHidden: false };
        var stopwatch = document.querySelector('.mm_stopwatch');
        if (!stopwatch) return null;
        var firstCwsvg = stopwatch.querySelector('div.cwsvg');
        var toggle = firstCwsvg ? firstCwsvg.parentElement : null;
        if (!toggle) return null;
        var styleTag = document.createElement('style');
        styleTag.textContent = '.cw-gxt-wnd.cw-sync-hidden { visibility: hidden !important; }';
        document.head.appendChild(styleTag);
        var popup = null;
        var obs = new MutationObserver(function(muts) {
          for (var mi = 0; mi < muts.length; mi++) {
            for (var ni = 0; ni < muts[mi].addedNodes.length; ni++) {
              var n = muts[mi].addedNodes[ni];
              if (n.nodeType !== 1) continue;
              var w = n.classList.contains('cw-gxt-wnd') ? n
                    : (n.querySelector && n.querySelector('.cw-gxt-wnd'));
              if (w) { w.classList.add('cw-sync-hidden'); popup = w; obs.disconnect(); return; }
            }
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        makeClickFn(toggle)();
        for (var i = 0; i < 10; i++) {
          await new Promise(function(r) { setTimeout(r, 200); });
          ta = document.querySelector('textarea.cw_PsaResizableTextArea');
          if (ta) break;
        }
        obs.disconnect();
        if (!ta) { styleTag.remove(); return null; }
        if (!popup) { popup = ta.closest('.cw-gxt-wnd'); if (popup) popup.classList.add('cw-sync-hidden'); }
        return { ta: ta, wasHidden: true, popup: popup, styleTag: styleTag };
      }

      function restoreState(info) {
        if (!info.wasHidden || !info.popup) return;
        info.popup.classList.remove('cw-sync-hidden');
        if (info.styleTag) info.styleTag.remove();
        var saveBtn = info.popup.querySelector('.cw_confirmButton .mm_button');
        var closeBtn = info.popup.querySelector('.cwsvg.mm_icon');
        if (saveBtn) makeClickFn(saveBtn)();
        if (closeBtn) makeClickFn(closeBtn)();
      }

      var draftEl = document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
      if (draftEl) {
        withVisible(draftEl, function() {
          draftEl.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, text);
        });
        return { type: 'draft' };
      }

      var info = await ensureTextarea();
      if (!info) return null;
      withVisible(info.ta, function() {
        info.ta.focus();
        var setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(info.ta, text);
        info.ta.dispatchEvent(new Event('input',  { bubbles: true }));
        info.ta.dispatchEvent(new Event('change', { bubbles: true }));
      });
      restoreState(info);
      return { type: 'textarea' };
    })()`;
  }

  // ==================== Ticket Swapper ====================
  //
  // Runs on tab activation and did-finish-load. When the detected ticket differs
  // from currentPanelTicket: snapshot the outgoing content (if changed), then
  // load the incoming ticket from CW first, falling back to local backup.

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

    let grabResult;
    try {
      grabResult = await tab.webview.executeJavaScript(TICKET_GRAB_SCRIPT);
    } catch { return; }

    if (!grabResult || !grabResult.ticket) return;

    const newTicket = grabResult.ticket;

    if (userTypedTicket && ticketIdInput.value.trim() && ticketIdInput.value.trim() !== newTicket) return;
    if (newTicket === currentPanelTicket) return;

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

    let loadedFromCw = false;
    try {
      const cwResult = await tab.webview.executeJavaScript(CW_NOTES_READ_SCRIPT);
      if (cwResult && cwResult.text && cwResult.text.trim()) {
        await snapshotBeforeBulkImport(cwResult.text);
        const html = cwResult.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");
        setEditorContent(html);
        const state = getSyncState(tabId);
        state.cwFieldType = cwResult.type;
        state.lastPulledText = cwResult.text;
        state.lastPushedText = null;
        loadedFromCw = true;
      }
    } catch { /* CW read failed — fall through to local */ }

    if (!loadedFromCw) {
      await loadLocalTicketContent(newTicket);
      // Still detect field type for sync even if CW was empty
      try {
        const probe = await tab.webview.executeJavaScript(CW_NOTES_READ_SCRIPT);
        if (probe) {
          const state = getSyncState(tabId);
          state.cwFieldType = probe.type;
        }
      } catch { /* ignore */ }
    }

    ticketIdInput.value = newTicket;
    currentPanelTicket = newTicket;
    userTypedTicket = false;
    lastSavedTicketId = newTicket;
    hasAttemptedAutoGrab = true;

    autosaveStatus.textContent = "Loaded ticket #" + newTicket;
    autosaveStatus.className = "saved";
    updateSyncPill();

    await refreshTicketList(newTicket);

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
  }

  // Save a snapshot before any bulk import that changes the panel by more than 4 chars.
  // Prevents losing panel content when live sync or a manual pull overwrites it.
  async function snapshotBeforeBulkImport(incomingPlainText) {
    if (isEditorEmpty()) return;
    const currentText = getEditorPlainText();
    if (Math.abs(currentText.length - incomingPlainText.length) <= 4) return;
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

  async function loadLocalTicketContent(ticketId) {
    try {
      const autosaveData = await window.backupAPI.loadAutosave();
      if (autosaveData[ticketId] && autosaveData[ticketId].content) {
        setEditorContent(autosaveData[ticketId].content);
        return;
      }
      const history = await window.backupAPI.getHistory(ticketId);
      if (history.length > 0) {
        setEditorContent(history[0].content);
      } else {
        setEditorContent("");
      }
    } catch {
      setEditorContent("");
    }
  }

  // ==================== Note Templates ====================

  let editingTemplateIndex = null;

  function renderTemplateList() {
    if (!templateList) return;
    templateList.innerHTML = "";
    const templates = (appSettings.noteTemplates || []);
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
        window.backupAPI.saveSettings(appSettings);
        renderTemplateList();
        btnInsertTemplate.style.display = appSettings.noteTemplates.length > 0 ? "inline-block" : "none";
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
    if (!name) {
      templateNameInput.focus();
      return;
    }
    if (!appSettings.noteTemplates) appSettings.noteTemplates = [];

    if (editingTemplateIndex !== null) {
      appSettings.noteTemplates[editingTemplateIndex] = { name, content };
    } else {
      appSettings.noteTemplates.push({ name, content });
    }

    window.backupAPI.saveSettings(appSettings);
    templateAddForm.classList.remove("visible");
    btnAddTemplate.style.display = "";
    editingTemplateIndex = null;
    renderTemplateList();
    btnInsertTemplate.style.display = appSettings.noteTemplates.length > 0 ? "inline-block" : "none";
  });

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

  // Listen for menu bar "Edit > Settings"
  window.backupAPI.onOpenSettings(function () {
    openSettings();
  });

  // Listen for menu bar "Edit > Find..."
  window.backupAPI.onFindInPage(function () {
    showFindBar();
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

    // Create webview element
    const webview = document.createElement("webview");
    webview.setAttribute("src", url || appSettings.defaultUrl);
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
      pinned: false,
    };
    tabs.push(tabData);

    if (startPinned) {
      tabData.pinned = true;
      tabEl.classList.add("tab-pinned");
      closeBtn.style.display = "none";
    }

    // click (not mousedown) to avoid activating the tab while the user is starting a drag
    tabEl.addEventListener("click", function (e) {
      if (e.target.closest(".tab-close")) return;
      activateTab(id);
    });

    tabEl.addEventListener("auxclick", function (e) {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(id);
      }
    });

    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeTab(id);
    });

    tabEl.addEventListener("contextmenu", function (e) {
      showTabContextMenu(e, id);
    });

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

    // Messages emitted by the injected CW watcher arrive here as console-message events.
    webview.addEventListener("console-message", function (e) {
      const msg = e.message || "";
      if (!msg.startsWith("[CW-SYNC] ")) return;
      try {
        handleWatcherMessage(id, JSON.parse(msg.slice(10)));
      } catch { /* malformed payload — ignore */ }
    });

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
      if (activeTabId === id) updateNavButtons();
      // Reset sync state so the watcher re-detects the fields on the new page.
      const navState = syncStates.get(id);
      if (navState) {
        navState.cwFieldType = null;
        navState.lastPushedText = null;
        navState.lastPulledText = null;
        navState.cwFocused = false;
        navState.cwPopupVisible = false;
      }
    });

    webview.addEventListener("did-finish-load", function () {
      webview.executeJavaScript(CW_WATCHER_SCRIPT).catch(function () {});
      if (activeTabId === id) ticketSwapRun(id);
    });

    webview.addEventListener("did-navigate-in-page", function () {
      debouncedRefreshTicketList();
      updateTabTitle();
      saveTabSession();
      if (activeTabId === id) {
        updateNavButtons();
        ticketSwapRun(id);
      }
    });

    webview.addEventListener("found-in-page", function (e) {
      if (findActive && activeTabId === id) {
        if (e.result.matches > 0) {
          findMatchCount.textContent =
            e.result.activeMatchOrdinal + " of " + e.result.matches;
        } else {
          findMatchCount.textContent = "No results";
        }
      }
    });

    // CW's "Save and Return" button calls window.close() on the child page.
    // After closing that tab, click the refresh button on the parent so CW reloads its list.
    // The refresh button is identified by its SVG path data — no stable class or ID is available.
    webview.addEventListener("close", function () {
      console.log("[Tab] Webview requested close for tab:", id);
      closeTab(id);
      const returnedWebview = getActiveWebview();
      if (returnedWebview) {
        returnedWebview
          .executeJavaScript(
            `(function() {
              const paths = document.querySelectorAll('.mm_button svg path');
              for (const p of paths) {
                if ((p.getAttribute('d') || '').startsWith('M43.4 24.4')) {
                  const btn = p.closest('.mm_button');
                  if (btn) { btn.click(); break; }
                }
              }
            })();`,
          )
          .catch(function () {});
      }
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
        nextId = tabs[newIdx].id;
      }
      activateTab(nextId);
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
    if (!e.target.closest("#template-dropdown") && !e.target.closest("#btn-insert-template")) {
      templateDropdown.classList.remove("visible");
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      hideTabContextMenu();
      if (findActive) hideFindBar();
      closeSettings();
      if (confirmOverlay.classList.contains("visible")) closeConfirm(false);
      if (aiOverlay.classList.contains("visible")) closeAiOverlay();
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

  // ==================== Grab Ticket from ConnectWise ====================

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
    } catch (err) {
      autosaveStatus.textContent = "Auto-save error!";
      autosaveStatus.className = "";
      console.error("Autosave error:", err);
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
        console.log(
          "Grab success - source:",
          result.source,
          "text:",
          result.text,
        );
        refreshTicketList(result.ticket);
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
      openSettings();
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
