"use strict";

const { DEFAULT_SETTINGS, validateSettings, migrateCoreSettings } = require("../utils");

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
