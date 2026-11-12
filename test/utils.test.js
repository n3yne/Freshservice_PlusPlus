"use strict";

const { DEFAULT_SETTINGS, validateSettings, migrateCoreSettings, findLegacyUserDataDir } = require("../utils");
const path = require("path");

// ==================== validateSettings ====================

describe("validateSettings", () => {
  test("accepts DEFAULT_SETTINGS unchanged", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  test("rejects null", () => {
    expect(validateSettings(null)).toBe(false);
  });

  test("rejects non-object primitives", () => {
    expect(validateSettings("string")).toBe(false);
    expect(validateSettings(42)).toBe(false);
    expect(validateSettings(true)).toBe(false);
  });

  test("rejects arrays (array is an object but not a valid settings bag)", () => {
    expect(validateSettings([])).toBe(false);
  });

  test("accepts a boolean sidePanelTabScroll and rejects anything else", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, sidePanelTabScroll: true })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, sidePanelTabScroll: "true" })).toBe(false);
    expect(DEFAULT_SETTINGS.sidePanelTabScroll).toBe(false);
  });

  // sidePanelEnabled
  test("rejects non-boolean sidePanelEnabled", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, sidePanelEnabled: 1 })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, sidePanelEnabled: "true" })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, sidePanelEnabled: null })).toBe(false);
  });

  // sidePanelTab
  test("accepts a string sidePanelTab and rejects other values", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, sidePanelTab: "notes" })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, sidePanelTab: 3 })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, sidePanelTab: "x".repeat(65) })).toBe(false);
  });

  test("rejects non-boolean panelCollapsed", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, panelCollapsed: 0 })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, panelCollapsed: "false" })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, panelCollapsed: null })).toBe(false);
  });
  test("accepts false and true for panelCollapsed", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, panelCollapsed: false })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, panelCollapsed: true })).toBe(true);
  });
});

// ==================== migrateCoreSettings ====================

describe("migrateCoreSettings", () => {
  test("carries notePanelEnabled over to sidePanelEnabled", () => {
    expect(migrateCoreSettings({ notePanelEnabled: false })).toEqual({ sidePanelEnabled: false });
    expect(migrateCoreSettings({ notePanelEnabled: true })).toEqual({ sidePanelEnabled: true });
  });

  test("keeps an existing sidePanelEnabled and drops the old key", () => {
    expect(migrateCoreSettings({ notePanelEnabled: false, sidePanelEnabled: true })).toEqual({ sidePanelEnabled: true });
  });

  test("leaves settings without the old key unchanged", () => {
    const s = { theme: "light" };
    expect(migrateCoreSettings(s)).toEqual({ theme: "light" });
  });

  test("ignores non-object input", () => {
    expect(migrateCoreSettings(null)).toBe(null);
  });
});

// ==================== DEFAULT_SETTINGS ====================

describe("DEFAULT_SETTINGS", () => {
  test("has all required keys", () => {
    for (const key of ["sidePanelEnabled", "panelCollapsed", "defaultUrl", "theme"]) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
    }
  });

  test("holds no Note Backup plugin settings", () => {
    for (const key of ["notePanelEnabled", "backupRetentionDays", "signatureHtml", "noteTemplates", "liveSyncEnabled"]) {
      expect(DEFAULT_SETTINGS).not.toHaveProperty(key);
    }
  });

  test("default values pass validateSettings", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  test("rejects non-string defaultUrl", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: 42 })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: null })).toBe(false);
  });
  test("rejects empty defaultUrl", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: "" })).toBe(false);
  });
  test("rejects non-http defaultUrl", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: "ftp://example.com" })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: "file:///C:/foo" })).toBe(false);
  });
  test("accepts valid theme values", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, theme: "dark" })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, theme: "light" })).toBe(true);
  });
  test("rejects unknown theme", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, theme: "system" })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, theme: "" })).toBe(false);
  });
  test("accepts about:blank, the home page when no site plugin is installed", () => {
    expect(DEFAULT_SETTINGS.defaultUrl).toBe("about:blank");
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: "about:blank" })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: "about:config" })).toBe(false);
  });

  test("accepts valid http/https defaultUrl", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: "https://yourcompany.freshservice.com/" })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, defaultUrl: "http://localhost:8080/" })).toBe(true);
  });

  test("shape is stable", () => {
    expect(DEFAULT_SETTINGS.sidePanelEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.panelCollapsed).toBe(false);
  });
});

// ==================== findLegacyUserDataDir ====================

describe("findLegacyUserDataDir", () => {
  const appData = path.join("/home", "u", ".config");
  const current = path.join(appData, "MSP++");
  const existsFrom = (dirs) => (p) => dirs.includes(p);
  const data = (name) => path.join(appData, name, "note-backups");

  test("keeps using the Freshservice++ folder when MSP++ has no data", () => {
    const exists = existsFrom([data("Freshservice++")]);
    expect(findLegacyUserDataDir(appData, current, exists, path.join)).toBe(path.join(appData, "Freshservice++"));
  });

  test("falls back to the old package-name folder", () => {
    const exists = existsFrom([data("freshservice-pp")]);
    expect(findLegacyUserDataDir(appData, current, exists, path.join)).toBe(path.join(appData, "freshservice-pp"));
  });

  test("prefers Freshservice++ when both old folders have data", () => {
    const exists = existsFrom([data("freshservice-pp"), data("Freshservice++")]);
    expect(findLegacyUserDataDir(appData, current, exists, path.join)).toBe(path.join(appData, "Freshservice++"));
  });

  test("uses the MSP++ folder once it has data", () => {
    const exists = existsFrom([data("MSP++"), data("Freshservice++")]);
    expect(findLegacyUserDataDir(appData, current, exists, path.join)).toBeNull();
  });

  test("ignores an old folder without data (fresh install)", () => {
    const exists = existsFrom([path.join(appData, "Freshservice++")]);
    expect(findLegacyUserDataDir(appData, current, exists, path.join)).toBeNull();
  });

  test("returns null when nothing exists", () => {
    expect(findLegacyUserDataDir(appData, current, () => false, path.join)).toBeNull();
  });
});

describe("tabsToRestore", () => {
  const { tabsToRestore } = require("../utils");
  const saved = [
    { url: "https://a.example/", pinned: true },
    { url: "https://b.example/", pinned: false },
    "https://c.example/",
  ];

  test("restores every tab when on (the default)", () => {
    expect(tabsToRestore(saved, true)).toEqual({
      tabs: [
        { url: "https://a.example/", pinned: true },
        { url: "https://b.example/", pinned: false },
        { url: "https://c.example/", pinned: false },
      ],
      openHome: false,
    });
    expect(tabsToRestore(saved, undefined).tabs).toHaveLength(3);
  });

  test("keeps only pinned tabs and opens Home when off", () => {
    expect(tabsToRestore(saved, false)).toEqual({
      tabs: [{ url: "https://a.example/", pinned: true }],
      openHome: true,
    });
  });

  test("opens Home when nothing was saved", () => {
    expect(tabsToRestore([], true)).toEqual({ tabs: [], openHome: true });
    expect(tabsToRestore(null, true)).toEqual({ tabs: [], openHome: true });
    expect(tabsToRestore([{ pinned: true }, null], true)).toEqual({ tabs: [], openHome: true });
  });

  test("restoreTabs must be a boolean when present", () => {
    const base = Object.assign({}, DEFAULT_SETTINGS);
    expect(validateSettings(Object.assign({}, base, { restoreTabs: false }))).toBe(true);
    expect(validateSettings(Object.assign({}, base, { restoreTabs: "no" }))).toBe(false);
  });

  test("unreadTabBadges defaults on and must be a boolean when present", () => {
    const base = Object.assign({}, DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.unreadTabBadges).toBe(true);
    expect(validateSettings(Object.assign({}, base, { unreadTabBadges: false }))).toBe(true);
    expect(validateSettings(Object.assign({}, base, { unreadTabBadges: "off" }))).toBe(false);
  });
});
