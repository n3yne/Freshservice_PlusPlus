const S = require("../side-panel-split");
const { DEFAULT_SETTINGS, validateSettings } = require("../utils");

describe("side panel split view", () => {
  test("clampSplit keeps the split in range and defaults bad values", () => {
    expect(S.clampSplit(0.3)).toBe(0.3);
    expect(S.clampSplit(0)).toBe(S.MIN_SPLIT);
    expect(S.clampSplit(1)).toBe(S.MAX_SPLIT);
    expect(S.clampSplit("0.3")).toBe(S.DEFAULT_SPLIT);
    expect(S.clampSplit(NaN)).toBe(S.DEFAULT_SPLIT);
    expect(S.clampSplit(undefined)).toBe(S.DEFAULT_SPLIT);
  });

  test("placeTabs splits tabs by the saved bottom list, keeping display order", () => {
    expect(S.placeTabs(["notes", "solutions", "recent"], ["solutions"]))
      .toEqual({ top: ["notes", "recent"], bottom: ["solutions"] });
    expect(S.placeTabs(["notes", "solutions"], [])).toEqual({ top: ["notes", "solutions"], bottom: [] });
    expect(S.placeTabs(["notes"], undefined)).toEqual({ top: ["notes"], bottom: [] });
  });

  test("placeTabs never leaves the top half empty", () => {
    expect(S.placeTabs(["solutions", "recent"], ["solutions", "recent"]))
      .toEqual({ top: ["solutions", "recent"], bottom: [] });
    expect(S.placeTabs([], ["solutions"])).toEqual({ top: [], bottom: [] });
  });

  test("placeTabs ignores saved ids whose tab isn't open", () => {
    expect(S.placeTabs(["notes", "recent"], ["solutions"])).toEqual({ top: ["notes", "recent"], bottom: [] });
  });

  test("moveTab adds and removes a tab from the bottom list without duplicates", () => {
    expect(S.moveTab([], "solutions", "bottom")).toEqual(["solutions"]);
    expect(S.moveTab(["solutions"], "solutions", "bottom")).toEqual(["solutions"]);
    expect(S.moveTab(["solutions", "recent"], "solutions", "top")).toEqual(["recent"]);
    expect(S.moveTab(undefined, "notes", "top")).toEqual([]);
  });

  test("chooseActive prefers the saved tab when it is in the half", () => {
    expect(S.chooseActive(["notes", "recent"], "recent")).toBe("recent");
    expect(S.chooseActive(["notes", "recent"], "solutions")).toBe("notes");
    expect(S.chooseActive([], "notes")).toBe(null);
  });

  test("splitFromPointer follows the pointer and keeps room for each half", () => {
    expect(S.splitFromPointer(300, 100, 400, 50)).toBe(0.5);
    expect(S.splitFromPointer(140, 100, 400, 0)).toBeCloseTo(0.15);
    // Dragged past the top: the top half keeps 100px of 400 (0.25).
    expect(S.splitFromPointer(0, 100, 400, 100)).toBe(0.25);
    // Dragged past the bottom: the bottom half keeps 100px.
    expect(S.splitFromPointer(900, 100, 400, 100)).toBe(0.75);
    expect(S.splitFromPointer(100, 100, 0, 100)).toBe(S.DEFAULT_SPLIT);
  });

  test("settings: defaults are valid and bad values are rejected", () => {
    expect(DEFAULT_SETTINGS.sidePanelBottomTabs).toEqual([]);
    expect(DEFAULT_SETTINGS.sidePanelBottomTab).toBe("");
    expect(DEFAULT_SETTINGS.sidePanelSplit).toBe(0.5);
    const ok = (patch) => validateSettings({ ...DEFAULT_SETTINGS, ...patch });
    expect(ok({ sidePanelBottomTabs: ["solutions-chat", "recent"], sidePanelBottomTab: "recent", sidePanelSplit: 0.3 })).toBe(true);
    expect(ok({ sidePanelBottomTabs: "solutions" })).toBe(false);
    expect(ok({ sidePanelBottomTabs: ["a", "a"] })).toBe(false);
    expect(ok({ sidePanelBottomTabs: ["Bad Id"] })).toBe(false);
    expect(ok({ sidePanelBottomTabs: [3] })).toBe(false);
    expect(ok({ sidePanelBottomTab: 5 })).toBe(false);
    expect(ok({ sidePanelSplit: 0.05 })).toBe(false);
    expect(ok({ sidePanelSplit: "0.5" })).toBe(false);
    // Settings saved by older versions have none of these keys.
    const old = { ...DEFAULT_SETTINGS };
    delete old.sidePanelBottomTabs; delete old.sidePanelBottomTab; delete old.sidePanelSplit;
    expect(validateSettings(old)).toBe(true);
  });
});
