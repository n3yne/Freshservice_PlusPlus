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

// Live copy of settings — updated on each save-settings call.
let _currentSettings = {};

// Menu contributions from plugins: { label, accelerator?, click }
const _menuContributions = [];
const MAX_MENU_ITEMS = 10;

// Reference to the menu template so we can rebuild with plugin items.
// Set by calling code via setMenuRebuildFn().
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

// ===================== Plugin API factory =====================

function buildPluginApi(pluginId, userData, ipcMain) {
  const dataDir = path.join(userData, "plugins", pluginId);

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

// ===================== Public API =====================

async function initPlugins(userData, initialSettings, ipcMain, rebuildMenuFn) {
  _currentSettings = Object.assign({}, initialSettings);
  _rebuildMenu = rebuildMenuFn || null;

  const searchDirs = [
    path.join(__dirname, "plugins"),
    path.join(userData, "plugins"),
  ];

  for (const dir of searchDirs) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // Directory doesn't exist — skip silently
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(dir, entry.name);
      await loadPlugin(pluginDir, userData, ipcMain);
    }
  }

  pluginBus.emit("app:ready", {});
}

async function loadPlugin(pluginDir, userData, ipcMain) {
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

  // Version check
  if (manifest.minAppVersion && semverLt(APP_VERSION, manifest.minAppVersion)) {
    console.warn(`[PluginManager] Skipping plugin "${id}": requires app >= ${manifest.minAppVersion} (running ${APP_VERSION})`);
    return;
  }

  // Load main-process entry
  let mainLoaded = false;
  if (manifest.main) {
    const mainPath = path.join(pluginDir, manifest.main);
    try {
      const mod = require(mainPath);
      const api = buildPluginApi(id, userData, ipcMain);
      if (typeof mod === "function") {
        mod(api);
      } else if (mod && typeof mod.init === "function") {
        mod.init(api);
      } else {
        console.warn(`[PluginManager] Plugin "${id}" main.js does not export a function or { init }`);
      }
      mainLoaded = true;
      console.log(`[PluginManager] Loaded plugin "${id}" (main)`);
    } catch (err) {
      console.error(`[PluginManager] Failed to load plugin "${id}" main.js:`, err);
      // Don't add renderer script if main failed — the plugin is broken
      return;
    }
  }

  // Record renderer entry
  if (manifest.renderer) {
    const rendererPath = path.join(pluginDir, manifest.renderer);
    try {
      await fsp.access(rendererPath, fs.constants.R_OK);
      rendererScripts.push(rendererPath);
      if (!mainLoaded) {
        console.log(`[PluginManager] Loaded plugin "${id}" (renderer only)`);
      }
    } catch {
      console.warn(`[PluginManager] Plugin "${id}" renderer file not found: ${rendererPath}`);
    }
  }
}

function getRendererScripts() {
  // Return file:// URLs so the renderer can use them as <script src>
  return rendererScripts.map(p => "file:///" + p.replace(/\\/g, "/"));
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
  fireEvent,
  updateSettings,
};
