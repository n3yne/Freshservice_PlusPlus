// Note Backup plugin — Settings window panel
// Live sync, backup storage, note templates and the signature, all of which
// used to be core Settings pages before note backup became a plugin.
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  const SIG_SAVE_DEBOUNCE = 800;

  function debounce(fn, ms) {
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  settingsAPI.addPanel("note-backup", "Note Backup", function (panel) {
    panel.insertAdjacentHTML("beforeend", `
<div class="settings-section">
  <h3 class="settings-section-title">Live Sync</h3>
  <label class="settings-toggle">
    <input type="checkbox" id="setting-live-sync" />
    <span class="settings-toggle-slider"></span>
    <span class="settings-toggle-label">Live Sync with Active Tab</span>
  </label>
  <p class="settings-description">
    Automatically load ticket notes when switching tabs and keep the Notes tab in sync
    with the open Freshservice note editor as you type.
  </p>
</div>

<div class="settings-section">
  <h3 class="settings-section-title">Backups</h3>

  <div class="settings-field">
    <label class="settings-field-label" for="setting-retention-days">Backup Retention</label>
    <div class="settings-field-row">
      <input type="number" id="setting-retention-days" class="settings-number-input"
        min="0" max="365" step="1" value="7" />
      <span class="settings-field-suffix">days</span>
    </div>
  </div>
  <p class="settings-description settings-description-field settings-description-field-spaced">
    How long to keep saved note snapshots before automatic cleanup.
    Set to <strong>0</strong> to keep notes forever.
  </p>

  <div class="settings-field">
    <label class="settings-field-label" for="setting-snapshot-threshold">Snapshot Threshold</label>
    <div class="settings-field-row">
      <input type="number" id="setting-snapshot-threshold" class="settings-number-input"
        min="1" max="9999" step="1" value="5" />
      <span class="settings-field-suffix">chars</span>
    </div>
  </div>
  <p class="settings-description settings-description-field settings-description-field-spaced">
    Minimum character difference between the note and the last snapshot before a new
    snapshot is auto-saved on tab switch or sync pull.
  </p>

  <div class="settings-field">
    <label class="settings-field-label" for="setting-storage-warning">Storage Warning</label>
    <div class="settings-field-row">
      <input type="number" id="setting-storage-warning" class="settings-number-input"
        min="0" max="100000" step="1" value="100" />
      <span class="settings-field-suffix">MB</span>
    </div>
  </div>
  <p class="settings-description settings-description-field settings-description-field-spaced">
    Show a notification when the backup folder exceeds this size.
    Set to <strong>0</strong> to disable.
  </p>

  <div class="settings-field">
    <label class="settings-field-label" for="setting-sort-field">Ticket Sort Order</label>
    <div class="settings-field-row">
      <select id="setting-sort-field" class="settings-select-input" title="Sort saved tickets by">
        <option value="lastUpdated">Last Updated</option>
        <option value="ticketNumber">Ticket Number</option>
      </select>
      <select id="setting-sort-direction" class="settings-select-input" title="Sort direction">
        <option value="desc">Descending</option>
        <option value="asc">Ascending</option>
      </select>
    </div>
  </div>
  <p class="settings-description settings-description-field">
    How the saved tickets dropdown is sorted.
  </p>
</div>

<div class="settings-section">
  <h3 class="settings-section-title">Note Templates</h3>
  <p class="settings-description settings-description-field settings-description-field-spaced">
    Predefined text snippets to insert into notes via the <strong>Tmpl</strong> toolbar button.
  </p>
  <div id="template-list" class="template-list"></div>
  <button type="button" id="btn-add-template" class="btn btn-small template-add-btn">+ Add Template</button>
  <div id="template-add-form" class="template-form">
    <input type="text" id="template-name-input" class="settings-text-input"
      placeholder="Template name…" maxlength="100" />
    <textarea id="template-content-input" class="template-content-textarea"
      placeholder="Template content…" maxlength="10000" rows="4"></textarea>
    <div class="template-form-buttons">
      <button type="button" id="btn-save-template" class="btn btn-primary btn-small">Save</button>
      <button type="button" id="btn-cancel-template" class="btn btn-secondary btn-small">Cancel</button>
    </div>
  </div>
</div>

<div class="settings-section">
  <h3 class="settings-section-title">Signature</h3>
  <p class="settings-description settings-description-field settings-description-field-spaced">
    Customize the signature block inserted into notes via the <strong>Sig</strong> toolbar button.
    Supports rich text formatting.
  </p>
  <div id="signature-toolbar" class="signature-toolbar">
    <button type="button" class="toolbar-btn" data-sig-command="bold" title="Bold"><b>B</b></button>
    <button type="button" class="toolbar-btn" data-sig-command="italic" title="Italic"><i>I</i></button>
    <button type="button" class="toolbar-btn" data-sig-command="underline" title="Underline"><u>U</u></button>
    <span class="toolbar-sep"></span>
    <button type="button" class="toolbar-btn" data-sig-command="insertUnorderedList" title="Bullet List">&#8226; List</button>
  </div>
  <div id="setting-signature" class="signature-editor" contenteditable="true"
    data-placeholder="e.g. Thanks, John Smith | IT Support | ext. 1234"></div>
</div>`);

    const settingLiveSync = panel.querySelector("#setting-live-sync");
    const settingRetentionDays = panel.querySelector("#setting-retention-days");
    const settingSnapshotThreshold = panel.querySelector("#setting-snapshot-threshold");
    const settingStorageWarning = panel.querySelector("#setting-storage-warning");
    const settingSortField = panel.querySelector("#setting-sort-field");
    const settingSortDirection = panel.querySelector("#setting-sort-direction");
    const settingSignature = panel.querySelector("#setting-signature");
    const templateList = panel.querySelector("#template-list");
    const btnAddTemplate = panel.querySelector("#btn-add-template");
    const templateAddForm = panel.querySelector("#template-add-form");
    const templateNameInput = panel.querySelector("#template-name-input");
    const templateContentInput = panel.querySelector("#template-content-input");
    const btnSaveTemplate = panel.querySelector("#btn-save-template");
    const btnCancelTemplate = panel.querySelector("#btn-cancel-template");

    let settings = settingsAPI.getSettings();

    function save(patch) {
      settings = Object.assign({}, settings, patch);
      return settingsAPI.saveSettings(patch);
    }

    function populate(s) {
      settings = s;
      settingLiveSync.checked = s.liveSyncEnabled !== false;
      settingRetentionDays.value = s.backupRetentionDays ?? 7;
      settingSnapshotThreshold.value = s.snapshotThreshold ?? 5;
      settingStorageWarning.value = s.backupStorageWarningMb ?? 100;
      settingSortField.value = s.ticketSortField || "lastUpdated";
      settingSortDirection.value = s.ticketSortDirection || "desc";
      if (document.activeElement !== settingSignature) {
        settingSignature.innerHTML = s.signatureHtml || "";
      }
      renderTemplateList();
    }

    settingLiveSync.addEventListener("change", function () {
      save({ liveSyncEnabled: settingLiveSync.checked });
    });

    // Clamps a number input to [min, max] and saves it under key.
    function bindNumber(input, key, min, max) {
      input.addEventListener("change", function () {
        let val = parseInt(input.value, 10);
        if (isNaN(val) || val < min) val = min;
        if (val > max) val = max;
        input.value = val;
        save({ [key]: val });
      });
    }
    bindNumber(settingRetentionDays, "backupRetentionDays", 0, 365);
    bindNumber(settingSnapshotThreshold, "snapshotThreshold", 1, 9999);
    bindNumber(settingStorageWarning, "backupStorageWarningMb", 0, 100000);

    settingSortField.addEventListener("change", function () {
      save({ ticketSortField: settingSortField.value });
    });
    settingSortDirection.addEventListener("change", function () {
      save({ ticketSortDirection: settingSortDirection.value });
    });

    // ---- Signature ----
    panel.querySelector("#signature-toolbar").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-sig-command]");
      if (!btn) return;
      settingSignature.focus();
      document.execCommand(btn.dataset.sigCommand, false, null);
    });
    settingSignature.addEventListener("input", debounce(function () {
      save({ signatureHtml: settingSignature.innerHTML });
    }, SIG_SAVE_DEBOUNCE));

    // ---- Note Templates ----
    let editingTemplateIndex = null;

    function templates() {
      return Array.isArray(settings.noteTemplates) ? settings.noteTemplates.slice() : [];
    }

    function renderTemplateList() {
      templateList.innerHTML = "";
      const list = templates();
      if (list.length === 0) {
        templateList.innerHTML = '<p style="font-size:11px;color:var(--text-muted);padding:4px 0;">No templates yet.</p>';
        return;
      }
      list.forEach(function (tmpl, idx) {
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
          const next = templates();
          next.splice(idx, 1);
          save({ noteTemplates: next });
          renderTemplateList();
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

    function closeTemplateForm() {
      templateAddForm.classList.remove("visible");
      btnAddTemplate.style.display = "";
      editingTemplateIndex = null;
    }

    btnAddTemplate.addEventListener("click", function () {
      editingTemplateIndex = null;
      templateNameInput.value = "";
      templateContentInput.value = "";
      templateAddForm.classList.add("visible");
      btnAddTemplate.style.display = "none";
      templateNameInput.focus();
    });

    btnCancelTemplate.addEventListener("click", closeTemplateForm);

    btnSaveTemplate.addEventListener("click", function () {
      const name = templateNameInput.value.trim();
      const content = templateContentInput.value;
      if (!name) { templateNameInput.focus(); return; }
      const next = templates();
      if (editingTemplateIndex !== null && editingTemplateIndex < next.length) {
        next[editingTemplateIndex] = { name, content };
      } else {
        next.push({ name, content });
      }
      save({ noteTemplates: next });
      closeTemplateForm();
      renderTemplateList();
    });

    populate(settings);
    settingsAPI.onSettingsChanged(populate);
  });
}());
