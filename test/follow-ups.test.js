"use strict";

const fu = require("../plugins/follow-ups/renderer");
const fuMain = require("../plugins/follow-ups/main");

function rec(key, extra) {
  return Object.assign({
    siteId: "freshservice", siteName: "FS", key: key, kind: "ticket",
    label: "ticket #" + key, title: "Printer offline", url: "https://acme.freshservice.com/a/tickets/" + key,
  }, extra || {});
}

// A Wednesday afternoon, local time.
const T0 = new Date(2026, 10, 11, 14, 0, 0, 0).getTime();
const HOUR = 3600000;

describe("follow-ups presets", () => {
  test("offers 1 hour, 3 hours, tomorrow morning and Monday", () => {
    const list = fu.presetTimes(T0, 9);
    const ids = list.map((p) => p.id);
    expect(ids).toEqual(["1h", "3h", "tomorrow", "monday"]);
    expect(list[0].at).toBe(T0 + HOUR);
    expect(list[2].at).toBe(new Date(2026, 10, 12, 9, 0).getTime());
    expect(list[3].at).toBe(new Date(2026, 10, 16, 9, 0).getTime());
  });

  test("offers 5 PM today in the morning", () => {
    const morning = new Date(2026, 10, 11, 8, 30).getTime();
    const list = fu.presetTimes(morning, 9);
    const eod = list.find((p) => p.id === "eod");
    expect(eod.at).toBe(new Date(2026, 10, 11, 17, 0).getTime());
  });

  test("on a Monday the last choice is next Monday, on a Sunday a week", () => {
    const monday = new Date(2026, 10, 16, 10, 0).getTime();
    const m = fu.presetTimes(monday, 8).pop();
    expect(m.id).toBe("monday");
    expect(m.at).toBe(new Date(2026, 10, 23, 8, 0).getTime());
    const sunday = new Date(2026, 10, 15, 10, 0).getTime();
    const s = fu.presetTimes(sunday, 8).pop();
    expect(s.id).toBe("week");
    expect(s.at).toBe(new Date(2026, 10, 22, 8, 0).getTime());
  });

  test("a bad morning hour falls back to 9", () => {
    const t = fu.snoozeTimes(T0, "x").find((p) => p.id === "tomorrow");
    expect(new Date(t.at).getHours()).toBe(9);
  });
});

describe("follow-ups list helpers", () => {
  test("setReminder keeps one reminder per ticket, sorted by due time", () => {
    let r = fu.setReminder([], rec("1"), T0 + 2 * HOUR, "chase", T0, "a");
    r = fu.setReminder(r.list, rec("2"), T0 + HOUR, "", T0, "b");
    r = fu.setReminder(r.list, rec("1"), T0 + 30 * 60000, null, T0, "c");
    expect(r.list.map((x) => x.key)).toEqual(["1", "2"]);
    expect(r.list[0].id).toBe("a");
    expect(r.list[0].note).toBe("chase");
    expect(r.list[0].firedAt).toBeNull();
  });

  test("the same number on two sites is two reminders", () => {
    let r = fu.setReminder([], rec("123"), T0 + HOUR, "", T0, "a");
    r = fu.setReminder(r.list, rec("123", { siteId: "connectwise-manage" }), T0 + HOUR, "", T0, "b");
    expect(r.list).toHaveLength(2);
  });

  test("dueToFire returns due reminders that haven't gone off", () => {
    let r = fu.setReminder([], rec("1"), T0 - 1000, "", T0, "a");
    r = fu.setReminder(r.list, rec("2"), T0 + HOUR, "", T0, "b");
    const list = r.list.concat([Object.assign({}, r.list[0], { id: "c", key: "3", firedAt: new Date(T0).toISOString() })]);
    expect(fu.dueToFire(list, T0).map((x) => x.id)).toEqual(["a"]);
  });

  test("snoozeReminder moves the time, clears firedAt and counts", () => {
    let r = fu.setReminder([], rec("1"), T0, "", T0, "a");
    const fired = [Object.assign({}, r.list[0], { firedAt: new Date(T0).toISOString() })];
    const list = fu.snoozeReminder(fired, "a", T0 + HOUR);
    expect(list[0].firedAt).toBeNull();
    expect(list[0].snoozes).toBe(1);
    expect(Date.parse(list[0].dueAt)).toBe(T0 + HOUR);
  });

  test("nextDelay waits for the next reminder, at most 30 seconds", () => {
    const r = fu.setReminder([], rec("1"), T0 + 10000, "", T0, "a");
    expect(fu.nextDelay(r.list, T0)).toBe(10000);
    expect(fu.nextDelay([], T0)).toBe(30000);
    expect(fu.nextDelay(r.list, T0 + 20000)).toBe(0);
  });

  test("groupReminders splits into Due, Later today, Tomorrow and Later", () => {
    let r = fu.setReminder([], rec("1"), T0 - 1000, "", T0, "a");
    r = fu.setReminder(r.list, rec("2"), T0 + HOUR, "", T0, "b");
    r = fu.setReminder(r.list, rec("3"), T0 + 20 * HOUR, "", T0, "c");
    r = fu.setReminder(r.list, rec("4"), T0 + 72 * HOUR, "", T0, "d");
    expect(fu.groupReminders(r.list, T0).map((g) => g.id)).toEqual(["due", "today", "tomorrow", "later"]);
  });
});

describe("follow-ups text", () => {
  test("formatDue", () => {
    const iso = (t) => new Date(t).toISOString();
    expect(fu.formatDue(iso(T0 + 25 * 60000), T0)).toBe("in 25 min");
    expect(fu.formatDue(iso(T0 + 130 * 60000), T0)).toBe("in 2 h 10 min");
    expect(fu.formatDue(iso(T0 - 10000), T0)).toBe("due now");
    expect(fu.formatDue(iso(T0 - 3 * HOUR), T0)).toBe("overdue by 3 h");
    expect(fu.formatDue(iso(new Date(2026, 10, 12, 9, 0).getTime()), T0)).toMatch(/^tomorrow /);
  });

  test("datetime-local round trip", () => {
    const s = fu.toLocalInput(T0);
    expect(s).toBe("2026-11-11T14:00");
    expect(fu.parseLocalInput(s)).toBe(T0);
    expect(fu.parseLocalInput("2026-02-31T10:00")).toBeNaN();
    expect(fu.parseLocalInput("")).toBeNaN();
  });

  test("alertText uses the note and subject", () => {
    const r = fu.setReminder([], rec("7"), T0, "chase the user", T0, "a").reminder;
    const t = fu.alertText(r);
    expect(t.title).toBe("Follow up: FS · ticket #7");
    expect(t.body).toBe("chase the user\nPrinter offline");
    expect(fu.summaryText([r, r, r, r, r]).body).toMatch(/and 1 more$/);
  });
});

describe("follow-ups main", () => {
  test("validateSettings", () => {
    expect(fuMain.validateSettings(fuMain.defaultSettings)).toBe(true);
    expect(fuMain.validateSettings({})).toBe(true);
    expect(fuMain.validateSettings({ followUpMorningHour: 12 })).toBe(false);
    expect(fuMain.validateSettings({ followUpDesktop: "yes" })).toBe(false);
  });

  test("sanitizeStore drops bad entries and duplicates", () => {
    const good = fu.setReminder([], rec("1"), T0, "n", T0, "a").reminder;
    const store = fuMain.sanitizeStore({
      reminders: [
        good,
        Object.assign({}, good, { id: "b" }),                 // same ticket
        Object.assign({}, good, { id: "c", key: "2", url: "javascript:alert(1)" }),
        Object.assign({}, good, { id: "d", key: "3", dueAt: "soon" }),
        Object.assign({}, good, { id: "bad id!", key: "4" }),
        null,
      ],
    });
    expect(store.reminders.map((r) => r.id)).toEqual(["a"]);
    expect(store.reminders[0].note).toBe("n");
  });

  test("sanitizeReminder cuts long notes", () => {
    const r = fu.setReminder([], rec("1"), T0, "x".repeat(5000), T0, "a").reminder;
    expect(fuMain.sanitizeReminder(Object.assign({}, r, { note: "y".repeat(5000) })).note).toHaveLength(1000);
  });
});
