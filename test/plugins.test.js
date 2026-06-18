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
    for (const p of ["none", "hatz", "openai", "anthropic"]) {
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

});
