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

  test("onMessage registers a namespaced fire-and-forget channel and emit reaches api.on", async () => {
    const { userData } = makeUserData();
    const msgDir = path.join(userData, "plugins", "msg-test");
    fs.mkdirSync(msgDir, { recursive: true });
    fs.writeFileSync(path.join(msgDir, "manifest.json"), JSON.stringify({ id: "msg-test", main: "main.js", settings: "settings.js" }));
    fs.writeFileSync(path.join(msgDir, "settings.js"), "");
    fs.writeFileSync(path.join(msgDir, "main.js"),
      "module.exports = function (api) {" +
      "  api.onMessage('save-state', function (d) { global.__msgTest = d; });" +
      "  api.on('msg-test:ping', function (d) { global.__msgPing = d; });" +
      "  api.emit('msg-test:ping', { ok: true });" +
      "};");
    const listeners = new Map();
    const ipc = { handle: () => {}, on: (channel, fn) => listeners.set(channel, fn) };
    await pluginManager.initPlugins(userData, {}, ipc);

    expect(global.__msgPing).toEqual({ ok: true });
    const fn = listeners.get("plugin-msg:msg-test:save-state");
    expect(typeof fn).toBe("function");
    fn({}, { blank: true });
    expect(global.__msgTest).toEqual({ blank: true });

    const info = pluginManager.getPluginInfo().find((p) => p.id === "msg-test");
    expect(info.hasSettings).toBe(true);
    const entry = pluginManager.getSettingsScripts().find((e) => e.id === "msg-test");
    expect(entry.url).toMatch(/^file:\/\//);
    delete global.__msgTest;
    delete global.__msgPing;
  });

  test("collects site blocks from loaded plugins and seeds the home page default", async () => {
    const { userData } = makeUserData();
    const siteDir = path.join(userData, "plugins", "site-test");
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, "manifest.json"), JSON.stringify({
      id: "site-test",
      site: {
        name: "Site Test",
        hosts: ["Example-Helpdesk.net", "*.bad.com", "https://nope.com", "example-helpdesk.net"],
        defaultUrl: "https://na.example-helpdesk.net/start",
        chromeUserAgent: true,
        color: "#ABC",
      },
    }));
    await pluginManager.initPlugins(userData, {}, ipcMain);

    const site = pluginManager.getSites().find((si) => si.pluginId === "site-test");
    expect(site).toEqual({
      pluginId: "site-test",
      name: "Site Test",
      shortName: "Site Test",
      hosts: ["example-helpdesk.net"],
      defaultUrl: "https://na.example-helpdesk.net/start",
      chromeUserAgent: true,
      color: "#aabbcc",
    });
    expect(pluginManager.findSiteForUrl("https://na.example-helpdesk.net/v4/ticket").pluginId).toBe("site-test");
    expect(pluginManager.findSiteForUrl("https://example-helpdesk.net/").pluginId).toBe("site-test");
    expect(pluginManager.findSiteForUrl("https://notexample-helpdesk.net/")).toBeNull();
    expect(pluginManager.findSiteForUrl("not a url")).toBeNull();

    // The bundled Freshservice plugin loads first (bundled before user plugins),
    // so its start page is the default.
    const fsSite = pluginManager.getSites().find((si) => si.pluginId === "freshservice");
    expect(fsSite.hosts).toEqual(["freshservice.com", "freshworks.com", "myfreshworks.com"]);
    expect(fsSite.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(pluginManager.findSiteForUrl("https://acme.freshservice.com/a/tickets/1").pluginId).toBe("freshservice");
    expect(pluginManager.getPluginDefaultSettings().defaultUrl).toBe("https://freshservice.com/login");
  });

  test("a disabled site plugin shapes nothing", async () => {
    const { userData } = makeUserData();
    fs.mkdirSync(path.join(userData, "note-backups"), { recursive: true });
    fs.writeFileSync(path.join(userData, "note-backups", "plugins-config.json"), JSON.stringify({ freshservice: false }));
    await pluginManager.initPlugins(userData, {}, ipcMain);
    expect(pluginManager.getSites().map((si) => si.pluginId)).not.toContain("freshservice");
    expect(pluginManager.findSiteForUrl("https://acme.freshservice.com/")).toBeNull();
    expect(pluginManager.getPluginDefaultSettings().defaultUrl).toBeUndefined();
  });

  test("parseSiteManifest rejects unusable blocks", () => {
    expect(pluginManager.parseSiteManifest("x", undefined)).toBeNull();
    expect(pluginManager.parseSiteManifest("x", [])).toBeNull();
    const parsed = pluginManager.parseSiteManifest("x", { hosts: "a.com", defaultUrl: "javascript:alert(1)", color: "red; background: url(x)" });
    expect(parsed).toEqual({ pluginId: "x", name: "x", shortName: "x", hosts: [], defaultUrl: "", chromeUserAgent: false, color: "" });
  });

  describe("installed plugins (plugin directory)", () => {
    const bundledVersion = require("../plugins/bookmarks-bar/manifest.json").version;

    function installCopy(userData, version, source) {
      const dir = path.join(userData, "installed-plugins", "bookmarks-bar");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
        id: "bookmarks-bar", name: "Bookmarks Bar", version, renderer: "renderer.js",
      }));
      fs.writeFileSync(path.join(dir, "renderer.js"), "");
      if (source) {
        fs.writeFileSync(path.join(userData, "installed-plugins", "registry.json"),
          JSON.stringify({ "bookmarks-bar": { source, version } }));
      }
      return dir;
    }

    test("a newer installed copy replaces the bundled one", async () => {
      const { userData } = makeUserData();
      const dir = installCopy(userData, "99.0.0", "directory");
      await pluginManager.initPlugins(userData, {}, ipcMain);
      const copies = pluginManager.getPluginInfo().filter((p) => p.id === "bookmarks-bar");
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({ source: "directory", version: "99.0.0", replacesBundled: bundledVersion });
      expect(pluginManager.getRendererScripts().some((u) => fileURLToPath(u) === path.join(dir, "renderer.js"))).toBe(true);
    });

    test("the bundled copy wins a tie or against an older installed copy", async () => {
      const { userData } = makeUserData();
      installCopy(userData, bundledVersion, "imported");
      await pluginManager.initPlugins(userData, {}, ipcMain);
      const copies = pluginManager.getPluginInfo().filter((p) => p.id === "bookmarks-bar");
      expect(copies).toHaveLength(1);
      expect(copies[0].source).toBe("bundled");
    });

    test("installed plugins report their source, and data folders aren't treated as plugins", async () => {
      const { userData } = makeUserData();
      const dir = path.join(userData, "installed-plugins", "extra-plugin");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: "extra-plugin", version: "1.0.0" }));
      fs.writeFileSync(path.join(userData, "installed-plugins", "registry.json"),
        JSON.stringify({ "extra-plugin": { source: "imported", version: "1.0.0" } }));
      fs.mkdirSync(path.join(userData, "plugins", "time-tracker"), { recursive: true }); // a data folder
      await pluginManager.initPlugins(userData, {}, ipcMain);
      const info = pluginManager.getPluginInfo();
      expect(info.find((p) => p.id === "extra-plugin").source).toBe("imported");
      expect(info.find((p) => p.id === "menu-test").source).toBe("user");
      expect(info.filter((p) => p.id === "time-tracker")).toHaveLength(1);
    });

    test("changes staged in Settings are applied before plugins load", async () => {
      const { userData } = makeUserData();
      const staged = path.join(userData, "installed-plugins", ".pending", "staged-plugin");
      fs.mkdirSync(staged, { recursive: true });
      fs.writeFileSync(path.join(staged, "manifest.json"), JSON.stringify({ id: "staged-plugin", version: "2.0.0" }));
      fs.writeFileSync(path.join(userData, "installed-plugins", "pending.json"), JSON.stringify({
        install: { "staged-plugin": { version: "2.0.0", source: "directory" } },
        remove: { "menu-test": {} },
      }));
      await pluginManager.initPlugins(userData, {}, ipcMain);
      const ids = pluginManager.getPluginInfo().map((p) => p.id);
      expect(ids).toContain("staged-plugin");
      // menu-test was imported before 0.8 (its folder is its data folder), so it's gone.
      expect(ids).not.toContain("menu-test");
      expect(fs.existsSync(path.join(userData, "plugins", "menu-test"))).toBe(false);
    });
  });
});
