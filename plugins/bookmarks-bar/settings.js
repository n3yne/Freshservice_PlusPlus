// Bookmarks Bar plugin — Settings window panel
// Lists the bookmarks with add, edit, delete (with a confirmation), move up and
// down, and drag to reorder. Saves the whole list to bookmarksBarItems.
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  const MAX_BOOKMARKS = 500;
  const MAX_TITLE = 200;

  function isWebUrl(url) {
    try {
      const p = new URL(url);
      return (p.protocol === "http:" || p.protocol === "https:") && Boolean(p.hostname);
    } catch { return false; }
  }

  // "example.com" → "https://example.com/". Returns null when it isn't a web address.
  function parseUrl(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 2048 || /\s/.test(t)) return null;
    if (isWebUrl(t)) return new URL(t).href;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null; // some other scheme
    const host = t.split(/[/?#]/)[0].replace(/:\d+$/, "");
    const local = /^(localhost|127(\.\d{1,3}){3})$/i.test(host);
    if (!local && !/^[^.\s]+(\.[^.\s]+)+$/.test(host)) return null;
    const url = (local ? "http://" : "https://") + t;
    return isWebUrl(url) ? new URL(url).href : null;
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

  function hostOf(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  settingsAPI.addPanel("bookmarks-bar", "Bookmarks Bar", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Bookmarks Bar</h3>' +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="plugin-bm-visible" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Show the bookmarks bar</span>' +
      "  </label>" +
      '  <p class="settings-description">' +
      "    The bar sits under the address bar. Click a bookmark to open it in the current tab, middle-click for a new tab, " +
      "    or right-click for more. Drag bookmarks on the bar, or here, to change their order. To bookmark a page, right-click " +
      "    its tab and choose <strong>Save to Bookmarks Bar</strong>." +
      "  </p>" +
      "</div>" +
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Bookmarks</h3>' +
      '  <ul id="plugin-bm-list" class="bm-settings-list"></ul>' +
      '  <p id="plugin-bm-empty" class="settings-description" hidden>No bookmarks yet.</p>' +
      '  <div class="bm-settings-add">' +
      '    <input type="text" id="plugin-bm-new-title" class="settings-text-input" placeholder="Name" maxlength="' + MAX_TITLE + '" spellcheck="false" autocomplete="off" />' +
      '    <input type="text" id="plugin-bm-new-url" class="settings-text-input" placeholder="https://example.com" maxlength="2048" spellcheck="false" autocomplete="off" />' +
      '    <button type="button" id="plugin-bm-add" class="btn btn-small btn-primary">Add</button>' +
      "  </div>" +
      '  <p id="plugin-bm-status" class="settings-description bm-settings-status"></p>' +
      "</div>";

    const visibleInput = panel.querySelector("#plugin-bm-visible");
    const listEl = panel.querySelector("#plugin-bm-list");
    const emptyEl = panel.querySelector("#plugin-bm-empty");
    const newTitle = panel.querySelector("#plugin-bm-new-title");
    const newUrl = panel.querySelector("#plugin-bm-new-url");
    const addBtn = panel.querySelector("#plugin-bm-add");
    const statusEl = panel.querySelector("#plugin-bm-status");

    let items = [];
    let editingId = null;
    let confirmingId = null;

    function setStatus(text, isError) {
      statusEl.textContent = text || "";
      statusEl.classList.toggle("bm-settings-error", !!isError);
    }

    function save(next) {
      const previous = items;
      items = next;
      render();
      return Promise.resolve(settingsAPI.saveSettings({ bookmarksBarItems: items })).then(function (res) {
        if (res && res.success === false) throw new Error(res.error || "rejected");
        setStatus("");
      }).catch(function (err) {
        console.error("[Bookmarks Bar] Save failed:", err);
        items = previous;
        render();
        setStatus("The bookmarks couldn't be saved.", true);
      });
    }

    function move(from, to) {
      if (to < 0 || to >= items.length || from === to) return;
      const next = items.slice();
      const moved = next.splice(from, 1)[0];
      next.splice(to, 0, moved);
      save(next);
    }

    function button(label, title, onClick, extra) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small" + (extra ? " " + extra : "");
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", onClick);
      return b;
    }

    function renderEditRow(li, b) {
      li.classList.add("bm-settings-editing");
      li.draggable = false;
      const t = document.createElement("input");
      t.type = "text";
      t.className = "settings-text-input";
      t.value = b.title;
      t.maxLength = MAX_TITLE;
      t.placeholder = "Name";
      t.spellcheck = false;
      const u = document.createElement("input");
      u.type = "text";
      u.className = "settings-text-input";
      u.value = b.url;
      u.maxLength = 2048;
      u.placeholder = "https://example.com";
      u.spellcheck = false;
      function commit() {
        const url = parseUrl(u.value);
        if (!url) { u.classList.add("invalid"); setStatus("Enter a web address, such as https://example.com", true); u.focus(); return; }
        editingId = null;
        save(items.map(function (x) { return x.id === b.id ? { id: x.id, title: t.value.trim().slice(0, MAX_TITLE), url: url } : x; }));
      }
      function cancel() { editingId = null; setStatus(""); render(); }
      [t, u].forEach(function (input) {
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        });
      });
      const fields = document.createElement("div");
      fields.className = "bm-settings-fields";
      fields.appendChild(t);
      fields.appendChild(u);
      const actions = document.createElement("div");
      actions.className = "bm-settings-actions";
      actions.appendChild(button("Save", "Save changes", commit, "btn-primary"));
      actions.appendChild(button("Cancel", "Discard changes", cancel));
      li.appendChild(fields);
      li.appendChild(actions);
      setTimeout(function () { t.focus(); t.select(); }, 0);
    }

    function render() {
      listEl.textContent = "";
      emptyEl.hidden = items.length > 0;
      items.forEach(function (b, i) {
        const li = document.createElement("li");
        li.className = "bm-settings-row";
        li.dataset.id = b.id;

        if (b.id === editingId) { renderEditRow(li, b); listEl.appendChild(li); return; }

        li.draggable = true;
        const handle = document.createElement("span");
        handle.className = "bm-settings-handle";
        handle.textContent = "⋮⋮";
        handle.title = "Drag to reorder";
        const text = document.createElement("div");
        text.className = "bm-settings-text";
        const name = document.createElement("div");
        name.className = "bm-settings-name";
        name.textContent = b.title || hostOf(b.url);
        const url = document.createElement("div");
        url.className = "bm-settings-url";
        url.textContent = b.url;
        text.appendChild(name);
        text.appendChild(url);
        li.appendChild(handle);
        li.appendChild(text);

        const actions = document.createElement("div");
        actions.className = "bm-settings-actions";
        if (b.id === confirmingId) {
          const q = document.createElement("span");
          q.className = "bm-settings-confirm";
          q.textContent = "Delete this bookmark?";
          actions.appendChild(q);
          actions.appendChild(button("Delete", "Delete this bookmark", function () {
            confirmingId = null;
            save(items.filter(function (x) { return x.id !== b.id; }));
          }, "btn-warning"));
          actions.appendChild(button("Cancel", "Keep this bookmark", function () { confirmingId = null; render(); }));
        } else {
          const up = button("↑", "Move up", function () { move(i, i - 1); });
          up.disabled = i === 0;
          const down = button("↓", "Move down", function () { move(i, i + 1); });
          down.disabled = i === items.length - 1;
          actions.appendChild(up);
          actions.appendChild(down);
          actions.appendChild(button("Edit", "Edit this bookmark", function () { editingId = b.id; confirmingId = null; render(); }));
          actions.appendChild(button("Delete", "Delete this bookmark", function () { confirmingId = b.id; editingId = null; render(); }));
        }
        li.appendChild(actions);
        listEl.appendChild(li);
      });
    }

    // Drag rows to reorder.
    let draggedId = null;
    function clearMarks() {
      listEl.querySelectorAll(".bm-drop-before, .bm-drop-after").forEach(function (el) {
        el.classList.remove("bm-drop-before", "bm-drop-after");
      });
    }
    listEl.addEventListener("dragstart", function (e) {
      const li = e.target.closest(".bm-settings-row");
      if (!li || !li.draggable) return;
      draggedId = li.dataset.id;
      li.classList.add("bm-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", draggedId);
    });
    listEl.addEventListener("dragend", function (e) {
      const li = e.target.closest(".bm-settings-row");
      if (li) li.classList.remove("bm-dragging");
      draggedId = null;
      clearMarks();
    });
    listEl.addEventListener("dragover", function (e) {
      if (!draggedId) return;
      const li = e.target.closest(".bm-settings-row");
      if (!li) return;
      e.preventDefault();
      clearMarks();
      if (li.dataset.id === draggedId) return;
      const rect = li.getBoundingClientRect();
      li.classList.add(e.clientY < rect.top + rect.height / 2 ? "bm-drop-before" : "bm-drop-after");
    });
    listEl.addEventListener("drop", function (e) {
      if (!draggedId) return;
      e.preventDefault();
      const li = e.target.closest(".bm-settings-row");
      const fromId = draggedId;
      draggedId = null;
      clearMarks();
      if (!li || li.dataset.id === fromId) return;
      const rect = li.getBoundingClientRect();
      const after = e.clientY >= rect.top + rect.height / 2;
      const from = items.findIndex(function (b) { return b.id === fromId; });
      if (from === -1) return;
      const next = items.slice();
      const moved = next.splice(from, 1)[0];
      let to = next.findIndex(function (b) { return b.id === li.dataset.id; });
      if (after) to += 1;
      next.splice(to, 0, moved);
      save(next);
    });

    function add() {
      const url = parseUrl(newUrl.value);
      if (!url) {
        newUrl.classList.add("invalid");
        setStatus("Enter a web address, such as https://example.com", true);
        newUrl.focus();
        return;
      }
      if (items.length >= MAX_BOOKMARKS) { setStatus("You can have up to " + MAX_BOOKMARKS + " bookmarks.", true); return; }
      newUrl.classList.remove("invalid");
      const title = newTitle.value.trim().slice(0, MAX_TITLE);
      newTitle.value = "";
      newUrl.value = "";
      save(items.concat([{ id: newId(), title: title, url: url }]));
      newTitle.focus();
    }
    addBtn.addEventListener("click", add);
    [newTitle, newUrl].forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); add(); }
      });
    });
    newUrl.addEventListener("input", function () { newUrl.classList.remove("invalid"); });

    visibleInput.addEventListener("change", function () {
      settingsAPI.saveSettings({ bookmarksBarVisible: visibleInput.checked });
    });

    function populate(s) {
      if (!s) return;
      visibleInput.checked = s.bookmarksBarVisible !== false;
      if (Array.isArray(s.bookmarksBarItems)) {
        items = sanitize(s.bookmarksBarItems);
        // A row being edited or confirmed may have been removed elsewhere.
        if (editingId && !items.some(function (b) { return b.id === editingId; })) editingId = null;
        if (confirmingId && !items.some(function (b) { return b.id === confirmingId; })) confirmingId = null;
        render();
      }
    }

    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);
  });
})();
