// ConnectWise Manage plugin — main window renderer
//
// Registers a site adapter for ConnectWise Manage (*.myconnectwise.net) so the
// Note Backup and AI Features plugins work on CW tabs the same way they do on
// Freshservice tabs. The adapter supplies:
//   - recordScript   — finds the open ticket number (URL first, then the page)
//   - scrapeScript   — collects the ticket's notes for AI Summarize
//   - notes          — read / push / watch the CW notes field for live sync
//
// CW has two notes fields, ported from ConnectWise Manage++:
//   - 'draft'    — the Draft.js time-entry editor (.public-DraftEditor-content)
//   - 'textarea' — the GWT stopwatch notes textarea (.cw_PsaResizableTextArea),
//                  which only exists while the stopwatch popup is open. Reads and
//                  pushes open the popup hidden, use it, then Save as Draft and close.
//
// Ticket notes are stored under "CW-<number>" so they never collide with
// Freshservice ticket numbers in the shared note store.
//
// The pure helpers are exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  const TICKET_PREFIX = "CW-";
  const CW_HOSTNAME_PATTERN = /(?:^|\.)myconnectwise\.net$/i;
  const MAX_GRAB_ELEMENTS = 5000;

  const PUSH_DELAY_DRAFT = 500;          // ms — Draft.js push debounce
  const PUSH_DELAY_TA_VISIBLE = 100;     // ms — stopwatch popup visible
  const PUSH_DELAY_TA_HIDDEN = 2000;     // ms — stopwatch hidden (avoids rapid popup open/hide)

  const WATCHER_PREFIX = "[CW-SYNC] ";

  // ==================== Pure helpers ====================

  function matchesUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
      return CW_HOSTNAME_PATTERN.test(parsed.hostname);
    } catch { return false; }
  }

  // Ticket number → note-store key, and back.
  function ticketKey(number) {
    const n = String(number || "").trim();
    return /^\d+$/.test(n) ? TICKET_PREFIX + n : null;
  }

  function ticketNumberFromKey(key) {
    const m = String(key || "").match(/^CW-(\d+)$/);
    return m ? m[1] : null;
  }

  // Ticket number from a CW URL. Classic screens carry it as service_recid /
  // srRecID in the query or hash; the SR record id is the ticket number.
  function ticketFromUrl(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    const haystack = parsed.search + "&" + parsed.hash.replace(/^#/, "");
    const m = haystack.match(/[?&#](?:service_recid|srRecID|sr_recid|ticketId|ticket_id)=(\d+)/i);
    return m ? m[1] : null;
  }

  function fieldTypeLabel(type) {
    if (type === "draft") return "time entry";
    if (type === "textarea") return "stopwatch";
    return "notes field";
  }

  function pushDelay(type, siteState) {
    if (type === "draft") return PUSH_DELAY_DRAFT;
    if (type === "textarea") {
      return siteState && siteState.popupVisible ? PUSH_DELAY_TA_VISIBLE : PUSH_DELAY_TA_HIDDEN;
    }
    return undefined;
  }

  // Watcher messages the core sync engine doesn't know about.
  function onWatcherMessage(msg, siteState) {
    if (!msg || !siteState) return;
    if (msg.kind === "popup") siteState.popupVisible = !!msg.visible;
  }

  // ==================== Page scripts ====================

  // Shared by the read and push scripts.
  const CW_FIELD_HELPERS = `
    // GWT hides components with inline style.display='none'. Temporarily reveal
    // any such ancestors so innerText and focus() work, then restore.
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

    // Makes sure the stopwatch textarea is in the DOM, opening the stopwatch
    // popup hidden if needed. An !important rule beats any inline style GWT
    // sets while the popup initialises.
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

    // Un-hide FIRST so GWT handles the clicks, then Save as Draft and close.
    function restoreState(info) {
      if (!info.wasHidden || !info.popup) return;
      info.popup.classList.remove('cw-sync-hidden');
      if (info.styleTag) info.styleTag.remove();
      var saveBtn = info.popup.querySelector('.cw_confirmButton .mm_button');
      var closeBtn = info.popup.querySelector('.cwsvg.mm_icon');
      if (saveBtn) makeClickFn(saveBtn)();
      if (closeBtn) makeClickFn(closeBtn)();
    }

    function findDraft() {
      return document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
    }
  `;

  const NOTES_READ_SCRIPT = `(async function() {
    ${CW_FIELD_HELPERS}
    var draftEl = findDraft();
    if (draftEl) {
      // innerText is "" on hidden elements, so reveal before reading.
      var text = withVisible(draftEl, function() { return draftEl.innerText.replace(/\\n$/, ''); });
      return { type: 'draft', text: text };
    }
    var info = await ensureTextarea();
    if (!info) return null;
    var taText = info.ta.value;
    restoreState(info);
    return { type: 'textarea', text: taText };
  })()`;

  function buildPushScript(plainText) {
    return `(async function() {
      var text = ${JSON.stringify(String(plainText == null ? "" : plainText))};
      ${CW_FIELD_HELPERS}

      var draftEl = findDraft();
      if (draftEl) {
        withVisible(draftEl, function() { draftEl.focus(); });

        // Draft.js debounces selectionchange, so DOM selection tricks don't reach
        // _latestEditorState before the paste fires. Reach into the React fiber
        // and make getSelection() return an all-blocks selection, so the paste
        // replaces the content instead of inserting at the cursor.
        try {
          var fiberKey = Object.keys(draftEl).find(function(k) {
            return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance');
          });
          var inst = null;
          if (fiberKey) {
            var f = draftEl[fiberKey];
            while (f) {
              if (f.stateNode && f.stateNode._latestEditorState) { inst = f.stateNode; break; }
              f = f.return;
            }
          }
          if (inst) {
            var es = inst._latestEditorState;
            var curSel = es.getSelection();
            // Block keys are encoded in data-offset-key="blockKey-decoratorIdx-leafIdx".
            var blockEls = draftEl.querySelectorAll('[data-block="true"]');
            var keyRe = /^(.+)-\\d+-\\d+$/;
            var firstKey = blockEls.length > 0
              && (keyRe.exec(blockEls[0].getAttribute('data-offset-key') || '') || [])[1];
            var lastEl = blockEls[blockEls.length - 1];
            var lastKey = lastEl && (keyRe.exec(lastEl.getAttribute('data-offset-key') || '') || [])[1];
            var lastLen = lastEl ? lastEl.textContent.length : 0;
            if (curSel && firstKey && lastKey) {
              var spec = {
                anchorKey: firstKey, anchorOffset: 0,
                focusKey: lastKey, focusOffset: lastLen,
                isBackward: false, hasFocus: true
              };
              var newSel;
              try { newSel = new curSel.constructor(spec); } catch (e) { newSel = spec; }
              inst._latestEditorState = new Proxy(es, {
                get: function(target, prop) {
                  if (prop === 'getSelection') return function() { return newSel; };
                  var val = target[prop];
                  if (val === curSel) return newSel;
                  if (typeof val === 'function') {
                    return function() {
                      var r = val.apply(target, arguments);
                      return r === curSel ? newSel : r;
                    };
                  }
                  return val;
                }
              });
            }
          }
        } catch (fiberErr) { /* paste will insert at the cursor instead */ }

        // A paste (insertFragment) avoids the NoteRichTextEditor unmount that
        // execCommand('insertText') causes.
        try {
          var dt = new DataTransfer();
          dt.setData('text/plain', text);
          draftEl.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true, cancelable: true, clipboardData: dt
          }));
        } catch (pasteErr) {
          withVisible(draftEl, function() {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, text);
          });
        }

        if (!draftEl.isConnected) {
          var fresh = findDraft();
          if (fresh) fresh.focus();
        }
        return { type: 'draft' };
      }

      var info = await ensureTextarea();
      if (!info) return null;
      withVisible(info.ta, function() {
        info.ta.focus();
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(info.ta, text);
        info.ta.dispatchEvent(new Event('input',  { bubbles: true }));
        info.ta.dispatchEvent(new Event('change', { bubbles: true }));
      });
      restoreState(info);
      return { type: 'textarea' };
    })()`;
  }

  // Injected once per page load. Talks to the app through console.log lines
  // that start with WATCHER_PREFIX, using the shared watcher protocol:
  //   {kind:'fields', type}  {kind:'focus', focused}  {kind:'input', field, text}
  // plus {kind:'popup', visible} for the stopwatch popup (see onWatcherMessage).
  const WATCHER_SCRIPT = `(function() {
    if (window.__cwSyncWatcherInstalled) return;
    window.__cwSyncWatcherInstalled = true;

    function emit(payload) {
      console.log(${JSON.stringify(WATCHER_PREFIX)} + JSON.stringify(payload));
    }

    var draftEl = null;
    var textareaEl = null;
    var popupVisible = false;
    var inputDebounce = null;

    function emitFields() {
      emit({ kind: 'fields', type: draftEl && draftEl.isConnected ? 'draft' : (textareaEl && textareaEl.isConnected ? 'textarea' : null) });
    }

    function onInput(field) {
      clearTimeout(inputDebounce);
      inputDebounce = setTimeout(function() {
        if (field === 'draft' && draftEl) {
          emit({ kind: 'input', field: 'draft', text: (draftEl.innerText || '').replace(/\\n$/, '') });
        } else if (field === 'textarea' && textareaEl) {
          emit({ kind: 'input', field: 'textarea', text: textareaEl.value || '' });
        }
      }, 150);
    }

    function attach(el, field) {
      el.addEventListener('focus', function() { emit({ kind: 'focus', field: field, focused: true }); });
      el.addEventListener('blur',  function() { emit({ kind: 'focus', field: field, focused: false }); });
      el.addEventListener('input', function() { onInput(field); });
    }

    function checkPopupVisibility() {
      var popup = document.querySelector('.cw-gxt-wnd');
      var visible = !!(popup && popup.offsetParent !== null && !popup.classList.contains('cw-sync-hidden'));
      if (visible !== popupVisible) {
        popupVisible = visible;
        emit({ kind: 'popup', visible: visible });
      }
    }

    function scan() {
      var changed = false;
      var draft = document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
      if (draft && draft !== draftEl) { draftEl = draft; attach(draft, 'draft'); changed = true; }
      var ta = document.querySelector('textarea.cw_PsaResizableTextArea');
      if (ta && ta !== textareaEl) { textareaEl = ta; attach(ta, 'textarea'); changed = true; }
      if (changed) emitFields();
      checkPopupVisibility();
    }

    scan();
    var obs = new MutationObserver(scan);
    obs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'class']
    });
  })()`;

  // Finds the open ticket. Returns { ticket, kind, id, label, source } or null.
  const RECORD_SCRIPT = `(function() {
    var PREFIX = ${JSON.stringify(TICKET_PREFIX)};
    function found(n, source) {
      return { ticket: PREFIX + n, kind: 'ticket', id: n, label: 'Ticket #' + n, source: source };
    }

    var loc = window.location.search + '&' + window.location.hash.replace(/^#/, '');
    var u = loc.match(/[?&#](?:service_recid|srRecID|sr_recid|ticketId|ticket_id)=(\\d+)/i);
    if (u) return found(u[1], 'url');

    var selectors = [
      ".cw-header-ticket-number", ".ticket-number",
      "[class*=ticketNumber]", "[class*=ticket-number]", "[class*=TicketNumber]",
      "[data-testid*=ticket]", ".sr-number", "[class*=srNumber]",
      "[class*=recordId]", "[class*=record-id]",
      ".cw-breadcrumb", ".breadcrumb",
      ".tab-label.active", ".cw-tab.active", "[class*=activeTab]", ".selected-tab",
      ".panel-title", ".card-header", "h1", "h2", "h3"
    ];
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        var text = els[j].innerText || els[j].textContent || "";
        var match = text.match(/#\\s*([0-9]{4,})/);
        if (match) return found(match[1], selectors[i]);
      }
    }

    var body = (document.body && document.body.innerText) || "";
    var patterns = [/(?:Service\\s*Ticket|Ticket|SR)\\s*#\\s*([0-9]{4,})/i, /#([0-9]{5,})/];
    for (var p = 0; p < patterns.length; p++) {
      var m = body.match(patterns[p]);
      if (m) return found(m[1], 'body-scan');
    }

    var all = document.querySelectorAll("input, [contenteditable], span, div");
    var maxInputs = Math.min(all.length, ${MAX_GRAB_ELEMENTS});
    for (var k = 0; k < maxInputs; k++) {
      var el = all[k];
      var label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "").toLowerCase();
      if (/ticket|sr\\s*#|record\\s*id|ticket\\s*number/.test(label)) {
        var val = el.value || el.innerText || el.textContent || "";
        var num = val.match(/([0-9]{4,})/);
        if (num) return found(num[1], 'input-label');
      }
    }
    return null;
  })()`;

  // Ticket notes for AI Summarize (author, date and text of each note).
  const SCRAPE_SCRIPT = `(function() {
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

  const adapter = Object.freeze({
    id: "connectwise-manage",
    name: "ConnectWise Manage",
    shortName: "CW",
    matchesUrl: matchesUrl,
    recordScript: RECORD_SCRIPT,
    scrapeScript: SCRAPE_SCRIPT,
    notes: Object.freeze({
      readScript: NOTES_READ_SCRIPT,
      buildPushScript: buildPushScript,
      watcherScript: WATCHER_SCRIPT,
      watcherPrefix: WATCHER_PREFIX,
      fieldTypes: Object.freeze(["draft", "textarea"]),
      fieldTypeLabel: fieldTypeLabel,
      pushDelay: pushDelay,
      onWatcherMessage: onWatcherMessage,
    }),
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      adapter, matchesUrl, ticketKey, ticketNumberFromKey, ticketFromUrl,
      fieldTypeLabel, pushDelay, onWatcherMessage, buildPushScript,
      NOTES_READ_SCRIPT, WATCHER_SCRIPT, RECORD_SCRIPT, SCRAPE_SCRIPT, WATCHER_PREFIX,
    };
    return;
  }

  const api = window.pluginAPI;
  if (!api || !api.sites || typeof api.sites.register !== "function") {
    console.warn("[ConnectWise Manage] This app version has no site adapter API; plugin inactive.");
    return;
  }
  api.sites.register(adapter);
})();
