"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PluginPackage = require("../plugin-package");
const PluginDirectory = require("../plugin-directory");

const INDEX_URL = "https://example.test/releases/download/plugin-directory/index.json";
const BASE = "https://example.test/releases/download/plugin-directory/";
const quiet = { warn: () => {}, error: () => {}, log: () => {} };

function makePackage(manifest, extra = {}) {
  const files = [{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) }];
  for (const [name, text] of Object.entries(extra)) files.push({ name, data: Buffer.from(text) });
  return PluginPackage.writeZip(files);
}

function entryFor(manifest, pkg, more = {}) {
  return Object.assign({
    id: manifest.id,
    name: manifest.name || manifest.id,
    version: manifest.version,
    category: "Tickets",
    description: "A test plugin",
    url: `${manifest.id}-${manifest.version}.mspplugin`,
    sha256: crypto.createHash("sha256").update(pkg).digest("hex"),
    size: pkg.length,
  }, more);
}

// A fetch stand-in serving index.json and packages from a map of URL -> Buffer.
function fakeFetch(files, calls = []) {
  return async (url, opts) => {
    calls.push({ url, opts });
    const body = files[url];
    if (!body) return { ok: false, status: 404, headers: { get: () => null } };
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === "content-length" ? String(body.length) : h.toLowerCase() === "etag" ? '"v1"' : null) },
      text: async () => body.toString("utf8"),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
    };
  };
}

function setup({ installed = [], entries, packages }) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mspp-dir-"));
  const files = { [INDEX_URL]: Buffer.from(JSON.stringify({ plugins: entries })) };
  for (const [name, buf] of Object.entries(packages)) files[BASE + name] = buf;
  const calls = [];
  const dir = PluginDirectory.createPluginDirectory({
    userData,
    appVersion: "0.8.0",
    indexUrl: INDEX_URL,
    fetchImpl: fakeFetch(files, calls),
    getInstalled: () => installed,
    logger: quiet,
  });
  return { userData, dir, files, calls };
}

describe("compareVersions", () => {
  test("orders by major, minor, patch", () => {
    expect(PluginDirectory.compareVersions("0.8.0", "0.7.9")).toBe(1);
    expect(PluginDirectory.compareVersions("0.8.0", "0.8.0")).toBe(0);
    expect(PluginDirectory.compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(PluginDirectory.compareVersions("", "0.0.1")).toBe(-1);
  });
});

describe("parseIndex", () => {
  const good = { id: "ok", name: "OK", version: "1.0.0", url: "ok-1.0.0.mspplugin", sha256: "a".repeat(64), size: 10 };

  test("keeps valid entries and resolves package URLs inside the directory", () => {
    const { plugins } = PluginDirectory.parseIndex({ plugins: [good] }, INDEX_URL, quiet);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].url).toBe(BASE + "ok-1.0.0.mspplugin");
    expect(plugins[0].requires).toEqual([]);
  });

  test("drops entries with bad ids, hashes, sizes or URLs outside the directory", () => {
    const { plugins } = PluginDirectory.parseIndex({
      plugins: [
        Object.assign({}, good, { id: "Bad Id" }),
        Object.assign({}, good, { id: "nohash", sha256: "xyz" }),
        Object.assign({}, good, { id: "huge", size: PluginPackage.MAX_PACKAGE_BYTES + 1 }),
        Object.assign({}, good, { id: "elsewhere", url: "https://evil.test/x.mspplugin" }),
        Object.assign({}, good, { id: "upone", url: "../other/x.mspplugin" }),
        Object.assign({}, good, { id: "badver", version: "one" }),
        good,
        Object.assign({}, good, { name: "Duplicate" }),
      ],
    }, INDEX_URL, quiet);
    expect(plugins.map((p) => p.id)).toEqual(["ok"]);
  });

  test("throws on an index that isn't the expected shape", () => {
    expect(() => PluginDirectory.parseIndex({ nope: true }, INDEX_URL, quiet)).toThrow(/expected format/);
  });

  test("filters requires to valid ids other than itself", () => {
    const { plugins } = PluginDirectory.parseIndex({
      plugins: [Object.assign({}, good, { requires: ["ai-features", "ok", "Bad", 3] })],
    }, INDEX_URL, quiet);
    expect(plugins[0].requires).toEqual(["ai-features"]);
  });
});

describe("createPluginDirectory", () => {
  const timeMan = { id: "time-tracker", name: "Time Tracker", version: "0.8.1", main: "main.js" };
  const timePkg = makePackage(timeMan, { "main.js": "module.exports = () => {};" });
  const aiMan = { id: "ai-features", name: "AI Features", version: "0.8.0" };
  const aiPkg = makePackage(aiMan);
  const chatMan = { id: "solutions-chat", name: "Solutions Chat", version: "0.8.0" };
  const chatPkg = makePackage(chatMan);

  test("lists the directory with install state and updates", async () => {
    const { dir } = setup({
      installed: [{ id: "time-tracker", version: "0.7.7", source: "bundled" }, { id: "ai-features", version: "0.8.0", source: "directory" }],
      entries: [entryFor(timeMan, timePkg), entryFor(aiMan, aiPkg), entryFor(chatMan, chatPkg, { minAppVersion: "9.0.0" })],
      packages: {},
    });
    const state = await dir.refresh();
    expect(state.error).toBe("");
    const byId = Object.fromEntries(state.plugins.map((p) => [p.id, p]));
    expect(byId["time-tracker"].status).toBe("update");
    expect(byId["time-tracker"].installedSource).toBe("bundled");
    expect(byId["ai-features"].status).toBe("installed");
    expect(byId["solutions-chat"].status).toBe("incompatible");
    expect(state.updates).toEqual([{ id: "time-tracker", name: "Time Tracker", version: "0.8.1", installedVersion: "0.7.7" }]);
  });

  test("keeps the error when the directory can't be reached", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mspp-dir-"));
    const dir = PluginDirectory.createPluginDirectory({
      userData, appVersion: "0.8.0", indexUrl: INDEX_URL, logger: quiet,
      fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); },
    });
    const state = await dir.refresh();
    expect(state.error).toMatch(/ENOTFOUND/);
    expect(state.plugins).toEqual([]);
  });

  test("install downloads, checks and stages a plugin with what it requires", async () => {
    const { dir, userData } = setup({
      entries: [entryFor(aiMan, aiPkg), entryFor(chatMan, chatPkg, { requires: ["ai-features"] })],
      packages: { "ai-features-0.8.0.mspplugin": aiPkg, "solutions-chat-0.8.0.mspplugin": chatPkg },
    });
    await dir.refresh();
    const result = await dir.install(["solutions-chat"]);
    expect(result.success).toBe(true);
    expect(result.staged.map((s) => s.id)).toEqual(["ai-features", "solutions-chat"]);
    const pendingDir = path.join(userData, "installed-plugins", ".pending");
    expect(fs.existsSync(path.join(pendingDir, "solutions-chat", "manifest.json"))).toBe(true);
    expect(dir.getState().plugins.find((p) => p.id === "solutions-chat").pendingAction).toBe("install");

    // Nothing is live until applyPending runs at the next start.
    expect(fs.existsSync(path.join(userData, "installed-plugins", "solutions-chat"))).toBe(false);
    const applied = PluginDirectory.applyPending(userData, quiet);
    expect(applied.applied.map((a) => a.id).sort()).toEqual(["ai-features", "solutions-chat"]);
    expect(fs.existsSync(path.join(userData, "installed-plugins", "solutions-chat", "manifest.json"))).toBe(true);
    expect(PluginDirectory.readRegistry(userData)["solutions-chat"]).toMatchObject({ source: "directory", version: "0.8.0" });
    expect(fs.existsSync(pendingDir)).toBe(false);
  });

  test("refuses a download that doesn't match the checksum", async () => {
    const tampered = makePackage(Object.assign({}, timeMan), { "main.js": "require('child_process')" });
    const { dir, userData } = setup({
      entries: [entryFor(timeMan, timePkg)],
      packages: { "time-tracker-0.8.1.mspplugin": tampered },
    });
    await dir.refresh();
    const result = await dir.install(["time-tracker"]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/checksum/);
    expect(fs.existsSync(path.join(userData, "installed-plugins", ".pending", "time-tracker"))).toBe(false);
  });

  test("refuses a package whose manifest is for another plugin or version", async () => {
    const other = makePackage({ id: "something-else", version: "0.8.1" });
    const { dir } = setup({
      entries: [entryFor(timeMan, other)],
      packages: { "time-tracker-0.8.1.mspplugin": other },
    });
    await dir.refresh();
    expect((await dir.install(["time-tracker"])).error).toMatch(/different plugin/);
  });

  test("updateAll stages only compatible updates", async () => {
    const { dir } = setup({
      installed: [{ id: "time-tracker", version: "0.7.7", source: "directory" }],
      entries: [entryFor(timeMan, timePkg)],
      packages: { "time-tracker-0.8.1.mspplugin": timePkg },
    });
    await dir.refresh();
    const result = await dir.updateAll();
    expect(result.staged.map((s) => s.id)).toEqual(["time-tracker"]);
    expect(dir.getState().updates).toEqual([]);
  });

  test("remove stages a removal, keeps data unless asked, and refuses bundled plugins", async () => {
    const { dir, userData } = setup({
      installed: [
        { id: "time-tracker", version: "0.8.1", source: "directory" },
        { id: "freshservice", version: "0.8.0", source: "bundled" },
      ],
      entries: [],
      packages: {},
    });
    const live = path.join(userData, "installed-plugins", "time-tracker");
    const data = path.join(userData, "plugins", "time-tracker");
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, "manifest.json"), JSON.stringify(timeMan));
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, "timers.json"), "{}");

    expect(dir.remove("freshservice").success).toBe(false);
    expect(dir.remove("time-tracker").success).toBe(true);
    PluginDirectory.applyPending(userData, quiet);
    expect(fs.existsSync(live)).toBe(false);
    expect(fs.existsSync(path.join(data, "timers.json"))).toBe(true);
  });

  test("remove with deleteData also clears the plugin's data folder", async () => {
    const { dir, userData } = setup({
      installed: [{ id: "time-tracker", version: "0.8.1", source: "directory" }],
      entries: [], packages: {},
    });
    const data = path.join(userData, "plugins", "time-tracker");
    fs.mkdirSync(data, { recursive: true });
    dir.remove("time-tracker", { deleteData: true });
    PluginDirectory.applyPending(userData, quiet);
    expect(fs.existsSync(data)).toBe(false);
  });

  test("removing a staged install that isn't live yet just cancels it", async () => {
    const { dir, userData } = setup({
      entries: [entryFor(timeMan, timePkg)],
      packages: { "time-tracker-0.8.1.mspplugin": timePkg },
    });
    await dir.refresh();
    await dir.install(["time-tracker"]);
    expect(dir.remove("time-tracker")).toMatchObject({ success: true, cancelled: true });
    expect(PluginDirectory.readPending(userData)).toEqual({ install: {}, remove: {} });
  });

  test("importPackage stages a .mspplugin file or a folder as imported", async () => {
    const { dir, userData } = setup({ entries: [], packages: {} });
    expect(dir.importPackage({ buffer: timePkg })).toMatchObject({ id: "time-tracker", version: "0.8.1" });
    PluginDirectory.applyPending(userData, quiet);
    expect(PluginDirectory.readRegistry(userData)["time-tracker"].source).toBe("imported");

    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mspp-folder-"));
    fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ id: "folder-plugin", version: "1.0.0" }));
    expect(dir.importPackage({ folder }).id).toBe("folder-plugin");

    const tooNew = makePackage({ id: "future", version: "1.0.0", minAppVersion: "99.0.0" });
    expect(() => dir.importPackage({ buffer: tooNew })).toThrow(/needs MSP\+\+ 99\.0\.0/);
  });

  test("sends If-None-Match on later checks and keeps the index on 304", async () => {
    const original = Buffer.from(JSON.stringify({ plugins: [entryFor(timeMan, timePkg)] }));
    // The first request gets the index, the second a 304.
    const dir2 = PluginDirectory.createPluginDirectory({
      userData: fs.mkdtempSync(path.join(os.tmpdir(), "mspp-dir-")),
      appVersion: "0.8.0", indexUrl: INDEX_URL, logger: quiet,
      fetchImpl: (() => {
        let n = 0;
        return async (url, opts) => {
          n++;
          if (n === 1) return fakeFetch({ [INDEX_URL]: original })(url, opts);
          expect(opts.headers["If-None-Match"]).toBe('"v1"');
          return { ok: false, status: 304, headers: { get: () => null } };
        };
      })(),
    });
    await dir2.refresh();
    const state = await dir2.refresh();
    expect(state.error).toBe("");
    expect(state.plugins).toHaveLength(1);
  });
});
