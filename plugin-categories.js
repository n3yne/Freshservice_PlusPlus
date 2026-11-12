// Plugin categories: how Settings → Plugins (and the plugin tabs in the
// Settings nav) group plugins, so it's easy to see what's there and what's on.
//
// A plugin names its category in its manifest ("category": "Tickets"). The
// built-in categories below come first, in this order; a plugin may name its
// own category, which is listed after them (alphabetically), and a plugin with
// no category goes under "Other" at the end. A site plugin with no category
// goes under "Sites".
//
// Shared by the settings window (script tag), the main process and tests (require).
(function (root) {
  "use strict";

  const CATEGORIES = [
    { name: "Sites",            description: "Support for a ticketing site: ticket detection, note sync and its API." },
    { name: "Tickets",          description: "Finding, opening and updating tickets." },
    { name: "Notes & Replies",  description: "Writing ticket notes and replies." },
    { name: "Time & Reminders", description: "Tracking time on tickets and following up on them." },
    { name: "AI",               description: "AI suggestions, summaries and answers." },
    { name: "Tabs & Toolbars",  description: "Extra bars and ways to arrange tabs." },
  ];
  const OTHER = "Other";
  const MAX_LENGTH = 40;

  // A manifest's "category" value, tidied: a trimmed string of at most 40
  // characters, matched case-insensitively to a built-in name; "" if unusable.
  function normalizeCategory(value) {
    if (typeof value !== "string") return "";
    const v = value.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH).trim();
    if (!v) return "";
    const builtIn = CATEGORIES.find(function (c) { return c.name.toLowerCase() === v.toLowerCase(); });
    if (builtIn) return builtIn.name;
    if (v.toLowerCase() === OTHER.toLowerCase()) return OTHER;
    return v;
  }

  // The category a plugin (from getPluginInfo) is listed under.
  function categoryOf(plugin) {
    const c = normalizeCategory(plugin && plugin.category);
    if (c) return c;
    return plugin && plugin.site ? "Sites" : OTHER;
  }

  function rankOf(name) {
    const i = CATEGORIES.findIndex(function (c) { return c.name === name; });
    if (i >= 0) return i;
    return name === OTHER ? CATEGORIES.length + 1 : CATEGORIES.length;
  }

  function pluginLabel(p) {
    return String((p && (p.name || p.id)) || "");
  }

  // [{ name, description, plugins: [...], enabledCount }] in display order,
  // plugins sorted by name within each group. Empty groups are left out.
  function groupPlugins(plugins) {
    const groups = new Map();
    (Array.isArray(plugins) ? plugins : []).forEach(function (p) {
      const name = categoryOf(p);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(p);
    });
    const names = Array.from(groups.keys()).sort(function (a, b) {
      return rankOf(a) - rankOf(b) || a.localeCompare(b, undefined, { sensitivity: "base" });
    });
    return names.map(function (name) {
      const list = groups.get(name).slice().sort(function (a, b) {
        return pluginLabel(a).localeCompare(pluginLabel(b), undefined, { sensitivity: "base" });
      });
      const builtIn = CATEGORIES.find(function (c) { return c.name === name; });
      return {
        name,
        description: builtIn ? builtIn.description : "",
        plugins: list,
        enabledCount: list.filter(function (p) { return p.enabled; }).length,
      };
    });
  }

  // The plugins in the order Settings shows them (group by group).
  function sortPlugins(plugins) {
    return groupPlugins(plugins).reduce(function (all, g) { return all.concat(g.plugins); }, []);
  }

  const api = {
    CATEGORIES: CATEGORIES.map(function (c) { return Object.assign({}, c); }),
    OTHER,
    normalizeCategory,
    categoryOf,
    groupPlugins,
    sortPlugins,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PluginCategories = api;
})(typeof window !== "undefined" ? window : globalThis);
