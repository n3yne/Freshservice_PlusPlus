// Canned Responses plugin — Settings window panel
// Your name (for {{agent}}), and the list of responses with add, edit, delete
// (asks first) and move up/down. Saves the whole list to cannedResponses.
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  const MAX_RESPONSES = 200;
  const MAX_TITLE = 100;
  const MAX_BODY = 10000;
  const MAX_CATEGORY = 50;
  const MAX_NAME = 100;

  const PLACEHOLDER_HELP = [
    ["{{requester}}", "requester's name"],
    ["{{requester_first}}", "requester's first name"],
    ["{{subject}}", "ticket subject"],
    ["{{ticket}}", "ticket number"],
    ["{{agent}}", "your name (below)"],
    ["{{agent_first}}", "your first name"],
    ["{{date}}", "today's date"],
    ["{{time}}", "the time now"],
    ["{{site}}", "the site, e.g. Freshservice"],
  ];

  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (r) {
      return r && typeof r.id === "string" && typeof r.title === "string" && typeof r.body === "string";
    }).map(function (r) {
      const out = { id: r.id, title: r.title, body: r.body };
      if (typeof r.category === "string" && r.category.trim()) out.category = r.category.trim();
      return out;
    });
  }

  function newId() {
    return "cr-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  settingsAPI.addPanel("canned-responses", "Canned Responses", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Canned Responses</h3>' +
      '  <p class="settings-description">' +
      "    Replies you send often. Open the <strong>💬 Replies</strong> tab in the side panel and click one to insert it at the cursor " +
      "    in the ticket's reply box (Freshservice reply or note editor, ConnectWise Manage notes editor). Type in the search box and " +
      "    press <strong>Enter</strong> to insert the top match. <strong>Copy</strong> puts it on the clipboard for anywhere else." +
      "  </p>" +
      '  <div class="settings-field">' +
      '    <label class="settings-field-label" for="plugin-cr-agent">Your name</label>' +
      '    <input type="text" id="plugin-cr-agent" class="settings-text-input" maxlength="' + MAX_NAME + '" placeholder="e.g. Sam Taylor" autocomplete="off" />' +
      "  </div>" +
      '  <p class="settings-description settings-description-field">Used for <code>{{agent}}</code> and <code>{{agent_first}}</code>.</p>' +
      "</div>" +
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Placeholders</h3>' +
      '  <p class="settings-description">These are filled in when a reply is inserted. Anything that can\'t be read from the ticket is left as it is, ' +
      "    so you can spot it, and the side panel tells you which ones to fill in.</p>" +
      '  <dl class="cr-placeholder-help">' +
      PLACEHOLDER_HELP.map(function (p) { return "<dt><code>" + esc(p[0]) + "</code></dt><dd>" + esc(p[1]) + "</dd>"; }).join("") +
      "  </dl>" +
      "</div>" +
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Replies</h3>' +
      '  <ul id="plugin-cr-list" class="cr-settings-list"></ul>' +
      '  <p id="plugin-cr-empty" class="settings-description" hidden>No replies yet.</p>' +
      '  <button type="button" id="plugin-cr-add" class="btn btn-small btn-primary">+ Add reply</button>' +
      '  <div id="plugin-cr-form" class="cr-settings-form" hidden>' +
      '    <input type="text" id="plugin-cr-title" class="settings-text-input" placeholder="Name, e.g. Password reset done" maxlength="' + MAX_TITLE + '" autocomplete="off" />' +
      '    <input type="text" id="plugin-cr-category" class="settings-text-input" placeholder="Category (optional), e.g. Accounts" maxlength="' + MAX_CATEGORY + '" list="plugin-cr-categories" autocomplete="off" />' +
      '    <datalist id="plugin-cr-categories"></datalist>' +
      '    <textarea id="plugin-cr-body" class="cr-settings-body" rows="8" maxlength="' + MAX_BODY + '" ' +
      '      placeholder="Hi {{requester_first}},&#10;&#10;I\'ve reset your password…&#10;&#10;Thanks,&#10;{{agent_first}}"></textarea>' +
      '    <div class="cr-settings-form-buttons">' +
      '      <button type="button" id="plugin-cr-save" class="btn btn-small btn-primary">Save</button>' +
      '      <button type="button" id="plugin-cr-cancel" class="btn btn-small btn-secondary">Cancel</button>' +
      "    </div>" +
      "  </div>" +
      '  <p id="plugin-cr-status" class="settings-description cr-settings-status"></p>' +
      "</div>";

    const agentInput = panel.querySelector("#plugin-cr-agent");
    const listEl = panel.querySelector("#plugin-cr-list");
    const emptyEl = panel.querySelector("#plugin-cr-empty");
    const addBtn = panel.querySelector("#plugin-cr-add");
    const form = panel.querySelector("#plugin-cr-form");
    const titleInput = panel.querySelector("#plugin-cr-title");
    const categoryInput = panel.querySelector("#plugin-cr-category");
    const categoryList = panel.querySelector("#plugin-cr-categories");
    const bodyInput = panel.querySelector("#plugin-cr-body");
    const saveBtn = panel.querySelector("#plugin-cr-save");
    const cancelBtn = panel.querySelector("#plugin-cr-cancel");
    const statusEl = panel.querySelector("#plugin-cr-status");

    let items = [];
    let editingId = null; // null: form closed; "": adding; else the id being edited
    let confirmingId = null;

    function setStatus(text, isError) {
      statusEl.textContent = text || "";
      statusEl.classList.toggle("cr-settings-error", !!isError);
    }

    function save(next) {
      const previous = items;
      items = next;
      render();
      return Promise.resolve(settingsAPI.saveSettings({ cannedResponses: items })).then(function (res) {
        if (res && res.success === false) throw new Error(res.error || "rejected");
        setStatus("");
        return true;
      }).catch(function (err) {
        console.error("[Canned Responses] Save failed:", err);
        items = previous;
        render();
        setStatus("The replies couldn't be saved.", true);
        return false;
      });
    }

    function move(from, to) {
      if (to < 0 || to >= items.length || from === to) return;
      const next = items.slice();
      const moved = next.splice(from, 1)[0];
      next.splice(to, 0, moved);
      save(next);
    }

    function button(text, title, onClick, extra) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small" + (extra ? " " + extra : "");
      b.textContent = text;
      b.title = title;
      b.addEventListener("click", onClick);
      return b;
    }

    function openForm(r) {
      editingId = r ? r.id : "";
      confirmingId = null;
      titleInput.value = r ? r.title : "";
      categoryInput.value = r && r.category ? r.category : "";
      bodyInput.value = r ? r.body : "";
      titleInput.classList.remove("invalid");
      form.hidden = false;
      addBtn.style.display = "none";
      setStatus("");
      render();
      titleInput.focus();
    }

    function closeForm() {
      editingId = null;
      form.hidden = true;
      addBtn.style.display = "";
      render();
    }

    function render() {
      listEl.innerHTML = "";
      emptyEl.style.display = items.length > 0 ? "none" : "";
      const cats = [];
      items.forEach(function (r) {
        if (r.category && !cats.some(function (c) { return c.toLowerCase() === r.category.toLowerCase(); })) cats.push(r.category);
      });
      categoryList.innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("");

      items.forEach(function (r, idx) {
        const li = document.createElement("li");
        li.className = "cr-settings-item" + (r.id === editingId ? " cr-settings-editing" : "");
        const text = document.createElement("div");
        text.className = "cr-settings-text";
        const t = document.createElement("span");
        t.className = "cr-settings-title";
        t.textContent = r.title;
        text.appendChild(t);
        if (r.category) {
          const c = document.createElement("span");
          c.className = "cr-settings-category";
          c.textContent = r.category;
          text.appendChild(c);
        }
        const p = document.createElement("span");
        p.className = "cr-settings-preview";
        p.textContent = r.body.replace(/\s+/g, " ").trim().substring(0, 120);
        text.appendChild(p);
        li.appendChild(text);

        const btns = document.createElement("div");
        btns.className = "cr-settings-buttons";
        if (confirmingId === r.id) {
          btns.appendChild(button("Delete", "Delete this reply", function () {
            confirmingId = null;
            if (editingId === r.id) { editingId = null; form.hidden = true; addBtn.style.display = ""; }
            save(items.filter(function (x) { return x.id !== r.id; }));
          }, "btn-delete"));
          btns.appendChild(button("Keep", "Don't delete", function () { confirmingId = null; render(); }, "btn-secondary"));
        } else {
          const up = button("↑", "Move up", function () { move(idx, idx - 1); });
          up.disabled = idx === 0;
          const down = button("↓", "Move down", function () { move(idx, idx + 1); });
          down.disabled = idx === items.length - 1;
          btns.appendChild(up);
          btns.appendChild(down);
          btns.appendChild(button("Edit", "Edit this reply", function () { openForm(r); }));
          btns.appendChild(button("✕", "Delete this reply", function () { confirmingId = r.id; render(); }, "btn-delete"));
        }
        li.appendChild(btns);
        listEl.appendChild(li);
      });
      addBtn.disabled = items.length >= MAX_RESPONSES;
    }

    addBtn.addEventListener("click", function () { openForm(null); });
    cancelBtn.addEventListener("click", function () { setStatus(""); closeForm(); });

    saveBtn.addEventListener("click", function () {
      const title = titleInput.value.trim().slice(0, MAX_TITLE);
      if (!title) {
        titleInput.classList.add("invalid");
        setStatus("Give the reply a name.", true);
        titleInput.focus();
        return;
      }
      const entry = { id: editingId || newId(), title: title, body: bodyInput.value.slice(0, MAX_BODY) };
      const category = categoryInput.value.trim().slice(0, MAX_CATEGORY);
      if (category) entry.category = category;
      let next;
      if (editingId && items.some(function (x) { return x.id === editingId; })) {
        next = items.map(function (x) { return x.id === editingId ? entry : x; });
      } else {
        if (items.length >= MAX_RESPONSES) { setStatus("You can save up to " + MAX_RESPONSES + " replies.", true); return; }
        next = items.concat([entry]);
      }
      editingId = null;
      form.hidden = true;
      addBtn.style.display = "";
      save(next);
    });

    titleInput.addEventListener("input", function () { titleInput.classList.remove("invalid"); });

    let agentTimer = null;
    agentInput.addEventListener("input", function () {
      clearTimeout(agentTimer);
      agentTimer = setTimeout(function () {
        settingsAPI.saveSettings({ cannedResponsesAgentName: agentInput.value.trim().slice(0, MAX_NAME) });
      }, 400);
    });

    function populate(s) {
      items = sanitize(s.cannedResponses);
      if (document.activeElement !== agentInput) agentInput.value = s.cannedResponsesAgentName || "";
      if (editingId && !items.some(function (x) { return x.id === editingId; })) closeForm();
      else render();
    }

    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);
  });
}());
