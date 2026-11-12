"use strict";

// Recent Tickets plugin, main process: keeps the list of recently viewed
// tickets in recent.json in the plugin's data folder and validates the
// plugin's settings. The list itself is built in renderer.js.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const MAX_CHOICES = [10, 25, 50, 100, 200];
const HARD_MAX = 200;
const MAX_TEXT = 300;

function str(v, max) {
  return typeof v === "string" ? v.substring(0, max) : "";
}

function isoOrNull(v) {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Cleans one entry read from disk or sent by the renderer, or returns null.
function sanitizeEntry(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const key = str(e.key, 100);
  const url = str(e.url, 2048);
  if (!key || !/^https?:\/\//i.test(url)) return null;
  const viewedAt = isoOrNull(e.viewedAt);
  if (!viewedAt) return null;
  const views = Number(e.views);
  return {
    siteId: str(e.siteId, 63),
    siteName: str(e.siteName, 60),
    key,
    kind: str(e.kind, 30),
    label: str(e.label, MAX_TEXT) || key,
    title: str(e.title, MAX_TEXT),
    url,
    viewedAt,
    views: Number.isInteger(views) && views > 0 ? Math.min(views, 1e6) : 1,
    pinned: e.pinned === true,
  };
}

// Cleans the whole store: at most HARD_MAX entries, one per site + key.
function sanitizeStore(data) {
  const list = data && Array.isArray(data.entries) ? data.entries : [];
  const seen = new Set();
  const entries = [];
  for (const raw of list) {
    const e = sanitizeEntry(raw);
    if (!e) continue;
    const k = e.siteId + "|" + e.key;
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push(e);
    if (entries.length >= HARD_MAX) break;
  }
  return { version: 1, entries };
}

module.exports = {
  defaultSettings: {
    recentTicketsMax: 50,
    recentTicketsReuseTab: true,
  },

  validateSettings: function (s) {
    if (s.recentTicketsMax !== undefined && !MAX_CHOICES.includes(s.recentTicketsMax)) return false;
    if (s.recentTicketsReuseTab !== undefined && typeof s.recentTicketsReuseTab !== "boolean") return false;
    return true;
  },

  init: function (api) {
    const file = path.join(api.getDataPath(), "recent.json");

    function readSync() {
      try {
        return sanitizeStore(JSON.parse(fs.readFileSync(file, "utf-8")));
      } catch (e) {
        if (e.code !== "ENOENT") {
          const corrupt = file + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
          try { fs.renameSync(file, corrupt); } catch { /* start again with an empty list */ }
          api.log("recent.json couldn't be read; kept a copy at", corrupt);
        }
        return { version: 1, entries: [] };
      }
    }

    let writing = Promise.resolve();
    function writeAsync(store) {
      writing = writing.then(async function () {
        const tmp = file + ".tmp";
        await fsp.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
        await fsp.rename(tmp, file);
      }).catch(function (err) { api.log("Couldn't save recent tickets:", err.message); });
      return writing;
    }

    api.handle("load", async function () {
      return readSync();
    });

    api.handle("save", async function (data) {
      const store = sanitizeStore(data);
      await writeAsync(store);
      return { ok: true, count: store.entries.length };
    });

    // Sent while the window closes, when an awaited reply may never arrive.
    api.onMessage("save-sync", function (data) {
      try {
        const store = sanitizeStore(data);
        const tmp = file + ".close.tmp";
        fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
        fs.renameSync(tmp, file);
      } catch (err) {
        api.log("Couldn't save recent tickets on close:", err.message);
      }
    });
  },

  // For the tests.
  sanitizeEntry,
  sanitizeStore,
  MAX_CHOICES,
  HARD_MAX,
};
