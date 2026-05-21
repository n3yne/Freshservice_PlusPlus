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

    // --- Theme ---
    const theme = settings.theme || "dark";
    document.body.setAttribute("data-theme", theme);
    settingTheme.checked = theme === "light";

    // --- Default URL ---
    if (document.activeElement !== settingDefaultUrl) {
      settingDefaultUrl.value = settings.defaultUrl || "https://na.myconnectwise.net/";
    }

    // --- Sig toolbar button visibility ---
    btnInsertSignature.style.display = settings.signatureHtml ? "" : "none";

    // --- Templates ---
    btnInsertTemplate.style.display = (settings.noteTemplates && settings.noteTemplates.length > 0) ? "inline-block" : "none";
    renderTemplateList();

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
    settingDefaultUrl.value = appSettings.defaultUrl || "https://na.myconnectwise.net/";
    renderTemplateList();
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

  // --- Theme toggle ---
  settingTheme.addEventListener("change", function () {
    appSettings.theme = settingTheme.checked ? "light" : "dark";
    document.body.setAttribute("data-theme", appSettings.theme);
    window.backupAPI.saveSettings(appSettings);
  });

  // --- Default URL: debounced save on input ---
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
        }
      } catch (err) { /* grab failure is non-fatal */ }
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

    // Build push script with the text safely JSON-encoded to avoid injection
    const pushScript = `(async function() {
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

      // Draft.js editor (time-entry notes)
      // execCommand fires the synthetic beforeinput event that Draft.js intercepts,
      // so React state stays consistent — direct innerHTML assignment would not.
      var draftEl = document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
      if (draftEl) {
        withVisible(draftEl, function() {
          draftEl.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, text);
        });
        return { type: 'draft' };
      }

      // GWT textarea (stopwatch notes)
      // Reveal hidden ancestors so focus() works, use native value setter so GWT
      // prototype listeners fire, then dispatch input/change events.
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

    try {
      const result = await webview.executeJavaScript(pushScript);
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

    // Build dropdown items
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

    // Position below the button
    const rect = btnInsertTemplate.getBoundingClientRect();
    templateDropdown.style.left = rect.left + "px";
    templateDropdown.style.top = (rect.bottom + 2) + "px";
    templateDropdown.classList.add("visible");

    // Adjust if overflowing the window
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
      if (activeTabId === id) updateNavButtons();
    });

    webview.addEventListener("did-navigate-in-page", function () {
      debouncedRefreshTicketList();
      updateTabTitle();
      saveTabSession();
      if (activeTabId === id) updateNavButtons();
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

    // --- Handle webview requesting to close itself (e.g. ConnectWise "Save and Return") ---
    webview.addEventListener("close", function () {
      console.log("[Tab] Webview requested close for tab:", id);
      closeTab(id);
      // Click the refresh button on the tab we returned to, identified by the
      // refresh icon SVG path (d attribute starting with "M43.4 24.4").
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

    // Activate the tab
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
    // Stop find on the tab we're leaving so it doesn't persist in the background
    if (findActive && activeTabId && activeTabId !== id) {
      const prevTab = tabs.find(function (t) { return t.id === activeTabId; });
      if (prevTab) {
        try { prevTab.webview.stopFindInPage("clearSelection"); } catch { /* ignore */ }
      }
    }

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

    updateNavButtons();

    // Re-run find on the newly active tab if the find bar is still open
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

    // Don't close pinned tabs
    if (tabs[idx].pinned) return;

    // Don't close the last tab - navigate it home instead
    if (tabs.length === 1) {
      tabs[0].webview.setAttribute("src", appSettings.defaultUrl);
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

  // ==================== Tab Pin / Unpin ====================

  function pinTab(id) {
    const tab = tabs.find(function (t) { return t.id === id; });
    if (!tab || tab.pinned) return;
    tab.pinned = true;
    tab.tabEl.classList.add("tab-pinned");
    const closeBtn = tab.tabEl.querySelector(".tab-close");
    if (closeBtn) closeBtn.style.display = "none";

    // Move to the end of the pinned group (front of tab bar)
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

    // Show "Pin Tab" or "Unpin Tab" depending on current state
    const ctxTab = tabs.find(function (t) { return t.id === tabId; });
    const isTabPinned = ctxTab && ctxTab.pinned;
    const pinItem = tabContextMenu.querySelector('[data-action="pin"]');
    const unpinItem = tabContextMenu.querySelector('[data-action="unpin"]');
    if (pinItem) pinItem.style.display = isTabPinned ? "none" : "";
    if (unpinItem) unpinItem.style.display = isTabPinned ? "" : "none";

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

  // --- New Tab button ---
  btnNewTab.addEventListener("click", function () {
    createTab(appSettings.defaultUrl, { activate: true });
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
      const savedData = await window.backupAPI.loadTabs();
      if (savedData && savedData.length > 0) {
        for (let i = 0; i < savedData.length; i++) {
          // Support both old string[] format and new {url, pinned}[] format
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
    // Fallback: create a single default tab
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

    // Auto-save a snapshot so the content is recoverable after clearing
    const snapTicketId = ticketIdInput.value.trim() || "general";
    try {
      await window.backupAPI.saveNote({ ticketId: snapTicketId, noteContent: getEditorContent(), isManual: true });
      refreshTicketList();
    } catch (err) {
      console.error("[Clear] Auto-snapshot error:", err);
    }

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
    // Ctrl+F - Find in page
    if (e.ctrlKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      showFindBar();
    }
    // Alt+Left - Go back
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      const wv = getActiveWebview();
      if (wv) try { wv.goBack(); } catch { /* ignore */ }
    }
    // Alt+Right - Go forward
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      const wv = getActiveWebview();
      if (wv) try { wv.goForward(); } catch { /* ignore */ }
    }
    // Ctrl+T - New tab
    if (e.ctrlKey && !e.shiftKey && e.key === "t") {
      e.preventDefault();
      createTab(appSettings.defaultUrl, { activate: true });
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
    const tabData = [];
    for (let i = 0; i < tabs.length; i++) {
      try {
        const url = tabs[i].webview.getURL();
        if (url && url !== "" && url !== "about:blank") {
          tabData.push({ url, pinned: tabs[i].pinned || false });
        }
      } catch {
        /* ignore */
      }
    }
    if (tabData.length > 0) {
      // Use fire-and-forget send (not async invoke) so the message is
      // queued synchronously before the renderer process is destroyed.
      window.backupAPI.saveTabsSync(tabData);
    }

    // Persist whether the editor was blank at close so we can skip draft
    // restoration on the next launch if the user had cleared the editor.
    const blankAtClose =
      isEditorEmpty() && !ticketIdInput.value.trim();
    window.backupAPI.saveEditorStateSync({ blankAtClose });
  });
});
