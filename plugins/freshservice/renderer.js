// Freshservice site plugin — main window renderer
//
// Registers the Freshservice site adapter (pluginAPI.sites, see docs/sites.md).
// Everything that knows what a Freshservice page looks like lives here: which
// hosts are Freshservice, how a record's number is found in the URL or header,
// how the Froala note editor is read, watched and written, how a record's text is
// read for the AI features (REST API first, then the page), and the Solutions
// knowledge base. Feature plugins (Note Backup, AI Features, Solutions Chat) only
// talk to the adapter, so they work the same way on other sites.
(function () {
  "use strict";

  const api = window.pluginAPI;
  if (!api || !api.sites || typeof api.sites.register !== "function") return;

  const PLUGIN_ID = "freshservice";

  // Freshservice instances (*.freshservice.com) and Freshworks accounts / org SSO
  // (*.freshworks.com, *.myfreshworks.com). Keep in step with manifest.json "site.hosts".
  const FRESHWORKS_HOSTNAME_PATTERN = /(?:^|\.)(?:freshservice|freshworks|myfreshworks)\.com$/i;

  let settings = api.getSettings();
  api.events.on("settings:changed", function (s) { settings = s; });

  // A custom helpdesk domain set up for the API counts as Freshservice too.
  function apiHost() {
    const d = String(settings.fsApiDomain || "").trim().toLowerCase();
    return d && !/[/:]/.test(d) ? d : "";
  }

  function homeHost() {
    try {
      const u = new URL(settings.defaultUrl || "");
      return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase() : "";
    } catch { return ""; }
  }

  // True when another registered site claims the URL. Guarded so two adapters that
  // ask each other can't recurse.
  let checkingOthers = false;
  function claimedByAnotherSite(url) {
    if (checkingOthers) return false;
    checkingOthers = true;
    try {
      return api.sites.list().some(function (si) {
        if (si.id === PLUGIN_ID) return false;
        try { return si.matchesUrl(url) === true; } catch { return false; }
      });
    } finally {
      checkingOthers = false;
    }
  }

  function matchesUrl(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    if (FRESHWORKS_HOSTNAME_PATTERN.test(host) || (!!apiHost() && host === apiHost())) return true;
    // A custom helpdesk domain set as the Home URL counts as Freshservice too,
    // unless another site plugin claims it (it could be that site's home page).
    return !!homeHost() && host === homeHost() && !claimedByAnotherSite(url);
  }

  // ==================== Notes field ====================
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
  // Pushes are plain text and use the Froala API when available so the editor's
  // model and Freshservice's form bindings see the change.

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

  // Injected once per page load. Uses console.log as the outbound channel: the
  // Note Backup plugin filters the webview's console messages by the [FS-SYNC]
  // prefix. Freshservice is a single-page app, so the watcher stays installed
  // across in-page navigation and keeps re-detecting fields as editors open and close.
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

  function buildPushScript(plainText) {
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

  // ==================== Reply box (canned responses) ====================
  //
  // Inserts text into the reply or note editor at the cursor, for plugins such as
  // Canned Responses. Uses the same field finder as note sync (the focused editor,
  // then the one last clicked into, then the first visible one). When the caret
  // isn't in the field, the text goes at the end. Never replaces what's there.
  function buildReplyInsertScript(plainText) {
    return `(function() {
      var text = ${JSON.stringify(String(plainText == null ? "" : plainText))};
      ${FS_FIELD_HELPERS}

      var el = fsFindField();
      if (!el) return null;

      if (el.tagName === 'TEXTAREA') {
        el.focus();
        var start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
        var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
        var next = el.value.slice(0, start) + text + el.value.slice(end);
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, next);
        try { el.setSelectionRange(start + text.length, start + text.length); } catch (e) { /* ignore */ }
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { type: 'textarea' };
      }

      // Blank lines become paragraphs, single line breaks <br>, like the editor's own.
      var escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      var paras = escaped.split(/\\n\\s*\\n/);
      var html = paras.length > 1
        ? paras.map(function(p) { return '<p>' + (p.replace(/\\n/g, '<br>') || '<br>') + '</p>'; }).join('')
        : escaped.replace(/\\n/g, '<br>');

      // Keep the caret where the user left it; otherwise move it to the end.
      el.focus();
      var sel = window.getSelection();
      var inside = sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer);
      if (!inside && sel) {
        var range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      // Froala first (v3/v4 global, then the v2 jQuery plugin) so its model, undo
      // stack and Freshservice's bindings see the change.
      try {
        var inst = null;
        if (window.FroalaEditor && Array.isArray(window.FroalaEditor.INSTANCES)) {
          inst = window.FroalaEditor.INSTANCES.find(function(i) { return i && i.el === el; }) || null;
        }
        if (!inst && window.jQuery) {
          var box = window.jQuery(el).closest('.fr-box').prev();
          var data = box.length ? box.data('froala.editor') : null;
          if (data && data.html) inst = data;
        }
        if (inst && inst.html && typeof inst.html.insert === 'function') {
          inst.html.insert(html);
          if (inst.undo && typeof inst.undo.saveStep === 'function') inst.undo.saveStep();
          if (inst.events && typeof inst.events.trigger === 'function') inst.events.trigger('contentChanged');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return { type: 'editor' };
        }
      } catch (froalaErr) { /* fall through to the DOM path */ }

      var ok = false;
      try { ok = document.execCommand('insertHTML', false, html); } catch (cmdErr) { ok = false; }
      if (!ok) {
        el.insertAdjacentHTML('beforeend', html);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      return { type: 'editor' };
    })()`;
  }

  // Requester name and subject for placeholders such as {{requester_first}}.
  // Read through the API when it's set up, else from the page.
  const REPLY_CONTEXT_SCRIPT = `(function() {
    function txt(el) { return el ? String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : ''; }
    function first(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        var t = txt(el);
        if (t && t.length <= 200) return t;
      }
      return '';
    }
    return {
      subject: first(['[data-test-id="ticket-subject"]', '.ticket-subject-heading', '.ticket-subject', 'h1']),
      requester: first([
        '[data-test-id="requester-name"]', '[data-test-id*="requester"] a',
        '.requester-name', '.requester-info a', '.ticket-requester a', 'a[href*="/requesters/"]'
      ])
    };
  })()`;

  async function readReplyContext(ctx) {
    const out = {};
    const record = ctx && ctx.record;
    if (record && record.kind === "ticket" && record.id) {
      let host = "";
      try { host = new URL(ctx.url).hostname; } catch { /* no host */ }
      try {
        const res = await api.invoke(PLUGIN_ID, "get-ticket-fields", { ticketId: record.id, host: host });
        if (res && !res.error) {
          if (res.subject) out.subject = res.subject;
          if (res.requester) out.requester = res.requester;
          if (res.requesterFirstName) out.requesterFirstName = res.requesterFirstName;
        }
      } catch { /* fall back to the page */ }
    }
    if ((!out.subject || !out.requester) && ctx && ctx.webview) {
      try {
        const page = await ctx.webview.executeJavaScript(REPLY_CONTEXT_SCRIPT);
        if (page && !out.subject && page.subject) out.subject = page.subject;
        if (page && !out.requester && page.requester) out.requester = page.requester;
      } catch { /* nothing more to read */ }
    }
    return out;
  }

  // ==================== Record detection ====================
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
    { re: /\\/(?:a|helpdesk)\\/tickets\\/(\\d+)(?:[/?#]|$)/i, prefix: "", kind: "ticket" },
    { re: /\\/(?:a|itil)\\/changes\\/(\\d+)(?:[/?#]|$)/i, prefix: "CHN-", kind: "change" },
    { re: /\\/(?:a|itil)\\/problems\\/(\\d+)(?:[/?#]|$)/i, prefix: "PRB-", kind: "problem" },
    { re: /\\/(?:a|itil)\\/releases\\/(\\d+)(?:[/?#]|$)/i, prefix: "RL-", kind: "release" }
  ];
  var path = window.location.pathname + window.location.hash.replace(/^#/, "");
  for (var i = 0; i < routes.length; i++) {
    var m = path.match(routes[i].re);
    if (m) return found(routes[i].prefix + m[1], routes[i].kind, m[1], "url", path);
  }

  function found(ticket, kind, id, source, text) {
    return { ticket: ticket, kind: kind, id: id, label: kind + " #" + id, source: source, text: String(text || "").substring(0, 100) };
  }

  var KINDS = { CHN: "change", PRB: "problem", RL: "release" };
  function fromDisplayId(text, source) {
    var t = (text || "").match(/\\b(INC|SR)-(\\d+)\\b/);
    if (t) return found(t[2], "ticket", t[2], source, text);
    var o = (text || "").match(/\\b(CHN|PRB|RL)-(\\d+)\\b/);
    if (o) return found(o[1] + "-" + o[2], KINDS[o[1]], o[2], source, text);
    return null;
  }

  // Only trust the title/header on record pages, not list views.
  var onListPage = /\\/(?:a|helpdesk|itil)\\/(?:tickets|changes|problems|releases)\\/?(?:[?#]|$)/i.test(path);
  if (!onListPage) {
    var fromTitle = fromDisplayId(document.title, "title");
    if (fromTitle) return fromTitle;
    var headers = document.querySelectorAll("h1, h2, [class*=display-id], [class*=displayId], [class*=ticket-id], [class*=ticketId]");
    var maxScan = Math.min(headers.length, 5000);
    for (var h = 0; h < maxScan; h++) {
      var text = headers[h].innerText || headers[h].textContent || "";
      var hit = fromDisplayId(text, "header");
      if (hit) return hit;
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

  // ==================== Record text (AI features) ====================
  //
  // Freshservice renders stored rich text with Froala's read-only ".fr-view" class,
  // so those blocks are gathered first (skipping any open editors), after the
  // record's subject. If none are found, falls back to the main content area's text.
  const SCRAPE_SCRIPT = "(function() {" +
    "var parts = []; var seen = [];" +
    "document.querySelectorAll('.fr-view').forEach(function(el) {" +
    "  if (el.isContentEditable || el.closest('[contenteditable=\"true\"]')) return;" +
    "  if (seen.some(function(s) { return s.contains(el); })) return;" +
    "  var text = (el.innerText || el.textContent || '').trim();" +
    "  if (!text) return; seen.push(el); parts.push(text);" +
    "});" +
    "if (!parts.length) {" +
    "  var main = document.querySelector('main, [role=main], #main-content, .page-content') || document.body;" +
    "  parts.push((main.innerText || '').trim());" +
    "}" +
    "var title = (document.querySelector('h1, [data-test-id=\"ticket-subject\"]') || {}).innerText || '';" +
    "return ((title ? title.trim() + '\\n\\n' : '') + parts.join('\\n\\n---\\n\\n')).substring(0, 15000);" +
    "})()";

  // Tickets are read through the REST API when it's set up; anything else (the API
  // off or not configured, a change/problem/release, another account, an API
  // error) returns null so the page is scraped instead.
  async function readRecord(ctx) {
    const record = ctx && ctx.record;
    if (!record || record.kind !== "ticket" || !record.id) return null;
    let host = "";
    try { host = new URL(ctx.url).hostname; } catch { /* no host — the API checks nothing */ }
    const res = await api.invoke(PLUGIN_ID, "get-ticket", { ticketId: record.id, host: host });
    if (res && typeof res.text === "string" && res.text.trim()) return { text: res.text, source: "api" };
    if (res && res.error && !res.skipped) console.warn("[Freshservice] API:", res.error);
    return null;
  }

  // A clean link to the record open at `url` (for the tab menu's "Copy Ticket
  // Link"): the record's own page with no view, filter or tab parameters, e.g.
  // https://acme.freshservice.com/a/tickets/123. Null on list and other pages.
  const RECORD_LINK_PATTERN = /\/(a|helpdesk|itil)\/(tickets|changes|problems|releases)\/(\d+)(?=[/?#]|$)/i;
  function recordLink(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const m = (parsed.pathname + parsed.hash).match(RECORD_LINK_PATTERN);
    return m ? parsed.origin + "/" + m[1].toLowerCase() + "/" + m[2].toLowerCase() + "/" + m[3] : null;
  }

  // Logs time from the Time Tracker plugin as a Freshservice time entry, through
  // the REST API, for the agent the API key belongs to.
  async function logTimeEntry(ctx) {
    const record = ctx && ctx.record;
    if (!record || !record.id) return { error: "Open a ticket to log time on." };
    let host = "";
    try { host = new URL(ctx.url).hostname; } catch { /* no host — the API checks nothing */ }
    const res = await api.invoke(PLUGIN_ID, "add-time-entry", {
      kind: record.kind || "ticket",
      id: record.id,
      minutes: ctx.minutes,
      note: ctx.note,
      billable: ctx.billable,
      host: host,
    });
    if (res && res.ok) {
      return { ok: true, message: "Added a " + res.timeSpent + " time entry to " + (record.label || "the ticket") + " in Freshservice." };
    }
    return { error: (res && res.error) || "Freshservice didn't save the time entry." };
  }

  // Ticket quick-open (typing a number in the address bar): a link to that record
  // on the Freshservice instance in use. Accepts "12345", "#12345", "INC-12345",
  // "SR-12345", "FS-12345" for tickets and "CHN-45", "PRB-67", "RL-89" for
  // changes, problems and releases. The instance comes from an open Freshservice
  // tab (active tab first), then the API domain, then the Home URL. Freshworks
  // sign-in hosts (freshworks.com, myfreshworks.com) aren't instances, so skipped.
  const QUICK_OPEN_PATTERN = /^#?(?:(INC|SR|FS|CHN|PRB|RL)-?)?(\d{1,12})$/i;
  const QUICK_OPEN_KINDS = { CHN: "changes", PRB: "problems", RL: "releases" };
  const SIGN_IN_HOSTNAME_PATTERN = /(?:^|\.)(?:freshworks|myfreshworks)\.com$/i;

  function instanceBase(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (!matchesUrl(parsed.href) || SIGN_IN_HOSTNAME_PATTERN.test(parsed.hostname)) return null;
    const portal = /^\/(helpdesk|itil)\//i.exec(parsed.pathname);
    return { origin: parsed.origin, portal: portal ? portal[1].toLowerCase() : "a" };
  }

  function ticketUrl(query, ctx) {
    const m = QUICK_OPEN_PATTERN.exec(String(query || "").trim());
    if (!m) return null;
    const c = ctx || {};
    const candidates = (Array.isArray(c.tabUrls) ? c.tabUrls : []).slice();
    if (apiHost()) candidates.push("https://" + apiHost() + "/");
    candidates.push(c.homeUrl || settings.defaultUrl || "");
    let base = null;
    for (const u of candidates) { base = instanceBase(u); if (base) break; }
    if (!base) return null;
    const kind = QUICK_OPEN_KINDS[(m[1] || "").toUpperCase()] || "tickets";
    // The old /helpdesk portal has no changes/problems/releases; use /a there.
    const portal = kind === "tickets" || base.portal !== "helpdesk" ? base.portal : "a";
    return base.origin + "/" + portal + "/" + kind + "/" + Number(m[2]);
  }

  // Ticket search (the Ticket Search plugin's side panel tab, and anything else
  // that wants it, such as a command palette): by number, subject or requester,
  // through the REST API. Each result gets a link built the same way as ticket
  // quick-open, so it opens on the instance in use.
  async function searchTickets(term, options) {
    const opts = options || {};
    const res = await api.invoke(PLUGIN_ID, "search-tickets", { term: term, days: opts.days });
    if (!res || res.error) return { error: (res && res.error) || "Freshservice didn't answer the search.", skipped: !!(res && res.skipped) };
    let tabUrls = [];
    try {
      const list = api.browser.getTabs();
      list.sort(function (a, b) { return (b.active ? 1 : 0) - (a.active ? 1 : 0); });
      tabUrls = list.map(function (t) { return t.url; });
    } catch { /* no tabs yet */ }
    const ctx = { active: true, tabUrls: tabUrls, homeUrl: settings.defaultUrl || "" };
    const tickets = (res.tickets || []).map(function (t) {
      return {
        id: String(t.id),
        label: "#" + t.id,
        subject: t.subject || "",
        requester: t.requester || "",
        requesterEmail: t.requesterEmail || "",
        status: t.statusLabel || "",
        priority: t.priorityLabel || "",
        updatedAt: t.updatedAt || "",
        matches: t.matches || [],
        url: ticketUrl(String(t.id), ctx) || ("https://" + res.domain + "/a/tickets/" + t.id),
      };
    });
    let note = "";
    if (res.scanned) {
      note = "Subjects are matched against the " + (res.scanFull ? res.scanned + " most recent tickets" : res.scanned + " tickets") +
        " updated in the last " + res.days + " days.";
    }
    return { tickets: tickets, note: note, warnings: res.warnings || [] };
  }

  // ==================== Register ====================

  api.sites.register({
    id: PLUGIN_ID,
    name: "Freshservice",
    shortName: "FS",
    matchesUrl: matchesUrl,
    recordLink: recordLink,
    ticketUrl: ticketUrl,
    recordScript: TICKET_GRAB_SCRIPT,
    scrapeScript: SCRAPE_SCRIPT,
    readRecord: readRecord,
    notes: {
      readScript: FS_NOTES_READ_SCRIPT,
      buildPushScript: buildPushScript,
      watcherScript: FS_WATCHER_SCRIPT,
      watcherPrefix: "[FS-SYNC] ",
      fieldTypes: ["editor", "textarea"],
      fieldTypeLabel: function (type) { return type === "editor" ? "note editor" : "notes field"; },
      // Rich-text editors push after a slightly longer pause than plain textareas.
      pushDelay: function (type) { return type === "editor" ? 500 : 300; },
    },
    timeEntry: {
      label: "Log in Freshservice",
      billable: true,
      log: logTimeEntry,
    },
    reply: {
      label: "reply or note editor",
      buildInsertScript: buildReplyInsertScript,
      readContext: readReplyContext,
    },
    ticketSearch: {
      placeholder: "Ticket #, subject, or requester name/email",
      search: searchTickets,
    },
    knowledge: {
      name: "Solutions",
      search: function (term) { return api.invoke(PLUGIN_ID, "search-solutions", { term: term }); },
      getArticle: function (id) { return api.invoke(PLUGIN_ID, "get-solution-article", { id: id }); },
    },
  });
}());
