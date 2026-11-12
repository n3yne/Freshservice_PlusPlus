// Ticket Notifications — Settings window panel
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  const INTERVALS = [1, 2, 5, 10, 15, 30];

  function invoke(pluginId, action, data) {
    return window.backupAPI.pluginInvoke("plugin:" + pluginId + ":" + action, data || {});
  }

  function intervalLabel(m) {
    return m === 1 ? "Every minute" : "Every " + m + " minutes";
  }

  function timeLabel(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  settingsAPI.addPanel("ticket-notifications", "Ticket Notifications", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Ticket Notifications</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    Shows a desktop notification when a Freshservice ticket assigned to you gets a new reply. " +
      "    It checks through the Freshservice API, so set up the domain and API key in " +
      "    <strong>Settings → Freshservice</strong> first. Notifications also stay under the bell in the tab bar." +
      "  </p>" +
      '  <div class="settings-field settings-field-column">' +
      '    <label class="settings-field-label" for="plugin-tn-email">Your Freshservice email</label>' +
      '    <div class="settings-field-row">' +
      '      <input type="text" id="plugin-tn-email" class="settings-text-input" placeholder="you@company.com" maxlength="254" spellcheck="false" autocomplete="off" />' +
      '      <button type="button" id="plugin-tn-find" class="btn btn-small btn-primary">Find me</button>' +
      "    </div>" +
      '    <p id="plugin-tn-agent" class="settings-description settings-description-field"></p>' +
      "  </div>" +
      '  <p class="settings-description settings-description-field">' +
      "    Tickets count as yours when you are the assigned agent. If looking up your email isn't allowed for your API key, " +
      "    type your agent ID instead (the number at the end of your agent profile's address in Freshservice)." +
      "  </p>" +
      "</div>" +

      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">What to notify</h3>' +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="plugin-tn-other-agents" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Also replies and private notes from other agents</span>' +
      "  </label>" +
      '  <p class="settings-description">Replies from the requester always notify. Your own replies never do.</p>' +
      '  <label class="settings-toggle settings-toggle-spaced">' +
      '    <input type="checkbox" id="plugin-tn-desktop" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Show desktop notifications</span>' +
      "  </label>" +
      '  <p class="settings-description">When this is off, new replies only show under the bell.</p>' +
      '  <label class="settings-toggle settings-toggle-spaced">' +
      '    <input type="checkbox" id="plugin-tn-sound" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Play the notification sound</span>' +
      "  </label>" +
      '  <div class="settings-field" style="margin-top:12px">' +
      '    <label class="settings-field-label" for="plugin-tn-interval">Check for replies</label>' +
      '    <div class="settings-field-row">' +
      '      <select id="plugin-tn-interval" class="settings-select-input">' +
      INTERVALS.map(function (m) { return '<option value="' + m + '">' + intervalLabel(m) + "</option>"; }).join("") +
      "      </select>" +
      "    </div>" +
      "  </div>" +
      '  <div class="settings-field">' +
      '    <div class="settings-field-row">' +
      '      <button type="button" id="plugin-tn-test" class="btn btn-small btn-secondary">Show a test notification</button>' +
      '      <span id="plugin-tn-test-result" class="settings-description"></span>' +
      "    </div>" +
      "  </div>" +
      '  <p id="plugin-tn-status" class="settings-description settings-description-field"></p>' +
      "</div>";

    const elEmail = panel.querySelector("#plugin-tn-email");
    const elFind = panel.querySelector("#plugin-tn-find");
    const elAgent = panel.querySelector("#plugin-tn-agent");
    const elOther = panel.querySelector("#plugin-tn-other-agents");
    const elDesktop = panel.querySelector("#plugin-tn-desktop");
    const elSound = panel.querySelector("#plugin-tn-sound");
    const elInterval = panel.querySelector("#plugin-tn-interval");
    const elTest = panel.querySelector("#plugin-tn-test");
    const elStatus = panel.querySelector("#plugin-tn-status");
    const elTestResult = panel.querySelector("#plugin-tn-test-result");

    function agentText(s) {
      if (!s.ticketNotifyAgentId) return "Not set up yet: no tickets are being watched.";
      const who = s.ticketNotifyAgentName
        ? s.ticketNotifyAgentName + (s.ticketNotifyAgentEmail ? " (" + s.ticketNotifyAgentEmail + ")" : "")
        : "Agent";
      return "Watching tickets assigned to " + who + ", agent ID " + s.ticketNotifyAgentId + ".";
    }

    function applyForm(s) {
      if (document.activeElement !== elEmail) {
        elEmail.value = s.ticketNotifyAgentEmail || (s.ticketNotifyAgentId ? String(s.ticketNotifyAgentId) : "");
      }
      elAgent.textContent = agentText(s);
      elOther.checked = s.ticketNotifyOtherAgents !== false;
      elDesktop.checked = s.ticketNotifyDesktop !== false;
      elSound.checked = s.ticketNotifySound !== false;
      elSound.disabled = !elDesktop.checked;
      elInterval.value = String(INTERVALS.includes(s.ticketNotifyInterval) ? s.ticketNotifyInterval : 2);
    }

    applyForm(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(applyForm);

    async function findAgent() {
      const value = elEmail.value.trim();
      if (!value) {
        await settingsAPI.saveSettings({ ticketNotifyAgentId: 0, ticketNotifyAgentName: "", ticketNotifyAgentEmail: "" });
        return;
      }
      // An agent ID typed directly.
      if (/^\d{1,15}$/.test(value)) {
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id <= 0) {
          elAgent.textContent = "That isn't an agent ID.";
          return;
        }
        await settingsAPI.saveSettings({ ticketNotifyAgentId: id, ticketNotifyAgentName: "", ticketNotifyAgentEmail: "" });
        return;
      }
      elFind.disabled = true;
      elAgent.textContent = "Looking you up…";
      try {
        const res = await invoke("freshservice", "find-agent", { email: value });
        if (!res || res.error || !res.agent) {
          elAgent.textContent = (res && res.error) || "Couldn't look up that email.";
          return;
        }
        await settingsAPI.saveSettings({
          ticketNotifyAgentId: res.agent.id,
          ticketNotifyAgentName: res.agent.name || "",
          ticketNotifyAgentEmail: res.agent.email || value,
        });
      } catch {
        elAgent.textContent = "Couldn't reach the Freshservice plugin. Is it turned on?";
      } finally {
        elFind.disabled = false;
      }
    }

    elFind.addEventListener("click", findAgent);
    elEmail.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); findAgent(); }
    });

    elOther.addEventListener("change", function () {
      settingsAPI.saveSettings({ ticketNotifyOtherAgents: elOther.checked });
    });
    elDesktop.addEventListener("change", function () {
      elSound.disabled = !elDesktop.checked;
      settingsAPI.saveSettings({ ticketNotifyDesktop: elDesktop.checked });
    });
    elSound.addEventListener("change", function () {
      settingsAPI.saveSettings({ ticketNotifySound: elSound.checked });
    });
    elInterval.addEventListener("change", function () {
      settingsAPI.saveSettings({ ticketNotifyInterval: Number(elInterval.value) });
    });

    elTest.addEventListener("click", function () {
      if (typeof Notification !== "function") {
        elTestResult.textContent = "Desktop notifications aren't available here.";
        return;
      }
      elTestResult.textContent = "";
      try {
        const n = new Notification("New reply on #12345", {
          body: "Printer offline on floor 2\nrequester@example.com: It's working again, thanks!",
          silent: !elSound.checked,
        });
        n.onerror = function () {
          elTestResult.textContent = "Windows didn't show the notification. Check that notifications are on for MSP++ in Windows Settings → System → Notifications.";
        };
      } catch {
        elTestResult.textContent = "The test notification couldn't be shown.";
      }
    });

    // The last check's result, from the main window.
    async function refreshStatus() {
      if (!panel.offsetParent) return; // tab not showing
      let st = null;
      try { st = await invoke("ticket-notifications", "get-status"); } catch { /* plugin off */ }
      if (!st || !st.checkedAt) {
        elStatus.textContent = settingsAPI.getSettings().ticketNotifyAgentId
          ? "Waiting for the first check (about 15 seconds after MSP++ starts)."
          : "";
        return;
      }
      let text = "Last check " + timeLabel(st.checkedAt) + ": " + st.message;
      if (st.lastNotifiedAt) text += " Last notification " + timeLabel(st.lastNotifiedAt) + ".";
      elStatus.textContent = text;
    }
    refreshStatus();
    setInterval(refreshStatus, 5000);
  });
}());
