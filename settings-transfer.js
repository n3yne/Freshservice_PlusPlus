"use strict";

// Settings export and import: moves app and plugin settings (bookmarks, canned
// responses, home page, theme and so on) to another PC as one JSON file.
//
// API keys are never written to the file. They are stored encrypted with the
// OS (Windows DPAPI or the macOS keychain), which ties them to this user on
// this computer, so an exported copy couldn't be decrypted anywhere else, and
// writing them out in plain text would put them in a file people email and
// leave in Downloads. On import, the keys already saved on the receiving PC
// are kept as they are.

const EXPORT_KIND = "msp-pp-settings";
const FORMAT_VERSION = 1;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// Keys that describe this install rather than the person's preferences.
const MACHINE_KEYS = new Set(["dismissedReleaseVersion"]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// True for a stored credential and everything tied to it. Plugins declare
// credentials by name ("fsApiKey"); the encrypted copy, the "is set" flag and
// the details a key is bound to ("fsApiKeyHost", "aiApiKeyEndpoint") all share
// that name as a prefix. Any "...Encrypted" key is treated as a secret too, in
// case it belongs to a plugin that isn't installed here.
function isSecretKey(key, credentialFields) {
  if (/Encrypted$/.test(key)) return true;
  return (credentialFields || []).some((c) => key.startsWith(c.plain));
}

function isExportableKey(key, credentialFields) {
  return !UNSAFE_KEYS.has(key) && !MACHINE_KEYS.has(key) && !isSecretKey(key, credentialFields);
}

// rawSettings: settings.json as saved. plugins: [{ id, enabled }].
function buildSettingsExport(rawSettings, plugins, credentialFields, appVersion, now) {
  const settings = {};
  for (const [key, value] of Object.entries(isPlainObject(rawSettings) ? rawSettings : {})) {
    if (isExportableKey(key, credentialFields)) settings[key] = value;
  }
  const pluginStates = {};
  for (const p of plugins || []) {
    if (p && typeof p.id === "string" && typeof p.enabled === "boolean") pluginStates[p.id] = p.enabled;
  }
  return {
    kind: EXPORT_KIND,
    formatVersion: FORMAT_VERSION,
    appVersion: String(appVersion || ""),
    exportedAt: (now || new Date()).toISOString(),
    settings,
    plugins: pluginStates,
  };
}

// Reads an export file's text. Returns { ok: true, data } with secrets and
// unsafe keys already removed, or { ok: false, error } with a message to show.
function parseSettingsExport(text, credentialFields) {
  if (typeof text !== "string") return { ok: false, error: "The file couldn't be read." };
  if (Buffer.byteLength(text, "utf-8") > MAX_IMPORT_BYTES) {
    return { ok: false, error: "The file is too large to be an MSP++ settings export." };
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: "The file isn't an MSP++ settings export (it isn't valid JSON)." };
  }
  if (!isPlainObject(parsed) || parsed.kind !== EXPORT_KIND || !isPlainObject(parsed.settings)) {
    return { ok: false, error: "The file isn't an MSP++ settings export." };
  }
  if (typeof parsed.formatVersion !== "number" || parsed.formatVersion > FORMAT_VERSION) {
    return { ok: false, error: "This export was made by a newer version of MSP++. Update MSP++ on this PC and try again." };
  }
  const settings = {};
  for (const [key, value] of Object.entries(parsed.settings)) {
    if (isExportableKey(key, credentialFields)) settings[key] = value;
  }
  const plugins = {};
  if (isPlainObject(parsed.plugins)) {
    for (const [id, enabled] of Object.entries(parsed.plugins)) {
      if (!UNSAFE_KEYS.has(id) && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) && typeof enabled === "boolean") {
        plugins[id] = enabled;
      }
    }
  }
  return {
    ok: true,
    data: {
      appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion.slice(0, 20) : "",
      exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt.slice(0, 40) : "",
      settings,
      plugins,
    },
  };
}

// The settings to save after an import: the file's settings replace this PC's,
// except for the credentials (and what they're tied to) and install-specific
// keys, which stay as they are here. Settings the file doesn't have fall back
// to their defaults.
function mergeImportedSettings(existingRaw, importedSettings, credentialFields) {
  const result = {};
  for (const [key, value] of Object.entries(isPlainObject(existingRaw) ? existingRaw : {})) {
    if (!UNSAFE_KEYS.has(key) && (isSecretKey(key, credentialFields) || MACHINE_KEYS.has(key))) result[key] = value;
  }
  for (const [key, value] of Object.entries(importedSettings || {})) {
    if (isExportableKey(key, credentialFields)) result[key] = value;
  }
  return result;
}

// Plugins whose on/off state the import changes: [{ id, enabled }].
function pluginChanges(currentPlugins, importedPlugins) {
  const changes = [];
  for (const [id, enabled] of Object.entries(importedPlugins || {})) {
    const current = (currentPlugins || []).find((p) => p.id === id);
    // A plugin that isn't installed here counts as on (the default), so an
    // "off" for it is still saved and applies if it's installed later.
    const currentlyEnabled = current ? current.enabled !== false : true;
    if (currentlyEnabled !== enabled) changes.push({ id, enabled, installed: Boolean(current) });
  }
  return changes;
}

function defaultExportFileName(now) {
  const d = now || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `MSP++ settings ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

module.exports = {
  EXPORT_KIND,
  FORMAT_VERSION,
  isSecretKey,
  buildSettingsExport,
  parseSettingsExport,
  mergeImportedSettings,
  pluginChanges,
  defaultExportFileName,
};
