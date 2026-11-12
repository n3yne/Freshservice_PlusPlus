"use strict";

const { tabShortcutForKey, targetTabIndex } = require("../tab-shortcuts");

// Electron before-input-event style input.
const key = (k, mods = {}) => Object.assign({ key: k, control: true, shift: false, alt: false, meta: false }, mods);

describe("tabShortcutForKey", () => {
  test("maps tab shortcuts", () => {
    expect(tabShortcutForKey(key("t"))).toEqual({ action: "new-tab" });
    expect(tabShortcutForKey(key("T", { shift: true }))).toEqual({ action: "reopen-closed" });
    expect(tabShortcutForKey(key("w"))).toEqual({ action: "close-tab" });
    expect(tabShortcutForKey(key("f"))).toEqual({ action: "find" });
    expect(tabShortcutForKey(key("F"))).toEqual({ action: "find" });
    expect(tabShortcutForKey(key("k"))).toEqual({ action: "command-palette" });
    expect(tabShortcutForKey({ key: "K", ctrlKey: true })).toEqual({ action: "command-palette" });
    expect(tabShortcutForKey(key("Tab"))).toEqual({ action: "next-tab" });
    expect(tabShortcutForKey(key("Tab", { shift: true }))).toEqual({ action: "prev-tab" });
    expect(tabShortcutForKey(key("PageDown"))).toEqual({ action: "next-tab" });
    expect(tabShortcutForKey(key("PageUp"))).toEqual({ action: "prev-tab" });
  });

  test("Ctrl+1 to 8 pick a tab and Ctrl+9 is the last tab", () => {
    expect(tabShortcutForKey(key("1"))).toEqual({ action: "select-tab", index: 0 });
    expect(tabShortcutForKey(key("8"))).toEqual({ action: "select-tab", index: 7 });
    expect(tabShortcutForKey(key("9"))).toEqual({ action: "last-tab" });
  });

  test("ignores other keys and modifiers", () => {
    expect(tabShortcutForKey(key("t", { control: false }))).toBeNull();
    expect(tabShortcutForKey(key("t", { alt: true }))).toBeNull();
    expect(tabShortcutForKey(key("w", { shift: true }))).toBeNull();
    expect(tabShortcutForKey(key("f", { shift: true }))).toBeNull();
    expect(tabShortcutForKey(key("k", { shift: true }))).toBeNull();
    expect(tabShortcutForKey(key("1", { shift: true }))).toBeNull();
    expect(tabShortcutForKey(key("0"))).toBeNull();
    expect(tabShortcutForKey(key("c"))).toBeNull();
    expect(tabShortcutForKey(null)).toBeNull();
  });

  test("accepts DOM KeyboardEvent fields", () => {
    expect(tabShortcutForKey({ key: "Tab", ctrlKey: true, shiftKey: true })).toEqual({ action: "prev-tab" });
    expect(tabShortcutForKey({ key: "2", ctrlKey: true })).toEqual({ action: "select-tab", index: 1 });
    expect(tabShortcutForKey({ key: "t", metaKey: true })).toEqual({ action: "new-tab" });
  });
});

describe("targetTabIndex", () => {
  test("next and previous wrap around", () => {
    expect(targetTabIndex({ action: "next-tab" }, 2, 3)).toBe(0);
    expect(targetTabIndex({ action: "prev-tab" }, 0, 3)).toBe(2);
    expect(targetTabIndex({ action: "next-tab" }, 0, 1)).toBe(-1);
  });

  test("select and last", () => {
    expect(targetTabIndex({ action: "select-tab", index: 1 }, 0, 3)).toBe(1);
    expect(targetTabIndex({ action: "select-tab", index: 5 }, 0, 3)).toBe(-1);
    expect(targetTabIndex({ action: "last-tab" }, 0, 4)).toBe(3);
    expect(targetTabIndex({ action: "last-tab" }, 3, 4)).toBe(-1);
  });

  test("non-switching actions do nothing", () => {
    expect(targetTabIndex({ action: "new-tab" }, 0, 3)).toBe(-1);
  });
});
