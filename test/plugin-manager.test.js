"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { fileURLToPath } = require("url");

const pluginManager = require("../plugin-manager");

// Builds a user plugin under a userData folder whose path contains characters
// that must be percent-encoded in a file:// URL.
function makeUserData() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fspp #50% test-"));
  const pluginDir = path.join(userData, "plugins", "menu-test");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify({
    id: "menu-test",
    name: "Menu test",
    main: "main.js",
    renderer: "renderer.js",
  }));
  fs.writeFileSync(path.join(pluginDir, "main.js"),
    "module.exports = function (api) { api.addMenuItem({ label: 'Do thing', click: function () {} }); };");
  fs.writeFileSync(path.join(pluginDir, "renderer.js"), "");
  return { userData, pluginDir };
}

describe("plugin-manager", () => {
  const ipcMain = { handle: () => {} };

  test("passes plugin menu items to the menu rebuild callback", async () => {
    const { userData } = makeUserData();
    const rebuilt = [];
    await pluginManager.initPlugins(userData, {}, ipcMain, (items) => rebuilt.push(items.slice()));
    const last = rebuilt[rebuilt.length - 1];
    expect(last).toEqual([expect.objectContaining({ label: "Do thing", pluginId: "menu-test" })]);
  });

  test("returns percent-encoded file URLs that round-trip to the script path", async () => {
    const { userData, pluginDir } = makeUserData();
    await pluginManager.initPlugins(userData, {}, ipcMain);
    const expected = path.join(pluginDir, "renderer.js");
    const url = pluginManager.getRendererScripts().find((u) => fileURLToPath(u) === expected);
    expect(url).toMatch(/^file:\/\//);
    expect(url).not.toMatch(/#/);
    expect(url).toContain("%25");
  });
});
