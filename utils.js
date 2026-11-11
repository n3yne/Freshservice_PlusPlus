"use strict";

// Shared between main process (required directly) and tests.
// Contains only core app settings. Plugin-specific defaults and validators
// live in each plugin's main.js (defaultSettings + validateSettings exports).

const DEFAULT_SETTINGS = {
  sidePanelEnabled: true,
  panelCollapsed: false,
  sidePanelTab: "",
  // The first site plugin's start page replaces this (manifest "site.defaultUrl");
  // with no site plugin loaded, new tabs open blank.
  defaultUrl: "about:blank",
  theme: "dark",
  dismissedReleaseVersion: "",
  // Installed Windows build: download new versions in the background and install
  // them when the app closes. Off: ask before downloading. See updater.js.
  autoUpdate: true,
  // Reopen the tabs that were open when the app last closed. Off: start on the
  // Home URL. Pinned tabs come back either way.
  restoreTabs: true,
};

function validateSettings(s) {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  if (typeof s.sidePanelEnabled !== "boolean") return false;
  if (typeof s.panelCollapsed !== "boolean") return false;
  if (s.sidePanelTab !== undefined && (typeof s.sidePanelTab !== "string" || s.sidePanelTab.length > 64)) return false;
  if (typeof s.defaultUrl !== "string" || s.defaultUrl.length === 0 || s.defaultUrl.length > 2048) return false;
  if (s.defaultUrl !== "about:blank") {
    try {
      const parsed = new URL(s.defaultUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    } catch { return false; }
  }
  if (!["dark", "light"].includes(s.theme)) return false;
  if (s.autoUpdate !== undefined && typeof s.autoUpdate !== "boolean") return false;
  if (s.restoreTabs !== undefined && typeof s.restoreTabs !== "boolean") return false;
  if (s.dismissedReleaseVersion !== undefined && (typeof s.dismissedReleaseVersion !== "string" || s.dismissedReleaseVersion.length > 20)) return false;
  return true;
}

// Upgrades settings saved by older versions, in place. Run once at startup on
// the raw settings file. Returns the same object.
function migrateCoreSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  // 0.5.6: "Note Backup Side Panel" became the shared "Side Panel".
  if (Object.prototype.hasOwnProperty.call(raw, "notePanelEnabled")) {
    if (typeof raw.sidePanelEnabled !== "boolean" && typeof raw.notePanelEnabled === "boolean") {
      raw.sidePanelEnabled = raw.notePanelEnabled;
    }
    delete raw.notePanelEnabled;
  }
  return raw;
}

// Which saved tabs to open at startup, from open-tabs.json's entries (old
// builds saved bare URL strings) and the restoreTabs setting. Returns
// { tabs: [{ url, pinned }], openHome } where openHome means also open a Home
// URL tab and show it, because the last session's other tabs were left closed.
function tabsToRestore(saved, restoreTabs) {
  const list = (Array.isArray(saved) ? saved : [])
    .map((item) => (typeof item === "string" ? { url: item, pinned: false } : item))
    .filter((item) => item && typeof item.url === "string" && item.url)
    .map((item) => ({ url: item.url, pinned: item.pinned === true }));
  if (restoreTabs !== false) return { tabs: list, openHome: list.length === 0 };
  return { tabs: list.filter((t) => t.pinned), openHome: true };
}

// The app was called Freshservice++ before it became MSP++. Electron names the
// data folder after the app, so after the rename it would look in a new, empty
// folder and existing users would lose their settings, notes, open tabs and
// site sign-ins. Returns the old folder to keep using when the new one has no
// data yet and an old one does, otherwise null. Data stays where it is, so an
// older build pointed at the same folder still works.
const LEGACY_DATA_DIR_NAMES = ["Freshservice++", "freshservice-pp"];

function findLegacyUserDataDir(appDataDir, currentDir, exists, join) {
  const hasData = (dir) => exists(join(dir, "note-backups"));
  if (hasData(currentDir)) return null;
  for (const name of LEGACY_DATA_DIR_NAMES) {
    const legacy = join(appDataDir, name);
    if (legacy !== currentDir && hasData(legacy)) return legacy;
  }
  return null;
}

module.exports = { DEFAULT_SETTINGS, validateSettings, migrateCoreSettings, findLegacyUserDataDir, tabsToRestore };
