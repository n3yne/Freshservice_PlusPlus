"use strict";

// Shared between main process (required directly) and tests.
// Contains only core app settings. Plugin-specific defaults and validators
// live in each plugin's main.js (defaultSettings + validateSettings exports).

const DEFAULT_SETTINGS = {
  sidePanelEnabled: true,
  panelCollapsed: false,
  sidePanelTab: "",
  defaultUrl: "https://freshservice.com/login",
  theme: "dark",
  dismissedReleaseVersion: "",
};

function validateSettings(s) {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  if (typeof s.sidePanelEnabled !== "boolean") return false;
  if (typeof s.panelCollapsed !== "boolean") return false;
  if (s.sidePanelTab !== undefined && (typeof s.sidePanelTab !== "string" || s.sidePanelTab.length > 64)) return false;
  if (typeof s.defaultUrl !== "string" || s.defaultUrl.length === 0 || s.defaultUrl.length > 2048) return false;
  try {
    const parsed = new URL(s.defaultUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  } catch { return false; }
  if (!["dark", "light"].includes(s.theme)) return false;
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

module.exports = { DEFAULT_SETTINGS, validateSettings, migrateCoreSettings };
