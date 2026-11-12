// Follow-up Reminders plugin — Settings window panel
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("follow-ups", "Follow-up Reminders", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Follow-up Reminders</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    Open a ticket and use the <strong>⏰ Follow-ups</strong> tab in the side panel (or right-click its tab and choose " +
      "    <strong>Remind Me to Follow Up…</strong>, or press <strong>Ctrl+K</strong>) to be reminded about it in an hour, " +
      "    tomorrow morning, next week or at a time you pick. When it's due MSP++ shows a desktop alert and a notification " +
      "    under the bell. Reminders that came due while MSP++ was closed go off when it next starts." +
      "  </p>" +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="plugin-fup-desktop" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Show a desktop alert when a reminder is due</span>' +
      "  </label>" +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="plugin-fup-sound" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Play the notification sound</span>' +
      "  </label>" +
      '  <div class="settings-field">' +
      '    <label class="settings-field-label" for="plugin-fup-morning">"Tomorrow" and "Monday" mean</label>' +
      '    <div class="settings-field-row">' +
      '      <select id="plugin-fup-morning" class="settings-select-input">' +
      '        <option value="6">6:00 AM</option>' +
      '        <option value="7">7:00 AM</option>' +
      '        <option value="8">8:00 AM</option>' +
      '        <option value="9">9:00 AM</option>' +
      '        <option value="10">10:00 AM</option>' +
      '        <option value="11">11:00 AM</option>' +
      "      </select>" +
      "    </div>" +
      "  </div>" +
      '  <div class="settings-field">' +
      '    <button type="button" class="btn btn-small btn-secondary" id="plugin-fup-test">Send a test alert</button>' +
      '    <span class="settings-description" id="plugin-fup-test-result"></span>' +
      "  </div>" +
      '  <p class="settings-description">If no alert appears, check that notifications are on for MSP++ in ' +
      "    Windows Settings → System → Notifications. Notifications under the bell show either way.</p>" +
      "</div>";

    const elDesktop = panel.querySelector("#plugin-fup-desktop");
    const elSound = panel.querySelector("#plugin-fup-sound");
    const elMorning = panel.querySelector("#plugin-fup-morning");
    const elTest = panel.querySelector("#plugin-fup-test");
    const elTestResult = panel.querySelector("#plugin-fup-test-result");

    function populate(s) {
      elDesktop.checked = s.followUpDesktop !== false;
      elSound.checked = s.followUpSound !== false;
      elSound.disabled = !elDesktop.checked;
      elMorning.value = String(s.followUpMorningHour || 9);
    }
    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);

    elDesktop.addEventListener("change", function () {
      elSound.disabled = !elDesktop.checked;
      settingsAPI.saveSettings({ followUpDesktop: elDesktop.checked });
    });
    elSound.addEventListener("change", function () { settingsAPI.saveSettings({ followUpSound: elSound.checked }); });
    elMorning.addEventListener("change", function () { settingsAPI.saveSettings({ followUpMorningHour: Number(elMorning.value) }); });

    elTest.addEventListener("click", function () {
      elTestResult.textContent = "";
      if (typeof Notification !== "function") {
        elTestResult.textContent = "Desktop notifications aren't available here.";
        return;
      }
      try {
        const n = new Notification("Follow up: FS · #12345", {
          body: "Chase the user for a reply\nPrinter offline in the 2nd floor office",
          silent: !elSound.checked,
        });
        n.onerror = function () {
          elTestResult.textContent = "Windows didn't show the alert. Check that notifications are on for MSP++.";
        };
        elTestResult.textContent = "Sent.";
      } catch (err) {
        elTestResult.textContent = "Couldn't show the alert: " + err.message;
      }
    });
  });
})();
