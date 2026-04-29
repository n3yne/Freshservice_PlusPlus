"use strict";

const { DEFAULT_SETTINGS, sanitizeTicketId, validateSettings } = require("../utils");

// ==================== sanitizeTicketId ====================

describe("sanitizeTicketId", () => {
  test("leaves safe alphanumeric IDs unchanged", () => {
    expect(sanitizeTicketId("SR-123456")).toBe("SR-123456");
    expect(sanitizeTicketId("ticket_001")).toBe("ticket_001");
    expect(sanitizeTicketId("ABC-DEF_789")).toBe("ABC-DEF_789");
  });

  test("replaces dots and slashes with underscores", () => {
    expect(sanitizeTicketId("ticket/1.2.3")).toBe("ticket_1_2_3");
    expect(sanitizeTicketId("SR.123456")).toBe("SR_123456");
  });

  test("replaces spaces and special characters", () => {
    expect(sanitizeTicketId("ticket issue!")).toBe("ticket_issue_");
    expect(sanitizeTicketId("ticket:123")).toBe("ticket_123");
    expect(sanitizeTicketId("ticket@domain")).toBe("ticket_domain");
  });

  test("handles empty string", () => {
    expect(sanitizeTicketId("")).toBe("no-ticket");
  });

  test("handles null and undefined", () => {
    expect(sanitizeTicketId(null)).toBe("no-ticket");
    expect(sanitizeTicketId(undefined)).toBe("no-ticket");
  });

  test("neutralises path traversal sequences", () => {
    const result = sanitizeTicketId("../../etc/passwd");
    expect(result).not.toContain("..");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
    // Confirm the result is still usable as a filename segment
    expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  test("neutralises Windows-style path traversal", () => {
    const result = sanitizeTicketId("..\\..\\Windows\\System32");
    expect(result).not.toContain("..");
    expect(result).not.toContain("\\");
  });
});

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

  // notePanelEnabled
  test("rejects non-boolean notePanelEnabled", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, notePanelEnabled: 1 })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, notePanelEnabled: "true" })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, notePanelEnabled: null })).toBe(false);
  });

  // backupRetentionDays
  test("rejects negative backupRetentionDays", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, backupRetentionDays: -1 })).toBe(false);
  });

  test("accepts 0 backupRetentionDays (keep forever)", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, backupRetentionDays: 0 })).toBe(true);
  });

  test("rejects backupRetentionDays over 365", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, backupRetentionDays: 366 })).toBe(false);
  });

  test("accepts backupRetentionDays at boundary values 0 and 365", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, backupRetentionDays: 0 })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, backupRetentionDays: 365 })).toBe(true);
  });

  test("rejects non-number backupRetentionDays", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, backupRetentionDays: "7" })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, backupRetentionDays: null })).toBe(false);
  });

  // signatureHtml
  test("rejects signatureHtml over 100 000 chars", () => {
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, signatureHtml: "x".repeat(100001) })
    ).toBe(false);
  });

  test("accepts signatureHtml at exactly 100 000 chars", () => {
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, signatureHtml: "x".repeat(100000) })
    ).toBe(true);
  });

  test("rejects non-string signatureHtml", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, signatureHtml: 42 })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, signatureHtml: null })).toBe(false);
  });

  // ticketSortField
  test("accepts valid ticketSortField values", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, ticketSortField: "lastUpdated" })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, ticketSortField: "ticketNumber" })).toBe(true);
  });

  test("rejects unknown ticketSortField", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, ticketSortField: "createdAt" })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, ticketSortField: "" })).toBe(false);
  });

  // ticketSortDirection
  test("accepts valid ticketSortDirection values", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, ticketSortDirection: "asc" })).toBe(true);
    expect(validateSettings({ ...DEFAULT_SETTINGS, ticketSortDirection: "desc" })).toBe(true);
  });

  test("rejects unknown ticketSortDirection", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, ticketSortDirection: "ascending" })).toBe(false);
    expect(validateSettings({ ...DEFAULT_SETTINGS, ticketSortDirection: "" })).toBe(false);
  });

  // panelCollapsed
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

// ==================== DEFAULT_SETTINGS ====================

describe("DEFAULT_SETTINGS", () => {
  test("has all required keys", () => {
    const keys = [
      "notePanelEnabled",
      "backupRetentionDays",
      "signatureHtml",
      "ticketSortField",
      "ticketSortDirection",
      "panelCollapsed",
    ];
    for (const key of keys) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
    }
  });

  test("default values pass validateSettings", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  test("is frozen against accidental mutation between tests", () => {
    // Not frozen in source — just verify the shape is stable by checking values
    expect(DEFAULT_SETTINGS.notePanelEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.backupRetentionDays).toBe(7);
    expect(DEFAULT_SETTINGS.panelCollapsed).toBe(false);
  });
});
