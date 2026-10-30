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

  test("collects manifest credentials, including from disabled plugins", async () => {
    const { userData } = makeUserData();
    const credDir = path.join(userData, "plugins", "cred-test");
    fs.mkdirSync(credDir, { recursive: true });
    fs.writeFileSync(path.join(credDir, "manifest.json"), JSON.stringify({
      id: "cred-test",
      credentials: ["credTestKey", "bad name", 42],
    }));
    fs.mkdirSync(path.join(userData, "note-backups"), { recursive: true });
    fs.writeFileSync(path.join(userData, "note-backups", "plugins-config.json"), JSON.stringify({ "cred-test": false }));
    await pluginManager.initPlugins(userData, {}, ipcMain);
    expect(pluginManager.getCredentialFields()).toContainEqual({
      plain: "credTestKey",
      encrypted: "credTestKeyEncrypted",
      flag: "credTestKeySet",
      remove: "credTestKeyRemove",
    });
    expect(pluginManager.getCredentialFields().map((c) => c.plain)).not.toContain("bad name");
    const info = pluginManager.getPluginInfo().find((p) => p.id === "cred-test");
    expect(info.enabled).toBe(false);
    expect(info.credentials).toEqual(["credTestKey"]);
  });

  test("bundled plugins declare their API keys as credentials", async () => {
    const { userData } = makeUserData();
    await pluginManager.initPlugins(userData, {}, ipcMain);
    const names = pluginManager.getCredentialFields().map((c) => c.plain);
    expect(names).toEqual(expect.arrayContaining(["aiApiKey", "fsApiKey"]));
  });
});
