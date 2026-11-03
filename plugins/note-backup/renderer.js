// Note Backup plugin — main window renderer
//
// Adds the Notes tab to the side panel: a rich-text note editor bound to the
// ticket open in the active browser tab, with autosave, snapshots and history,
// note search, templates, a signature, and live sync with the Freshservice note
// editor. It also registers as the app's notes provider, so other plugins'
// pluginAPI.notes calls (AI Features, Solutions Chat) read and write this editor.
//
// Files on disk are handled by this plugin's main.js (see its handlers below).
(function () {
  "use strict";

  const api = window.pluginAPI;
  if (!api || !api.ui || typeof api.ui.addSidePanelTab !== "function") return;

  const PLUGIN_ID = "note-backup";

  // ==================== Main-process calls ====================
  const store = {
    saveNote: (data) => api.invoke(PLUGIN_ID, "save-note", data),
    loadAutosave: () => api.invoke(PLUGIN_ID, "load-autosave"),
    getHistory: (ticketId) => api.invoke(PLUGIN_ID, "get-history", ticketId),
    getAllTickets: () => api.invoke(PLUGIN_ID, "get-all-tickets"),
    deleteAutosave: (ticketId) => api.invoke(PLUGIN_ID, "delete-autosave", ticketId),
    deleteTicket: (ticketId) => api.invoke(PLUGIN_ID, "delete-ticket", ticketId),
    searchNotes: (query) => api.invoke(PLUGIN_ID, "search-notes", query),
    checkBackupSize: () => api.invoke(PLUGIN_ID, "check-backup-size"),
    loadEditorState: () => api.invoke(PLUGIN_ID, "load-editor-state"),
    openBackupFolder: () => api.invoke(PLUGIN_ID, "open-backup-folder"),
  };

  // ==================== Panel DOM ====================
  const sidePanelTab = api.ui.addSidePanelTab({
    id: "notes",
    label: "Notes",
    icon: "📋",
    title: "Note Backup: draft and back up ticket notes",
    order: 10,
  });
  sidePanelTab.element.innerHTML = `
<div id="note-backup-content">
  <!-- Ticket ID -->
  <div class="form-group">
    <label for="ticket-id">Ticket / Reference ID</label>
    <div class="input-with-button">
      <input
        type="text"
        id="ticket-id"
        placeholder="e.g. SR-123456 or any label"
      />
      <button
        id="btn-grab-ticket"
        class="btn btn-small"
        title="Grab the ticket number from the currently open Freshservice page"
      >
        🎯 Grab
      </button>
    </div>
  </div>

  <!-- Note Editor -->
  <div class="form-group note-group">
    <label>Notes</label>
    <!-- Formatting Toolbar -->
    <div id="editor-toolbar">
      <button
        class="toolbar-btn"
        data-command="bold"
        title="Bold (Ctrl+B)"
      >
        <b>B</b>
      </button>
      <button
        class="toolbar-btn"
        data-command="italic"
        title="Italic (Ctrl+I)"
      >
        <i>I</i>
      </button>
      <button
        class="toolbar-btn"
        data-command="underline"
        title="Underline (Ctrl+U)"
      >
        <u>U</u>
      </button>
      <button
        class="toolbar-btn"
        data-command="strikeThrough"
        title="Strikethrough"
      >
        <s>S</s>
      </button>
      <span class="toolbar-sep"></span>
      <button
        class="toolbar-btn"
        data-command="insertUnorderedList"
        title="Bullet List"
      >
        &#8226; List
      </button>
      <button
        class="toolbar-btn"
        data-command="insertOrderedList"
        title="Numbered List"
      >
        1. List
      </button>
      <span class="toolbar-sep"></span>
      <button
        class="toolbar-btn"
        data-command="formatBlock"
        data-value="h3"
        title="Heading"
      >
        H
      </button>
      <button
        class="toolbar-btn"
        data-command="formatBlock"
        data-value="blockquote"
        title="Quote"
      >
        &ldquo;
      </button>
      <button
        class="toolbar-btn"
        data-command="removeFormat"
        title="Clear Formatting"
      >
        &oslash;
      </button>
      <span class="toolbar-sep"></span>
      <button
        class="toolbar-btn toolbar-btn-sig"
        id="btn-insert-signature"
        title="Insert signature at end of note"
      >
        Sig
      </button>
      <span class="toolbar-sep"></span>
      <button
        type="button"
        class="toolbar-btn toolbar-btn-tmpl"
        id="btn-insert-template"
        title="Insert a note template"
      >
        Tmpl &#9662;
      </button>
      <span class="toolbar-sep"></span>
      <button
        type="button"
        class="toolbar-btn toolbar-btn-html"
        id="btn-html-toggle"
        title="Toggle HTML source view"
      >
        HTML
      </button>
    </div>
    <!-- Rich Text Editor -->
    <div
      id="note-content"
      contenteditable="true"
      data-placeholder="Type or paste your ticket notes here. You can use formatting and paste images..."
    ></div>
    <!-- HTML Source Editor (shown when HTML toggle is active) -->
    <textarea
      id="note-html-source"
      class="note-html-source"
      spellcheck="false"
      autocomplete="off"
      aria-label="HTML source"
    ></textarea>
  </div>

  <!-- Status Bar -->
  <div id="status-bar">
    <span id="autosave-status">Ready</span>
    <span id="sync-status" class="sync-status sync-off">⇅ No FS field</span>
  </div>

  <!-- Freshservice Notes Sync -->
  <div id="fs-sync-buttons">
    <button
      type="button"
      id="btn-pull-from-fs"
      class="btn btn-small"
      title="Load the open Freshservice note editor into this panel"
    >⬇ Pull from FS</button>
    <button
      type="button"
      id="btn-push-to-fs"
      class="btn btn-small"
      title="Send panel notes to the open Freshservice note editor"
    >⬆ Push to FS</button>
  </div>

  <!-- Action Buttons -->
  <div id="action-buttons">
    <button
      id="btn-save"
      class="btn btn-primary"
      title="Save a timestamped backup"
    >
      💾 Save Snapshot
    </button>
    <button
      id="btn-clear"
      class="btn btn-warning"
      title="Clear current note"
    >
      🗑️ Clear
    </button>
    <button
      id="btn-copy"
      class="btn btn-secondary"
      title="Copy notes to clipboard"
    >
      📋 Copy
    </button>
  </div>

  <!-- Divider -->
  <hr class="divider" />

  <!-- Note Search -->
  <div id="note-search">
    <input
      type="text"
      id="note-search-input"
      class="note-search-input"
      placeholder="Search notes…"
      autocomplete="off"
      spellcheck="false"
    />
    <div id="note-search-results" class="note-search-results"></div>
  </div>

  <!-- History / Restore Section -->
  <div id="history-section">
    <div id="history-header">
      <h3>📂 Saved Snapshots</h3>
      <button
        id="btn-open-folder"
        class="btn btn-small"
        title="Open backup folder"
      >
        📁 Open Folder
      </button>
    </div>

    <!-- Saved Tickets List -->
    <div id="saved-tickets">
      <label>Saved Tickets:</label>
      <select id="ticket-select" title="Select a saved ticket">
        <option value="">-- Select a ticket --</option>
      </select>
      <button id="btn-load-history" class="btn btn-small">
        Load History
      </button>
      <button
        id="btn-delete-ticket"
        class="btn btn-small btn-delete"
        title="Delete all saved data for the selected ticket"
      >
        🗑️ Delete
      </button>
    </div>

    <div id="history-list">
      <!-- Populated dynamically -->
    </div>
  </div>
</div>`;

  const overlayHost = document.createElement("div");
  overlayHost.innerHTML = `
<div id="diff-overlay" class="diff-overlay">
  <div class="diff-dialog">
    <div class="diff-dialog-header">
      <h3>Compare Snapshot</h3>
      <button type="button" id="btn-diff-close" class="settings-close" title="Close">&times;</button>
    </div>
    <div class="diff-meta">
      <span id="diff-snapshot-name" class="diff-snapshot-name"></span>
      <div class="diff-legend">
        <span class="diff-legend-item diff-remove-legend">&#x2212; Current</span>
        <span class="diff-legend-item diff-add-legend">+ Snapshot</span>
      </div>
    </div>
    <div id="diff-body" class="diff-body"></div>
    <div class="diff-dialog-footer">
      <button type="button" id="btn-diff-restore" class="btn btn-primary">Restore this snapshot</button>
      <button type="button" id="btn-diff-cancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>
</div>
<div id="template-dropdown" class="context-menu"></div>`;
  while (overlayHost.firstElementChild) document.body.appendChild(overlayHost.firstElementChild);

  // --- Element References ---
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
  const syncStatus = document.getElementById("sync-status");
  const btnInsertSignature = document.getElementById("btn-insert-signature");
  const btnInsertTemplate = document.getElementById("btn-insert-template");
  const templateDropdown = document.getElementById("template-dropdown");
  const btnHtmlToggle = document.getElementById("btn-html-toggle");
  const noteHtmlSource = document.getElementById("note-html-source");
  let htmlEditMode = false;
  const noteSearchInput = document.getElementById("note-search-input");
  const noteSearchResults = document.getElementById("note-search-results");
  const diffOverlay = document.getElementById("diff-overlay");
  const diffSnapshotName = document.getElementById("diff-snapshot-name");
  const diffBody = document.getElementById("diff-body");
  const btnDiffClose = document.getElementById("btn-diff-close");
  const btnDiffRestore = document.getElementById("btn-diff-restore");
  const btnDiffCancel = document.getElementById("btn-diff-cancel");

  // ==================== Constants ====================
  const MENU_EDGE_PADDING = 4; // px — dropdown window-edge padding
  const PREVIEW_MAX_LENGTH = 100; // chars — history preview truncation
  const MAX_GRAB_ELEMENTS = 5000; // max DOM elements scanned during ticket grab
  const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2 MB — max pasted/dropped image size

  // ==================== Settings ====================
  let appSettings = api.getSettings();

  function applySettings(settings) {
    appSettings = settings;
    btnInsertSignature.style.display = settings.signatureHtml ? "" : "none";
    btnInsertTemplate.style.display = (settings.noteTemplates && settings.noteTemplates.length > 0) ? "inline-block" : "none";
    refreshTicketList();
    updateSyncPill();
  }

  api.events.on("settings:changed", applySettings);

  // ==================== App helpers ====================
  function showConfirm(message, defaultYes = false) {
    return api.ui.confirm(message, { defaultYes });
  }

  function notify(type, title, desc, action) {
    api.ui.notify({ type, title, desc, action });
  }

  // ==================== Browser Tabs ====================
  // Mirrors the app's browser tabs (pluginAPI tab:* events) so live sync and
  // ticket detection can follow the active one.
  const tabs = []; // { id, webview, listeners: [{ event, fn }] }
  let activeTabId = null;

  function getActiveWebview() {
    const tab = tabs.find(function (t) { return t.id === activeTabId; });
    return tab ? tab.webview : null;
  }

  btnInsertSignature.addEventListener("click", function () {
    const sigHtml = appSettings.signatureHtml;
    if (!sigHtml) {
      autosaveStatus.textContent =
        "No signature configured - set one in Settings → Note Backup";
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
        notify("sync-failure", "Live Sync Push Failed",
          "Could not write notes to the Freshservice notes field. Your Freshservice session may have expired or the note editor is no longer open on this page.");
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
          await store.saveNote({
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
    const ticketChange = { ticketId: newTicket, previous: currentPanelTicket };
    api.events.emit("ticket:changed", ticketChange);
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
        await store.saveNote({ ticketId, noteContent: html, isManual: true });
        lastSnapshotContent.set(ticketId, html);
        refreshTicketList();
      }
    } catch { /* non-fatal */ }
  }

  // Returns the saved HTML for a ticket: its autosaved draft, else its newest
  // snapshot, else "".
  async function readLocalTicketContent(ticketId) {
    try {
      const autosaveData = await store.loadAutosave();
      if (autosaveData[ticketId] && autosaveData[ticketId].content) {
        return autosaveData[ticketId].content;
      }
      const history = await store.getHistory(ticketId);
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
      const results = await store.searchNotes(query);
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
      const data = await store.loadAutosave();
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
        await store.deleteAutosave(lastSavedTicketId);
      }

      const result = await store.saveNote({
        ticketId: ticketId,
        noteContent: content,
        isManual: false,
      });
      lastSavedTicketId = ticketId;
      autosaveStatus.textContent =
        "Auto-saved at " + new Date(result.timestamp).toLocaleTimeString();
      autosaveStatus.className = "saved";
      api.events.emit("note:saved", { ticketId, timestamp: result.timestamp });
    } catch (err) {
      autosaveStatus.textContent = "Auto-save error!";
      autosaveStatus.className = "";
      console.error("Autosave error:", err);
      notify("autosave-failure", "Auto-save Failed",
        "A note could not be saved to disk. Check that the backup folder is accessible and you have write permissions.");
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
      const result = await store.saveNote({
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
      await store.saveNote({ ticketId: snapTicketId, noteContent: getEditorContent(), isManual: true });
      refreshTicketList();
    } catch (err) {
      console.error("[Clear] Auto-snapshot error:", err);
    }

    // Delete the autosave entry so the next launch doesn't restore a note the user explicitly cleared.
    if (lastSavedTicketId) {
      await store.deleteAutosave(lastSavedTicketId);
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
    store.openBackupFolder();
  });

  // ==================== History ====================
  let refreshTicketListTimer = null;
  function debouncedRefreshTicketList() {
    clearTimeout(refreshTicketListTimer);
    refreshTicketListTimer = setTimeout(refreshTicketList, 500);
  }

  async function refreshTicketList(selectTicketId = null) {
    try {
      const tickets = await store.getAllTickets();
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
      const items = await store.getHistory(ticketId);
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
      await store.deleteTicket(selectedTicket);
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
      const editorState = await store.loadEditorState();
      if (editorState && editorState.blankAtClose) {
        return;
      }

      const data = await store.loadAutosave();
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

  // ==================== Browser Tab Hooks ====================

  function attachTab(tabId, webview) {
    if (tabs.some(function (t) { return t.id === tabId; })) return;
    const tabData = { id: tabId, webview, listeners: [] };
    function on(event, fn) {
      webview.addEventListener(event, fn);
      tabData.listeners.push({ event, fn });
    }
    tabs.push(tabData);

    // Messages emitted by the injected FS watcher arrive here.
    on("console-message", function (e) {
      const msg = e.message || "";
      if (!msg.startsWith("[FS-SYNC] ")) return;
      if (!isFreshworksTab(tabData)) return;
      const wState = getSyncState(tabId);
      const now = Date.now();
      if (now - wState.lastWatcherMsgAt < SYNC_WATCHER_MIN_INTERVAL) return;
      wState.lastWatcherMsgAt = now;
      try {
        handleWatcherMessage(tabId, JSON.parse(msg.slice(10)));
      } catch { /* malformed payload — ignore */ }
    });

    on("did-navigate", function () {
      debouncedRefreshTicketList();
      // Reset sync state so the watcher re-detects the fields on the new page.
      const navState = syncStates.get(tabId);
      if (navState) {
        navState.fsFieldType = null;
        navState.lastPushedText = null;
        navState.lastPulledText = null;
        navState.fsFocused = false;
      }
    });

    on("did-finish-load", function () {
      if (isFreshworksTab(tabData)) webview.executeJavaScript(FS_WATCHER_SCRIPT).catch(function () {});
      if (activeTabId === tabId) ticketSwapRun(tabId);
    });

    on("did-navigate-in-page", function () {
      debouncedRefreshTicketList();
      if (activeTabId === tabId) ticketSwapRun(tabId);
    });

    // Clicks inside a webview don't bubble to document, so close the dropdown on webview focus.
    on("focus", function () {
      templateDropdown.classList.remove("visible");
    });

    return tabData;
  }

  function detachTab(tabId) {
    const idx = tabs.findIndex(function (t) { return t.id === tabId; });
    if (idx === -1) return;
    const tab = tabs[idx];
    tab.listeners.forEach(function (l) {
      try { tab.webview.removeEventListener(l.event, l.fn); } catch { /* ignore */ }
    });
    tabs.splice(idx, 1);
    clearSyncState(tabId);
  }

  function onTabActivated(tabId) {
    activeTabId = tabId;
    // Each tab has its own page context, so the previous auto-grab result doesn't apply.
    hasAttemptedAutoGrab = false;
    updateSyncPill();
    ticketSwapRun(tabId);
  }

  api.events.on("tab:created", function (e) { attachTab(e.tabId, e.webview); });
  api.events.on("tab:activated", function (e) {
    attachTab(e.tabId, e.webview);
    onTabActivated(e.tabId);
  });
  api.events.on("tab:closed", function (e) { detachTab(e.tabId); });

  // Tabs restored at startup may already exist (and have loaded) by the time this
  // script runs: attach them, and install the watcher in pages that finished loading.
  api.browser.getTabs().forEach(function (t) {
    const tabData = attachTab(t.tabId, t.webview);
    if (!tabData) return;
    try {
      if (!t.webview.isLoading() && isFreshworksTab(tabData)) {
        t.webview.executeJavaScript(FS_WATCHER_SCRIPT).catch(function () {});
      }
    } catch { /* webview not ready yet — did-finish-load will install it */ }
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#template-dropdown") && !e.target.closest("#btn-insert-template")) {
      templateDropdown.classList.remove("visible");
    }
  });

  // ==================== Keyboard Shortcuts ====================
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      templateDropdown.classList.remove("visible");
      if (diffOverlay.classList.contains("visible")) closeDiffOverlay();
    }
    if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) {
      e.preventDefault();
      btnSave.click();
    }
    // Paste as plain text into the note.
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
    // Persisted so the next launch can skip draft restoration when the user closed cleanly.
    const blankAtClose = isEditorEmpty() && !ticketIdInput.value.trim();
    api.send(PLUGIN_ID, "save-editor-state", { blankAtClose });
  });

  // ==================== Storage Warning ====================
  async function checkBackupSize() {
    const warningMb = appSettings.backupStorageWarningMb ?? 100;
    if (!warningMb) return;
    try {
      const result = await store.checkBackupSize();
      if (result.error || result.totalMb === undefined) return;
      if (result.totalMb < warningMb) return;
      notify("storage-warning", "Backup Storage Warning",
        `Your note backups are using ${result.totalMb} MB (threshold: ${warningMb} MB). Consider reducing the backup retention period or clearing old snapshots.`,
        { label: "Open Backup Folder", onClick: function () { store.openBackupFolder(); } });
    } catch {
      // Silently skip
    }
  }

  // ==================== Notes Provider ====================
  // Backs pluginAPI.notes for every plugin.
  api.notes.registerProvider({
    toolbar: document.getElementById("editor-toolbar"),
    actionsRow: document.getElementById("fs-sync-buttons"),
    getContent: function () { return getEditorContent(); },
    setContent: function (html) {
      setEditorContent(html);
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(performAutosave, AUTOSAVE_DELAY);
    },
    getTicketId: function () { return ticketIdInput.value.trim() || null; },
    getPlainText: function () { return getEditorPlainText(); },
    saveSnapshot: function (incomingText, options) {
      return snapshotBeforeBulkImport(incomingText, !!(options && options.force));
    },
    focusTab: function () { sidePanelTab.activate(); },
  });

  // ==================== Init ====================
  applySettings(appSettings);
  loadAutosaved();
  checkBackupSize();
  const active = api.browser.getActiveTab();
  if (active) onTabActivated(active.tabId);
}());
