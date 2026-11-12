"use strict";

// Time Tracker plugin, main process: keeps the timers in timers.json in the
// plugin's data folder and validates the plugin's settings. The timers
// themselves run in renderer.js; this side only loads and saves them.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const MAX_TIMERS = 200;
const MAX_TEXT = 300;
const MAX_NOTE = 4000;
const MAX_MS = 7 * 24 * 60 * 60 * 1000; // a week on one timer is surely a mistake
const ROUND_TO_CHOICES = [1, 5, 6, 10, 15, 30];

function str(v, max) {
  return typeof v === "string" ? v.substring(0, max) : "";
}

function isoOrNull(v) {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Cleans one timer read from disk or sent by the renderer, or returns null.
function sanitizeTimer(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) return null;
  const id = str(t.id, 60);
  const key = str(t.key, 100);
  if (!id || !key) return null;
  const ms = Number(t.accumulatedMs);
  const since = Number(t.runningSince);
  const loggedMinutes = Number(t.loggedMinutes);
  return {
    id,
    key,
    siteId: str(t.siteId, 63),
    siteName: str(t.siteName, 60),
    recordId: /^\d{1,20}$/.test(String(t.recordId || "")) ? String(t.recordId) : "",
    kind: str(t.kind, 30),
    label: str(t.label, MAX_TEXT),
    title: str(t.title, MAX_TEXT),
    url: /^https?:\/\//i.test(str(t.url, 2048)) ? str(t.url, 2048) : "",
    accumulatedMs: Number.isFinite(ms) ? Math.min(Math.max(0, Math.round(ms)), MAX_MS) : 0,
    runningSince: Number.isFinite(since) && since > 0 ? Math.round(since) : null,
    createdAt: isoOrNull(t.createdAt) || new Date().toISOString(),
    note: str(t.note, MAX_NOTE),
    billable: t.billable === false ? false : true,
    loggedAt: isoOrNull(t.loggedAt),
    loggedMinutes: Number.isInteger(loggedMinutes) && loggedMinutes > 0 ? loggedMinutes : 0,
  };
}

// Cleans the whole store: at most MAX_TIMERS timers, unique ids and keys.
function sanitizeStore(data) {
  const list = data && Array.isArray(data.timers) ? data.timers : [];
  const seenIds = new Set();
  const seenKeys = new Set();
  const timers = [];
  for (const raw of list) {
    const t = sanitizeTimer(raw);
    if (!t || seenIds.has(t.id)) continue;
    const scopedKey = t.siteId + "|" + t.key;
    if (seenKeys.has(scopedKey)) continue;
    seenIds.add(t.id);
    seenKeys.add(scopedKey);
    timers.push(t);
    if (timers.length >= MAX_TIMERS) break;
  }
  const savedAt = Number(data && data.savedAt);
  return { version: 1, savedAt: Number.isFinite(savedAt) && savedAt > 0 ? Math.round(savedAt) : 0, timers };
}

module.exports = {
  defaultSettings: {
    timeTrackerRoundTo: 1,
    timeTrackerOneAtATime: true,
    timeTrackerAutoStart: false,
    timeTrackerBillable: true,
  },

  validateSettings: function (s) {
    if (s.timeTrackerRoundTo !== undefined && !ROUND_TO_CHOICES.includes(s.timeTrackerRoundTo)) return false;
    for (const k of ["timeTrackerOneAtATime", "timeTrackerAutoStart", "timeTrackerBillable"]) {
      if (s[k] !== undefined && typeof s[k] !== "boolean") return false;
    }
    return true;
  },

  init: function (api) {
    const file = path.join(api.getDataPath(), "timers.json");

    function readSync() {
      try {
        return sanitizeStore(JSON.parse(fs.readFileSync(file, "utf-8")));
      } catch (e) {
        if (e.code !== "ENOENT") {
          const corrupt = file + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
          try { fs.renameSync(file, corrupt); } catch { /* start again with an empty list */ }
          api.log("timers.json couldn't be read; kept a copy at", corrupt);
        }
        return { version: 1, savedAt: 0, timers: [] };
      }
    }

    let writing = Promise.resolve();
    function writeAsync(store) {
      writing = writing.then(async function () {
        const tmp = file + ".tmp";
        await fsp.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
        await fsp.rename(tmp, file);
      }).catch(function (err) { api.log("Couldn't save timers:", err.message); });
      return writing;
    }

    api.handle("load", async function () {
      return readSync();
    });

    api.handle("save", async function (data) {
      const store = sanitizeStore(data);
      await writeAsync(store);
      return { ok: true, count: store.timers.length };
    });

    // Sent while the window closes, when an awaited reply may never arrive.
    api.onMessage("save-sync", function (data) {
      try {
        const store = sanitizeStore(data);
        const tmp = file + ".close.tmp";
        fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
        fs.renameSync(tmp, file);
      } catch (err) {
        api.log("Couldn't save timers on close:", err.message);
      }
    });
  },

  // For the tests.
  sanitizeTimer,
  sanitizeStore,
  MAX_TIMERS,
  ROUND_TO_CHOICES,
};
