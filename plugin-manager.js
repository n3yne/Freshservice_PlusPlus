"use strict";

const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { EventEmitter } = require("events");

const { version: APP_VERSION } = require("./package.json");

const pluginBus = new EventEmitter();
pluginBus.setMaxListeners(100);

// All IPC channels registered by plugins — checked at handle() time to prevent duplicates.
const registeredChannels = new Set();

// Absolute renderer script paths collected during initPlugins.
const rendererScripts = [];

// Absolute settings-window script paths collected during initPlugins.
const settingsScripts = [];

// All plugins discovered during initPlugins (including disabled and failed).
const _discoveredPlugins = [];

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
  });
}

// ===================== Plugin loading =====================

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
  };
  _discoveredPlugins.push(record);

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
    const mainPath = path.join(pluginDir, manifest.main);
    try {
      const mod = require(mainPath);
      const api = buildPluginApi(id, ipcMain);
      if (typeof mod === "function") {
        mod(api);
      } else if (mod && typeof mod.init === "function") {
        mod.init(api);
      } else {
        console.warn(`[PluginManager] Plugin "${id}" main.js does not export a function or { init }`);
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
    const rendererPath = path.join(pluginDir, manifest.renderer);
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

  // Record settings-window entry
  if (manifest.settings) {
    const settingsPath = path.join(pluginDir, manifest.settings);
    try {
      await fsp.access(settingsPath, fs.constants.R_OK);
      settingsScripts.push(settingsPath);
    } catch {
      console.warn(`[PluginManager] Plugin "${id}" settings file not found: ${settingsPath}`);
    }
  }

  record.loaded = true;
}

// ===================== Public API =====================

async function initPlugins(userData, initialSettings, ipcMain, rebuildMenuFn) {
  _userData = userData;
  _currentSettings = Object.assign({}, initialSettings);
  _rebuildMenu = rebuildMenuFn || null;
  _pluginsConfigFile = path.join(userData, "note-backups", "plugins-config.json");
  _discoveredPlugins.length = 0; // Clear on re-init

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
  // Return file:// URLs so the renderer can use them as <script src>
  return rendererScripts.map(p => "file:///" + p.replace(/\\/g, "/"));
}

function getSettingsScripts() {
  return settingsScripts.map(p => "file:///" + p.replace(/\\/g, "/"));
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

  try {
    await fsp.mkdir(destDir, { recursive: true });
    // Copy plugin directory (overwrites existing — allows updates)
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

module.exports = {
  initPlugins,
  getRendererScripts,
  getSettingsScripts,
  getPluginInfo,
  setPluginEnabled,
  importPlugin,
  fireEvent,
  updateSettings,
};
