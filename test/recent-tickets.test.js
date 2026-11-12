"use strict";

const rt = require("../plugins/recent-tickets/renderer");
const rtMain = require("../plugins/recent-tickets/main");

function rec(key, extra) {
  return Object.assign({
    siteId: "freshservice", siteName: "FS", key: key, kind: "ticket",
    label: "ticket #" + key, title: "", url: "https://acme.freshservice.com/a/tickets/" + key,
  }, extra || {});
}

const T0 = Date.parse("2026-11-12T15:00:00Z");

describe("recent-tickets list helpers", () => {
  test("recordVisit puts the ticket on top and counts views", () => {
    let list = [];
    list = rt.recordVisit(list, rec("1"), T0, 50);
    list = rt.recordVisit(list, rec("2"), T0 + 1000, 50);
    list = rt.recordVisit(list, rec("1", { title: "Printer on fire" }), T0 + 2000, 50);
    expect(list.map((e) => e.key)).toEqual(["1", "2"]);
    expect(list[0].views).toBe(2);
    expect(list[0].title).toBe("Printer on fire");
    expect(list[0].viewedAt).toBe(new Date(T0 + 2000).toISOString());
  });

  test("recordVisit keeps the old title and pin when the new visit has none", () => {
    let list = rt.recordVisit([], rec("1", { title: "Subject" }), T0, 50);
    list[0].pinned = true;
    list = rt.recordVisit(list, rec("1"), T0 + 1000, 50);
    expect(list[0].title).toBe("Subject");
    expect(list[0].pinned).toBe(true);
  });

  test("the same number on two sites is two entries", () => {
    let list = rt.recordVisit([], rec("123"), T0, 50);
    list = rt.recordVisit(list, rec("CW-123", { siteId: "connectwise-manage", siteName: "CW" }), T0, 50);
    list = rt.recordVisit(list, rec("123", { siteId: "connectwise-manage", siteName: "CW" }), T0, 50);
    expect(list).toHaveLength(3);
  });

  test("pruneEntries keeps pinned entries and the newest of the rest", () => {
    const list = [
      { key: "a" }, { key: "b", pinned: true }, { key: "c" }, { key: "d" }, { key: "e", pinned: true },
    ];
    expect(rt.pruneEntries(list, 3).map((e) => e.key)).toEqual(["a", "b", "e"]);
    expect(rt.pruneEntries(list, 4).map((e) => e.key)).toEqual(["a", "b", "c", "e"]);
    expect(rt.pruneEntries(list, 1).map((e) => e.key)).toEqual(["b", "e"]);
  });

  test("refreshEntry updates the title of a ticket already listed", () => {
    const list = rt.recordVisit([], rec("1"), T0, 50);
    expect(rt.refreshEntry(list, rec("1", { title: "Late subject" }))).toBe(true);
    expect(list[0].title).toBe("Late subject");
    expect(rt.refreshEntry(list, rec("1", { title: "Late subject" }))).toBe(false);
    expect(rt.refreshEntry(list, rec("9", { title: "x" }))).toBe(false);
  });

  test("matchesFilter looks at number, label, subject and site, every word", () => {
    const e = { label: "ticket #4521", key: "4521", title: "VPN drops every hour", siteName: "FS" };
    expect(rt.matchesFilter(e, "")).toBe(true);
    expect(rt.matchesFilter(e, "4521")).toBe(true);
    expect(rt.matchesFilter(e, "vpn hour")).toBe(true);
    expect(rt.matchesFilter(e, "fs vpn")).toBe(true);
    expect(rt.matchesFilter(e, "vpn printer")).toBe(false);
  });

  test("groupEntries splits by day with pinned first", () => {
    const now = new Date(2026, 10, 12, 15, 0, 0).getTime();
    const at = (d, h) => new Date(2026, 10, d, h, 0, 0).toISOString();
    const groups = rt.groupEntries([
      { key: "p", viewedAt: at(1, 9), pinned: true },
      { key: "t", viewedAt: at(12, 9) },
      { key: "y", viewedAt: at(11, 23) },
      { key: "w", viewedAt: at(8, 9) },
      { key: "o", viewedAt: at(1, 9) },
    ], now);
    expect(groups.map((g) => g.id)).toEqual(["pinned", "today", "yesterday", "week", "older"]);
    expect(groups.map((g) => g.items[0].key)).toEqual(["p", "t", "y", "w", "o"]);
    expect(rt.groupEntries([{ key: "t", viewedAt: at(12, 9) }], now).map((g) => g.id)).toEqual(["today"]);
  });

  test("timeAgo", () => {
    expect(rt.timeAgo(new Date(T0 - 20000).toISOString(), T0)).toBe("just now");
    expect(rt.timeAgo(new Date(T0 - 5 * 60000).toISOString(), T0)).toBe("5 min ago");
    expect(rt.timeAgo(new Date(T0 - 3 * 3600000).toISOString(), T0)).toBe("3 h ago");
    expect(rt.timeAgo("nonsense", T0)).toBe("");
  });

  test("entryName", () => {
    expect(rt.entryName({ siteName: "CW", label: "ticket #123", key: "CW-123" })).toBe("CW · ticket #123");
    expect(rt.entryName({ key: "42" })).toBe("42");
  });
});

describe("recent-tickets main process", () => {
  const good = {
    siteId: "freshservice", siteName: "FS", key: "1", label: "ticket #1",
    url: "https://acme.freshservice.com/a/tickets/1", viewedAt: "2026-11-12T15:00:00Z",
  };

  test("sanitizeEntry keeps good entries and rejects bad ones", () => {
    expect(rtMain.sanitizeEntry(good)).toMatchObject({ key: "1", views: 1, pinned: false, viewedAt: "2026-11-12T15:00:00.000Z" });
    expect(rtMain.sanitizeEntry(Object.assign({}, good, { url: "javascript:alert(1)" }))).toBeNull();
    expect(rtMain.sanitizeEntry(Object.assign({}, good, { key: "" }))).toBeNull();
    expect(rtMain.sanitizeEntry(Object.assign({}, good, { viewedAt: "soon" }))).toBeNull();
    expect(rtMain.sanitizeEntry(null)).toBeNull();
    expect(rtMain.sanitizeEntry([])).toBeNull();
    expect(rtMain.sanitizeEntry(Object.assign({}, good, { title: "x".repeat(1000) })).title).toHaveLength(300);
  });

  test("sanitizeStore drops duplicates and caps the list", () => {
    const many = [];
    for (let i = 0; i < 250; i++) many.push(Object.assign({}, good, { key: String(i) }));
    many.splice(1, 0, Object.assign({}, good, { key: "0", title: "dupe" }));
    const store = rtMain.sanitizeStore({ entries: many });
    expect(store.entries).toHaveLength(rtMain.HARD_MAX);
    expect(store.entries[0].title).toBe("");
    expect(rtMain.sanitizeStore(null)).toEqual({ version: 1, entries: [] });
  });

  test("validateSettings", () => {
    expect(rtMain.validateSettings({})).toBe(true);
    expect(rtMain.validateSettings({ recentTicketsMax: 50, recentTicketsReuseTab: false })).toBe(true);
    expect(rtMain.validateSettings({ recentTicketsMax: 51 })).toBe(false);
    expect(rtMain.validateSettings({ recentTicketsReuseTab: "yes" })).toBe(false);
  });
});

describe("recent-tickets command palette entries", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  function list() {
    const out = [];
    for (let i = 1; i <= 8; i++) {
      out.push(Object.assign(rec(String(i), { title: "Subject " + i }), { viewedAt: "2026-11-12T11:30:00Z", views: 1, pinned: false }));
    }
    out[6].pinned = true;
    return out;
  }

  test("with nothing typed: pinned first, then the latest, five in all", () => {
    const items = rt.paletteEntries(list(), "", now);
    expect(items.map((i) => i.entry.key)).toEqual(["7", "1", "2", "3", "4"]);
    expect(items[0].shortcut).toBe("Pinned");
    expect(items[1]).toMatchObject({
      id: "r1",
      title: "ticket #1  Subject 1",
      subtitle: "FS · viewed 30 min ago",
      keywords: ["1", "ticket #1", "FS"],
      shortcut: "",
    });
  });

  test("with a query: every entry, and none without a link", () => {
    const entries = list();
    entries[2].url = "";
    const items = rt.paletteEntries(entries, "sub", now);
    expect(items).toHaveLength(7);
    expect(items.every((i) => /^r\d+$/.test(i.id))).toBe(true);
  });

  test("an entry without a subject shows its label", () => {
    const items = rt.paletteEntries([Object.assign(rec("9"), { viewedAt: "bad" })], "9", now);
    expect(items[0].title).toBe("ticket #9");
    expect(items[0].subtitle).toBe("FS");
  });
});
