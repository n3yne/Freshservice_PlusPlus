"use strict";

const metricsBar = require("../plugins/metrics-bar/main");
const aiFeatures = require("../plugins/ai-features/main");

const { validateSettings: validateMetrics, migrateSettings, defaultSettings: metricsDefaults } = metricsBar;
const { validateSettings: validateAi, defaultSettings: aiDefaults } = aiFeatures;

// ===================== metrics-bar: validateSettings =====================

describe("metrics-bar validateSettings", () => {

  test("accepts defaultSettings unchanged", () => {
    expect(validateMetrics(metricsDefaults)).toBe(true);
  });

  test("accepts empty object (all keys optional)", () => {
    expect(validateMetrics({})).toBe(true);
  });

  // metricsBarEnabled
  test("accepts boolean metricsBarEnabled", () => {
    expect(validateMetrics({ metricsBarEnabled: true })).toBe(true);
    expect(validateMetrics({ metricsBarEnabled: false })).toBe(true);
  });
  test("rejects non-boolean metricsBarEnabled", () => {
    expect(validateMetrics({ metricsBarEnabled: 1 })).toBe(false);
    expect(validateMetrics({ metricsBarEnabled: "yes" })).toBe(false);
  });

  // metricsBarInterval
  test("accepts valid interval values", () => {
    for (const v of [5, 15, 30, 60]) {
      expect(validateMetrics({ metricsBarInterval: v })).toBe(true);
    }
  });
  test("rejects invalid interval values", () => {
    expect(validateMetrics({ metricsBarInterval: 10 })).toBe(false);
    expect(validateMetrics({ metricsBarInterval: "15" })).toBe(false);
  });

  // metricsBarDashboards
  test("accepts empty dashboards array", () => {
    expect(validateMetrics({ metricsBarDashboards: [] })).toBe(true);
  });
  test("accepts valid dashboard entry", () => {
    expect(validateMetrics({
      metricsBarDashboards: [{
        id: "db1",
        url: "https://example.com",
        fields: [{ id: "f1", label: "Field 1", selector: ".value" }],
      }],
    })).toBe(true);
  });
  test("rejects non-array metricsBarDashboards", () => {
    expect(validateMetrics({ metricsBarDashboards: "nope" })).toBe(false);
  });
  test("rejects dashboard missing required fields", () => {
    expect(validateMetrics({ metricsBarDashboards: [{ id: "", url: "", fields: [] }] })).toBe(false);
    expect(validateMetrics({ metricsBarDashboards: [{ id: "x", url: "", fields: "bad" }] })).toBe(false);
  });
  test("rejects field missing required properties", () => {
    expect(validateMetrics({
      metricsBarDashboards: [{
        id: "db1", url: "https://x.com",
        fields: [{ id: "", label: "L", selector: ".s" }],
      }],
    })).toBe(false);
  });

  // metricsProgressEnabled
  test("accepts boolean metricsProgressEnabled", () => {
    expect(validateMetrics({ metricsProgressEnabled: true })).toBe(true);
    expect(validateMetrics({ metricsProgressEnabled: false })).toBe(true);
  });
  test("rejects non-boolean metricsProgressEnabled", () => {
    expect(validateMetrics({ metricsProgressEnabled: 0 })).toBe(false);
    expect(validateMetrics({ metricsProgressEnabled: "false" })).toBe(false);
  });

  // metricsWorkDays
  test("accepts valid work days array", () => {
    expect(validateMetrics({ metricsWorkDays: [1, 2, 3, 4, 5] })).toBe(true);
    expect(validateMetrics({ metricsWorkDays: [] })).toBe(true);
    expect(validateMetrics({ metricsWorkDays: [0, 6] })).toBe(true);
  });
  test("rejects non-array metricsWorkDays", () => {
    expect(validateMetrics({ metricsWorkDays: "monday" })).toBe(false);
    expect(validateMetrics({ metricsWorkDays: 1 })).toBe(false);
  });
  test("rejects metricsWorkDays with out-of-range values", () => {
    expect(validateMetrics({ metricsWorkDays: [0, 1, 9] })).toBe(false);
    expect(validateMetrics({ metricsWorkDays: [-1] })).toBe(false);
  });
  test("rejects metricsWorkDays with non-integer values", () => {
    expect(validateMetrics({ metricsWorkDays: [1.5] })).toBe(false);
    expect(validateMetrics({ metricsWorkDays: ["1"] })).toBe(false);
  });
  test("rejects metricsWorkDays longer than 7", () => {
    expect(validateMetrics({ metricsWorkDays: [0, 1, 2, 3, 4, 5, 6, 0] })).toBe(false);
  });

  // metricsWorkWeekEndDay
  test("accepts valid week-end day 0-6", () => {
    for (let d = 0; d <= 6; d++) {
      expect(validateMetrics({ metricsWorkWeekEndDay: d })).toBe(true);
    }
  });
  test("rejects out-of-range metricsWorkWeekEndDay", () => {
    expect(validateMetrics({ metricsWorkWeekEndDay: 7 })).toBe(false);
    expect(validateMetrics({ metricsWorkWeekEndDay: -1 })).toBe(false);
  });
  test("rejects non-integer metricsWorkWeekEndDay", () => {
    expect(validateMetrics({ metricsWorkWeekEndDay: 1.5 })).toBe(false);
    expect(validateMetrics({ metricsWorkWeekEndDay: "5" })).toBe(false);
  });

  // metricsWorkHoursStart / metricsWorkHoursEnd
  test("accepts HH:MM formatted work hours", () => {
    expect(validateMetrics({ metricsWorkHoursStart: "08:00" })).toBe(true);
    expect(validateMetrics({ metricsWorkHoursEnd: "17:30" })).toBe(true);
  });
  test("rejects badly formatted work hours", () => {
    expect(validateMetrics({ metricsWorkHoursStart: "8am" })).toBe(false);
    expect(validateMetrics({ metricsWorkHoursStart: "8:00" })).toBe(false);
    expect(validateMetrics({ metricsWorkHoursEnd: "25:00" })).toBe(true); // format-only check, 25:00 passes regex
    expect(validateMetrics({ metricsWorkHoursStart: 800 })).toBe(false);
  });
  test("rejects non-string work hours", () => {
    expect(validateMetrics({ metricsWorkHoursStart: 8 })).toBe(false);
  });

  // metricsLunchMinutes
  test("accepts valid lunch minutes", () => {
    expect(validateMetrics({ metricsLunchMinutes: 0 })).toBe(true);
    expect(validateMetrics({ metricsLunchMinutes: 60 })).toBe(true);
    expect(validateMetrics({ metricsLunchMinutes: 480 })).toBe(true);
  });
  test("rejects out-of-range lunch minutes", () => {
    expect(validateMetrics({ metricsLunchMinutes: -1 })).toBe(false);
    expect(validateMetrics({ metricsLunchMinutes: 481 })).toBe(false);
  });

  // metricsTimeOff
  test("accepts valid time-off entries", () => {
    expect(validateMetrics({
      metricsTimeOff: [{ date: "2026-06-17", hours: 8 }],
    })).toBe(true);
  });
  test("rejects non-array metricsTimeOff", () => {
    expect(validateMetrics({ metricsTimeOff: "nope" })).toBe(false);
  });
  test("rejects time-off with bad date format", () => {
    expect(validateMetrics({
      metricsTimeOff: [{ date: "06/17/2026", hours: 8 }],
    })).toBe(false);
  });
  test("rejects time-off with out-of-range hours", () => {
    expect(validateMetrics({
      metricsTimeOff: [{ date: "2026-06-17", hours: 25 }],
    })).toBe(false);
  });

});

// ===================== metrics-bar: migrateSettings =====================

describe("metrics-bar migrateSettings", () => {

  test("migrates legacy single-dashboard format to dashboards array", () => {
    const parsed = {
      metricsBarUrl: "https://example.com",
      metricsBarFields: [{ id: "f1", label: "L", selector: ".s" }],
    };
    migrateSettings(parsed);
    expect(Array.isArray(parsed.metricsBarDashboards)).toBe(true);
    expect(parsed.metricsBarDashboards[0].url).toBe("https://example.com");
    expect(parsed.metricsBarDashboards[0].fields).toHaveLength(1);
    expect(parsed.metricsBarUrl).toBeUndefined();
    expect(parsed.metricsBarFields).toBeUndefined();
  });

  test("creates empty dashboards array when only metricsBarFields present (no url)", () => {
    const parsed = { metricsBarFields: [{ id: "f1", label: "L", selector: ".s" }] };
    migrateSettings(parsed);
    expect(parsed.metricsBarDashboards).toEqual([]);
    expect(parsed.metricsBarFields).toBeUndefined();
  });

  test("removes legacy keys even when metricsBarDashboards already present", () => {
    const parsed = {
      metricsBarDashboards: [{ id: "existing", url: "https://x.com", fields: [] }],
      metricsBarUrl: "https://old.com",
      metricsBarFields: [],
    };
    migrateSettings(parsed);
    expect(parsed.metricsBarDashboards).toHaveLength(1); // not re-migrated
    expect(parsed.metricsBarUrl).toBeUndefined();
    expect(parsed.metricsBarFields).toBeUndefined();
  });

  test("no-ops on already-migrated settings", () => {
    const parsed = { metricsBarDashboards: [] };
    migrateSettings(parsed);
    expect(parsed.metricsBarDashboards).toEqual([]);
  });

});

// ===================== ai-features: validateSettings =====================

describe("ai-features validateSettings", () => {

  test("accepts defaultSettings unchanged", () => {
    expect(validateAi(aiDefaults)).toBe(true);
  });

  test("accepts empty object (all keys optional)", () => {
    expect(validateAi({})).toBe(true);
  });

  // aiEnabled
  test("accepts boolean aiEnabled", () => {
    expect(validateAi({ aiEnabled: true })).toBe(true);
    expect(validateAi({ aiEnabled: false })).toBe(true);
  });
  test("rejects non-boolean aiEnabled", () => {
    expect(validateAi({ aiEnabled: 1 })).toBe(false);
    expect(validateAi({ aiEnabled: "true" })).toBe(false);
  });

  // aiProvider
  test("accepts known providers", () => {
    for (const p of ["none", "hatz", "openai", "anthropic", "azure", "m365copilot"]) {
      expect(validateAi({ aiProvider: p })).toBe(true);
    }
  });
  test("rejects unknown provider", () => {
    expect(validateAi({ aiProvider: "gemini" })).toBe(false);
    expect(validateAi({ aiProvider: "" })).toBe(false);
  });

  // aiModelName
  test("accepts valid model names", () => {
    expect(validateAi({ aiModelName: "" })).toBe(true);
    expect(validateAi({ aiModelName: "gpt-4o" })).toBe(true);
    expect(validateAi({ aiModelName: "a".repeat(100) })).toBe(true);
  });
  test("rejects model name that is too long", () => {
    expect(validateAi({ aiModelName: "a".repeat(101) })).toBe(false);
  });
  test("rejects non-string model name", () => {
    expect(validateAi({ aiModelName: 4 })).toBe(false);
  });

  // aiApiKey (backward compat)
  test("accepts a short plaintext key", () => {
    expect(validateAi({ aiApiKey: "sk-abc123" })).toBe(true);
  });
  test("rejects plaintext key that is too long", () => {
    expect(validateAi({ aiApiKey: "a".repeat(501) })).toBe(false);
  });

  // aiApiKeyEncrypted
  test("accepts a valid encrypted key (≤2000 chars)", () => {
    expect(validateAi({ aiApiKeyEncrypted: "base64data" })).toBe(true);
  });
  test("rejects encrypted key that is too long", () => {
    expect(validateAi({ aiApiKeyEncrypted: "a".repeat(2001) })).toBe(false);
  });

  // aiAzureEndpoint
  test("accepts empty or https Azure endpoints", () => {
    expect(validateAi({ aiAzureEndpoint: "" })).toBe(true);
    expect(validateAi({ aiAzureEndpoint: "https://contoso.openai.azure.com/" })).toBe(true);
    expect(validateAi({ aiAzureEndpoint: "https://contoso.services.ai.azure.com/openai/v1/" })).toBe(true);
  });
  test("rejects non-https or malformed Azure endpoints", () => {
    expect(validateAi({ aiAzureEndpoint: "http://contoso.openai.azure.com" })).toBe(false);
    expect(validateAi({ aiAzureEndpoint: "not a url" })).toBe(false);
    expect(validateAi({ aiAzureEndpoint: 5 })).toBe(false);
  });

  // aiAzureDeployment / aiApiKeyProvider
  test("validates the Azure deployment name and key provider", () => {
    expect(validateAi({ aiAzureDeployment: "my-gpt4o" })).toBe(true);
    expect(validateAi({ aiAzureDeployment: "a".repeat(101) })).toBe(false);
    expect(validateAi({ aiApiKeyProvider: "" })).toBe(true);
    expect(validateAi({ aiApiKeyProvider: "azure" })).toBe(true);
    expect(validateAi({ aiApiKeyProvider: "gemini" })).toBe(false);
  });

  // aiM365TenantId / aiM365ClientId
  test("accepts tenant GUIDs and domains", () => {
    expect(validateAi({ aiM365TenantId: "" })).toBe(true);
    expect(validateAi({ aiM365TenantId: "contoso.onmicrosoft.com" })).toBe(true);
    expect(validateAi({ aiM365TenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47" })).toBe(true);
  });
  test("rejects tenant values that could alter the login URL", () => {
    expect(validateAi({ aiM365TenantId: "contoso/../evil" })).toBe(false);
    expect(validateAi({ aiM365TenantId: "a?b=c" })).toBe(false);
  });
  test("accepts only GUID client IDs", () => {
    expect(validateAi({ aiM365ClientId: "" })).toBe(true);
    expect(validateAi({ aiM365ClientId: "11111111-2222-3333-4444-555555555555" })).toBe(true);
    expect(validateAi({ aiM365ClientId: "my-app" })).toBe(false);
  });

});

// ===================== ai-features: provider calls =====================

describe("ai-features providers", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { cleanCopilotText } = require("../plugins/ai-features/m365");

  const TENANT = "contoso.onmicrosoft.com";
  const CLIENT = "11111111-2222-3333-4444-555555555555";

  let dataDir;
  let handlers;
  let settings;
  let realFetch;

  let transformer;

  function initPlugin(extraApi) {
    handlers = {};
    aiFeatures.init({
      handle: (name, fn) => { handlers[name] = fn; },
      getSettings: () => settings,
      getDataPath: () => dataDir,
      // Identity "encryption" keeps the test independent of the OS keychain.
      encryptCredential: (v) => v,
      decryptCredential: (v) => v,
      registerSettingsTransformer: (fn) => { transformer = fn; },
      log: () => {},
      ...extraApi,
    });
  }

  function jsonResponse(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fspp-ai-"));
    realFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("Azure OpenAI calls the v1 chat endpoint with the deployment as model", async () => {
    settings = { aiProvider: "azure", aiApiKey: "azkey", aiApiKeyProvider: "azure", aiModelName: "gpt-4o", aiAzureDeployment: "my-gpt4o", aiAzureEndpoint: "https://contoso.openai.azure.com/openai/v1/" };
    initPlugin();
    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, opts });
      return jsonResponse({ choices: [{ message: { content: "Improved." } }] });
    });

    const res = await handlers.suggest({ text: "fix printer", settings: { aiProvider: "azure", aiModelName: "gpt-4o" } });

    expect(res).toEqual({ result: "Improved." });
    expect(calls[0].url).toBe("https://contoso.openai.azure.com/openai/v1/chat/completions");
    expect(calls[0].opts.headers["api-key"]).toBe("azkey");
    expect(JSON.parse(calls[0].opts.body).model).toBe("my-gpt4o");
  });

  test("Azure OpenAI reports a missing endpoint or deployment", async () => {
    settings = { aiProvider: "azure", aiApiKey: "azkey", aiApiKeyProvider: "azure", aiAzureDeployment: "", aiAzureEndpoint: "https://contoso.openai.azure.com" };
    initPlugin();
    global.fetch = jest.fn();
    const noDeployment = await handlers.summarize({ text: "x", settings: { aiProvider: "azure" } });
    expect(noDeployment.error).toMatch(/deployment name/);

    settings = { ...settings, aiAzureDeployment: "dep", aiAzureEndpoint: "" };
    const noEndpoint = await handlers.summarize({ text: "x", settings: { aiProvider: "azure" } });
    expect(noEndpoint.error).toMatch(/endpoint/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("a key saved for one provider is never sent to another", async () => {
    settings = { aiProvider: "azure", aiApiKey: "sk-openai", aiApiKeyProvider: "openai", aiAzureDeployment: "dep", aiAzureEndpoint: "https://contoso.openai.azure.com" };
    initPlugin();
    global.fetch = jest.fn();
    const res = await handlers.suggest({ text: "x", settings: { aiProvider: "azure" } });
    expect(res.error).toMatch(/API key/);
    expect((await handlers["get-models"]({ aiProvider: "anthropic" })).error).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("keys saved before provider binding still work for the original providers only", async () => {
    settings = { aiProvider: "openai", aiApiKey: "sk-old", aiAzureDeployment: "dep", aiAzureEndpoint: "https://contoso.openai.azure.com" };
    initPlugin();
    global.fetch = jest.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    expect(await handlers.summarize({ text: "x", settings: { aiProvider: "openai" } })).toEqual({ result: "ok" });
    const azure = await handlers.summarize({ text: "x", settings: { aiProvider: "azure" } });
    expect(azure.error).toMatch(/API key/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("the settings transformer binds a new key to the selected provider and keeps the binding on resend", () => {
    settings = { aiProvider: "openai", aiApiKeyEncrypted: "sk-openai", aiApiKeyProvider: "openai" };
    initPlugin();
    // A new key entered while Azure is selected belongs to Azure.
    const fresh = transformer({ aiProvider: "azure", aiApiKey: "az-key", aiApiKeyProvider: "openai" });
    expect(fresh).toMatchObject({ aiApiKeyEncrypted: "az-key", aiApiKeyProvider: "azure" });
    expect(fresh.aiApiKey).toBeUndefined();
    // The settings window resending the already-saved key after a provider switch doesn't move it.
    const resent = transformer({ aiProvider: "anthropic", aiApiKey: "sk-openai", aiApiKeyProvider: "anthropic" });
    expect(resent.aiApiKeyProvider).toBe("openai");
    // A save without a key can't rebind it either.
    expect(transformer({ aiProvider: "hatz", aiApiKeyProvider: "hatz" }).aiApiKeyProvider).toBe("openai");
  });

  test("an empty reply is reported as an error", async () => {
    settings = { aiProvider: "openai", aiApiKey: "sk", aiApiKeyProvider: "openai" };
    initPlugin();
    global.fetch = jest.fn(async () => jsonResponse({ choices: [{ message: { content: "  " } }] }));
    const res = await handlers.suggest({ text: "x", settings: { aiProvider: "openai" } });
    expect(res.error).toMatch(/empty reply/);
  });

  test("requests that never answer time out with a readable error", async () => {
    settings = { aiProvider: "openai", aiApiKey: "sk", aiApiKeyProvider: "openai" };
    initPlugin();
    global.fetch = jest.fn(async (url, opts) => {
      expect(opts.signal).toBeDefined();
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });
    const res = await handlers.summarize({ text: "x", settings: { aiProvider: "openai" } });
    expect(res.error).toBe("OpenAI did not respond within 60 seconds");
  });

  test("Microsoft 365 Copilot requires sign-in", async () => {
    settings = { aiProvider: "m365copilot", aiM365TenantId: TENANT, aiM365ClientId: CLIENT };
    initPlugin();
    global.fetch = jest.fn();
    const res = await handlers.suggest({ text: "x", settings: { aiProvider: "m365copilot" } });
    expect(res.error).toMatch(/Not signed in to Microsoft 365/);
    expect(await handlers["m365-status"]()).toEqual({ account: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("Microsoft 365 Copilot refreshes the token, creates a conversation and returns the reply", async () => {
    settings = { aiProvider: "m365copilot", aiM365TenantId: TENANT, aiM365ClientId: CLIENT };
    fs.writeFileSync(path.join(dataDir, "m365-token.dat"),
      JSON.stringify({ tenant: TENANT, clientId: CLIENT, refreshToken: "rt-1", account: "agent@contoso.com" }));
    initPlugin();

    expect(await handlers["m365-status"]()).toEqual({ account: "agent@contoso.com" });

    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes("/oauth2/v2.0/token")) return jsonResponse({ access_token: "at-1", refresh_token: "rt-2", expires_in: 3600 });
      if (url.endsWith("/beta/copilot/conversations")) return jsonResponse({ id: "conv-1" });
      return jsonResponse({
        id: "conv-1",
        messages: [
          { text: "prompt echo" },
          { text: "Spoke with <Person>Jane Doe</Person> about the VPN.[^1^]" },
        ],
      });
    });

    const res = await handlers.summarize({ text: "ticket notes", settings: { aiProvider: "m365copilot" } });

    expect(res).toEqual({ result: "Spoke with Jane Doe about the VPN." });
    expect(calls[0].url).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    const tokenBody = new URLSearchParams(calls[0].opts.body);
    expect(tokenBody.get("grant_type")).toBe("refresh_token");
    expect(tokenBody.get("refresh_token")).toBe("rt-1");
    expect(tokenBody.get("client_id")).toBe(CLIENT);
    expect(calls[1].opts.headers.Authorization).toBe("Bearer at-1");
    expect(calls[2].url).toBe("https://graph.microsoft.com/beta/copilot/conversations/conv-1/chat");
    const chatBody = JSON.parse(calls[2].opts.body);
    expect(chatBody.message.text).toContain("ticket notes");
    expect(chatBody.contextualResources.webContext.isWebEnabled).toBe(false);
    expect(chatBody.locationHint.timeZone).toBeTruthy();

    // The rotated refresh token is persisted for next launch.
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "m365-token.dat"), "utf-8"));
    expect(stored.refreshToken).toBe("rt-2");
    expect(stored.accessToken).toBeUndefined();
  });

  test("Microsoft 365 Copilot refreshes and retries once when Graph rejects the access token", async () => {
    settings = { aiProvider: "m365copilot", aiM365TenantId: TENANT, aiM365ClientId: CLIENT };
    fs.writeFileSync(path.join(dataDir, "m365-token.dat"),
      JSON.stringify({ tenant: TENANT, clientId: CLIENT, refreshToken: "rt-1", account: "a" }));
    initPlugin();
    let tokens = 0;
    let rejected = false;
    const auth = [];
    global.fetch = jest.fn(async (url, opts) => {
      if (url.includes("/oauth2/v2.0/token")) { tokens++; return jsonResponse({ access_token: "at-" + tokens, expires_in: 3600 }); }
      auth.push(opts.headers.Authorization);
      if (!rejected) { rejected = true; return jsonResponse({ error: { message: "expired" } }, 401); }
      if (url.endsWith("/conversations")) return jsonResponse({ id: "c" });
      return jsonResponse({ messages: [{ text: "q" }, { text: "Answer" }] });
    });
    const res = await handlers.summarize({ text: "x", settings: { aiProvider: "m365copilot" } });
    expect(res).toEqual({ result: "Answer" });
    expect(tokens).toBe(2);
    expect(auth).toEqual(["Bearer at-1", "Bearer at-2", "Bearer at-2"]);
  });

  test("Microsoft 365 Copilot reports an empty reply as an error", async () => {
    settings = { aiProvider: "m365copilot", aiM365TenantId: TENANT, aiM365ClientId: CLIENT };
    fs.writeFileSync(path.join(dataDir, "m365-token.dat"),
      JSON.stringify({ tenant: TENANT, clientId: CLIENT, refreshToken: "rt-1", account: "a" }));
    initPlugin();
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/oauth2/v2.0/token")) return jsonResponse({ access_token: "at", expires_in: 3600 });
      if (url.endsWith("/conversations")) return jsonResponse({ id: "c" });
      return jsonResponse({ messages: [{ text: "q" }, { text: "[^1^]" }] });
    });
    const res = await handlers.summarize({ text: "x", settings: { aiProvider: "m365copilot" } });
    expect(res.error).toMatch(/empty reply/);
  });

  test("a stored sign-in for a different app registration doesn't count", async () => {
    settings = { aiProvider: "m365copilot", aiM365TenantId: TENANT, aiM365ClientId: "99999999-2222-3333-4444-555555555555" };
    fs.writeFileSync(path.join(dataDir, "m365-token.dat"),
      JSON.stringify({ tenant: TENANT, clientId: CLIENT, refreshToken: "rt-1", account: "agent@contoso.com" }));
    initPlugin();
    expect(await handlers["m365-status"]()).toEqual({ account: null });
  });

  test("sign-out deletes the stored token and clears the sign-in window's cookies", async () => {
    settings = { aiProvider: "m365copilot", aiM365TenantId: TENANT, aiM365ClientId: CLIENT };
    const file = path.join(dataDir, "m365-token.dat");
    fs.writeFileSync(file, JSON.stringify({ tenant: TENANT, clientId: CLIENT, refreshToken: "rt-1", account: "a" }));
    const clearStorageData = jest.fn(async () => {});
    const fromPartition = jest.fn(() => ({ clearStorageData }));
    jest.resetModules(); // drop any electron mock cached by an earlier test
    jest.doMock("electron", () => ({ session: { fromPartition } }), { virtual: true });
    initPlugin();
    await handlers["m365-sign-out"]();
    expect(fs.existsSync(file)).toBe(false);
    expect(await handlers["m365-status"]()).toEqual({ account: null });
    expect(fromPartition).toHaveBeenCalledWith("persist:fspp-m365-auth");
    expect(clearStorageData).toHaveBeenCalled();
    jest.dontMock("electron");
  });

  test("sign-in opens Microsoft login with PKCE and exchanges the returned code", async () => {
    settings = { aiProvider: "m365copilot", aiM365TenantId: "", aiM365ClientId: "" };
    let win;
    jest.resetModules(); // drop any electron mock cached by an earlier test
    jest.doMock("electron", () => ({
      BrowserWindow: class {
        constructor(opts) {
          win = this;
          this.opts = opts;
          this.handlers = {};
          this.destroyed = false;
          this.webContents = {
            on: (ev, fn) => { this.handlers[ev] = fn; },
            setWindowOpenHandler: () => {},
          };
        }
        static getFocusedWindow() { return null; }
        on(ev, fn) { this.handlers["win:" + ev] = fn; }
        loadURL(url) { this.url = url; return Promise.resolve(); }
        isDestroyed() { return this.destroyed; }
        close() { this.destroyed = true; if (this.handlers["win:closed"]) this.handlers["win:closed"](); }
      },
    }), { virtual: true });

    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, opts });
      const idToken = "h." + Buffer.from(JSON.stringify({ preferred_username: "agent@contoso.com" })).toString("base64") + ".s";
      return jsonResponse({ access_token: "at", refresh_token: "rt", id_token: idToken, expires_in: 3600 });
    });

    initPlugin();
    const pending = handlers["m365-sign-in"]({ tenant: TENANT, clientId: CLIENT });
    await new Promise((r) => setImmediate(r));

    const auth = new URL(win.url);
    expect(auth.origin + auth.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("scope")).toContain("offline_access");
    expect(win.opts.webPreferences.nodeIntegration).toBe(false);

    const prevented = jest.fn();
    win.handlers["will-redirect"]({ preventDefault: prevented },
      "https://login.microsoftonline.com/common/oauth2/nativeclient?code=abc&state=" + auth.searchParams.get("state"));

    expect(await pending).toEqual({ account: "agent@contoso.com" });
    expect(prevented).toHaveBeenCalled();
    const body = new URLSearchParams(calls[0].opts.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("abc");
    // The verifier must hash to the challenge sent in the authorize request.
    const crypto = require("crypto");
    const challenge = crypto.createHash("sha256").update(body.get("code_verifier")).digest("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(challenge).toBe(auth.searchParams.get("code_challenge"));

    jest.dontMock("electron");
  });

  test("sign-in rejects a redirect with the wrong state", async () => {
    settings = {};
    let win;
    jest.resetModules(); // drop any electron mock cached by an earlier test
    jest.doMock("electron", () => ({
      BrowserWindow: class {
        constructor() {
          win = this; this.handlers = {}; this.destroyed = false;
          this.webContents = { on: (ev, fn) => { this.handlers[ev] = fn; }, setWindowOpenHandler: () => {} };
        }
        static getFocusedWindow() { return null; }
        on(ev, fn) { this.handlers["win:" + ev] = fn; }
        loadURL(url) { this.url = url; return Promise.resolve(); }
        isDestroyed() { return this.destroyed; }
        close() { this.destroyed = true; }
      },
    }), { virtual: true });
    global.fetch = jest.fn();
    initPlugin();
    const pending = handlers["m365-sign-in"]({ tenant: TENANT, clientId: CLIENT });
    await new Promise((r) => setImmediate(r));
    win.handlers["will-redirect"]({ preventDefault() {} },
      "https://login.microsoftonline.com/common/oauth2/nativeclient?code=abc&state=forged");
    expect((await pending).error).toMatch(/state mismatch/);
    expect(global.fetch).not.toHaveBeenCalled();
    jest.dontMock("electron");
  });

  test("cleanCopilotText strips entity tags and citation markers", () => {
    expect(cleanCopilotText("Call <Person>Jo</Person> re <File>a.docx</File>[^2^] now")).toBe("Call Jo re a.docx now");
    expect(cleanCopilotText("Keep <b>html</b> lowercase tags")).toBe("Keep <b>html</b> lowercase tags");
  });
});
