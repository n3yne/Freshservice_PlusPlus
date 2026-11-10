"use strict";

const { EventEmitter } = require("events");
const { createUpdater, detectUpdateMode, isNewerVersion } = require("../updater");

describe("isNewerVersion", () => {
  test("compares each part numerically", () => {
    expect(isNewerVersion("0.7.0", "0.7.1")).toBe(true);
    expect(isNewerVersion("0.7.0", "0.10.0")).toBe(true);
    expect(isNewerVersion("0.7.0", "v1.0.0")).toBe(true);
    expect(isNewerVersion("0.7.1", "0.7.0")).toBe(false);
    expect(isNewerVersion("0.7.0", "0.7.0")).toBe(false);
  });

  test("treats missing parts as zero and ignores pre-release suffixes", () => {
    expect(isNewerVersion("0.7", "0.7.0")).toBe(false);
    expect(isNewerVersion("0.7.0", "0.7.1-beta")).toBe(true);
  });

  test("a version that doesn't parse is never newer", () => {
    expect(isNewerVersion("0.7.0", "")).toBe(false);
    expect(isNewerVersion("0.7.0", "latest")).toBe(false);
    expect(isNewerVersion("0.7.0", undefined)).toBe(false);
  });
});

describe("detectUpdateMode", () => {
  const base = {
    isPackaged: true,
    platform: "win32",
    env: {},
    resourcesPath: "C:\\App\\resources",
    exists: () => true,
  };

  test("installed Windows build updates itself", () => {
    expect(detectUpdateMode(base)).toEqual({ mode: "auto", reason: "" });
  });

  test("portable, Mac, source and builds without app-update.yml only notify", () => {
    expect(detectUpdateMode({ ...base, env: { PORTABLE_EXECUTABLE_DIR: "D:\\" } }).reason).toBe("portable");
    expect(detectUpdateMode({ ...base, platform: "darwin" }).reason).toBe("mac");
    expect(detectUpdateMode({ ...base, platform: "linux" }).reason).toBe("platform");
    expect(detectUpdateMode({ ...base, isPackaged: false }).reason).toBe("dev");
    expect(detectUpdateMode({ ...base, exists: () => false }).reason).toBe("no-config");
    for (const o of [{ platform: "darwin" }, { isPackaged: false }, { exists: () => false }]) {
      expect(detectUpdateMode({ ...base, ...o }).mode).toBe("notify");
    }
  });
});

function fakeAutoUpdater() {
  const au = new EventEmitter();
  au.autoDownload = true;
  au.checkForUpdates = jest.fn(async () => {
    au.emit("checking-for-update");
    au.emit("update-available", { version: "0.8.0" });
    if (au.autoDownload) au.emit("update-downloaded", { version: "0.8.0" });
  });
  au.downloadUpdate = jest.fn(async () => { au.emit("update-downloaded", { version: "0.8.0" }); });
  au.quitAndInstall = jest.fn();
  return au;
}

function autoUpdaterOpts(au, settings = {}) {
  const sent = [];
  return {
    sent,
    opts: {
      currentVersion: "0.7.0",
      isPackaged: true,
      platform: "win32",
      env: {},
      resourcesPath: "/res",
      exists: () => true,
      getSettings: async () => settings,
      broadcast: (s) => sent.push(s),
      loadAutoUpdater: () => au,
      logger: { error() {} },
    },
  };
}

describe("createUpdater (installed build)", () => {
  test("downloads in the background and reports it ready", async () => {
    const au = fakeAutoUpdater();
    const { opts, sent } = autoUpdaterOpts(au);
    const updater = createUpdater(opts);
    const status = await updater.check();
    expect(au.autoInstallOnAppQuit).toBe(true);
    expect(status).toMatchObject({ mode: "auto", state: "downloaded", version: "0.8.0" });
    expect(status.releaseUrl).toBe("https://github.com/n3yne/MSP_PlusPlus/releases/tag/v0.8.0");
    expect(sent.map((s) => s.state)).toEqual(["checking", "downloading", "downloaded"]);
  });

  test("with automatic downloads off, waits for the user to download", async () => {
    const au = fakeAutoUpdater();
    const { opts } = autoUpdaterOpts(au, { autoUpdate: false });
    const updater = createUpdater(opts);
    expect(await updater.check()).toMatchObject({ state: "available", autoDownload: false });
    expect(au.downloadUpdate).not.toHaveBeenCalled();
    expect(await updater.download()).toMatchObject({ state: "downloaded" });
  });

  test("install only runs once an update is downloaded", async () => {
    jest.useFakeTimers();
    try {
      const au = fakeAutoUpdater();
      const { opts } = autoUpdaterOpts(au);
      const updater = createUpdater(opts);
      expect(updater.install()).toHaveProperty("error");
      await updater.check();
      expect(updater.install()).toEqual({ ok: true });
      jest.runAllTimers();
      expect(au.quitAndInstall).toHaveBeenCalledWith(true, true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("an error after the download doesn't hide the ready update", async () => {
    const au = fakeAutoUpdater();
    const { opts } = autoUpdaterOpts(au);
    const updater = createUpdater(opts);
    await updater.check();
    au.emit("error", new Error("offline"));
    expect(updater.getStatus().state).toBe("downloaded");
  });

  test("a failed check is reported as an error", async () => {
    const au = fakeAutoUpdater();
    au.checkForUpdates = jest.fn(async () => { throw new Error("404"); });
    const { opts } = autoUpdaterOpts(au);
    const updater = createUpdater(opts);
    expect(await updater.check()).toMatchObject({ state: "error", error: "404" });
  });
});

describe("createUpdater (portable / Mac / source)", () => {
  function notifyOpts(fetchImpl) {
    const sent = [];
    return {
      sent,
      opts: {
        currentVersion: "0.7.0",
        isPackaged: true,
        platform: "win32",
        env: { PORTABLE_EXECUTABLE_DIR: "D:\\" },
        resourcesPath: "/res",
        exists: () => true,
        getSettings: async () => ({}),
        broadcast: (s) => sent.push(s),
        loadAutoUpdater: () => { throw new Error("must not load electron-updater"); },
        fetchImpl,
      },
    };
  }

  test("reports a newer release with its page", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v0.8.0", html_url: "https://github.com/n3yne/MSP_PlusPlus/releases/tag/v0.8.0" }),
    }));
    const { opts } = notifyOpts(fetchImpl);
    const status = await createUpdater(opts).check();
    expect(status).toMatchObject({ mode: "notify", reason: "portable", state: "available", version: "0.8.0" });
    expect(status.releaseUrl).toBe("https://github.com/n3yne/MSP_PlusPlus/releases/tag/v0.8.0");
  });

  test("ignores a release link that isn't on github.com", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ tag_name: "v0.8.0", html_url: "https://evil.example/" }) });
    const status = await createUpdater(notifyOpts(fetchImpl).opts).check();
    expect(status.releaseUrl).toBe("https://github.com/n3yne/MSP_PlusPlus/releases/tag/v0.8.0");
  });

  test("same version is up to date; API errors are reported", async () => {
    const same = async () => ({ ok: true, json: async () => ({ tag_name: "v0.7.0" }) });
    expect((await createUpdater(notifyOpts(same).opts).check()).state).toBe("none");
    const broken = async () => ({ ok: false, status: 403 });
    expect(await createUpdater(notifyOpts(broken).opts).check()).toMatchObject({ state: "error", error: "GitHub API error 403" });
  });

  test("download and install refuse", async () => {
    const updater = createUpdater(notifyOpts(async () => ({ ok: false, status: 500 })).opts);
    expect(await updater.download()).toHaveProperty("error");
    expect(updater.install()).toHaveProperty("error");
  });
});
