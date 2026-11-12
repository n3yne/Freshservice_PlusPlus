"use strict";

const { matchScore, scoreItem, rankItems, sanitizeCommand } = require("../command-palette");

const run = () => {};
const item = (title, extra = {}) => Object.assign({ id: title, title, run }, extra);

describe("matchScore", () => {
  test("ranks whole, prefix, word start, substring, words, then letters in order", () => {
    const whole = matchScore("new tab", "New Tab");
    const prefix = matchScore("new", "New Tab");
    const word = matchScore("tab", "New Tab");
    const inside = matchScore("ew", "New Tab");
    const words = matchScore("tab new", "New Tab");
    const letters = matchScore("nt", "New Tab");
    expect(whole).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(words);
    expect(words).toBeGreaterThan(letters);
    expect(letters).toBeGreaterThan(0);
  });

  test("is 0 when there's no match or nothing to match", () => {
    expect(matchScore("xyz", "New Tab")).toBe(0);
    expect(matchScore("", "New Tab")).toBe(0);
    expect(matchScore("new", "")).toBe(0);
    expect(matchScore("new", undefined)).toBe(0);
  });

  test("exact leaves out letters in order", () => {
    expect(matchScore("nt", "New Tab", true)).toBe(0);
    expect(matchScore("tab", "New Tab", true)).toBeGreaterThan(0);
  });

  test("tighter letter runs score higher", () => {
    expect(matchScore("rld", "Reload")).toBeGreaterThan(matchScore("rld", "Refresh all tabs (old)"));
  });
});

describe("scoreItem", () => {
  test("titles count more than keywords, keywords more than subtitles", () => {
    const byTitle = scoreItem("zoom", item("Zoom In"));
    const byKeyword = scoreItem("zoom", item("Actual Size", { keywords: ["zoom reset"] }));
    const bySubtitle = scoreItem("zoom", item("Meeting", { subtitle: "zoom.us/j/1" }));
    expect(byTitle).toBeGreaterThan(byKeyword);
    expect(byKeyword).toBeGreaterThan(bySubtitle);
    expect(bySubtitle).toBeGreaterThan(0);
  });

  test("scattered letters in a subtitle don't match", () => {
    expect(scoreItem("vendor", item("Settings: Ticket Notifications", { subtitle: "Shows a notification when a ticket view gets a new reply or is reassigned" }))).toBe(0);
  });
});

describe("rankItems", () => {
  const items = [
    item("Reload Tab"),
    item("New Tab"),
    item("Settings: Bookmarks Bar"),
    item("Freshservice", { subtitle: "https://help.example.com/a/tickets/1" }),
  ];

  test("with no query keeps the given order", () => {
    expect(rankItems("", items).map((i) => i.title)).toEqual(items.map((i) => i.title));
  });

  test("puts the best match first and drops misses", () => {
    expect(rankItems("new", items).map((i) => i.title)).toEqual(["New Tab"]);
    expect(rankItems("tab", items).map((i) => i.title)).toEqual(["Reload Tab", "New Tab", "Settings: Bookmarks Bar"]);
    expect(rankItems("bookmarks", items)[0].title).toBe("Settings: Bookmarks Bar");
    expect(rankItems("tickets", items)[0].title).toBe("Freshservice");
  });

  test("keeps pinned items on top whatever the query", () => {
    const pinned = item("Open ticket 12345", { pinned: true });
    const out = rankItems("12345", items.concat(pinned));
    expect(out[0]).toBe(pinned);
    expect(rankItems("", [items[0], pinned])[0]).toBe(pinned);
  });

  test("skips unusable items and stops at the limit", () => {
    const bad = [null, { title: "No run" }, { title: "", run }, item("Okay")];
    expect(rankItems("", bad).map((i) => i.title)).toEqual(["Okay"]);
    const many = Array.from({ length: 80 }, (_, i) => item("Tab " + i));
    expect(rankItems("", many)).toHaveLength(50);
    expect(rankItems("tab", many, 5)).toHaveLength(5);
  });
});

describe("sanitizeCommand", () => {
  test("copies a usable command with defaults and a prefixed id", () => {
    const runInNewTab = () => {};
    const c = sanitizeCommand({ id: "open-recent", title: "  Recent tickets ", keywords: ["history", 5], run, runInNewTab }, "plugin:");
    expect(c).toEqual({
      id: "plugin:open-recent", title: "Recent tickets", subtitle: "", group: "Commands",
      keywords: ["history"], shortcut: "", run, runInNewTab,
    });
  });

  test("rejects a missing title, run function or bad id", () => {
    expect(sanitizeCommand(null)).toBeNull();
    expect(sanitizeCommand({ id: "x", run })).toBeNull();
    expect(sanitizeCommand({ id: "x", title: "X" })).toBeNull();
    expect(sanitizeCommand({ id: "../x", title: "X", run })).toBeNull();
    expect(sanitizeCommand({ id: "", title: "X", run })).toBeNull();
  });

  test("clips long text", () => {
    const c = sanitizeCommand({ id: "x", title: "T".repeat(500), subtitle: "s".repeat(900), group: "g".repeat(90), run });
    expect(c.title).toHaveLength(200);
    expect(c.subtitle).toHaveLength(300);
    expect(c.group).toHaveLength(40);
  });
});
