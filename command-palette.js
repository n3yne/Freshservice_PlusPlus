"use strict";

// Command palette (Ctrl+K): one search box to jump to an open tab, bookmark,
// ticket number, side panel tab, setting or app command. Loaded in the window
// (window.CommandPalette) and by the tests.
//
// This file holds the matching and ranking, which the tests cover, and the
// palette's on-screen list (create). renderer.js gathers the items: the core
// ones and those plugins add with pluginAPI.commands (see docs/plugins.md).
//
// An item is { id, title, subtitle?, group?, keywords?, shortcut?, pinned?,
// run(), runInNewTab?() }. Pinned items (e.g. "Open ticket 12345" built from
// what was typed) always list first.
(function (root) {
  const MAX_RESULTS = 50;
  const MAX_QUERY = 200;

  function norm(text) {
    return typeof text === "string" ? text.toLowerCase().trim() : "";
  }

  // How well text matches the query, 0 when it doesn't. Whole match beats a
  // prefix, a word start, a substring, all words in any order, then letters
  // in order ("nt" finds "New Tab"), so the closest match ranks first.
  // exact: true leaves out letters in order, for long text such as URLs and
  // descriptions, where scattered letters match almost anything.
  function matchScore(query, text, exact) {
    const q = norm(query);
    const t = norm(text);
    if (!q || !t) return 0;
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    const at = t.indexOf(q);
    if (at > 0 && /[^a-z0-9]/.test(t[at - 1])) return 60;
    if (at > 0) return 40;
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every(function (w) { return t.includes(w); })) return 30;
    if (exact) return 0;
    // Letters in order. Tighter runs score higher, up to 20.
    let ti = 0;
    let first = -1;
    for (let qi = 0; qi < q.length; qi++) {
      const ch = q[qi];
      if (ch === " ") continue;
      const found = t.indexOf(ch, ti);
      if (found === -1) return 0;
      if (first === -1) first = found;
      ti = found + 1;
    }
    const span = ti - first;
    const letters = q.replace(/\s+/g, "").length;
    return 10 + Math.round(10 * letters / Math.max(span, letters));
  }

  // The best match among the item's title, keywords and subtitle. Titles count
  // most; a URL or description in the subtitle counts least, and only for
  // whole words or runs of letters.
  function scoreItem(query, item) {
    if (!item) return 0;
    let best = matchScore(query, item.title);
    (Array.isArray(item.keywords) ? item.keywords : []).forEach(function (k) {
      best = Math.max(best, matchScore(query, k) * 0.9);
    });
    best = Math.max(best, matchScore(query, item.subtitle, true) * 0.7);
    return best;
  }

  // The items to list for a query, best first. With no query, every item in
  // the order given (the caller orders the groups). Pinned items stay on top
  // whatever the query, and nothing past limit is returned.
  function rankItems(query, items, limit) {
    const max = typeof limit === "number" && limit > 0 ? limit : MAX_RESULTS;
    const list = (Array.isArray(items) ? items : []).filter(function (it) {
      return it && typeof it.title === "string" && it.title !== "" && typeof it.run === "function";
    });
    const pinned = list.filter(function (it) { return it.pinned; });
    const rest = list.filter(function (it) { return !it.pinned; });
    const q = norm(query);
    if (!q) return pinned.concat(rest).slice(0, max);
    const scored = rest.map(function (it, i) { return { it, i, s: scoreItem(q, it) }; })
      .filter(function (x) { return x.s > 0; });
    scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    return pinned.concat(scored.map(function (x) { return x.it; })).slice(0, max);
  }

  // A command a plugin registered, checked and copied, or null when it isn't
  // usable. id: [a-z0-9:_.-], up to 100 characters; title: required.
  function sanitizeCommand(opts, prefix) {
    if (!opts || typeof opts !== "object") return null;
    const id = typeof opts.id === "string" ? opts.id : "";
    if (!/^[a-z0-9][a-z0-9:_.-]{0,99}$/i.test(id)) return null;
    if (typeof opts.title !== "string" || opts.title.trim() === "") return null;
    if (typeof opts.run !== "function") return null;
    const clip = function (s, n) { return typeof s === "string" ? s.slice(0, n) : ""; };
    return {
      id: (prefix || "") + id,
      title: clip(opts.title.trim(), 200),
      subtitle: clip(opts.subtitle, 300),
      group: clip(opts.group, 40) || "Commands",
      keywords: (Array.isArray(opts.keywords) ? opts.keywords : [])
        .filter(function (k) { return typeof k === "string"; }).slice(0, 20)
        .map(function (k) { return k.slice(0, 100); }),
      shortcut: clip(opts.shortcut, 40),
      run: opts.run,
      runInNewTab: typeof opts.runInNewTab === "function" ? opts.runInNewTab : undefined,
    };
  }

  // ------------------------------------------------------------------
  // The palette on screen. elements: { overlay, input, list, hint }.
  // getItems(query) returns { items, more } where more is an optional list of
  // promises for items that arrive later (plugin providers that search).
  function create(elements, getItems) {
    const overlay = elements.overlay;
    const input = elements.input;
    const list = elements.list;
    let shown = [];
    let selected = 0;
    let query = "";
    let token = 0;
    let extra = [];        // items from providers that answered late
    let base = [];         // items available right away
    let returnFocus = null;

    function isOpen() { return overlay.classList.contains("visible"); }

    function render() {
      shown = rankItems(query, base.concat(extra));
      if (selected >= shown.length) selected = Math.max(0, shown.length - 1);
      list.textContent = "";
      if (shown.length === 0) {
        const empty = document.createElement("div");
        empty.className = "command-palette-empty";
        empty.textContent = query ? "Nothing matches \"" + query + "\"" : "Nothing to show";
        list.appendChild(empty);
        input.removeAttribute("aria-activedescendant");
        return;
      }
      let lastGroup = null;
      shown.forEach(function (item, i) {
        const group = item.group || "Commands";
        // Group headings only make sense while the list isn't ranked by match.
        if (!query && group !== lastGroup) {
          const head = document.createElement("div");
          head.className = "command-palette-group";
          head.textContent = group;
          head.setAttribute("role", "presentation");
          list.appendChild(head);
          lastGroup = group;
        }
        const row = document.createElement("div");
        row.className = "command-palette-item" + (i === selected ? " selected" : "");
        row.id = "command-palette-item-" + i;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", i === selected ? "true" : "false");
        const text = document.createElement("div");
        text.className = "command-palette-text";
        const title = document.createElement("div");
        title.className = "command-palette-title";
        title.textContent = item.title;
        text.appendChild(title);
        if (item.subtitle) {
          const sub = document.createElement("div");
          sub.className = "command-palette-subtitle";
          sub.textContent = item.subtitle;
          text.appendChild(sub);
        }
        row.appendChild(text);
        const meta = document.createElement("div");
        meta.className = "command-palette-meta";
        meta.textContent = item.shortcut || (query ? group : "");
        row.appendChild(meta);
        row.addEventListener("mousemove", function () {
          if (selected !== i) { selected = i; markSelected(); }
        });
        row.addEventListener("mousedown", function (e) { e.preventDefault(); });
        row.addEventListener("click", function (e) { choose(i, e.ctrlKey || e.metaKey || e.button === 1); });
        list.appendChild(row);
      });
      markSelected();
    }

    function markSelected() {
      Array.prototype.forEach.call(list.querySelectorAll(".command-palette-item"), function (row) {
        const on = row.id === "command-palette-item-" + selected;
        row.classList.toggle("selected", on);
        row.setAttribute("aria-selected", on ? "true" : "false");
        if (on) {
          input.setAttribute("aria-activedescendant", row.id);
          row.scrollIntoView({ block: "nearest" });
        }
      });
    }

    function refresh() {
      const my = ++token;
      extra = [];
      let res;
      try { res = getItems(query) || {}; } catch (err) {
        console.error("[Palette] Gathering items failed:", err);
        res = {};
      }
      base = Array.isArray(res.items) ? res.items : [];
      render();
      (Array.isArray(res.more) ? res.more : []).forEach(function (p) {
        Promise.resolve(p).then(function (items) {
          if (my !== token || !isOpen() || !Array.isArray(items) || items.length === 0) return;
          extra = extra.concat(items);
          render();
        }).catch(function (err) { console.error("[Palette] Provider failed:", err); });
      });
    }

    function open(text) {
      if (!isOpen()) {
        returnFocus = document.activeElement;
        overlay.classList.add("visible");
      }
      input.value = typeof text === "string" ? text.slice(0, MAX_QUERY) : "";
      query = input.value.trim();
      selected = 0;
      refresh();
      input.focus();
      input.select();
    }

    function close(restoreFocus) {
      if (!isOpen()) return;
      overlay.classList.remove("visible");
      token++;
      list.textContent = "";
      base = [];
      extra = [];
      shown = [];
      const back = returnFocus;
      returnFocus = null;
      if (restoreFocus !== false && back && typeof back.focus === "function" && document.contains(back)) {
        try { back.focus(); } catch { /* gone */ }
      }
    }

    function toggle() { if (isOpen()) close(); else open(""); }

    function choose(index, newTab) {
      const item = shown[index];
      if (!item) return;
      // Close first, so whatever the command focuses (a page, the address bar,
      // a side panel input) keeps the focus.
      close(false);
      try {
        if (newTab && item.runInNewTab) item.runInNewTab();
        else item.run();
      } catch (err) {
        console.error("[Palette] \"" + item.title + "\" failed:", err);
      }
    }

    input.addEventListener("input", function () {
      query = input.value.slice(0, MAX_QUERY).trim();
      selected = 0;
      refresh();
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (shown.length === 0) return;
        selected = (selected + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
        markSelected();
      } else if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        if (shown.length === 0) return;
        selected = Math.min(shown.length - 1, Math.max(0, selected + (e.key === "PageDown" ? 8 : -8)));
        markSelected();
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(selected, e.ctrlKey || e.metaKey || e.shiftKey);
      } else if (e.key === "Escape") {
        // Stop here, so the window's own Escape handling (find bar, menus) doesn't run too.
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });

    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) { e.preventDefault(); close(); }
    });

    return { open, close, toggle, isOpen, refresh: function () { if (isOpen()) refresh(); } };
  }

  const api = { matchScore, scoreItem, rankItems, sanitizeCommand, create, MAX_RESULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CommandPalette = api;
})(typeof window !== "undefined" ? window : globalThis);
