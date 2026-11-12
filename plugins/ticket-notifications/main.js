"use strict";

// Ticket Notifications: main-process half. The checking happens in renderer.js
// through the Freshservice plugin's API handlers; this file keeps what was
// already seen on disk (so a restart doesn't repeat notifications), holds the
// last check's status for the Settings tab, and brings the window forward when
// a notification is clicked.

const fs = require("fs");
const path = require("path");

const INTERVALS = [1, 2, 5, 10, 15, 30];
const MAX_SEEN = 1000;

function isId(v) {
  return Number.isSafeInteger(v) && v > 0;
}

function isTime(v) {
  return Number.isFinite(v) && v > 0 && v < 8.64e15;
}

// What renderer.js remembers between checks: whose tickets, when it last
// checked, and the conversation IDs it has already looked at. Returns null
// for anything else.
function cleanState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!isId(raw.agentId) || !isTime(raw.lastCheck)) return null;
  const seen = Array.isArray(raw.seen) ? raw.seen.filter(isId).slice(-MAX_SEEN) : [];
  return { agentId: raw.agentId, lastCheck: raw.lastCheck, seen };
}

function cleanStatus(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (v, max) => (typeof v === "string" ? v.substring(0, max) : "");
  return {
    checkedAt: isTime(raw.checkedAt) ? raw.checkedAt : null,
    ok: raw.ok === true,
    message: text(raw.message, 500),
    tickets: Number.isInteger(raw.tickets) && raw.tickets >= 0 ? raw.tickets : null,
    lastNotifiedAt: isTime(raw.lastNotifiedAt) ? raw.lastNotifiedAt : null,
  };
}

module.exports = {

  defaultSettings: {
    ticketNotifyAgentId: 0,
    ticketNotifyAgentName: "",
    ticketNotifyAgentEmail: "",
    ticketNotifyInterval: 2,
    ticketNotifyOtherAgents: true,
    ticketNotifyDesktop: true,
    ticketNotifySound: true,
  },

  validateSettings: function (s) {
    if (s.ticketNotifyAgentId !== undefined && s.ticketNotifyAgentId !== 0 && !isId(s.ticketNotifyAgentId)) return false;
    if (s.ticketNotifyAgentName !== undefined && (typeof s.ticketNotifyAgentName !== "string" || s.ticketNotifyAgentName.length > 200)) return false;
    if (s.ticketNotifyAgentEmail !== undefined && (typeof s.ticketNotifyAgentEmail !== "string" || s.ticketNotifyAgentEmail.length > 254)) return false;
    if (s.ticketNotifyInterval !== undefined && !INTERVALS.includes(s.ticketNotifyInterval)) return false;
    for (const key of ["ticketNotifyOtherAgents", "ticketNotifyDesktop", "ticketNotifySound"]) {
      if (s[key] !== undefined && typeof s[key] !== "boolean") return false;
    }
    return true;
  },

  init: function (api) {
    let status = null;

    function stateFile() {
      return path.join(api.getDataPath(), "state.json");
    }

    api.handle("get-state", async function () {
      try {
        return cleanState(JSON.parse(fs.readFileSync(stateFile(), "utf-8")));
      } catch {
        return null; // first run, or an unreadable file: start afresh
      }
    });

    api.handle("save-state", async function (data) {
      const clean = cleanState(data);
      if (!clean) return { error: "Invalid state." };
      const file = stateFile();
      const tmp = file + ".tmp";
      try {
        fs.writeFileSync(tmp, JSON.stringify(clean), "utf-8");
        fs.renameSync(tmp, file);
        return { ok: true };
      } catch (err) {
        api.log("Could not save state:", err.message);
        return { error: err.message };
      }
    });

    api.onMessage("status", function (data) {
      status = cleanStatus(data);
    });

    api.handle("get-status", async function () {
      return status;
    });

    // Restores and focuses the main window (the one showing index.html).
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

  // Exported for tests.
  cleanState,
  cleanStatus,
  INTERVALS,
};
