"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { createNoteStore } = require("../plugins/note-backup/main");
const { importLegacyNotes, findLegacyNoteDirs, mapConnectWiseKey, LEDGER_FILE } =
  require("../plugins/note-backup/legacy-import");

let appData;
let cwDir;
let store;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
const autosave = () => readJson(path.join(store.dir, "autosave.json"));

beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-import-"));
  cwDir = path.join(appData, "connectwise-manage-pp", "note-backups");
  store = createNoteStore(path.join(appData, "msp-pp", "note-backups"));
});

afterEach(() => {
  fs.rmSync(appData, { recursive: true, force: true });
});

describe("mapConnectWiseKey", () => {
  test("prefixes ticket numbers with CW-", () => {
    expect(mapConnectWiseKey("123456")).toBe("CW-123456");
  });
  test("keeps other keys", () => {
    expect(mapConnectWiseKey("general")).toBe("general");
    expect(mapConnectWiseKey("CW-5")).toBe("CW-5");
    expect(mapConnectWiseKey("SR#12")).toBe("SR_12");
  });
});

describe("findLegacyNoteDirs", () => {
  test("finds nothing when CW++ was never installed", async () => {
    expect(await findLegacyNoteDirs(appData, store.dir)).toEqual([]);
    expect(await importLegacyNotes(appData, store)).toEqual([]);
    expect(fs.existsSync(path.join(store.dir, LEDGER_FILE))).toBe(false);
  });
  test("finds the folder under the product name too", async () => {
    write(path.join(appData, "ConnectWise Manage++", "note-backups", "autosave.json"), "{}");
    const found = await findLegacyNoteDirs(appData, store.dir);
    expect(found).toHaveLength(1);
    expect(found[0].dir).toBe(path.join(appData, "ConnectWise Manage++", "note-backups"));
  });
});

describe("importLegacyNotes", () => {
  test("copies drafts and snapshots under CW- keys and leaves CW++ alone", async () => {
    write(path.join(cwDir, "autosave.json"), JSON.stringify({
      "123": { content: "<p>draft 123</p>", updatedAt: "2026-01-01T00:00:00.000Z" },
      general: { content: "<p>scratch</p>", updatedAt: "2026-01-02T00:00:00.000Z" },
    }));
    write(path.join(cwDir, "123", "2026-01-01T00-00-00-000Z.html"), "<p>snap</p>");
    write(path.join(cwDir, "456", "2026-01-03T00-00-00-000Z.html"), "<p>snap 456</p>");
    write(path.join(cwDir, "settings.json"), "{}");
    const before = fs.readFileSync(path.join(cwDir, "autosave.json"), "utf-8");

    const [r] = await importLegacyNotes(appData, store);
    expect(r).toMatchObject({ source: "ConnectWise Manage++", drafts: 2, draftsAsSnapshots: 0, snapshots: 2, tickets: 3 });

    const drafts = autosave();
    expect(drafts["CW-123"].content).toBe("<p>draft 123</p>");
    expect(drafts["CW-123"].updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(drafts["CW-123"].importedAt).toEqual(expect.any(String));
    expect(drafts.general.content).toBe("<p>scratch</p>");
    expect(drafts["123"]).toBeUndefined();
    expect((await store.getHistory("CW-456"))[0].content).toBe("<p>snap 456</p>");
    expect(fs.existsSync(path.join(store.dir, "settings.json"))).toBe(false);
    expect(fs.readFileSync(path.join(cwDir, "autosave.json"), "utf-8")).toBe(before);
  });

  test("never overwrites an MSP++ draft; the CW++ one becomes a snapshot", async () => {
    await store.saveNote({ ticketId: "CW-123", noteContent: "<p>newer in MSP++</p>" });
    write(path.join(cwDir, "autosave.json"), JSON.stringify({
      "123": { content: "<p>old in CW++</p>", updatedAt: "2026-01-01T00:00:00.000Z" },
    }));

    const [r] = await importLegacyNotes(appData, store);
    expect(r.drafts).toBe(0);
    expect(r.draftsAsSnapshots).toBe(1);
    expect(autosave()["CW-123"].content).toBe("<p>newer in MSP++</p>");
    const history = await store.getHistory("CW-123");
    expect(history).toEqual([{ filename: "2026-01-01T00-00-00-000Z.html", content: "<p>old in CW++</p>" }]);
  });

  test("keeps both files when a snapshot name is already taken", async () => {
    write(path.join(store.dir, "CW-7", "a.html"), "mine");
    write(path.join(cwDir, "7", "a.html"), "theirs");
    await importLegacyNotes(appData, store);
    const files = fs.readdirSync(path.join(store.dir, "CW-7")).sort();
    expect(files).toEqual(["a-cwpp.html", "a.html"]);
    expect(fs.readFileSync(path.join(store.dir, "CW-7", "a.html"), "utf-8")).toBe("mine");
  });

  test("a second run imports only what is new, and deleted notes stay deleted", async () => {
    write(path.join(cwDir, "autosave.json"), JSON.stringify({
      "1": { content: "one", updatedAt: "2026-01-01T00:00:00.000Z" },
    }));
    write(path.join(cwDir, "1", "s1.html"), "s1");
    await importLegacyNotes(appData, store);

    await store.deleteTicket("CW-1");
    const [again] = await importLegacyNotes(appData, store);
    expect(again).toMatchObject({ drafts: 0, snapshots: 0, tickets: 0 });
    expect(autosave()["CW-1"]).toBeUndefined();

    // Still writing notes in CW++: those come across next time.
    write(path.join(cwDir, "autosave.json"), JSON.stringify({
      "1": { content: "one, edited", updatedAt: "2026-02-01T00:00:00.000Z" },
    }));
    write(path.join(cwDir, "1", "s2.html"), "s2");
    const [later] = await importLegacyNotes(appData, store);
    expect(later).toMatchObject({ drafts: 1, snapshots: 1 });
    expect(autosave()["CW-1"].content).toBe("one, edited");
    expect((await store.getHistory("CW-1")).map((h) => h.filename)).toEqual(["s2.html"]);
  });

  test("imported notes survive the startup retention cleanup", async () => {
    write(path.join(cwDir, "autosave.json"), JSON.stringify({
      "9": { content: "old draft", updatedAt: "2020-01-01T00:00:00.000Z" },
    }));
    const snap = path.join(cwDir, "8", "old.html");
    write(snap, "old snapshot");
    fs.utimesSync(snap, new Date("2020-01-01"), new Date("2020-01-01"));

    await importLegacyNotes(appData, store);
    await store.cleanup(7);
    expect(autosave()["CW-9"]).toMatchObject({ content: "old draft", updatedAt: "2020-01-01T00:00:00.000Z" });
    expect((await store.getHistory("CW-8"))[0].content).toBe("old snapshot");
  });

  test("ignores a corrupt CW++ autosave.json and still copies snapshots", async () => {
    write(path.join(cwDir, "autosave.json"), "{not json");
    write(path.join(cwDir, "5", "x.html"), "x");
    const [r] = await importLegacyNotes(appData, store);
    expect(r).toMatchObject({ drafts: 0, snapshots: 1 });
  });
});
