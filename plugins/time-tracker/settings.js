// Time Tracker plugin — Settings window panel
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  function toggle(id, label) {
    return '<label class="settings-toggle">' +
      '  <input type="checkbox" id="' + id + '" />' +
      '  <span class="settings-toggle-slider"></span>' +
      '  <span class="settings-toggle-label">' + label + "</span>" +
      "</label>";
  }

  settingsAPI.addPanel("time-tracker", "Time Tracker", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Time Tracker</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    Open the <strong>⏱ Time</strong> tab in the side panel to time the ticket open in the current tab. When you're done, " +
      "    <strong>Log time</strong> adds a time entry to the ticket: on Freshservice through the API (set up the domain and API key " +
      "    under <strong>Freshservice</strong>; the entry is added for the agent the key belongs to), on ConnectWise Manage by filling " +
      "    the hours of the time entry open on the page. Anywhere else, copy the time and paste it in." +
      "  </p>" +
      '  <div class="settings-field">' +
      '    <label class="settings-field-label" for="plugin-tmr-round">Round logged time up to</label>' +
      '    <div class="settings-field-row">' +
      '      <select id="plugin-tmr-round" class="settings-select-input">' +
      '        <option value="1">the next minute</option>' +
      '        <option value="5">5 minutes</option>' +
      '        <option value="6">6 minutes (0.1 hour)</option>' +
      '        <option value="10">10 minutes</option>' +
      '        <option value="15">15 minutes</option>' +
      '        <option value="30">30 minutes</option>' +
      "      </select>" +
      "    </div>" +
      "  </div>" +
      toggle("plugin-tmr-one", "Run one timer at a time (starting a timer pauses the others)") +
      toggle("plugin-tmr-auto", "Start a timer when I open a ticket") +
      toggle("plugin-tmr-billable", "Mark time entries billable by default") +
      '  <p class="settings-description">' +
      "    Running timers are paused when MSP++ closes. The time is only rounded when you log it; the timer keeps the exact time." +
      "  </p>" +
      "</div>";

    const elRound = panel.querySelector("#plugin-tmr-round");
    const elOne = panel.querySelector("#plugin-tmr-one");
    const elAuto = panel.querySelector("#plugin-tmr-auto");
    const elBillable = panel.querySelector("#plugin-tmr-billable");

    function populate(s) {
      elRound.value = String(s.timeTrackerRoundTo || 1);
      elOne.checked = s.timeTrackerOneAtATime !== false;
      elAuto.checked = s.timeTrackerAutoStart === true;
      elBillable.checked = s.timeTrackerBillable !== false;
    }
    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);

    elRound.addEventListener("change", function () {
      settingsAPI.saveSettings({ timeTrackerRoundTo: Number(elRound.value) });
    });
    elOne.addEventListener("change", function () { settingsAPI.saveSettings({ timeTrackerOneAtATime: elOne.checked }); });
    elAuto.addEventListener("change", function () { settingsAPI.saveSettings({ timeTrackerAutoStart: elAuto.checked }); });
    elBillable.addEventListener("change", function () { settingsAPI.saveSettings({ timeTrackerBillable: elBillable.checked }); });
  });
})();
