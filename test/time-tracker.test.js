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
    expect(ttMain.sanitizeStore(null)).toEqual({ version: 1, savedAt: 0, timers: [] });
  });
});
