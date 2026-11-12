// Ticket Search plugin — Settings window panel
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("ticket-search", "Ticket Search", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Ticket Search</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    Open the <strong>🔎 Search</strong> tab in the side panel and type a ticket number, words from the subject, " +
      "    or a requester's name or email. On Freshservice the search goes through the API, so set up the domain and API key " +
      "    under <strong>Freshservice</strong> first." +
      "  </p>" +
      '  <div class="settings-field">' +
      '    <label class="settings-field-label" for="plugin-ts-open">Open a ticket I click in</label>' +
      '    <div class="settings-field-row">' +
      '      <select id="plugin-ts-open" class="settings-select-input">' +
      '        <option value="new">a new tab</option>' +
      '        <option value="current">the current tab</option>' +
      "      </select>" +
      "    </div>" +
      "  </div>" +
      '  <div class="settings-field">' +
      '    <label class="settings-field-label" for="plugin-ts-days">Match subjects of tickets updated in the last</label>' +
      '    <div class="settings-field-row">' +
      '      <select id="plugin-ts-days" class="settings-select-input">' +
      '        <option value="7">7 days</option>' +
      '        <option value="30">30 days</option>' +
      '        <option value="90">90 days</option>' +
      '        <option value="180">180 days</option>' +
      '        <option value="365">year</option>' +
      "      </select>" +
      "    </div>" +
      "  </div>" +
      '  <p class="settings-description">' +
      "    Freshservice's API can't search ticket subjects, so MSP++ fetches up to the 300 most recent tickets updated in that " +
      "    window and matches subjects itself (it keeps the list for two minutes, so typing doesn't call the API again). " +
      "    Ticket numbers and requesters are looked up directly, however old the ticket. Ctrl+click or middle-click a result " +
      "    to open it in a background tab." +
      "  </p>" +
      '  <label class="settings-toggle settings-toggle-spaced">' +
      '    <input type="checkbox" id="plugin-ts-preview" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Preview a ticket when I rest the mouse on a result (status, requester, agent and the latest reply)</span>' +
      "  </label>" +
      '  <p class="settings-description">The preview reads the ticket through the site\'s API (two or three calls per ticket, kept for a minute).</p>' +
      "</div>";

    const elOpen = panel.querySelector("#plugin-ts-open");
    const elDays = panel.querySelector("#plugin-ts-days");
    const elPreview = panel.querySelector("#plugin-ts-preview");

    function populate(s) {
      elOpen.value = s.ticketSearchOpenIn === "current" ? "current" : "new";
      elDays.value = String(s.ticketSearchDays || 30);
      elPreview.checked = s.ticketSearchHoverPreview !== false;
    }
    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);

    elOpen.addEventListener("change", function () { settingsAPI.saveSettings({ ticketSearchOpenIn: elOpen.value }); });
    elDays.addEventListener("change", function () { settingsAPI.saveSettings({ ticketSearchDays: Number(elDays.value) }); });
    elPreview.addEventListener("change", function () { settingsAPI.saveSettings({ ticketSearchHoverPreview: elPreview.checked }); });
  });
})();
