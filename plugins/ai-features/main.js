"use strict";

module.exports = function (api) {

  async function callAiChat(prompt, aiSettings) {
    const { aiProvider, aiApiKey, aiModelName } = aiSettings;

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

  api.handle("suggest", async function ({ text, ticketContext, settings: aiSettings }) {
    const provider = aiSettings?.aiProvider;
    if (!aiSettings || !["hatz", "openai", "anthropic"].includes(provider) || !aiSettings.aiApiKey) {
      return { error: "No AI provider configured. Add your API key in Settings → AI Features." };
    }
    const contextSection =
      ticketContext && ticketContext.trim().length > 20
        ? "\n\nFor background, here are the existing ticket notes for context (do not repeat or summarize these — they are reference only):\n\n" +
          ticketContext.trim() + "\n\n---\n\n"
        : "";
    const prompt =
      "Review the following technical support notes and provide an improved version with better clarity, grammar, and professionalism. " +
      "Do not use em-dashes or en-dashes in your response — use commas, periods, or hyphens instead. " +
      "Do not add, include, or preserve any signature, sign-off, closing line, or contact information at the end. " +
      "Reply with only the improved notes text, no preamble, no labels, no explanation:" +
      contextSection +
      "\n\nNotes to improve:\n\n" + text;
    try {
      return { result: await callAiChat(prompt, aiSettings) };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  api.handle("summarize", async function ({ text, settings: aiSettings }) {
    const provider = aiSettings?.aiProvider;
    if (!aiSettings || !["hatz", "openai", "anthropic"].includes(provider) || !aiSettings.aiApiKey) {
      return { error: "No AI provider configured. Add your API key in Settings → AI Features." };
    }
    const prompt =
      "Summarize the following ConnectWise ticket notes into a concise bullet-point summary. " +
      "Capture the key issue, actions taken, and current status. " +
      "Do not use em-dashes or en-dashes in your response — use commas, periods, or hyphens instead. " +
      "Reply with only the summary, no preamble:\n\n" + text;
    try {
      return { result: await callAiChat(prompt, aiSettings) };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  api.handle("get-models", async function ({ aiProvider, aiApiKey }) {
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
};
