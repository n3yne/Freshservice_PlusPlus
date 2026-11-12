"use strict";

// Follow-up Reminders plugin, main process: keeps the reminders in
// reminders.json in the plugin's data folder, validates the plugin's settings
// and brings the window forward when a reminder's desktop alert is clicked.
// The scheduling and the side panel tab live in renderer.js.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const HARD_MAX = 500;
const MAX_TEXT = 300;
const MAX_NOTE = 1000;
const MORNING_HOURS = [6, 7, 8, 9, 10, 11];

function str(v, max) {
  return typeof v === "string" ? v.substring(0, max) : "";
}

function isoOrNull(v) {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Cleans one reminder read from disk or sent by the renderer, or returns null.
function sanitizeReminder(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const id = str(r.id, 64);
  const key = str(r.key, 2048);
  const url = str(r.url, 2048);
  if (!/^[a-z0-9-]{1,64}$/i.test(id) || !key || !/^https?:\/\//i.test(url)) return null;
  const dueAt = isoOrNull(r.dueAt);
  if (!dueAt) return null;
  const snoozes = Number(r.snoozes);
  return {
    id,
    siteId: str(r.siteId, 63),
    siteName: str(r.siteName, 60),
    key,
    kind: str(r.kind, 30),
    label: str(r.label, MAX_TEXT) || key.substring(0, MAX_TEXT),
    title: str(r.title, MAX_TEXT),
    url,
    note: str(r.note, MAX_NOTE),
    dueAt,
    createdAt: isoOrNull(r.createdAt) || dueAt,
    firedAt: isoOrNull(r.firedAt),
    snoozes: Number.isInteger(snoozes) && snoozes > 0 ? Math.min(snoozes, 1e6) : 0,
  };
}

// Cleans the whole store: at most HARD_MAX reminders, one per site + key.
function sanitizeStore(data) {
  const list = data && Array.isArray(data.reminders) ? data.reminders : [];
  const seenKeys = new Set();
  const seenIds = new Set();
  const reminders = [];
  for (const raw of list) {
    const r = sanitizeReminder(raw);
    if (!r) continue;
    const k = r.siteId + "|" + r.key;
    if (seenKeys.has(k) || seenIds.has(r.id)) continue;
    seenKeys.add(k);
    seenIds.add(r.id);
    reminders.push(r);
    if (reminders.length >= HARD_MAX) break;
  }
  return { version: 1, reminders };
}

module.exports = {
  defaultSettings: {
    followUpDesktop: true,
    followUpSound: true,
    followUpMorningHour: 9,
  },

  validateSettings: function (s) {
    if (s.followUpDesktop !== undefined && typeof s.followUpDesktop !== "boolean") return false;
    if (s.followUpSound !== undefined && typeof s.followUpSound !== "boolean") return false;
    if (s.followUpMorningHour !== undefined && !MORNING_HOURS.includes(s.followUpMorningHour)) return false;
    return true;
  },

  init: function (api) {
    const file = path.join(api.getDataPath(), "reminders.json");

    function readSync() {
      try {
        return sanitizeStore(JSON.parse(fs.readFileSync(file, "utf-8")));
      } catch (e) {
        if (e.code !== "ENOENT") {
          const corrupt = file + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
          try { fs.renameSync(file, corrupt); } catch { /* start again with an empty list */ }
          api.log("reminders.json couldn't be read; kept a copy at", corrupt);
        }
        return { version: 1, reminders: [] };
      }
    }

    let writing = Promise.resolve();
    function writeAsync(store) {
      writing = writing.then(async function () {
        const tmp = file + ".tmp";
        await fsp.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
        await fsp.rename(tmp, file);
      }).catch(function (err) { api.log("Couldn't save follow-up reminders:", err.message); });
      return writing;
    }

    api.handle("load", async function () {
      return readSync();
    });

    api.handle("save", async function (data) {
      const store = sanitizeStore(data);
      await writeAsync(store);
      return { ok: true, count: store.reminders.length };
    });

    // Sent while the window closes, when an awaited reply may never arrive.
    api.onMessage("save-sync", function (data) {
      try {
        const store = sanitizeStore(data);
        const tmp = file + ".close.tmp";
        fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
        fs.renameSync(tmp, file);
      } catch (err) {
        api.log("Couldn't save follow-up reminders on close:", err.message);
      }
    });

    // Clicking a desktop alert brings the main window forward.
    api.handle("focus-window", async function () {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows().find(function (w) {
        if (w.isDestroyed()) return false;
        try { return new URL(w.webContents.getURL()).pathname.endsWith("/index.html"); } catch { return false; }
      });
      if (!win) return { ok: false };
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return { ok: true };
    });
  },

  // For the tests.
  sanitizeReminder,
  sanitizeStore,
  HARD_MAX,
  MORNING_HOURS,
};
