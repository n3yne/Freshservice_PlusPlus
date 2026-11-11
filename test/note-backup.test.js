"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const noteBackup = require("../plugins/note-backup/main");
const { sanitizeTicketId, createNoteStore, defaultSettings } = noteBackup;
const DEFAULTS = defaultSettings;
const validateSettings = noteBackup.validateSettings;

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

describe("note-backup validateSettings", () => {
  test("accepts defaultSettings unchanged", () => {
    expect(validateSettings(DEFAULTS)).toBe(true);
  });

  test("accepts an empty object (all keys optional)", () => {
    expect(validateSettings({})).toBe(true);
  });

  test("rejects non-boolean liveSyncEnabled", () => {
    expect(validateSettings({ ...DEFAULTS, liveSyncEnabled: "yes" })).toBe(false);
  });

  test("rejects out-of-range snapshotThreshold and backupStorageWarningMb", () => {
    expect(validateSettings({ ...DEFAULTS, snapshotThreshold: 0 })).toBe(false);
    expect(validateSettings({ ...DEFAULTS, backupStorageWarningMb: -1 })).toBe(false);
  });

  test("rejects negative backupRetentionDays", () => {
    expect(validateSettings({ ...DEFAULTS, backupRetentionDays: -1 })).toBe(false);
  });
  test("accepts 0 backupRetentionDays (keep forever)", () => {
    expect(validateSettings({ ...DEFAULTS, backupRetentionDays: 0 })).toBe(true);
  });
  test("rejects backupRetentionDays over 365", () => {
    expect(validateSettings({ ...DEFAULTS, backupRetentionDays: 366 })).toBe(false);
  });
  test("accepts backupRetentionDays at boundary values 0 and 365", () => {
    expect(validateSettings({ ...DEFAULTS, backupRetentionDays: 0 })).toBe(true);
    expect(validateSettings({ ...DEFAULTS, backupRetentionDays: 365 })).toBe(true);
  });
  test("rejects non-number backupRetentionDays", () => {
    expect(validateSettings({ ...DEFAULTS, backupRetentionDays: "7" })).toBe(false);
    expect(validateSettings({ ...DEFAULTS, backupRetentionDays: null })).toBe(false);
  });
  test("rejects signatureHtml over 100 000 chars", () => {
    expect(
      validateSettings({ ...DEFAULTS, signatureHtml: "x".repeat(100001) })
    ).toBe(false);
  });
  test("accepts signatureHtml at exactly 100 000 chars", () => {
    expect(
      validateSettings({ ...DEFAULTS, signatureHtml: "x".repeat(100000) })
    ).toBe(true);
  });
  test("rejects non-string signatureHtml", () => {
    expect(validateSettings({ ...DEFAULTS, signatureHtml: 42 })).toBe(false);
    expect(validateSettings({ ...DEFAULTS, signatureHtml: null })).toBe(false);
  });
  test("accepts valid ticketSortField values", () => {
    expect(validateSettings({ ...DEFAULTS, ticketSortField: "lastUpdated" })).toBe(true);
    expect(validateSettings({ ...DEFAULTS, ticketSortField: "ticketNumber" })).toBe(true);
  });
  test("rejects unknown ticketSortField", () => {
    expect(validateSettings({ ...DEFAULTS, ticketSortField: "createdAt" })).toBe(false);
    expect(validateSettings({ ...DEFAULTS, ticketSortField: "" })).toBe(false);
  });
  test("accepts valid ticketSortDirection values", () => {
    expect(validateSettings({ ...DEFAULTS, ticketSortDirection: "asc" })).toBe(true);
    expect(validateSettings({ ...DEFAULTS, ticketSortDirection: "desc" })).toBe(true);
  });
  test("rejects unknown ticketSortDirection", () => {
    expect(validateSettings({ ...DEFAULTS, ticketSortDirection: "ascending" })).toBe(false);
    expect(validateSettings({ ...DEFAULTS, ticketSortDirection: "" })).toBe(false);
  });
  test("accepts empty noteTemplates array", () => {
    expect(validateSettings({ ...DEFAULTS, noteTemplates: [] })).toBe(true);
  });
  test("accepts valid noteTemplates", () => {
    expect(
      validateSettings({
        ...DEFAULTS,
        noteTemplates: [{ name: "Greeting", content: "Hello, thank you for contacting us." }],
      })
    ).toBe(true);
  });
  test("rejects noteTemplates that is not an array", () => {
    expect(validateSettings({ ...DEFAULTS, noteTemplates: null })).toBe(false);
    expect(validateSettings({ ...DEFAULTS, noteTemplates: {} })).toBe(false);
    expect(validateSettings({ ...DEFAULTS, noteTemplates: "tmpl" })).toBe(false);
  });
  test("rejects noteTemplates with more than 50 entries", () => {
    const big = Array.from({ length: 51 }, (_, i) => ({ name: `T${i}`, content: "" }));
    expect(validateSettings({ ...DEFAULTS, noteTemplates: big })).toBe(false);
  });
  test("rejects noteTemplates entries with empty or missing name", () => {
    expect(
      validateSettings({ ...DEFAULTS, noteTemplates: [{ name: "", content: "x" }] })
    ).toBe(false);
    expect(
      validateSettings({ ...DEFAULTS, noteTemplates: [{ content: "x" }] })
    ).toBe(false);
  });
  test("rejects noteTemplates entries with name over 100 chars", () => {
    expect(
      validateSettings({
        ...DEFAULTS,
        noteTemplates: [{ name: "x".repeat(101), content: "" }],
      })
    ).toBe(false);
  });
  test("rejects noteTemplates entries with content over 10 000 chars", () => {
    expect(
      validateSettings({
        ...DEFAULTS,
        noteTemplates: [{ name: "T", content: "x".repeat(10001) }],
      })
    ).toBe(false);
  });
  test("accepts noteTemplates entries with content at exactly 10 000 chars", () => {
    expect(
      validateSettings({
        ...DEFAULTS,
        noteTemplates: [{ name: "T", content: "x".repeat(10000) }],
      })
    ).toBe(true);
  });
});

// ==================== Note store (files on disk) ====================

describe("note-backup note store", () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-test-"));
    store = createNoteStore(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("autosave keeps the latest draft per ticket without writing a snapshot", async () => {
    await store.saveNote({ ticketId: "123", noteContent: "<p>one</p>", isManual: false });
    const res = await store.saveNote({ ticketId: "123", noteContent: "<p>two</p>", isManual: false });
    expect(res.success).toBe(true);
    const drafts = await store.loadAutosave();
    expect(drafts["123"].content).toBe("<p>two</p>");
    expect(await store.getHistory("123")).toEqual([]);
  });

  test("manual save writes a snapshot that history and search find", async () => {
    await store.saveNote({ ticketId: "SR-9", noteContent: "<p>Reset the VPN token</p>", isManual: true });
    const history = await store.getHistory("SR-9");
    expect(history).toHaveLength(1);
    expect(history[0].content).toContain("VPN");
    const results = await store.searchNotes("vpn");
    expect(results.map((r) => r.ticketId)).toContain("SR-9");
  });

  test("sanitizes ticket IDs used as folder names", async () => {
    const res = await store.saveNote({ ticketId: "../evil", noteContent: "x", isManual: true });
    expect(res.ticketId).not.toContain("..");
    expect(fs.existsSync(path.join(dir, res.ticketId))).toBe(true);
  });

  test("rejects oversized notes", async () => {
    const res = await store.saveNote({ ticketId: "1", noteContent: "x".repeat(10 * 1024 * 1024 + 1) });
    expect(res.success).toBe(false);
  });

  test("lists tickets from drafts and snapshot folders, and deletes them", async () => {
    await store.saveNote({ ticketId: "1", noteContent: "a", isManual: false });
    await store.saveNote({ ticketId: "2", noteContent: "b", isManual: true });
    await store.deleteAutosave("2");
    const ids = (await store.getAllTickets()).map((t) => t.ticketId).sort();
    expect(ids).toEqual(["1", "2"]);
    await store.deleteTicket("2");
    expect((await store.getAllTickets()).map((t) => t.ticketId)).toEqual(["1"]);
  });

  test("cleanup removes old snapshots and drafts, and skips when retention is 0", async () => {
    await store.saveNote({ ticketId: "old", noteContent: "a", isManual: true });
    const ticketDir = path.join(dir, "old");
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const f of fs.readdirSync(ticketDir)) fs.utimesSync(path.join(ticketDir, f), old, old);
    const drafts = JSON.parse(fs.readFileSync(path.join(dir, "autosave.json"), "utf-8"));
    drafts.old.updatedAt = old.toISOString();
    fs.writeFileSync(path.join(dir, "autosave.json"), JSON.stringify(drafts));

    expect(await store.cleanup(0)).toEqual({ skipped: true });
    const result = await store.cleanup(7);
    expect(result.deletedFiles).toBe(1);
    expect(result.prunedAutosaves).toBe(1);
    expect(await store.getAllTickets()).toEqual([]);
  });

  test("leaves the app's own files in the folder alone", async () => {
    fs.writeFileSync(path.join(dir, "settings.json"), "{}");
    await store.cleanup(1);
    expect(fs.existsSync(path.join(dir, "settings.json"))).toBe(true);
  });

  test("editor state round-trips", async () => {
    expect(await store.loadEditorState()).toBeNull();
    store.saveEditorStateSync({ blankAtClose: true });
    expect(await store.loadEditorState()).toEqual({ blankAtClose: true });
  });
});

// ==================== saveNoteSync (window closing) ====================

describe("saveNoteSync", () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "msppp-notes-sync-"));
    store = createNoteStore(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("writes the draft next to the ones already saved", async () => {
    await store.saveNote({ ticketId: "100", noteContent: "<p>older</p>", isManual: false });
    const res = store.saveNoteSync({ ticketId: "SR#12", noteContent: "<p>typed just before closing</p>" });
    expect(res).toMatchObject({ success: true, ticketId: "SR_12" });
    const data = await store.loadAutosave();
    expect(data["100"].content).toBe("<p>older</p>");
    expect(data.SR_12.content).toBe("<p>typed just before closing</p>");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("refuses an oversized note and leaves the file alone", async () => {
    await store.saveNote({ ticketId: "100", noteContent: "<p>kept</p>", isManual: false });
    const res = store.saveNoteSync({ ticketId: "100", noteContent: "x".repeat(10 * 1024 * 1024 + 1) });
    expect(res).toMatchObject({ success: false, code: "too-large" });
    expect((await store.loadAutosave())["100"].content).toBe("<p>kept</p>");
  });

  test("keeps a corrupt autosave file aside and still saves", () => {
    fs.writeFileSync(path.join(dir, "autosave.json"), "{ not json", "utf-8");
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(store.saveNoteSync({ ticketId: "7", noteContent: "<p>x</p>" }).success).toBe(true);
    spy.mockRestore();
    expect(fs.readdirSync(dir).some((f) => f.includes(".corrupt-"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "autosave.json"), "utf-8"))["7"].content).toBe("<p>x</p>");
  });
});
