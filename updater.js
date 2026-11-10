"use strict";

// App updates.
//
// The installed Windows build (NSIS installer) updates itself with electron-updater:
// it checks the GitHub release's latest.yml, downloads the new installer in the
// background and installs it when the app closes, or straight away when the user
// clicks "Restart to update". Builds that can't replace themselves (the portable
// .exe, the unsigned Mac app, and running from source) fall back to the GitHub
// releases API and only tell the user a new version is out, with a link to it.
//
// Both modes report the same status object to the windows ("app-update-status"):
//   { mode: "auto"|"notify", reason, state, currentVersion, version, releaseUrl,
//     autoDownload, percent, error }
//   state: "idle" | "checking" | "none" | "available" | "downloading" | "downloaded" | "error"
//   reason (notify mode only): "dev" | "portable" | "mac" | "platform" | "no-config"

const path = require("path");

const REPO = "n3yne/MSP_PlusPlus";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

const FIRST_CHECK_DELAY_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Compares dotted versions ("0.7.0", "v0.7.1"). A pre-release suffix is ignored.
// Anything that doesn't parse is never newer, so a malformed tag can't nag.
function isNewerVersion(current, latest) {
  const parse = (v) => String(v || "").replace(/^v/i, "").split("-")[0].split(".").map(Number);
  const a = parse(current);
  const b = parse(latest);
  if (b.length < 1 || b.some((n) => !Number.isFinite(n))) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number.isFinite(a[i]) ? a[i] : 0;
    const y = Number.isFinite(b[i]) ? b[i] : 0;
    if (x !== y) return y > x;
  }
  return false;
}

// Decides whether this copy of the app can update itself.
//   isPackaged     electron.app.isPackaged
//   env            process.env (the portable launcher sets PORTABLE_EXECUTABLE_DIR)
//   resourcesPath  process.resourcesPath (electron-builder writes app-update.yml there)
function detectUpdateMode({ isPackaged, platform, env, resourcesPath, exists }) {
  if (!isPackaged) return { mode: "notify", reason: "dev" };
  if (platform === "darwin") return { mode: "notify", reason: "mac" };
  if (platform !== "win32") return { mode: "notify", reason: "platform" };
  if (env && env.PORTABLE_EXECUTABLE_DIR) return { mode: "notify", reason: "portable" };
  if (!resourcesPath || !exists(path.join(resourcesPath, "app-update.yml"))) {
    return { mode: "notify", reason: "no-config" };
  }
  return { mode: "auto", reason: "" };
}

function releaseUrlFor(version) {
  return version ? `${RELEASES_PAGE}/tag/v${version}` : RELEASES_PAGE;
}

function createUpdater(opts) {
  const {
    currentVersion,
    getSettings,              // async () => settings (reads autoUpdate)
    broadcast,                // (status) => void, sends to the app's windows
    loadAutoUpdater = () => require("electron-updater").autoUpdater,
    fetchImpl = (...args) => fetch(...args),
    logger = console,
  } = opts;
  const { mode, reason } = detectUpdateMode(opts);

  let status = {
    mode, reason, state: "idle", currentVersion,
    version: "", releaseUrl: RELEASES_PAGE, autoDownload: mode === "auto", percent: 0, error: "",
  };
  let autoUpdater = null;
  let inFlight = null;
  let timers = [];

  function setStatus(patch) {
    status = Object.assign({}, status, patch);
    try { broadcast(Object.assign({}, status)); } catch (err) { logger.error("[Updater] broadcast failed:", err); }
  }

  async function wantsAutoDownload() {
    try {
      const s = await getSettings();
      return !s || s.autoUpdate !== false;
    } catch {
      return true;
    }
  }

  function getAutoUpdater() {
    if (autoUpdater) return autoUpdater;
    autoUpdater = loadAutoUpdater();
    autoUpdater.logger = null;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => setStatus({ state: "checking", error: "" }));
    autoUpdater.on("update-not-available", () => setStatus({ state: "none", error: "" }));
    autoUpdater.on("update-available", (info) => {
      const version = (info && info.version) || "";
      setStatus({
        state: autoUpdater.autoDownload ? "downloading" : "available",
        version, releaseUrl: releaseUrlFor(version), percent: 0, error: "",
      });
    });
    autoUpdater.on("download-progress", (p) => {
      const percent = Math.floor((p && p.percent) || 0);
      // Only pass on whole steps of 5% so the windows aren't flooded.
      if (percent - status.percent >= 5 || percent === 100) setStatus({ state: "downloading", percent });
    });
    autoUpdater.on("update-downloaded", (info) => {
      const version = (info && info.version) || status.version;
      setStatus({ state: "downloaded", version, releaseUrl: releaseUrlFor(version), percent: 100, error: "" });
    });
    autoUpdater.on("error", (err) => {
      logger.error("[Updater] Update error:", err);
      // A failed re-check after a finished download doesn't undo the download.
      if (status.state === "downloaded") return;
      setStatus({ state: "error", error: (err && err.message) || String(err) });
    });
    return autoUpdater;
  }

  async function checkAuto() {
    const au = getAutoUpdater();
    au.autoDownload = await wantsAutoDownload();
    status.autoDownload = au.autoDownload;
    await au.checkForUpdates();
  }

  async function checkNotify() {
    setStatus({ state: "checking", error: "" });
    const resp = await fetchImpl(RELEASES_API, { headers: { "User-Agent": "MSP-PP/" + currentVersion } });
    if (!resp.ok) throw new Error(`GitHub API error ${resp.status}`);
    const json = await resp.json();
    const tag = typeof json.tag_name === "string" ? json.tag_name : "";
    const version = tag.replace(/^v/i, "");
    const releaseUrl = typeof json.html_url === "string" && json.html_url.startsWith("https://github.com/")
      ? json.html_url : releaseUrlFor(version);
    setStatus({
      state: isNewerVersion(currentVersion, version) ? "available" : "none",
      version, releaseUrl, autoDownload: false,
    });
  }

  // Runs one check. Overlapping calls share it. Once an update is downloaded
  // there is nothing more to check until the app restarts.
  function check() {
    if (status.state === "downloaded" || status.state === "downloading") return Promise.resolve(getStatus());
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        if (mode === "auto") await checkAuto();
        else await checkNotify();
      } catch (err) {
        if (status.state !== "downloaded") {
          setStatus({ state: "error", error: (err && err.message) || String(err) });
        }
      } finally {
        inFlight = null;
      }
      return getStatus();
    })();
    return inFlight;
  }

  // Starts downloading an update the user chose to get (auto mode with
  // automatic downloads turned off).
  async function download() {
    if (mode !== "auto") return { error: "This copy of MSP++ can't update itself." };
    if (status.state !== "available") return getStatus();
    setStatus({ state: "downloading", percent: 0 });
    try {
      await getAutoUpdater().downloadUpdate();
    } catch (err) {
      setStatus({ state: "error", error: (err && err.message) || String(err) });
    }
    return getStatus();
  }

  // Closes the app and runs the downloaded installer silently, then restarts.
  function install() {
    if (mode !== "auto" || status.state !== "downloaded") return { error: "No update is ready to install." };
    // Let the reply reach the window before the app starts quitting.
    setImmediate(() => {
      try {
        getAutoUpdater().quitAndInstall(true, true);
      } catch (err) {
        logger.error("[Updater] quitAndInstall failed:", err);
      }
    });
    return { ok: true };
  }

  function getStatus() {
    return Object.assign({}, status);
  }

  function start() {
    stop();
    timers.push(setTimeout(check, FIRST_CHECK_DELAY_MS));
    timers.push(setInterval(check, CHECK_INTERVAL_MS));
  }

  function stop() {
    for (const t of timers) { clearTimeout(t); clearInterval(t); }
    timers = [];
  }

  return { start, stop, check, download, install, getStatus };
}

module.exports = {
  createUpdater,
  detectUpdateMode,
  isNewerVersion,
  RELEASES_PAGE,
  FIRST_CHECK_DELAY_MS,
  CHECK_INTERVAL_MS,
};
