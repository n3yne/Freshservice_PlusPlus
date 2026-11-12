// Bookmarks Bar plugin — main window renderer
// A row of bookmarked sites under the address bar.
//   Left click: open in this tab (Ctrl+click: new tab, Shift+click: new window)
//   Middle click: open in a new tab in the background
//   Right click: Open site / in new tab / in new window / Edit / Delete
//   Drag a bookmark along the bar to reorder it.
// The tab menu gets "Save to Bookmarks Bar". The list is the bookmarksBarItems
// setting, also edited in Settings → Bookmarks Bar.
(function () {
  const api = window.pluginAPI;
  const addressBar = document.getElementById("address-bar");
  if (!api || !addressBar) return;

  const MAX_BOOKMARKS = 500;
  const MAX_TITLE = 200;

  let settings = api.getSettings();
  let items = sanitize(settings.bookmarksBarItems);
  let visible = settings.bookmarksBarVisible !== false;

  // ---------- helpers ----------

  function isWebUrl(url) {
    try {
      const p = new URL(url);
      return (p.protocol === "http:" || p.protocol === "https:") && Boolean(p.hostname);
    } catch { return false; }
  }

  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (b) {
      return b && typeof b.id === "string" && typeof b.url === "string" && isWebUrl(b.url);
    }).map(function (b) {
      return { id: b.id, title: typeof b.title === "string" ? b.title : "", url: b.url };
    });
  }

  function newId() {
    return "bm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function displayTitle(b) {
    if (b.title) return b.title;
    try { return new URL(b.url).hostname; } catch { return b.url; }
  }

  function findItem(id) {
    return items.find(function (b) { return b.id === id; }) || null;
  }

  // Moves the bookmark with id fromId before (or after) the one with id toId.
  function moveItem(list, fromId, toId, after) {
    const from = list.findIndex(function (b) { return b.id === fromId; });
    if (from === -1 || fromId === toId) return list;
    const copy = list.slice();
    const moved = copy.splice(from, 1)[0];
    let to = toId ? copy.findIndex(function (b) { return b.id === toId; }) : copy.length;
    if (to === -1) to = copy.length;
    else if (after) to += 1;
    copy.splice(to, 0, moved);
    return copy;
  }

  // ---------- saving ----------

  function save(next) {
    const previous = items;
    items = next;
    render();
    // Send only this key: this window's copy of the other settings can be out of date.
    return window.backupAPI.saveSettings({ bookmarksBarItems: items }).then(function (res) {
      if (res && res.success === false) throw new Error((res && res.error) || "rejected");
    }).catch(function (err) {
      console.error("[Bookmarks Bar] Save failed:", err);
      items = previous;
      render();
      api.ui.notify({ type: "bookmarks-bar-save", title: "Bookmark not saved", desc: "The bookmarks couldn't be saved. Check the address and try again." });
    });
  }

  function addBookmark(title, url, index) {
    if (!isWebUrl(url)) return Promise.resolve(null);
    if (items.length >= MAX_BOOKMARKS) {
      api.ui.notify({ type: "bookmarks-bar-full", title: "Bookmarks bar is full", desc: "Delete a bookmark to make room (" + MAX_BOOKMARKS + " at most)." });
      return Promise.resolve(null);
    }
    const b = { id: newId(), title: String(title || "").trim().slice(0, MAX_TITLE), url: url };
    const next = items.slice();
    if (typeof index === "number" && index >= 0 && index <= next.length) next.splice(index, 0, b);
    else next.push(b);
    return save(next).then(function () { return b; });
  }

  // ---------- the bar ----------

  const bar = document.createElement("div");
  bar.id = "bookmarks-bar";
  bar.className = "bookmarks-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Bookmarks");
  bar.innerHTML =
    '<div class="bm-items"></div>' +
    '<button type="button" class="bm-overflow" title="More bookmarks" hidden>&raquo;</button>';
  addressBar.insertAdjacentElement("afterend", bar);

  const itemsEl = bar.querySelector(".bm-items");
  const overflowBtn = bar.querySelector(".bm-overflow");
  let overflowIds = [];

  function faviconFor(url) {
    try { return new URL(url).origin + "/favicon.ico"; } catch { return ""; }
  }

  function makeIcon(url) {
    const icon = document.createElement("span");
    icon.className = "bm-icon";
    const src = faviconFor(url);
    if (src) {
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", function () { img.remove(); icon.classList.add("bm-icon-default"); });
      img.src = src;
      icon.appendChild(img);
    } else {
      icon.classList.add("bm-icon-default");
    }
    return icon;
  }

  function render() {
    bar.hidden = !visible;
    itemsEl.textContent = "";
    if (!items.length) {
      const hint = document.createElement("span");
      hint.className = "bm-empty";
      hint.textContent = "No bookmarks yet. Right-click a tab and choose Save to Bookmarks Bar, or right-click here to add one.";
      itemsEl.appendChild(hint);
    }
    items.forEach(function (b) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "bm-item";
      el.dataset.id = b.id;
      el.draggable = true;
      el.title = displayTitle(b) + "\n" + b.url;
      el.appendChild(makeIcon(b.url));
      const label = document.createElement("span");
      label.className = "bm-label";
      label.textContent = displayTitle(b);
      el.appendChild(label);
      itemsEl.appendChild(el);
    });
    layout();
  }

  // Hides bookmarks that don't fit and lists them under the » button.
  function layout() {
    overflowIds = [];
    const buttons = itemsEl.querySelectorAll(".bm-item");
    buttons.forEach(function (el) { el.classList.remove("bm-hidden"); });
    if (bar.hidden || !buttons.length) { overflowBtn.hidden = true; return; }
    overflowBtn.hidden = false; // reserve its space while measuring
    // Measure everything first, then hide from the first one that doesn't fit,
    // so the bar keeps its order.
    const limit = itemsEl.clientWidth;
    const firstHidden = Array.prototype.findIndex.call(buttons, function (el) {
      return el.offsetLeft + el.offsetWidth > limit + 1;
    });
    if (firstHidden !== -1) {
      Array.prototype.slice.call(buttons, firstHidden).forEach(function (el) {
        el.classList.add("bm-hidden");
        overflowIds.push(el.dataset.id);
      });
    }
    overflowBtn.hidden = overflowIds.length === 0;
  }

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(function () { layout(); }).observe(bar);
  } else {
    window.addEventListener("resize", layout);
  }

  // ---------- opening ----------

  function open(b, where) {
    if (!b || !isWebUrl(b.url)) return;
    if (where === "tab") api.browser.newTab(b.url, { activate: true });
    else if (where === "background") api.browser.newTab(b.url, { activate: false });
    else if (where === "window") api.browser.newWindow(b.url);
    else api.browser.navigate(b.url);
  }

  function itemFromEvent(e) {
    const el = e.target.closest("[data-id]");
    return el ? findItem(el.dataset.id) : null;
  }

  bar.addEventListener("click", function (e) {
    if (e.button !== 0) return;
    if (e.target.closest(".bm-overflow")) { showOverflowMenu(); return; }
    const b = itemFromEvent(e);
    if (!b) return;
    if (e.ctrlKey || e.metaKey) open(b, "background");
    else if (e.shiftKey) open(b, "window");
    else open(b, "current");
  });

  // Stop the middle-button autoscroll cursor; auxclick does the work.
  bar.addEventListener("mousedown", function (e) {
    if (e.button === 1 && e.target.closest(".bm-item")) e.preventDefault();
  });
  bar.addEventListener("auxclick", function (e) {
    if (e.button !== 1) return;
    const b = itemFromEvent(e);
    if (b) { e.preventDefault(); open(b, "background"); }
  });

  bar.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    const b = itemFromEvent(e);
    if (b) showItemMenu(b, e.clientX, e.clientY);
    else if (!e.target.closest(".bm-overflow")) showBarMenu(e.clientX, e.clientY);
  });

  // ---------- drag to reorder ----------

  let draggedId = null;

  function clearDropMarks() {
    bar.querySelectorAll(".bm-drop-before, .bm-drop-after").forEach(function (el) {
      el.classList.remove("bm-drop-before", "bm-drop-after");
    });
    itemsEl.classList.remove("bm-drop-end");
  }

  itemsEl.addEventListener("dragstart", function (e) {
    const el = e.target.closest(".bm-item");
    if (!el) return;
    const b = findItem(el.dataset.id);
    draggedId = el.dataset.id;
    el.classList.add("bm-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", b ? b.url : "");
  });

  itemsEl.addEventListener("dragend", function (e) {
    const el = e.target.closest(".bm-item");
    if (el) el.classList.remove("bm-dragging");
    draggedId = null;
    clearDropMarks();
  });

  itemsEl.addEventListener("dragover", function (e) {
    if (!draggedId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const el = e.target.closest(".bm-item");
    clearDropMarks();
    if (!el) { itemsEl.classList.add("bm-drop-end"); return; }
    if (el.dataset.id === draggedId) return;
    const rect = el.getBoundingClientRect();
    el.classList.add(e.clientX < rect.left + rect.width / 2 ? "bm-drop-before" : "bm-drop-after");
  });

  itemsEl.addEventListener("dragleave", function (e) {
    if (!itemsEl.contains(e.relatedTarget)) clearDropMarks();
  });

  itemsEl.addEventListener("drop", function (e) {
    if (!draggedId) return;
    e.preventDefault();
    const fromId = draggedId;
    draggedId = null;
    clearDropMarks();
    const el = e.target.closest(".bm-item");
    let next;
    if (!el) {
      next = moveItem(items, fromId, null, false);
    } else {
      if (el.dataset.id === fromId) return;
      const rect = el.getBoundingClientRect();
      next = moveItem(items, fromId, el.dataset.id, e.clientX >= rect.left + rect.width / 2);
    }
    const changed = next.some(function (b, i) { return b.id !== items[i].id; });
    if (changed) save(next);
  });

  // ---------- menus ----------

  // A transparent layer under the menu catches clicks anywhere else, including
  // over a page (clicks in a webview never reach this document).
  const backdrop = document.createElement("div");
  backdrop.className = "bm-backdrop";
  backdrop.hidden = true;
  const menu = document.createElement("div");
  menu.className = "context-menu bm-menu";
  menu.setAttribute("role", "menu");
  document.body.appendChild(backdrop);
  document.body.appendChild(menu);

  function hideMenu() {
    menu.classList.remove("visible");
    menu.textContent = "";
    backdrop.hidden = true;
  }

  backdrop.addEventListener("mousedown", function (e) { e.preventDefault(); hideMenu(); });
  backdrop.addEventListener("contextmenu", function (e) { e.preventDefault(); hideMenu(); });
  window.addEventListener("blur", hideMenu);
  window.addEventListener("resize", hideMenu);

  // entries: [{ label, onClick, danger? } | "-" ]
  function showMenu(entries, x, y) {
    hideMenu();
    entries.forEach(function (entry) {
      if (entry === "-") {
        const sep = document.createElement("div");
        sep.className = "context-menu-separator";
        menu.appendChild(sep);
        return;
      }
      const el = document.createElement("div");
      el.className = "context-menu-item" + (entry.danger ? " bm-menu-danger" : "");
      el.setAttribute("role", "menuitem");
      el.textContent = entry.label;
      if (entry.title) el.title = entry.title;
      el.addEventListener("click", function () {
        hideMenu();
        try { entry.onClick(); } catch (err) { console.error("[Bookmarks Bar]", err); }
      });
      menu.appendChild(el);
    });
    backdrop.hidden = false;
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.classList.add("visible");
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - rect.width - 4) + "px";
    if (rect.bottom > window.innerHeight) menu.style.top = Math.max(4, window.innerHeight - rect.height - 4) + "px";
  }

  function showItemMenu(b, x, y) {
    showMenu([
      { label: "Open site", onClick: function () { open(b, "current"); } },
      { label: "Open site in new tab", onClick: function () { open(b, "tab"); } },
      { label: "Open site in new window", onClick: function () { open(b, "window"); } },
      "-",
      { label: "Edit bookmark…", onClick: function () { editBookmark(b); } },
      { label: "Delete bookmark", danger: true, onClick: function () { deleteBookmark(b); } },
    ], x, y);
  }

  function showBarMenu(x, y) {
    const active = api.browser.getActiveTab();
    let activeUrl = "";
    if (active) try { activeUrl = active.webview.getURL(); } catch { /* not ready */ }
    const entries = [];
    if (isWebUrl(activeUrl)) {
      entries.push({ label: "Bookmark this page", onClick: function () { saveTab(activeTabInfo()); } });
    }
    entries.push({ label: "Add bookmark…", onClick: function () { newBookmark(); } });
    entries.push("-");
    entries.push({ label: "Manage bookmarks…", onClick: function () { window.backupAPI.openSettingsWindow(); } });
    entries.push({ label: "Hide bookmarks bar", onClick: hideBar });
    showMenu(entries, x, y);
  }

  function showOverflowMenu() {
    const rect = overflowBtn.getBoundingClientRect();
    const entries = overflowIds.map(function (id) {
      const b = findItem(id);
      return b ? { label: displayTitle(b), title: b.url, onClick: function () { open(b, "current"); } } : null;
    }).filter(Boolean);
    if (entries.length) showMenu(entries, rect.left, rect.bottom);
  }

  function hideBar() {
    visible = false;
    render();
    window.backupAPI.saveSettings({ bookmarksBarVisible: false });
    api.ui.notify({
      type: "bookmarks-bar-hidden",
      title: "Bookmarks bar hidden",
      desc: "Turn it back on in Settings → Bookmarks Bar.",
      action: { label: "Show it again", onClick: function () {
        visible = true;
        render();
        window.backupAPI.saveSettings({ bookmarksBarVisible: true });
      } },
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu.classList.contains("visible")) hideMenu();
  });

  // ---------- delete ----------

  function deleteBookmark(b) {
    api.ui.confirm('Delete the bookmark "' + displayTitle(b) + '"?').then(function (ok) {
      if (!ok) return;
      save(items.filter(function (x) { return x.id !== b.id; }));
    });
  }

  // ---------- add / edit dialog ----------

  const dialog = document.createElement("div");
  dialog.className = "confirm-overlay bm-dialog-overlay";
  dialog.innerHTML =
    '<div class="confirm-dialog bm-dialog" role="dialog" aria-modal="true">' +
    '  <h3 class="bm-dialog-title"></h3>' +
    '  <label class="bm-dialog-label">Name<input type="text" class="bm-dialog-input" name="title" maxlength="' + MAX_TITLE + '" spellcheck="false" /></label>' +
    '  <label class="bm-dialog-label">URL<input type="text" class="bm-dialog-input" name="url" maxlength="2048" spellcheck="false" placeholder="https://example.com" /></label>' +
    '  <p class="bm-dialog-error" hidden>Enter a web address, such as https://example.com</p>' +
    '  <div class="confirm-buttons">' +
    '    <button type="button" class="btn btn-primary bm-dialog-save">Save</button>' +
    '    <button type="button" class="btn btn-secondary bm-dialog-cancel">Cancel</button>' +
    "  </div>" +
    "</div>";
  document.body.appendChild(dialog);
  const dialogTitle = dialog.querySelector(".bm-dialog-title");
  const titleInput = dialog.querySelector('input[name="title"]');
  const urlInput = dialog.querySelector('input[name="url"]');
  const dialogError = dialog.querySelector(".bm-dialog-error");
  let dialogDone = null;

  function parseUrl(text) {
    if (window.AddressBar && typeof window.AddressBar.parseAddress === "function") {
      return window.AddressBar.parseAddress(text);
    }
    return isWebUrl(String(text || "").trim()) ? String(text).trim() : null;
  }

  // Resolves { title, url } or null when cancelled.
  function openDialog(heading, title, url) {
    if (dialogDone) dialogDone(null);
    dialogTitle.textContent = heading;
    titleInput.value = title || "";
    urlInput.value = url || "";
    dialogError.hidden = true;
    urlInput.classList.remove("invalid");
    dialog.classList.add("visible");
    // A focused page keeps keyboard focus unless the window takes it back.
    const active = api.browser.getActiveTab();
    if (active) try { active.webview.blur(); } catch { /* ignore */ }
    window.focus();
    (title || !url ? titleInput : urlInput).focus();
    titleInput.select();
    return new Promise(function (resolve) { dialogDone = resolve; });
  }

  function closeDialog(result) {
    dialog.classList.remove("visible");
    const done = dialogDone;
    dialogDone = null;
    if (done) done(result);
  }

  function submitDialog() {
    const url = parseUrl(urlInput.value);
    if (!url) {
      dialogError.hidden = false;
      urlInput.classList.add("invalid");
      urlInput.focus();
      return;
    }
    closeDialog({ title: titleInput.value.trim().slice(0, MAX_TITLE), url: url });
  }
  dialog.querySelector(".bm-dialog-save").addEventListener("click", submitDialog);
  dialog.querySelector(".bm-dialog-cancel").addEventListener("click", function () { closeDialog(null); });
  dialog.addEventListener("mousedown", function (e) { if (e.target === dialog) closeDialog(null); });
  dialog.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.stopPropagation(); closeDialog(null); }
    else if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); submitDialog(); }
  });

  function editBookmark(b) {
    openDialog("Edit bookmark", b.title, b.url).then(function (res) {
      if (!res) return;
      const next = items.map(function (x) { return x.id === b.id ? { id: x.id, title: res.title, url: res.url } : x; });
      save(next);
    });
  }

  function newBookmark() {
    openDialog("Add bookmark", "", "").then(function (res) {
      if (res) addBookmark(res.title, res.url);
    });
  }

  // ---------- tab menu: Save to Bookmarks Bar ----------

  function activeTabInfo() {
    const active = api.browser.getActiveTab();
    if (!active) return null;
    let url = "";
    let title = "";
    try { url = active.webview.getURL(); title = active.webview.getTitle(); } catch { /* not ready */ }
    return { url: url, title: title };
  }

  function flash(id) {
    const el = itemsEl.querySelector('[data-id="' + id + '"]');
    if (!el) return;
    el.classList.add("bm-flash");
    setTimeout(function () { el.classList.remove("bm-flash"); }, 1200);
  }

  function saveTab(tab) {
    if (!tab || !isWebUrl(tab.url)) return;
    // Already on the bar: point it out instead of adding it twice.
    const existing = items.find(function (b) { return b.url === tab.url; });
    if (existing) { flash(existing.id); return; }
    if (!visible) {
      visible = true;
      window.backupAPI.saveSettings({ bookmarksBarVisible: true });
    }
    addBookmark(tab.title, tab.url).then(function (b) { if (b) flash(b.id); });
  }

  if (typeof api.ui.addTabMenuItem === "function") {
    api.ui.addTabMenuItem({
      id: "bookmarks-bar-save",
      icon: "⭐",
      label: "Save to Bookmarks Bar",
      isVisible: function (tab) { return !!tab && isWebUrl(tab.url); },
      onClick: saveTab,
    });
  }

  // ---------- command palette (Ctrl+K) ----------
  // Every bookmark is searchable there: Enter opens it in this tab, Ctrl+Enter
  // in a new tab.
  if (api.commands && typeof api.commands.addProvider === "function") {
    api.commands.addProvider({
      id: "bookmarks-bar",
      group: "Bookmarks",
      items: function () {
        return items.map(function (b) {
          let host = "";
          try { host = new URL(b.url).hostname; } catch { /* checked by sanitize */ }
          return {
            id: b.id,
            title: displayTitle(b),
            subtitle: b.url,
            keywords: host ? [host, "bookmark"] : ["bookmark"],
            run: function () { open(b, "current"); },
            runInNewTab: function () { open(b, "tab"); },
          };
        });
      },
    });
  }

  // ---------- settings from other windows ----------

  api.events.on("settings:changed", function (s) {
    if (!s) return;
    settings = s;
    if (Array.isArray(s.bookmarksBarItems)) items = sanitize(s.bookmarksBarItems);
    if (typeof s.bookmarksBarVisible === "boolean") visible = s.bookmarksBarVisible;
    render();
  });

  render();
})();
