// Recent Tickets plugin — Settings window panel
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("recent-tickets", "Recent Tickets", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Recent Tickets</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    The <strong>🕘 Recent</strong> tab in the side panel lists the tickets you've viewed lately on Freshservice, " +
      "    ConnectWise Manage and any other site plugin that knows its tickets, newest first. Click one to go back to it; " +
      "    Ctrl+click or middle-click opens it in a new tab. Star a ticket to pin it to the top. " +
      "    Clear the list from the tab's <strong>Clear</strong> button." +
      "  </p>" +
      '  <div class="settings-field">' +
      '    <label class="settings-field-label" for="plugin-rct-max">Remember up to</label>' +
      '    <div class="settings-field-row">' +
      '      <select id="plugin-rct-max" class="settings-select-input">' +
      '        <option value="10">10 tickets</option>' +
      '        <option value="25">25 tickets</option>' +
      '        <option value="50">50 tickets</option>' +
      '        <option value="100">100 tickets</option>' +
      '        <option value="200">200 tickets</option>' +
      "      </select>" +
      "    </div>" +
      "  </div>" +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="plugin-rct-reuse" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Switch to the ticket\'s tab when it\'s already open (instead of opening another tab)</span>' +
      "  </label>" +
      '  <p class="settings-description">Pinned tickets don\'t count toward the limit.</p>' +
      '  <label class="settings-toggle settings-toggle-spaced">' +
      '    <input type="checkbox" id="plugin-rct-preview" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Preview a ticket when I rest the mouse on it (status, requester, agent and the latest reply)</span>' +
      "  </label>" +
      '  <p class="settings-description">Previews need the site\'s API (on Freshservice, the domain and API key under Freshservice). ' +
      "    ConnectWise Manage tickets have no preview yet.</p>" +
      "</div>";

    const elMax = panel.querySelector("#plugin-rct-max");
    const elReuse = panel.querySelector("#plugin-rct-reuse");
    const elPreview = panel.querySelector("#plugin-rct-preview");

    function populate(s) {
      elMax.value = String(s.recentTicketsMax || 50);
      elReuse.checked = s.recentTicketsReuseTab !== false;
      elPreview.checked = s.recentTicketsHoverPreview !== false;
    }
    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);

    elMax.addEventListener("change", function () { settingsAPI.saveSettings({ recentTicketsMax: Number(elMax.value) }); });
    elReuse.addEventListener("change", function () { settingsAPI.saveSettings({ recentTicketsReuseTab: elReuse.checked }); });
    elPreview.addEventListener("change", function () { settingsAPI.saveSettings({ recentTicketsHoverPreview: elPreview.checked }); });
  });
})();
