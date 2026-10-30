"use strict";

const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { EventEmitter } = require("events");
const { pathToFileURL } = require("url");

const { version: APP_VERSION } = require("./package.json");

const pluginBus = new EventEmitter();
pluginBus.setMaxListeners(100);

// All IPC channels registered by plugins — checked at handle() time to prevent duplicates.
const registeredChannels = new Set();

// Absolute renderer script paths collected during initPlugins.
const rendererScripts = [];

// Absolute settings-window script paths collected during initPlugins.
const settingsScripts = [];

// Absolute stylesheet paths collected during initPlugins (loaded in both windows).
const pluginStylesheets = [];

// Merged default settings from all loaded plugins — filled during initPlugins.
const _pluginDefaultSettings = {};
// Settings validators from plugins — each { pluginId, fn }.
const _pluginValidators = [];
// Settings transformers from plugins — each { pluginId, fn } — called before writing to disk.
const _settingsTransformers = [];
// Settings migrators from plugins — each { pluginId, fn } — mutate raw parsed object in-place.
const _migrators = [];

// All plugins discovered during initPlugins (including disabled and failed).
const _discoveredPlugins = [];
// Credential settings declared in plugin manifests ("credentials": ["myApiKey"]).
// Collected from disabled plugins too, so their stored keys stay protected.
const _credentialFields = [];
const CREDENTIAL_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,40}$/;

// Plugin enable/disable config: { "plugin-id": false } — only entries for disabled plugins.
// Missing key = enabled by default.
let _pluginsConfig = {};
let _pluginsConfigFile = null;

// Absolute path to the userData directory (set during initPlugins).
let _userData = null;

// Live copy of settings — updated on each save-settings call.
let _currentSettings = {};

// Menu contributions from plugins: { label, accelerator?, click }
const _menuContributions = [];
const MAX_MENU_ITEMS = 10;

// Callback to rebuild the app menu with plugin contributions.
let _rebuildMenu = null;

// ===================== Semver helpers =====================

function parseSemver(str) {
  const m = String(str || "0.0.0").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

function semverLt(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return true;
    if (pa[i] > pb[i]) return false;
  }
  return false;
}

// ===================== Config persistence =====================

async function loadPluginsConfig() {
  if (!_pluginsConfigFile) return;
  try {
    const raw = await fsp.readFile(_pluginsConfigFile, "utf-8");
    _pluginsConfig = JSON.parse(raw) || {};
  } catch {
    _pluginsConfig = {};
  }
}

async function savePluginsConfig() {
  if (!_pluginsConfigFile) return;
  try {
    await fsp.writeFile(_pluginsConfigFile, JSON.stringify(_pluginsConfig, null, 2), "utf-8");
  } catch (err) {
    console.error("[PluginManager] Failed to save plugins config:", err);
  }
}

// ===================== Plugin API factory =====================

function buildPluginApi(pluginId, ipcMain) {
  const dataDir = path.join(_userData, "plugins", pluginId);

  return Object.freeze({
    handle(action, asyncFn) {
      if (!/^[a-z0-9_-]+$/i.test(action)) {
        console.warn(`[Plugin:${pluginId}] Skipped handle("${action}"): invalid action name`);
        return;
      }
      const channel = `plugin:${pluginId}:${action}`;
      if (registeredChannels.has(channel)) {
        console.warn(`[Plugin:${pluginId}] Duplicate handler for "${action}" — skipped`);
        return;
      }
      registeredChannels.add(channel);
      ipcMain.handle(channel, async (_event, data) => {
        try {
          return await asyncFn(data);
        } catch (err) {
          console.error(`[Plugin:${pluginId}] Error in handler "${action}":`, err);
          throw err;
        }
      });
    },

    on(eventName, fn) {
      pluginBus.on(eventName, function (data) {
        try { fn(data); } catch (err) {
          console.error(`[Plugin:${pluginId}] Error in event "${eventName}":`, err);
        }
      });
    },

    getDataPath() {
      fs.mkdirSync(dataDir, { recursive: true });
      return dataDir;
    },

    getSettings() {
      return Object.freeze(Object.assign({}, _currentSettings));
    },

    addMenuItem(opts) {
      if (!opts || typeof opts.label !== "string") return;
      if (_menuContributions.length >= MAX_MENU_ITEMS) {
        console.warn(`[Plugin:${pluginId}] Menu item limit (${MAX_MENU_ITEMS}) reached`);
        return;
      }
      _menuContributions.push({
        label: opts.label,
        accelerator: opts.accelerator || undefined,
        click: typeof opts.click === "function" ? opts.click : () => {},
        pluginId,
      });
      if (_rebuildMenu) _rebuildMenu(_menuContributions);
    },

    log(...args) {
      console.log(`[Plugin:${pluginId}]`, ...args);
    },

    encryptCredential(plaintext) {
      if (typeof plaintext !== "string" || !plaintext) return null;
      try {
        const electron = require("electron");
        if (!electron.safeStorage.isEncryptionAvailable()) return null;
        return electron.safeStorage.encryptString(plaintext).toString("base64");
      } catch { return null; }
    },

    decryptCredential(encrypted) {
      if (typeof encrypted !== "string" || !encrypted) return null;
      try {
        const electron = require("electron");
        if (!electron.safeStorage.isEncryptionAvailable()) return null;
        return electron.safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      } catch { return null; }
    },

    registerSettingsTransformer(fn) {
      if (typeof fn !== "function") {
        console.warn(`[Plugin:${pluginId}] registerSettingsTransformer: argument must be a function`);
        return;
      }
      _settingsTransformers.push({ pluginId, fn });
    },
  });
}

// ===================== Plugin loading =====================

// Resolves a manifest-supplied relative path and validates it stays within pluginDir.
// Returns the absolute path, or null if the entry attempts to escape the directory.
function safePluginPath(pluginDir, entry) {
  if (!entry || typeof entry !== "string") return null;
  const resolved = path.resolve(pluginDir, entry);
  const base = pluginDir.endsWith(path.sep) ? pluginDir : pluginDir + path.sep;
  return resolved.startsWith(base) ? resolved : null;
}

async function loadPlugin(pluginDir, source, ipcMain) {
  // Parse manifest
  let manifest;
  try {
    const raw = await fsp.readFile(path.join(pluginDir, "manifest.json"), "utf-8");
    manifest = JSON.parse(raw);
  } catch {
    console.warn(`[PluginManager] Skipping "${pluginDir}": missing or invalid manifest.json`);
    return;
  }

  // Validate id
  if (!manifest.id || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(manifest.id)) {
    console.warn(`[PluginManager] Skipping "${pluginDir}": invalid or missing id`);
    return;
  }

  const id = manifest.id;
  const enabled = _pluginsConfig[id] !== false;

  // Record discovery before attempting to load
  const record = {
    id,
    name: manifest.name || id,
    version: manifest.version || "",
    description: manifest.description || "",
    source,         // "bundled" | "user"
    dir: pluginDir,
    enabled,
    loaded: false,
    loadError: null,
    credentials: [],
  };
  _discoveredPlugins.push(record);

  const credentials = Array.isArray(manifest.credentials) ? manifest.credentials : [];
  for (const name of credentials) {
    if (typeof name !== "string" || !CREDENTIAL_NAME_PATTERN.test(name)) {
      console.warn(`[PluginManager] Plugin "${id}" declares an invalid credential name — skipped`);
      continue;
    }
    record.credentials.push(name);
    if (_credentialFields.some(c => c.plain === name)) continue;
    _credentialFields.push({
      plain: name,
      encrypted: name + "Encrypted",
      flag: name + "Set",
      remove: name + "Remove",
    });
  }

  if (!enabled) {
    return; // Skip load — disabled by user
  }

  // Version check
  if (manifest.minAppVersion && semverLt(APP_VERSION, manifest.minAppVersion)) {
    record.loadError = `Requires app >= ${manifest.minAppVersion}`;
    console.warn(`[PluginManager] Skipping plugin "${id}": ${record.loadError} (running ${APP_VERSION})`);
    return;
  }

  // Load main-process entry
  if (manifest.main) {
    const mainPath = safePluginPath(pluginDir, manifest.main);
    if (!mainPath) {
      record.loadError = "Invalid main entry point path";
      console.warn(`[PluginManager] Skipping plugin "${id}" main: path traversal detected`);
      return;
    }
    try {
      const mod = require(mainPath);
      const api = buildPluginApi(id, ipcMain);
      if (typeof mod === "function") {
        mod(api);
      } else if (mod && typeof mod.init === "function") {
        mod.init(api);
      } else if (!mod?.defaultSettings && !mod?.validateSettings) {
        console.warn(`[PluginManager] Plugin "${id}" main.js does not export a function, { init }, or plugin metadata`);
      }
      // Collect plugin-provided settings metadata (defaultSettings, validateSettings)
      if (mod?.defaultSettings && typeof mod.defaultSettings === "object" && !Array.isArray(mod.defaultSettings)) {
        Object.assign(_pluginDefaultSettings, mod.defaultSettings);
      }
      if (typeof mod?.validateSettings === "function") {
        _pluginValidators.push({ pluginId: id, fn: mod.validateSettings });
      }
      if (typeof mod?.migrateSettings === "function") {
        _migrators.push({ pluginId: id, fn: mod.migrateSettings });
      }
      console.log(`[PluginManager] Loaded plugin "${id}" (main)`);
    } catch (err) {
      record.loadError = err.message || String(err);
      console.error(`[PluginManager] Failed to load plugin "${id}" main.js:`, err);
      return; // Don't add renderer script if main failed
    }
  }

  // Record renderer entry
  if (manifest.renderer) {
    const rendererPath = safePluginPath(pluginDir, manifest.renderer);
    if (!rendererPath) {
      console.warn(`[PluginManager] Plugin "${id}" renderer: path traversal detected — skipped`);
    } else {
      try {
        await fsp.access(rendererPath, fs.constants.R_OK);
        rendererScripts.push(rendererPath);
        if (!manifest.main) {
          console.log(`[PluginManager] Loaded plugin "${id}" (renderer only)`);
        }
      } catch {
        console.warn(`[PluginManager] Plugin "${id}" renderer file not found: ${rendererPath}`);
      }
    }
  }

  // Record settings-window entry
  if (manifest.settings) {
    const settingsPath = safePluginPath(pluginDir, manifest.settings);
    if (!settingsPath) {
      console.warn(`[PluginManager] Plugin "${id}" settings: path traversal detected — skipped`);
    } else {
      try {
        await fsp.access(settingsPath, fs.constants.R_OK);
        settingsScripts.push(settingsPath);
      } catch {
        console.warn(`[PluginManager] Plugin "${id}" settings file not found: ${settingsPath}`);
      }
    }
  }

  // Auto-load styles.css if present — injected into both windows
  const stylesPath = path.join(pluginDir, "styles.css");
  try {
    await fsp.access(stylesPath, fs.constants.R_OK);
    pluginStylesheets.push(stylesPath);
  } catch { /* no styles.css — fine */ }

  record.loaded = true;
}

// ===================== Public API =====================

async function initPlugins(userData, initialSettings, ipcMain, rebuildMenuFn) {
  _userData = userData;
  _currentSettings = Object.assign({}, initialSettings);
  _rebuildMenu = rebuildMenuFn || null;
  _pluginsConfigFile = path.join(userData, "note-backups", "plugins-config.json");
  _discoveredPlugins.length = 0; // Clear on re-init
  _credentialFields.length = 0;
  for (const key of Object.keys(_pluginDefaultSettings)) delete _pluginDefaultSettings[key];
  _pluginValidators.length = 0;
  _settingsTransformers.length = 0;
  _migrators.length = 0;

  await loadPluginsConfig();

  const searchDirs = [
    { dir: path.join(__dirname, "plugins"), source: "bundled" },
    { dir: path.join(userData, "plugins"), source: "user" },
  ];

  for (const { dir, source } of searchDirs) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // Directory doesn't exist — skip silently
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(dir, entry.name);
      await loadPlugin(pluginDir, source, ipcMain);
    }
  }

  pluginBus.emit("app:ready", {});
}

function getRendererScripts() {
  // Return file:// URLs so the renderer can use them as <script src>.
  // pathToFileURL percent-encodes characters such as # and % in the install path.
  return rendererScripts.map(p => pathToFileURL(p).href);
}

function getSettingsScripts() {
  return settingsScripts.map(p => pathToFileURL(p).href);
}

function getPluginStylesheets() {
  return pluginStylesheets.map(p => pathToFileURL(p).href);
}

function getPluginInfo() {
  return _discoveredPlugins.map(p => ({
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    source: p.source,
    enabled: p.enabled,
    loaded: p.loaded,
    loadError: p.loadError,
    credentials: p.credentials.slice(),
  }));
}

async function setPluginEnabled(id, enabled) {
  if (enabled) {
    delete _pluginsConfig[id]; // Enabled is the default — remove the entry
  } else {
    _pluginsConfig[id] = false;
  }
  await savePluginsConfig();

  // Update in-memory record
  const plugin = _discoveredPlugins.find(p => p.id === id);
  if (plugin) plugin.enabled = enabled;
}

async function importPlugin(sourcePath) {
  // Basic path validation — must not escape out of the provided path
  if (!sourcePath || typeof sourcePath !== "string") {
    return { success: false, error: "No path provided" };
  }

  // Read and validate manifest from source
  let manifest;
  try {
    const raw = await fsp.readFile(path.join(sourcePath, "manifest.json"), "utf-8");
    manifest = JSON.parse(raw);
  } catch {
    return { success: false, error: "Could not read manifest.json from the selected directory" };
  }

  if (!manifest.id || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(manifest.id)) {
    return { success: false, error: "Plugin manifest has an invalid or missing id" };
  }

  if (!_userData) {
    return { success: false, error: "Plugin manager not initialised" };
  }

  const destDir = path.join(_userData, "plugins");
  const destPlugin = path.join(destDir, manifest.id);

  // Refuse to silently overwrite an already-installed plugin.
  try {
    await fsp.access(destPlugin);
    return {
      success: false,
      error: `Plugin "${manifest.id}" is already installed. Remove it from the Plugins list first, then re-import to update.`,
    };
  } catch { /* does not exist — safe to proceed */ }

  try {
    await fsp.mkdir(destDir, { recursive: true });
    fs.cpSync(sourcePath, destPlugin, { recursive: true, force: true });
  } catch (err) {
    return { success: false, error: "Failed to copy plugin: " + (err.message || err) };
  }

  return {
    success: true,
    id: manifest.id,
    name: manifest.name || manifest.id,
  };
}

function fireEvent(name, data) {
  pluginBus.emit(name, data);
}

function updateSettings(settings) {
  _currentSettings = Object.assign({}, settings);
}

function runMigrations(rawSettings) {
  for (const { pluginId, fn } of _migrators) {
    try {
      fn(rawSettings);
    } catch (err) {
      console.error(`[PluginManager] Plugin "${pluginId}" migrateSettings threw:`, err);
    }
  }
}

// Returns [{ plain, encrypted, flag, remove }] for every credential setting a plugin declares.
function getCredentialFields() {
  return _credentialFields.map(c => Object.assign({}, c));
}

function getPluginDefaultSettings() {
  return Object.assign({}, _pluginDefaultSettings);
}

function validatePluginSettings(s) {
  for (const { pluginId, fn } of _pluginValidators) {
    try {
      if (!fn(s)) {
        console.warn(`[PluginManager] Plugin "${pluginId}" validateSettings rejected the payload`);
        return false;
      }
    } catch (err) {
      console.error(`[PluginManager] Plugin "${pluginId}" validateSettings threw:`, err);
      return false;
    }
  }
  return true;
}

function transformSettingsForSave(settings) {
  let result = Object.assign({}, settings);
  for (const { pluginId, fn } of _settingsTransformers) {
    try {
      const out = fn(result);
      if (out && typeof out === "object" && !Array.isArray(out)) result = out;
    } catch (err) {
      console.error(`[PluginManager] Plugin "${pluginId}" settings transformer threw:`, err);
    }
  }
  return result;
}

module.exports = {
  initPlugins,
  getRendererScripts,
  getSettingsScripts,
  getPluginStylesheets,
  getPluginInfo,
  setPluginEnabled,
  importPlugin,
  fireEvent,
  updateSettings,
  runMigrations,
  getPluginDefaultSettings,
  validatePluginSettings,
  transformSettingsForSave,
  getCredentialFields,
};
