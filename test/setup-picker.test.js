"use strict";

const SetupPicker = require("../setup-picker");
const PluginCategories = require("../plugin-categories");

const index = [
  { id: "freshservice", name: "Freshservice", category: "Sites", site: true, status: "available", requires: [] },
  { id: "connectwise-manage", name: "ConnectWise Manage", category: "Sites", site: true, status: "available", requires: [] },
  { id: "note-backup", name: "Note Backup", category: "Notes & Replies", status: "available", requires: [] },
  { id: "ai-features", name: "AI Features", category: "AI", status: "available", requires: [] },
  { id: "solutions-chat", name: "Solutions Chat", category: "AI", status: "available", requires: ["ai-features", "freshservice"] },
  { id: "tree-tabs", name: "Tree Style Tabs", category: "Tabs & Toolbars", status: "installed", requires: [] },
  { id: "future", name: "Future", category: "Tickets", status: "incompatible", compatible: false, requires: [] },
];

describe("setup picker choices", () => {
  test("puts site plugins first, groups the rest by category and leaves out installed ones", () => {
    const c = SetupPicker.buildChoices(index, [], PluginCategories);
    expect(c.sites.map((p) => p.id)).toEqual(["connectwise-manage", "freshservice"]);
    expect(c.groups.map((g) => g.name)).toEqual(["Tickets", "Notes & Replies", "AI"]);
    expect(c.groups.flatMap((g) => g.plugins).map((p) => p.id)).not.toContain("tree-tabs");
    expect([...c.selected]).toEqual([]);
  });

  test("pre-ticks plugins in use before the update, with what they need, but not incompatible ones", () => {
    const c = SetupPicker.buildChoices(index, ["solutions-chat", "future", "not-listed"], PluginCategories);
    expect([...c.selected].sort()).toEqual(["ai-features", "freshservice", "solutions-chat"]);
  });

  test("ticking adds requirements; unticking a requirement unticks what needs it", () => {
    let s = SetupPicker.toggle(new Set(), "solutions-chat", true, index);
    expect([...s].sort()).toEqual(["ai-features", "freshservice", "solutions-chat"]);
    s = SetupPicker.toggle(s, "freshservice", false, index);
    expect([...s]).toEqual(["ai-features"]);
  });

  test("names what a plugin also installs", () => {
    expect(SetupPicker.requiredNames(index[4], index)).toEqual(["AI Features", "Freshservice"]);
  });
});
