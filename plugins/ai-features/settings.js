(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("ai-features", "AI Features", function (panel) {

    const section = document.createElement("div");
    section.className = "settings-section";

    section.innerHTML =
      '<h3 class="settings-section-title">AI Features</h3>' +

      '<div class="settings-field">' +
      '  <label class="settings-field-label" for="ai-plugin-provider">Provider</label>' +
      '  <div class="settings-field-row">' +
      '    <select id="ai-plugin-provider" class="settings-select-input" title="AI provider">' +
      '      <option value="hatz">Hatz AI</option>' +
      '      <option value="openai">OpenAI</option>' +
      '      <option value="anthropic">Anthropic</option>' +
      "    </select>" +
      "  </div>" +
      "</div>" +

      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-field-label" for="ai-plugin-model">Model</label>' +
      '  <select id="ai-plugin-model" class="settings-select-input">' +
      '    <option value="" disabled selected>Enter API key first</option>' +
      "  </select>" +
      "</div>" +

      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-field-label" for="ai-plugin-key">API Key</label>' +
      '  <input type="password" id="ai-plugin-key" class="settings-text-input"' +
      '    placeholder="Paste your API key here" maxlength="500" autocomplete="off" />' +
      "</div>" +
      '<p class="settings-description settings-description-field">' +
      "  For Hatz AI, generate your API key from the Hatz Admin Dashboard." +
      "</p>";

    panel.appendChild(section);

    const elProvider = panel.querySelector("#ai-plugin-provider");
    const elModel    = panel.querySelector("#ai-plugin-model");
    const elKey      = panel.querySelector("#ai-plugin-key");

    async function populateModelDropdown() {
      const s = settingsAPI.getSettings();
      if (!s.aiApiKeySet) {
        elModel.innerHTML = '<option value="" disabled selected>Enter API key first</option>';
        elModel.disabled = true;
        return;
      }
      elModel.innerHTML = '<option value="" disabled selected>Loading models…</option>';
      elModel.disabled = true;
      let result;
      try {
        result = await window.backupAPI.pluginInvoke("plugin:ai-features:get-models", {
          aiProvider: s.aiProvider || "hatz",
        });
      } catch {
        elModel.innerHTML = '<option value="" disabled selected>Error loading models</option>';
        elModel.disabled = false;
        return;
      }
      if (result.error || !result.models || !result.models.length) {
        const detail = result.error || "Empty model list returned";
        elModel.innerHTML = '<option value="" disabled selected></option>';
        elModel.options[0].textContent = "Error: " + detail.substring(0, 80);
        elModel.disabled = false;
        return;
      }
      elModel.innerHTML = "";
      result.models.forEach(function (m) {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        elModel.appendChild(opt);
      });
      const saved = settingsAPI.getSettings().aiModelName;
      const values = result.models.map(function (m) { return m.value; });
      if (saved && !values.includes(saved)) {
        const opt = document.createElement("option");
        opt.value = saved;
        opt.textContent = saved;
        elModel.insertBefore(opt, elModel.firstChild);
      }
      elModel.value = saved || values[0] || "";
      elModel.disabled = false;
      if (elModel.value !== saved) {
        settingsAPI.saveSettings({ aiModelName: elModel.value });
      }
    }

    function applyForm(s) {
      const provider = s.aiProvider && s.aiProvider !== "none" ? s.aiProvider : "hatz";
      elProvider.value = provider;
      elKey.value = "";
      elKey.placeholder = s.aiApiKeySet ? "••••••••  (saved)" : "Paste your API key here";
    }

    applyForm(settingsAPI.getSettings());
    if (settingsAPI.getSettings().aiApiKeySet) populateModelDropdown();

    settingsAPI.onSettingsChanged(function (s) {
      applyForm(s);
    });

    elProvider.addEventListener("change", function () {
      settingsAPI.saveSettings({ aiProvider: elProvider.value });
      populateModelDropdown();
    });

    elModel.addEventListener("change", function () {
      settingsAPI.saveSettings({ aiModelName: elModel.value });
    });

    elKey.addEventListener("change", function () {
      const val = elKey.value.trim();
      if (val) {
        settingsAPI.saveSettings({ aiApiKey: val });
        elKey.value = "";
        elKey.placeholder = "••••••••  (saved)";
        populateModelDropdown();
      }
    });
  });

}());
