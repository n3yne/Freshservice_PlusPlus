"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const PluginDirectory = require("../plugin-directory");
const moved = require("../moved-plugins.json").plugins;
const { readPluginManifests } = require("../scripts/build-plugin-directory");

describe("moved-plugins.json", () => {
  const manifests = new Map(readPluginManifests().map((p) => [p.manifest.id, p]));

  test("lists only plugins that are in the directory now", () => {
    for (const m of moved) {
      expect(manifests.get(m.id)).toBeDefined();
      expect(manifests.get(m.id).distribution).toBe("directory");
    }
  });

  test("keeps each plugin's settings defaults and credentials in step with the plugin", () => {
    for (const m of moved) {
      const { manifest, dir } = manifests.get(m.id);
      const defaults = manifest.main ? require(path.join(dir, manifest.main)).defaultSettings || {} : {};
      expect({ id: m.id, settings: m.settings }).toEqual({ id: m.id, settings: defaults });
      expect(m.credentials || []).toEqual(manifest.credentials || []);
      if (m.alsoIf) expect(moved.map((x) => x.id)).toContain(m.alsoIf);
    }
  });
});

describe("findMovedPlugins", () => {
  function userDataWith(files = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mspp-moved-"));
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    return dir;
  }

  test("ticks plugins that show signs of use and leaves out installed and offered ones", () => {
    const userData = userDataWith({
      "plugins/time-tracker/timers.json": JSON.stringify({ timers: [{ ticket: "1" }] }),
      "plugins/tree-tabs/tree.json": "{}", // empty file: not a sign of use
    });
    const result = PluginDirectory.findMovedPlugins({
      userData,
      moved,
      settings: {
        cannedResponses: [{ title: "Hi", text: "Hello" }],
        quickActionsReloadTab: true, // the default
        aiApiKeyEncrypted: "abc",
      },
      pluginsConfig: { "ticket-search": false },
      installedIds: ["follow-ups"],
      handled: ["quick-actions"],
      tabsText: JSON.stringify([{ url: "https://na.myconnectwise.net/v4_6_release/" }]),
    });
    const byId = Object.fromEntries(result.map((r) => [r.id, r.used]));
    expect(byId).toEqual({
      "connectwise-manage": true,
      "ai-features": true,
      "solutions-chat": true, // alsoIf ai-features
      "canned-responses": true,
      "time-tracker": true,
      "ticket-notifications": false,
      "ticket-search": false, // turned off
      "tree-tabs": false,
    });
  });

  test("a plugin that was turned off isn't ticked even with data", () => {
    const userData = userDataWith({ "plugins/time-tracker/timers.json": "{\"timers\":[1]}" });
    const result = PluginDirectory.findMovedPlugins({
      userData, moved: moved.filter((m) => m.id === "time-tracker"), pluginsConfig: { "time-tracker": false },
    });
    expect(result).toEqual([{ id: "time-tracker", name: "Time Tracker", used: false }]);
  });

  test("dismissMoved stops the offer for good", async () => {
    const userData = userDataWith();
    const dir = PluginDirectory.createPluginDirectory({
      userData, appVersion: "0.8.0", logger: { warn() {}, error() {} },
      fetchImpl: async () => { throw new Error("offline"); },
    });
    dir.setMoved([{ id: "time-tracker", name: "Time Tracker", used: true }]);
    expect(dir.getState().moved).toEqual([{ id: "time-tracker", name: "Time Tracker", used: true, available: false }]);
    dir.dismissMoved(["time-tracker"]);
    expect(dir.getState().moved).toEqual([]);
    expect(PluginDirectory.readMovedHandled(userData)).toEqual(["time-tracker"]);
  });
});
