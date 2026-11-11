"use strict";

const bookmarks = require("../plugins/bookmarks-bar/main");
const { validateSettings, defaultSettings, MAX_BOOKMARKS } = bookmarks;

const ok = (over) => Object.assign({ id: "bm-1", title: "Example", url: "https://example.com/" }, over);

describe("bookmarks-bar validateSettings", () => {
  test("accepts the defaults and an empty object", () => {
    expect(validateSettings(defaultSettings)).toBe(true);
    expect(validateSettings({})).toBe(true);
  });

  test("bookmarksBarVisible must be a boolean", () => {
    expect(validateSettings({ bookmarksBarVisible: false })).toBe(true);
    expect(validateSettings({ bookmarksBarVisible: "no" })).toBe(false);
  });

  test("accepts web bookmarks, with or without a name", () => {
    expect(validateSettings({ bookmarksBarItems: [ok(), ok({ id: "bm-2", title: "", url: "http://localhost:3000/x" })] })).toBe(true);
  });

  test("rejects anything that isn't an http(s) page", () => {
    for (const url of ["file:///C:/Windows/system32/cmd.exe", "javascript:alert(1)", "about:blank", "", "example.com"]) {
      expect(validateSettings({ bookmarksBarItems: [ok({ url })] })).toBe(false);
    }
  });

  test("rejects malformed entries, duplicate ids and oversized lists", () => {
    expect(validateSettings({ bookmarksBarItems: "x" })).toBe(false);
    expect(validateSettings({ bookmarksBarItems: [null] })).toBe(false);
    expect(validateSettings({ bookmarksBarItems: [ok({ id: "" })] })).toBe(false);
    expect(validateSettings({ bookmarksBarItems: [ok({ title: 5 })] })).toBe(false);
    expect(validateSettings({ bookmarksBarItems: [ok({ title: "x".repeat(201) })] })).toBe(false);
    expect(validateSettings({ bookmarksBarItems: [ok(), ok()] })).toBe(false);
    const many = Array.from({ length: MAX_BOOKMARKS + 1 }, (_, i) => ok({ id: "bm-" + i }));
    expect(validateSettings({ bookmarksBarItems: many })).toBe(false);
  });
});
