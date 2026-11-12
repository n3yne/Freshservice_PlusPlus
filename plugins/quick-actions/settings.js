// Quick Actions plugin — Settings window panel
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  function toggle(id, label) {
    return '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="' + id + '" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">' + label + "</span>" +
      "  </label>";
  }

  settingsAPI.addPanel("quick-actions", "Quick Actions", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Quick Actions</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    Open a ticket and the <strong>⚡ Actions</strong> tab in the side panel changes its status, priority, group and agent " +
      "    without the ticket form, with <strong>Assign to me</strong>, <strong>Pending</strong> and <strong>Resolve</strong> in one click. " +
      "    The command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>) has <em>Assign Ticket to Me</em>, <em>Resolve Ticket</em> and " +
      "    <em>Set Ticket Status / Priority</em> too. On Freshservice the changes go through the API, so set up the domain and " +
      "    API key under <strong>Freshservice</strong> first; the key's agent needs permission to edit tickets." +
      "  </p>" +
      toggle("plugin-qa-reload", "Reload the ticket's tab after a change, so the page shows it") +
      '  <p class="settings-description">' +
      "    The tab isn't reloaded while something is typed on the page (a reply or note you haven't sent); you get a " +
      "    <strong>Reload tab</strong> button instead. Saving the ticket form on a page that still shows the old values can put them back." +
      "  </p>" +
      toggle("plugin-qa-confirm", "Ask before resolving a ticket") +
      "</div>";

    const elReload = panel.querySelector("#plugin-qa-reload");
    const elConfirm = panel.querySelector("#plugin-qa-confirm");

    function populate(s) {
      elReload.checked = s.quickActionsReloadTab !== false;
      elConfirm.checked = s.quickActionsConfirmResolve !== false;
    }
    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);

    elReload.addEventListener("change", function () { settingsAPI.saveSettings({ quickActionsReloadTab: elReload.checked }); });
    elConfirm.addEventListener("change", function () { settingsAPI.saveSettings({ quickActionsConfirmResolve: elConfirm.checked }); });
  });
})();
