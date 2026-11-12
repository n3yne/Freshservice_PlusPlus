const fs = require("fs");
const path = require("path");
const PluginCategories = require("../plugin-categories");

const { normalizeCategory, categoryOf, groupPlugins, sortPlugins, CATEGORIES, OTHER } = PluginCategories;
const builtInNames = CATEGORIES.map((c) => c.name);

describe("normalizeCategory", () => {
  test("matches built-in names case-insensitively", () => {
    expect(normalizeCategory("tickets")).toBe("Tickets");
    expect(normalizeCategory("  NOTES & replies ")).toBe("Notes & Replies");
    expect(normalizeCategory("other")).toBe(OTHER);
  });

  test("keeps custom names, tidied and capped at 40 characters", () => {
    expect(normalizeCategory("  Reporting   tools ")).toBe("Reporting tools");
    expect(normalizeCategory("x".repeat(60))).toHaveLength(40);
  });

  test("rejects non-strings and blanks", () => {
    expect(normalizeCategory(undefined)).toBe("");
    expect(normalizeCategory(42)).toBe("");
    expect(normalizeCategory("   ")).toBe("");
  });
});

describe("categoryOf", () => {
  test("uses the manifest category", () => {
    expect(categoryOf({ category: "AI" })).toBe("AI");
  });

  test("site plugins without one go under Sites, others under Other", () => {
    expect(categoryOf({ site: { name: "X" } })).toBe("Sites");
    expect(categoryOf({})).toBe(OTHER);
    expect(categoryOf(null)).toBe(OTHER);
  });
});

describe("groupPlugins", () => {
  const plugins = [
    { id: "z", name: "Zeta", category: "Tickets", enabled: true },
    { id: "custom", name: "Custom", category: "Reporting", enabled: true },
    { id: "loose", name: "Loose", enabled: false },
    { id: "a", name: "alpha", category: "tickets", enabled: false },
    { id: "site", name: "Site", site: { name: "Site" }, enabled: true },
    { id: "ai", name: "AI Thing", category: "AI", enabled: true },
  ];

  test("built-in categories first in their order, then custom, then Other", () => {
    expect(groupPlugins(plugins).map((g) => g.name)).toEqual(["Sites", "Tickets", "AI", "Reporting", OTHER]);
  });

  test("sorts plugins by name within a group and counts the ones that are on", () => {
    const tickets = groupPlugins(plugins).find((g) => g.name === "Tickets");
    expect(tickets.plugins.map((p) => p.id)).toEqual(["a", "z"]);
    expect(tickets.enabledCount).toBe(1);
    expect(tickets.description).toBeTruthy();
  });

  test("custom groups have no description", () => {
    expect(groupPlugins(plugins).find((g) => g.name === "Reporting").description).toBe("");
  });

  test("handles a missing list", () => {
    expect(groupPlugins(undefined)).toEqual([]);
  });

  test("sortPlugins flattens the groups in display order", () => {
    expect(sortPlugins(plugins).map((p) => p.id)).toEqual(["site", "a", "z", "ai", "custom", "loose"]);
  });
});

describe("bundled plugin manifests", () => {
  const dir = path.join(__dirname, "..", "plugins");
  const ids = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "manifest.json")));

  test.each(ids)("%s names a built-in category", (id) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, id, "manifest.json"), "utf-8"));
    expect(builtInNames).toContain(manifest.category);
    if (manifest.site) expect(manifest.category).toBe("Sites");
  });
});
