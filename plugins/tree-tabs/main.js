"use strict";

// Tree Style Tabs plugin: saves and loads the tree in <userData>/plugins/tree-tabs/tree.json.
// The tree itself lives in renderer.js. Tab ids change every run, so tab nodes
// are saved with their address and tab-bar position and matched to the restored
// tabs at startup (see restore() in renderer.js).

const fs = require("fs");
const path = require("path");

const STATE_VERSION = 1;
const MAX_ENTRIES = 2000;
const MAX_DEPTH = 64;
const MAX_NAME = 200;
const MAX_URL = 4096;

// A saved tree is a flat list in depth-first order:
//   { kind: "group" | "tab", depth, name, collapsed, url?, index? }
// depth starts at 0 and a node's depth is at most one more than the one before it.
function isEntry(e, prevDepth) {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return false;
  if (e.kind !== "group" && e.kind !== "tab") return false;
  if (!Number.isInteger(e.depth) || e.depth < 0 || e.depth > MAX_DEPTH || e.depth > prevDepth + 1) return false;
  if (e.name !== undefined && (typeof e.name !== "string" || e.name.length > MAX_NAME)) return false;
  if (e.collapsed !== undefined && typeof e.collapsed !== "boolean") return false;
  if (e.kind === "tab") {
    if (typeof e.url !== "string" || e.url.length > MAX_URL) return false;
    if (!Number.isInteger(e.index) || e.index < 0) return false;
  }
  return true;
}

function isValidState(state) {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return false;
  if (state.version !== STATE_VERSION) return false;
  if (!Array.isArray(state.entries) || state.entries.length > MAX_ENTRIES) return false;
  let prev = -1;
  for (const e of state.entries) {
    if (!isEntry(e, prev)) return false;
    prev = e.depth;
  }
  return true;
}

// Keeps only the fields the renderer reads.
function cleanState(state) {
  return {
    version: STATE_VERSION,
    entries: state.entries.map((e) => {
      const out = { kind: e.kind, depth: e.depth, name: e.name || "", collapsed: e.collapsed === true };
      if (e.kind === "tab") { out.url = e.url; out.index = e.index; }
      return out;
    }),
  };
}

function writeAtomic(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

module.exports = {
  defaultSettings: {
    treeTabsNestOpened: true,
  },

  validateSettings: function (s) {
    if (s.treeTabsNestOpened !== undefined && typeof s.treeTabsNestOpened !== "boolean") return false;
    return true;
  },

  init: function (api) {
    const file = () => path.join(api.getDataPath(), "tree.json");

    function save(state) {
      if (!isValidState(state)) {
        api.log("Ignored an invalid tree");
        return false;
      }
      writeAtomic(file(), JSON.stringify(cleanState(state)));
      return true;
    }

    api.handle("load-state", async function () {
      try {
        const state = JSON.parse(await fs.promises.readFile(file(), "utf8"));
        return isValidState(state) ? cleanState(state) : null;
      } catch (err) {
        if (err && err.code !== "ENOENT") api.log("Couldn't read the tree:", err.message);
        return null;
      }
    });

    api.handle("save-state", async function (state) {
      try {
        return { success: save(state) };
      } catch (err) {
        api.log("Couldn't save the tree:", err.message);
        return { success: false };
      }
    });

    // Sent from beforeunload, where an invoke() reply may never arrive.
    api.onMessage("save-state-now", function (state) {
      try { save(state); } catch (err) { api.log("Couldn't save the tree:", err.message); }
    });
  },

  // For the tests.
  _isValidState: isValidState,
  _cleanState: cleanState,
  MAX_ENTRIES,
};
