(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("freshservice-api", "Freshservice API", function (panel) {

    const section = document.createElement("div");
    section.className = "settings-section";

    section.innerHTML =
      '<h3 class="settings-section-title">Freshservice API</h3>' +

      '<div class="settings-field">' +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="fsapi-plugin-enabled" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Read ticket details through the API</span>' +
      "  </label>" +
      "</div>" +

      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-field-label" for="fsapi-plugin-domain">Freshservice Domain</label>' +
      '  <input type="text" id="fsapi-plugin-domain" class="settings-text-input"' +
      '    placeholder="yourcompany.freshservice.com" maxlength="300" spellcheck="false" autocomplete="off" />' +
      "</div>" +

      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-field-label" for="fsapi-plugin-key">API Key</label>' +
      '  <input type="password" id="fsapi-plugin-key" class="settings-text-input"' +
      '    placeholder="Paste your API key here" maxlength="200" autocomplete="off" />' +
      "</div>" +

      '<div class="settings-field">' +
      '  <div class="settings-field-row">' +
      '    <button type="button" id="fsapi-plugin-test" class="btn btn-small btn-primary">Test connection</button>' +
      '    <button type="button" id="fsapi-plugin-remove" class="btn btn-small btn-secondary">Remove key</button>' +
      '    <span id="fsapi-plugin-status" class="settings-description"></span>' +
      "  </div>" +
      "</div>" +

      '<p class="settings-description settings-description-field">' +
      "Find your key in Freshservice under your profile → Profile Settings → API Key. " +
      "Summarize and Suggest read tickets through the API when this is set up, and read the page as before " +
      "when it isn't, or for changes, problems and releases. The key is stored encrypted and only sent to the domain above." +
      "</p>";

    panel.appendChild(section);

    const elEnabled = panel.querySelector("#fsapi-plugin-enabled");
    const elDomain  = panel.querySelector("#fsapi-plugin-domain");
    const elKey     = panel.querySelector("#fsapi-plugin-key");
    const elTest    = panel.querySelector("#fsapi-plugin-test");
    const elRemove  = panel.querySelector("#fsapi-plugin-remove");
    const elStatus  = panel.querySelector("#fsapi-plugin-status");

    // Mirrors normalizeDomain in main.js.
    function normalizeDomain(raw) {
      let value = String(raw || "").trim();
      if (!value) return null;
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;
      let url;
      try { url = new URL(value); } catch { return null; }
      if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
      const host = url.hostname.toLowerCase();
      return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
    }

    function applyForm(s) {
      elEnabled.checked = s.fsApiEnabled !== false;
      if (document.activeElement !== elDomain) elDomain.value = s.fsApiDomain || "";
      elKey.value = "";
      elKey.placeholder = s.fsApiKeySet ? "••••••••  (saved)" : "Paste your API key here";
      elRemove.style.display = s.fsApiKeySet ? "" : "none";
    }

    applyForm(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(applyForm);

    elEnabled.addEventListener("change", function () {
      settingsAPI.saveSettings({ fsApiEnabled: elEnabled.checked });
    });

    elDomain.addEventListener("change", function () {
      const raw = elDomain.value.trim();
      const domain = raw ? normalizeDomain(raw) : "";
      if (domain === null) {
        elDomain.setCustomValidity("Enter your Freshservice host name, e.g. yourcompany.freshservice.com");
        elDomain.reportValidity();
        return;
      }
      elDomain.setCustomValidity("");
      elDomain.value = domain;
      settingsAPI.saveSettings({ fsApiDomain: domain });
    });
    elDomain.addEventListener("input", function () { elDomain.setCustomValidity(""); });

    elKey.addEventListener("change", async function () {
      const val = elKey.value.trim();
      if (!val) return;
      elKey.value = "";
      const result = await settingsAPI.saveSettings({ fsApiKey: val });
      if (!result || !result.success) {
        elKey.setCustomValidity((result && result.error) || "The API key could not be saved.");
        elKey.reportValidity();
        return;
      }
      elKey.placeholder = "••••••••  (saved)";
      elRemove.style.display = "";
      elStatus.textContent = "";
    });
    elKey.addEventListener("input", function () { elKey.setCustomValidity(""); });

    elRemove.addEventListener("click", async function () {
      const result = await settingsAPI.saveSettings({ fsApiKeyRemove: true });
      if (!result || !result.success) {
        elStatus.textContent = "The API key could not be removed.";
        return;
      }
      elKey.placeholder = "Paste your API key here";
      elRemove.style.display = "none";
      elStatus.textContent = "API key removed";
    });

    elTest.addEventListener("click", async function () {
      elTest.disabled = true;
      elStatus.textContent = "Testing…";
      try {
        const result = await window.backupAPI.pluginInvoke("plugin:freshservice-api:test-connection", {});
        elStatus.textContent = result && result.ok
          ? "Connected to " + result.domain
          : ((result && result.error) || "Connection failed");
      } catch {
        elStatus.textContent = "Connection failed";
      } finally {
        elTest.disabled = false;
      }
    });
  });

}());
