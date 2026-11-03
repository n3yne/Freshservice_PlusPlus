// Solutions Chat plugin — Settings window panel
// Solutions Chat has no settings of its own: it uses AI Features for the AI and
// the Freshservice API plugin for articles. This panel shows whether both are
// ready and lets you test a Solutions search with the saved API key.
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  const PROVIDER_NAMES = {
    hatz: "Hatz AI",
    openai: "OpenAI",
    anthropic: "Anthropic",
    azure: "Azure OpenAI",
    m365copilot: "Microsoft 365 Copilot",
  };

  settingsAPI.addPanel("solutions-chat", "Solutions Chat", function (panel) {
    const section = document.createElement("div");
    section.className = "settings-section";
    section.innerHTML =
      '<h3 class="settings-section-title">Solutions Chat</h3>' +
      '<p class="settings-description settings-description-field">' +
      "Open the <strong>📚 Solutions</strong> tab in the side panel to use the chat. It answers from your Freshservice " +
      "Solutions articles using the AI provider from <strong>AI Features</strong> and the domain and API key from " +
      "<strong>Freshservice API</strong>, so it has no settings of its own. Both need to be set up:" +
      "</p>" +
      '<ul class="sc-settings-checklist">' +
      '  <li id="sc-settings-ai"></li>' +
      '  <li id="sc-settings-fs"></li>' +
      "</ul>" +
      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-field-label" for="sc-settings-term">Test a Solutions search</label>' +
      '  <div class="settings-field-row">' +
      '    <input type="text" id="sc-settings-term" class="settings-text-input" placeholder="e.g. password reset"' +
      '      maxlength="200" spellcheck="false" autocomplete="off" />' +
      '    <button type="button" id="sc-settings-test" class="btn btn-small btn-primary">Search</button>' +
      "  </div>" +
      '  <p id="sc-settings-result" class="settings-description"></p>' +
      "</div>" +
      '<p class="settings-description settings-description-field">' +
      "The search checks that your Freshservice API key is allowed to read Solutions articles." +
      "</p>";
    panel.appendChild(section);

    const elAi = panel.querySelector("#sc-settings-ai");
    const elFs = panel.querySelector("#sc-settings-fs");
    const elTerm = panel.querySelector("#sc-settings-term");
    const elTest = panel.querySelector("#sc-settings-test");
    const elResult = panel.querySelector("#sc-settings-result");

    function setLine(el, ok, text) {
      el.textContent = (ok ? "✓ " : "✗ ") + text;
      el.className = ok ? "sc-ok" : "sc-missing";
    }

    async function m365SignedIn() {
      try {
        const res = await window.backupAPI.pluginInvoke("plugin:ai-features:m365-status", {});
        return !!(res && res.account);
      } catch { return false; }
    }

    let renderSeq = 0;
    async function render(s) {
      const seq = ++renderSeq;
      const provider = s.aiProvider;
      const name = PROVIDER_NAMES[provider];
      if (!name) {
        setLine(elAi, false, "AI Features: choose a provider in Plugins → AI Features.");
      } else if (provider === "m365copilot") {
        const ok = await m365SignedIn();
        if (seq !== renderSeq) return;
        setLine(elAi, ok, ok
          ? "AI Features: using Microsoft 365 Copilot."
          : "AI Features: Microsoft 365 Copilot is selected but not signed in.");
      } else {
        // aiApiKeySet says a key is saved; AI Features only uses it for the provider it was entered for.
        const keyed = s.aiApiKeySet && (!s.aiApiKeyProvider || s.aiApiKeyProvider === provider);
        setLine(elAi, !!keyed, keyed
          ? "AI Features: using " + name + "."
          : "AI Features: " + name + " is selected but has no API key.");
      }

      if (s.fsApiEnabled === false) {
        setLine(elFs, false, "Freshservice API: turned off. Turn it on in Plugins → Freshservice API.");
      } else if (!s.fsApiDomain) {
        setLine(elFs, false, "Freshservice API: enter your domain in Plugins → Freshservice API.");
      } else if (!s.fsApiKeySet) {
        setLine(elFs, false, "Freshservice API: enter your API key in Plugins → Freshservice API.");
      } else {
        setLine(elFs, true, "Freshservice API: connected to " + s.fsApiDomain + ".");
      }
    }

    render(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(render);

    async function testSearch() {
      const term = elTerm.value.trim();
      if (!term) { elTerm.focus(); return; }
      elTest.disabled = true;
      elResult.textContent = "Searching…";
      try {
        const res = await window.backupAPI.pluginInvoke("plugin:freshservice-api:search-solutions", { term });
        if (!res || res.error) {
          elResult.textContent = (res && res.error) || "The search failed.";
        } else if (!res.articles.length) {
          elResult.textContent = "The search worked but found no articles for “" + term + "”.";
        } else {
          const titles = res.articles.slice(0, 3).map(function (a) { return "“" + a.title + "”"; }).join(", ");
          elResult.textContent = "Found " + res.articles.length + " article" + (res.articles.length === 1 ? "" : "s") +
            ", including " + titles + ".";
        }
      } catch {
        elResult.textContent = "The Freshservice API plugin isn't available. Turn it on under Plugins and restart.";
      } finally {
        elTest.disabled = false;
      }
    }

    elTest.addEventListener("click", testSearch);
    elTerm.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); testSearch(); }
    });
  });
}());
