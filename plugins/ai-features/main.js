"use strict";

const { createM365Client, TENANT_PATTERN, CLIENT_ID_PATTERN } = require("./m365");

const PROVIDERS = ["hatz", "openai", "anthropic", "azure", "m365copilot"];

const MAX_NOTES_CHARS        = 8000;
const MAX_CONTEXT_CHARS      = 4000;
const MAX_INSTRUCTIONS_CHARS = 500;

module.exports = {

  defaultSettings: {
    aiEnabled: true,
    aiProvider: "hatz",
    aiModelName: "",
    aiAzureEndpoint: "",
    aiM365TenantId: "",
    aiM365ClientId: "",
  },

  validateSettings: function (s) {
    if (s.aiEnabled !== undefined && typeof s.aiEnabled !== "boolean") return false;
    if (s.aiProvider !== undefined && !["none", ...PROVIDERS].includes(s.aiProvider)) return false;
    if (s.aiModelName !== undefined && (typeof s.aiModelName !== "string" || s.aiModelName.length > 100)) return false;
    if (s.aiApiKey !== undefined && (typeof s.aiApiKey !== "string" || s.aiApiKey.length > 500)) return false;
    if (s.aiApiKeyEncrypted !== undefined && (typeof s.aiApiKeyEncrypted !== "string" || s.aiApiKeyEncrypted.length > 2000)) return false;
    if (s.aiAzureEndpoint !== undefined) {
      if (typeof s.aiAzureEndpoint !== "string" || s.aiAzureEndpoint.length > 300) return false;
      if (s.aiAzureEndpoint && normalizeAzureEndpoint(s.aiAzureEndpoint) === null) return false;
    }
    if (s.aiM365TenantId !== undefined && (typeof s.aiM365TenantId !== "string" || (s.aiM365TenantId && !TENANT_PATTERN.test(s.aiM365TenantId)))) return false;
    if (s.aiM365ClientId !== undefined && (typeof s.aiM365ClientId !== "string" || (s.aiM365ClientId && !CLIENT_ID_PATTERN.test(s.aiM365ClientId)))) return false;
    return true;
  },

  init: function (api) {

    const m365 = createM365Client(api);

    // Encrypt any plaintext aiApiKey before it reaches disk; never write plaintext credentials.
    api.registerSettingsTransformer(function (settings) {
      if (settings.aiApiKey) {
        const encrypted = api.encryptCredential(settings.aiApiKey);
        if (encrypted) settings.aiApiKeyEncrypted = encrypted;
      }
      delete settings.aiApiKey; // Always remove plaintext from the saved copy
      return settings;
    });

    // Retrieves the API key from either the new encrypted field or the old plaintext field.
    function getApiKey(settings) {
      if (settings.aiApiKey) return settings.aiApiKey;
      if (settings.aiApiKeyEncrypted) return api.decryptCredential(settings.aiApiKeyEncrypted) || "";
      return "";
    }

    async function callAiChat(prompt, aiSettings) {
      const { aiProvider, aiApiKey, aiModelName } = aiSettings;

      if (aiProvider === "m365copilot") {
        const s = api.getSettings();
        return m365.chat(prompt, s.aiM365TenantId, s.aiM365ClientId);
      }

      if (aiProvider === "azure") {
        // Azure OpenAI v1 API: the "model" is the name of your deployment.
        const endpoint = normalizeAzureEndpoint(api.getSettings().aiAzureEndpoint || "");
        const resp = await fetch(endpoint + "/openai/v1/chat/completions", {
          method: "POST",
          headers: { "api-key": aiApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ model: aiModelName, messages: [{ role: "user", content: prompt }] }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Azure OpenAI error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return json.choices?.[0]?.message?.content ?? "";
      }

      if (aiProvider === "anthropic") {
        const model = aiModelName || "claude-opus-4-6";
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": aiApiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Anthropic API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return json.content?.[0]?.text ?? "";
      }

      if (aiProvider === "openai") {
        const model = aiModelName || "gpt-4o";
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`OpenAI API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return json.choices?.[0]?.message?.content ?? "";
      }

      // Hatz AI (OpenAI-compatible)
      const model = aiModelName || "gpt-4o";
      const resp = await fetch("https://ai.hatz.ai/v1/chat/completions", {
        method: "POST",
        headers: { "X-API-Key": aiApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], model }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Hatz AI error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
      }
      const json = await resp.json();
      return json.choices?.[0]?.message?.content ?? "";
    }

    async function fetchAiModels(aiProvider, aiApiKey) {
      if (aiProvider === "openai") {
        const resp = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${aiApiKey}` },
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`OpenAI API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return (json.data || [])
          .filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id || ""))
          .sort((a, b) => (b.created || 0) - (a.created || 0))
          .map((m) => ({ value: m.id, label: m.id }));
      }

      if (aiProvider === "anthropic") {
        const resp = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": aiApiKey, "anthropic-version": "2023-06-01" },
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Anthropic API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return (json.data || []).map((m) => ({
          value: m.id,
          label: m.display_name ? `${m.display_name} (${m.id})` : m.id,
        }));
      }

      // Hatz AI
      const resp = await fetch("https://ai.hatz.ai/v1/chat/models", {
        headers: { "X-API-Key": aiApiKey },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
      }
      const json = await resp.json();
      const raw = Array.isArray(json) ? json : (json.data || json.models || []);
      return raw
        .map((m) => {
          if (typeof m === "string") return { value: m, label: m };
          const value = m?.name || m?.id;
          const label = m?.display_name ? `${m.display_name} (${value})` : value;
          return value ? { value, label } : null;
        })
        .filter(Boolean);
    }

    // Returns an error message if the selected provider isn't fully configured, else null.
    function configError(provider, settings, aiApiKey) {
      const notConfigured = "No AI provider configured. Add your API key in Settings → AI Features.";
      if (!PROVIDERS.includes(provider)) return notConfigured;
      if (provider === "m365copilot") {
        if (!m365.status(settings.aiM365TenantId, settings.aiM365ClientId)) {
          return "Not signed in to Microsoft 365. Enter your tenant and client IDs and click Sign in under Settings → AI Features.";
        }
        return null;
      }
      if (!aiApiKey) return notConfigured;
      if (provider === "azure") {
        if (!normalizeAzureEndpoint(settings.aiAzureEndpoint || "")) return "Enter your Azure OpenAI endpoint in Settings → AI Features.";
        if (!settings.aiModelName) return "Enter your Azure OpenAI deployment name in Settings → AI Features.";
      }
      return null;
    }

    api.handle("suggest", async function ({ text, ticketContext, customInstructions, settings: aiSettings }) {
      const provider = aiSettings?.aiProvider;
      const current = api.getSettings();
      const aiApiKey = getApiKey(current);
      const notReady = aiSettings ? configError(provider, current, aiApiKey) : "No AI provider configured.";
      if (notReady) return { error: notReady };
      const safeText = (text || "").substring(0, MAX_NOTES_CHARS);
      const safeContext = (ticketContext || "").substring(0, MAX_CONTEXT_CHARS);
      const safeInstructions = (customInstructions || "").substring(0, MAX_INSTRUCTIONS_CHARS);
      const contextSection =
        safeContext.trim().length > 20
          ? "\n\nFor background, here are the existing ticket notes for context (do not repeat or summarize these — they are reference only):\n\n" +
            safeContext.trim() + "\n\n---\n\n"
          : "";
      const instructionsSection = safeInstructions.trim()
        ? "\nAdditional user instructions: " + safeInstructions.trim() + "\n"
        : "";
      const prompt =
        "You are a professional writing assistant for an IT help desk. " +
        "Improve the following text for clarity, grammar, and professionalism.\n\n" +
        "CRITICAL — preserve the original voice and intended audience:\n" +
        "- If the text addresses a client directly (has a salutation or uses second-person \"you\"/\"your\"), keep it as a second-person client-facing message. Do NOT rewrite it as a third-person internal note.\n" +
        "- If the text is an internal note (uses third person, refers to \"the client\", \"the user\", or \"they\"), keep it as a third-person internal note. Do NOT convert it to second person.\n\n" +
        "Do not use em-dashes or en-dashes — use commas, periods, or hyphens instead. " +
        "Do not add, include, or preserve any signature, sign-off, closing line, or contact information at the end.\n" +
        instructionsSection +
        "Reply with only the improved text, no preamble, no labels, no explanation." +
        contextSection +
        "\n\nText to improve:\n\n" + safeText;
      try {
        return { result: await callAiChat(prompt, Object.assign({}, aiSettings, { aiApiKey })) };
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    api.handle("summarize", async function ({ text, settings: aiSettings }) {
      const provider = aiSettings?.aiProvider;
      const current = api.getSettings();
      const aiApiKey = getApiKey(current);
      const notReady = aiSettings ? configError(provider, current, aiApiKey) : "No AI provider configured.";
      if (notReady) return { error: notReady };
      const safeText = (text || "").substring(0, MAX_NOTES_CHARS + MAX_CONTEXT_CHARS);
      const prompt =
        "Summarize the following Freshservice ticket conversation and notes into a concise bullet-point summary. " +
        "Capture the key issue, actions taken, and current status. " +
        "Do not use em-dashes or en-dashes in your response — use commas, periods, or hyphens instead. " +
        "Reply with only the summary, no preamble:\n\n" + safeText;
      try {
        return { result: await callAiChat(prompt, Object.assign({}, aiSettings, { aiApiKey })) };
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    api.handle("m365-status", async function () {
      const s = api.getSettings();
      return m365.status(s.aiM365TenantId, s.aiM365ClientId) || { account: null };
    });

    api.handle("m365-sign-in", async function (data) {
      const s = api.getSettings();
      const tenant = (data && typeof data.tenant === "string" && data.tenant) || s.aiM365TenantId;
      const clientId = (data && typeof data.clientId === "string" && data.clientId) || s.aiM365ClientId;
      try {
        return await m365.signIn(tenant, clientId);
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    api.handle("m365-sign-out", async function () {
      m365.signOut();
      return { ok: true };
    });

    api.handle("get-models", async function ({ aiProvider }) {
      const aiApiKey = getApiKey(api.getSettings());
      // Azure deployments and Microsoft 365 Copilot have no model list to choose from.
      if (!["hatz", "openai", "anthropic"].includes(aiProvider) || !aiApiKey) {
        return { error: "No provider configured" };
      }
      try {
        const models = await fetchAiModels(aiProvider, aiApiKey);
        if (!models.length) return { error: "Empty model list returned" };
        return { models };
      } catch (err) {
        api.log("get-models failed:", err);
        return { error: err.message || String(err) };
      }
    });
  },
};

// Accepts an Azure OpenAI / Foundry resource URL with or without a trailing path
// (e.g. https://contoso.openai.azure.com/ or .../openai/v1/) and returns its origin,
// or null if it isn't an https URL.
function normalizeAzureEndpoint(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
