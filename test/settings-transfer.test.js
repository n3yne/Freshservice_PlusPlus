"use strict";

const {
  EXPORT_KIND,
  isSecretKey,
  buildSettingsExport,
  parseSettingsExport,
  mergeImportedSettings,
  pluginChanges,
  defaultExportFileName,
} = require("../settings-transfer");

const CREDENTIALS = ["fsApiKey", "aiApiKey"].map((plain) => ({
  plain,
  encrypted: plain + "Encrypted",
  flag: plain + "Set",
  remove: plain + "Remove",
}));

const RAW = {
  theme: "light",
  defaultUrl: "https://acme.freshservice.com/",
  dismissedReleaseVersion: "0.7.4",
  bookmarks: [{ title: "Queue", url: "https://acme.freshservice.com/a/tickets" }],
  cannedResponses: [{ title: "Hi", body: "Hello there" }],
  fsApiDomain: "acme.freshservice.com",
  fsApiKeyEncrypted: "djEw...",
  fsApiKeyHost: "acme.freshservice.com",
  aiProvider: "azure",
  aiApiKeyEncrypted: "djEw...",
  aiApiKeyProvider: "azure",
  aiApiKeyEndpoint: "https://x.openai.azure.com",
  otherPluginTokenEncrypted: "djEw...",
};

describe("isSecretKey", () => {
  test("matches credentials and everything tied to them", () => {
    for (const key of ["fsApiKey", "fsApiKeyEncrypted", "fsApiKeySet", "fsApiKeyRemove", "fsApiKeyHost",
      "aiApiKeyProvider", "aiApiKeyEndpoint", "unknownEncrypted"]) {
      expect(isSecretKey(key, CREDENTIALS)).toBe(true);
    }
  });
  test("leaves ordinary settings alone", () => {
    for (const key of ["fsApiDomain", "aiProvider", "theme", "bookmarks"]) {
      expect(isSecretKey(key, CREDENTIALS)).toBe(false);
    }
  });
});

describe("buildSettingsExport", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  const plugins = [{ id: "bookmarks-bar", enabled: true }, { id: "metrics-bar", enabled: false }];
  const data = buildSettingsExport(RAW, plugins, CREDENTIALS, "0.7.5", now);

  test("has a header that identifies the file", () => {
    expect(data.kind).toBe(EXPORT_KIND);
    expect(data.formatVersion).toBe(1);
    expect(data.appVersion).toBe("0.7.5");
    expect(data.exportedAt).toBe("2026-11-12T10:00:00.000Z");
  });

  test("leaves out API keys, what they're tied to, and install-specific keys", () => {
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/ApiKey/);
    expect(json).not.toMatch(/Encrypted/);
    expect(data.settings.dismissedReleaseVersion).toBeUndefined();
  });

  test("keeps everything else, including bookmarks and canned responses", () => {
    expect(data.settings).toEqual({
      theme: "light",
      defaultUrl: "https://acme.freshservice.com/",
      bookmarks: RAW.bookmarks,
      cannedResponses: RAW.cannedResponses,
      fsApiDomain: "acme.freshservice.com",
      aiProvider: "azure",
    });
  });

  test("records which plugins are on", () => {
    expect(data.plugins).toEqual({ "bookmarks-bar": true, "metrics-bar": false });
  });
});

describe("parseSettingsExport", () => {
  const good = buildSettingsExport(RAW, [{ id: "tree-tabs", enabled: false }], CREDENTIALS, "0.7.5");

  test("reads an export back", () => {
    const result = parseSettingsExport(JSON.stringify(good), CREDENTIALS);
    expect(result.ok).toBe(true);
    expect(result.data.settings).toEqual(good.settings);
    expect(result.data.plugins).toEqual({ "tree-tabs": false });
    expect(result.data.appVersion).toBe("0.7.5");
  });

  test("accepts a byte order mark", () => {
    expect(parseSettingsExport("\uFEFF" + JSON.stringify(good), CREDENTIALS).ok).toBe(true);
  });

  test("rejects files that aren't exports", () => {
    expect(parseSettingsExport("not json", CREDENTIALS).ok).toBe(false);
    expect(parseSettingsExport("[]", CREDENTIALS).ok).toBe(false);
    expect(parseSettingsExport(JSON.stringify(RAW), CREDENTIALS).ok).toBe(false);
    expect(parseSettingsExport(JSON.stringify({ kind: EXPORT_KIND, formatVersion: 1 }), CREDENTIALS).ok).toBe(false);
  });

  test("rejects exports from a newer format", () => {
    const result = parseSettingsExport(JSON.stringify({ ...good, formatVersion: 2 }), CREDENTIALS);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/newer version/);
  });

  test("drops keys and credentials smuggled into the file", () => {
    const text = '{"kind":"' + EXPORT_KIND + '","formatVersion":1,"settings":{"theme":"dark",' +
      '"fsApiKeyEncrypted":"x","fsApiKeyHost":"evil.example.com","aiApiKey":"sk-1",' +
      '"__proto__":{"polluted":true}},"plugins":{"__proto__":false,"ok":false,"Bad Id!":false,"x":"no"}}';
    const result = parseSettingsExport(text, CREDENTIALS);
    expect(result.ok).toBe(true);
    expect(Object.keys(result.data.settings)).toEqual(["theme"]);
    expect(result.data.plugins).toEqual({ ok: false });
    expect({}.polluted).toBeUndefined();
  });
});

describe("mergeImportedSettings", () => {
  test("replaces settings but keeps this PC's keys and install-specific values", () => {
    const existing = { ...RAW, oldSetting: true };
    const merged = mergeImportedSettings(existing, { theme: "dark", bookmarks: [] }, CREDENTIALS);
    expect(merged).toEqual({
      theme: "dark",
      bookmarks: [],
      dismissedReleaseVersion: "0.7.4",
      fsApiKeyEncrypted: "djEw...",
      fsApiKeyHost: "acme.freshservice.com",
      aiApiKeyEncrypted: "djEw...",
      aiApiKeyProvider: "azure",
      aiApiKeyEndpoint: "https://x.openai.azure.com",
      otherPluginTokenEncrypted: "djEw...",
    });
  });

  test("never takes a credential from the imported settings", () => {
    const merged = mergeImportedSettings({}, { fsApiKeyEncrypted: "x", aiApiKey: "sk", theme: "dark" }, CREDENTIALS);
    expect(merged).toEqual({ theme: "dark" });
  });
});

describe("pluginChanges", () => {
  const current = [{ id: "a", enabled: true }, { id: "b", enabled: false }, { id: "c", enabled: true }];

  test("lists only plugins whose state changes", () => {
    expect(pluginChanges(current, { a: false, b: false, c: true })).toEqual([
      { id: "a", enabled: false, installed: true },
    ]);
    expect(pluginChanges(current, { b: true })).toEqual([{ id: "b", enabled: true, installed: true }]);
  });

  test("keeps an off state for a plugin that isn't installed here", () => {
    expect(pluginChanges(current, { missing: false, missing2: true })).toEqual([
      { id: "missing", enabled: false, installed: false },
    ]);
  });
});

test("defaultExportFileName uses the local date", () => {
  expect(defaultExportFileName(new Date(2026, 0, 5))).toBe("MSP++ settings 2026-01-05.json");
});
