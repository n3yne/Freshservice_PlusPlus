"use strict";

const tt = require("../plugins/time-tracker/renderer");
const ttMain = require("../plugins/time-tracker/main");

describe("time-tracker clock helpers", () => {
  test("elapsedMs adds the running stretch", () => {
    expect(tt.elapsedMs({ accumulatedMs: 1000, runningSince: null }, 5000)).toBe(1000);
    expect(tt.elapsedMs({ accumulatedMs: 1000, runningSince: 2000 }, 5000)).toBe(4000);
    expect(tt.elapsedMs(null, 5000)).toBe(0);
  });

  test("roundMinutes goes up to the next minute, then the next step", () => {
    expect(tt.roundMinutes(0, 15)).toBe(0);
    expect(tt.roundMinutes(20 * 1000, 1)).toBe(1);
    expect(tt.roundMinutes(61 * 1000, 1)).toBe(2);
    expect(tt.roundMinutes(16 * 60000, 15)).toBe(30);
    expect(tt.roundMinutes(15 * 60000, 15)).toBe(15);
    expect(tt.roundMinutes(7 * 60000, 6)).toBe(12);
  });

  test("formats clocks, h:mm and decimal hours", () => {
    expect(tt.formatClock(3725000)).toBe("1:02:05");
    expect(tt.formatClock(0)).toBe("0:00:00");
    expect(tt.formatHM(65)).toBe("1:05");
    expect(tt.formatHM(5)).toBe("0:05");
    expect(tt.decimalHours(65)).toBe("1.08");
    expect(tt.decimalHours(90)).toBe("1.50");
  });

  test("parseDuration reads the usual ways of writing a time", () => {
    expect(tt.parseDuration("1:05")).toBe(65);
    expect(tt.parseDuration("0:45")).toBe(45);
    expect(tt.parseDuration("1h 5m")).toBe(65);
    expect(tt.parseDuration("90m")).toBe(90);
    expect(tt.parseDuration("1.5h")).toBe(90);
    expect(tt.parseDuration("2 hours")).toBe(120);
    expect(tt.parseDuration("1.5")).toBe(90);
    expect(tt.parseDuration("45")).toBe(45);
    expect(tt.parseDuration("")).toBeNull();
    expect(tt.parseDuration("soon")).toBeNull();
    expect(tt.parseDuration("1:75")).toBeNull();
  });
});

describe("time-tracker timer actions", () => {
  test("starting one timer pauses the others when one-at-a-time is on", () => {
    const a = { accumulatedMs: 0, runningSince: 1000 };
    const b = { accumulatedMs: 0, runningSince: null };
    const list = [a, b];
    tt.startTimer(list, b, 4000, true);
    expect(a).toEqual({ accumulatedMs: 3000, runningSince: null });
    expect(b.runningSince).toBe(4000);
  });

  test("timers can run side by side when one-at-a-time is off", () => {
    const a = { accumulatedMs: 0, runningSince: 1000 };
    const b = { accumulatedMs: 0, runningSince: null };
    tt.startTimer([a, b], b, 4000, false);
    expect(a.runningSince).toBe(1000);
    expect(b.runningSince).toBe(4000);
  });

  test("adjustTimer moves a running timer and never goes below zero", () => {
    const t = { accumulatedMs: 60000, runningSince: 0 + 1000 };
    tt.adjustTimer(t, 5, 61000);
    expect(t.accumulatedMs).toBe(60000 + 60000 + 5 * 60000);
    expect(t.runningSince).toBe(61000);
    const s = { accumulatedMs: 60000, runningSince: null };
    tt.adjustTimer(s, -5, 0);
    expect(s).toEqual({ accumulatedMs: 0, runningSince: null });
  });

  test("resumeAfterCrash counts up to the last save and pauses", () => {
    const list = [{ accumulatedMs: 1000, runningSince: 10000 }, { accumulatedMs: 5, runningSince: null }];
    tt.resumeAfterCrash(list, 70000, 999999);
    expect(list[0]).toEqual({ accumulatedMs: 61000, runningSince: null });
    expect(list[1]).toEqual({ accumulatedMs: 5, runningSince: null });
  });

  test("pruneTimers drops empty timers before ones with time on them", () => {
    const list = [
      { id: "a", accumulatedMs: 5, runningSince: null },
      { id: "b", accumulatedMs: 0, runningSince: null },
      { id: "c", accumulatedMs: 9, runningSince: null },
      { id: "d", accumulatedMs: 0, runningSince: null },
    ];
    expect(tt.pruneTimers(list, 2).map((t) => t.id)).toEqual(["a", "c"]);
    expect(tt.pruneTimers(list, 10)).toBe(list);
  });

  test("buildCopyText has the time, ticket, title and note", () => {
    const t = { siteName: "FS", label: "ticket #123", key: "123", title: "Printer offline" };
    expect(tt.buildCopyText(t, 65, " Restarted the spooler ")).toBe("1:05 (1.08 h) — FS · ticket #123: Printer offline\nRestarted the spooler");
    expect(tt.sameRecord({ siteId: "x", key: "1" }, { siteId: "x", key: "1" })).toBe(true);
    expect(tt.sameRecord({ siteId: "x", key: "1" }, { siteId: "y", key: "1" })).toBe(false);
  });
});

describe("time-tracker main", () => {
  test("validateSettings checks each setting", () => {
    expect(ttMain.validateSettings(ttMain.defaultSettings)).toBe(true);
    expect(ttMain.validateSettings({ timeTrackerRoundTo: 15 })).toBe(true);
    expect(ttMain.validateSettings({ timeTrackerRoundTo: 7 })).toBe(false);
    expect(ttMain.validateSettings({ timeTrackerAutoStart: "yes" })).toBe(false);
  });

  test("sanitizeStore cleans timers and drops duplicates", () => {
    const store = ttMain.sanitizeStore({
      savedAt: 123,
      timers: [
        { id: "a", key: "123", siteId: "freshservice", recordId: "123", url: "javascript:alert(1)", accumulatedMs: -5, runningSince: "x", billable: false },
        { id: "b", key: "123", siteId: "freshservice" },
        { id: "a", key: "CW-9", siteId: "connectwise-manage" },
        { id: "c", key: "CW-9", siteId: "connectwise-manage", recordId: "9; drop", accumulatedMs: 1e15, note: "n".repeat(5000) },
        { key: "no-id" },
        "junk",
      ],
    });
    expect(store.savedAt).toBe(123);
    expect(store.timers.map((t) => t.id)).toEqual(["a", "c"]);
    expect(store.timers[0]).toEqual(expect.objectContaining({ url: "", accumulatedMs: 0, runningSince: null, billable: false }));
    expect(store.timers[1].recordId).toBe("");
    expect(store.timers[1].accumulatedMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(store.timers[1].note.length).toBe(4000);
  });

  test("sanitizeStore caps the number of timers", () => {
    const timers = Array.from({ length: 250 }, (_, i) => ({ id: "t" + i, key: String(i), siteId: "s" }));
    expect(ttMain.sanitizeStore({ timers }).timers).toHaveLength(ttMain.MAX_TIMERS);
    expect(ttMain.sanitizeStore(null)).toEqual({ version: 1, savedAt: 0, timers: [], log: [] });
  });
});

describe("time-tracker daily summary", () => {
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).toISOString();
  const entry = (over) => Object.assign({
    id: "l" + Math.random().toString(36).slice(2), at: at(2026, 11, 12, 9, 0), siteId: "freshservice", siteName: "FS",
    key: "INC-1", label: "INC-1", title: "Printer", url: "https://x.freshservice.com/a/tickets/1", minutes: 15, how: "site", note: "",
  }, over);

  test("dayKey and shiftDay use local calendar days", () => {
    expect(tt.dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(tt.shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(tt.shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("makeLogEntry copies the ticket from the timer", () => {
    const e = tt.makeLogEntry({ siteId: "cw", siteName: "CW", key: "CW-5", label: "CW-5", title: "VPN", url: "https://cw/x" }, 30, "marked", "  fixed it ", Date.UTC(2026, 10, 12));
    expect(e).toMatchObject({ siteId: "cw", key: "CW-5", minutes: 30, how: "marked", note: "fixed it", at: "2026-11-12T00:00:00.000Z" });
    expect(e.id).toMatch(/^l/);
  });

  test("summarizeDay groups one day's entries by ticket, in the order first logged", () => {
    const log = [
      entry({ key: "INC-2", label: "INC-2", at: at(2026, 11, 12, 8, 30), minutes: 10 }),
      entry({ at: at(2026, 11, 12, 9, 0), minutes: 15, note: "first" }),
      entry({ at: at(2026, 11, 11, 16, 0), minutes: 60 }), // the day before
      entry({ at: at(2026, 11, 12, 14, 0), minutes: 30, title: "Printer jam", note: "second" }),
      entry({ siteId: "cw", siteName: "CW", key: "INC-1", at: at(2026, 11, 12, 15, 0), minutes: 5 }), // same key, other site
    ];
    const s = tt.summarizeDay(log, "2026-11-12");
    expect(s.totalMinutes).toBe(60);
    expect(s.tickets.map((t) => t.siteId + "|" + t.key)).toEqual(["freshservice|INC-2", "freshservice|INC-1", "cw|INC-1"]);
    expect(s.tickets[1].minutes).toBe(45);
    expect(s.tickets[1].entries).toHaveLength(2);
    expect(s.tickets[1].title).toBe("Printer jam");
    expect(tt.summarizeDay(log, "2026-11-10")).toEqual({ day: "2026-11-10", totalMinutes: 0, tickets: [] });
  });

  test("buildSummaryText lists each ticket with its notes", () => {
    const s = tt.summarizeDay([
      entry({ minutes: 45, note: "reset spooler\nand driver" }),
      entry({ key: "INC-9", label: "INC-9", title: "", minutes: 20, at: at(2026, 11, 12, 10, 0) }),
    ], "2026-11-12");
    expect(tt.buildSummaryText(s, "today")).toBe([
      "Time logged today: 1:05 (1.08 h)",
      "",
      "0:45 (0.75 h) — FS · INC-1: Printer",
      "  • reset spooler and driver",
      "",
      "0:20 (0.33 h) — FS · INC-9",
    ].join("\n"));
  });

  test("the store keeps a clean log next to the timers", () => {
    const now = Date.now();
    const good = { id: "l1", at: new Date(now - 3600000).toISOString(), key: "INC-1", minutes: 15, how: "site", url: "javascript:alert(1)", note: "x".repeat(900) };
    const store = ttMain.sanitizeStore({
      timers: [],
      log: [
        good,
        { ...good }, // duplicate id
        { id: "l2", at: new Date(now - 100 * 86400000).toISOString(), key: "INC-1", minutes: 5 }, // too old
        { id: "l3", at: "not a date", key: "INC-1", minutes: 5 },
        { id: "l4", at: new Date(now).toISOString(), key: "INC-1", minutes: 0 },
        { id: "l5", at: new Date(now).toISOString(), key: "INC-1", minutes: 1.5 },
        { id: "l6", at: new Date(now - 7200000).toISOString(), key: "INC-2", minutes: 10, how: "weird" },
      ],
    });
    expect(store.log.map((e) => e.id)).toEqual(["l6", "l1"]);
    expect(store.log[1].url).toBe("");
    expect(store.log[1].note).toHaveLength(500);
    expect(store.log[0].how).toBe("marked");
    expect(ttMain.sanitizeStore({ timers: [] }).log).toEqual([]);
  });

  test("the log keeps only the newest entries past the limit", () => {
    const now = Date.now();
    const list = [];
    for (let i = 0; i < ttMain.MAX_LOG + 5; i++) list.push({ id: "l" + i, at: new Date(now - (ttMain.MAX_LOG + 5 - i) * 1000).toISOString(), key: "K", minutes: 1 });
    const out = ttMain.sanitizeLog(list, now);
    expect(out).toHaveLength(ttMain.MAX_LOG);
    expect(out[0].id).toBe("l5");
  });
});
