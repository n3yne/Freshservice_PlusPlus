"use strict";

// Note Backup plugin — main process.
//
// Stores the side panel's notes on disk:
//   <userData>/note-backups/autosave.json        latest draft per ticket
//   <userData>/note-backups/<ticket>/<time>.html  manual and automatic snapshots
//   <userData>/note-backups/editor-state.json    whether the editor was blank at close
// The folder is the one the app used before note backup became a plugin, so
// existing backups keep working. It also holds the app's own settings files,
// which this plugin leaves alone.

const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const MAX_NOTE_CHARS = 10 * 1024 * 1024;
const SNAPSHOT_EXTENSIONS = [".html", ".txt"];

function isSnapshotFile(name) {
  return SNAPSHOT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function sanitizeTicketId(raw) {
  return (raw || "no-ticket").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stripHtml(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function contentPreview(text, q) {
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 25);
  const end = Math.min(text.length, idx + q.length + 50);
  return (start > 0 ? "…" : "") + text.substring(start, end) + (end < text.length ? "…" : "");
}

function shortPreview(text) {
  return text.substring(0, 80) + (text.length > 80 ? "…" : "");
}

// All file access for one backup folder. Kept separate from init() so tests can
// point it at a temporary directory.
function createNoteStore(dir) {
  const autosaveFile = path.join(dir, "autosave.json");
  const editorStateFile = path.join(dir, "editor-state.json");

  // Serializes all reads+writes to autosave.json so concurrent calls (autosave,
  // live-sync snapshot, ticket-swap snapshot) can't interleave and overwrite
  // each other with stale data.
  let autosaveQueue = Promise.resolve();
  function withAutosaveLock(fn) {
    const queued = autosaveQueue.then(fn);
    autosaveQueue = queued.catch((err) => { console.error("[NoteBackup] Autosave write failed:", err); });
    return queued;
  }

  async function ensureDir() {
    await fsp.mkdir(dir, { recursive: true });
  }

  // tmp-file + rename so a crash mid-write can't truncate the file.
  async function writeAutosaveAtomic(data) {
    const tmp = autosaveFile + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fsp.rename(tmp, autosaveFile);
  }

  async function readAutosave() {
    try {
      return JSON.parse(await fsp.readFile(autosaveFile, "utf-8"));
    } catch {
      return {};
    }
  }

  async function saveNote({ ticketId, noteContent, isManual }) {
    if (typeof noteContent !== "string" || noteContent.length > MAX_NOTE_CHARS) {
      return { success: false, error: "Note content exceeds size limit" };
    }
    await ensureDir();

    const timestamp = new Date().toISOString();
    const safeTicketId = sanitizeTicketId(ticketId);

    await withAutosaveLock(async () => {
      let data = {};
      try {
        data = JSON.parse(await fsp.readFile(autosaveFile, "utf-8"));
      } catch (e) {
        if (e.code !== "ENOENT") {
          // Corrupt file (truncated write, disk error): keep it so it can be recovered by hand.
          const corruptPath = `${autosaveFile}.corrupt-${timestamp.replace(/[:.]/g, "-")}`;
          await fsp.rename(autosaveFile, corruptPath).catch(() => {});
          console.error("[NoteBackup] Corrupt autosave.json preserved at", corruptPath, e);
        }
      }
      data[safeTicketId] = { content: noteContent, updatedAt: timestamp };
      await writeAutosaveAtomic(data);
    });

    // A manual save also writes a timestamped snapshot file.
    if (isManual) {
      const historyDir = path.join(dir, safeTicketId);
      await fsp.mkdir(historyDir, { recursive: true });
      await fsp.writeFile(path.join(historyDir, `${timestamp.replace(/[:.]/g, "-")}.html`), noteContent, "utf-8");
    }

    return { success: true, timestamp, ticketId: safeTicketId };
  }

  async function loadAutosave() {
    await ensureDir();
    return readAutosave();
  }

  async function getHistory(ticketId) {
    const historyDir = path.join(dir, sanitizeTicketId(ticketId));
    try {
      const files = (await fsp.readdir(historyDir)).filter(isSnapshotFile).sort().reverse();
      return await Promise.all(files.map(async (f) => ({
        filename: f,
        content: await fsp.readFile(path.join(historyDir, f), "utf-8"),
      })));
    } catch {
      return [];
    }
  }

  // Every ticket with a draft or snapshots, with the time it last changed.
  async function getAllTickets() {
    await ensureDir();
    const entries = [];
    const seen = new Set();

    for (const [ticketId, info] of Object.entries(await readAutosave())) {
      const safeId = sanitizeTicketId(ticketId);
      if (seen.has(safeId)) continue;
      seen.add(safeId);
      entries.push({ ticketId: safeId, updatedAt: info.updatedAt, source: "autosave" });
    }

    try {
      const dirs = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
      for (const name of dirs) {
        const safeDir = sanitizeTicketId(name);
        if (seen.has(safeDir)) continue;
        seen.add(safeDir);
        // Newest snapshot's mtime, so history-only tickets can show a date.
        let updatedAt = null;
        try {
          let latestMs = 0;
          for (const f of await fsp.readdir(path.join(dir, safeDir))) {
            if (!isSnapshotFile(f)) continue;
            try {
              const st = await fsp.stat(path.join(dir, safeDir, f));
              if (st.mtimeMs > latestMs) {
                latestMs = st.mtimeMs;
                updatedAt = new Date(st.mtimeMs).toISOString();
              }
            } catch { /* skip unreadable file */ }
          }
        } catch { /* folder unreadable */ }
        entries.push({ ticketId: safeDir, updatedAt, source: "history" });
      }
    } catch { /* folder missing */ }

    return entries;
  }

  async function deleteAutosave(ticketId) {
    const safeTicketId = sanitizeTicketId(ticketId);
    await withAutosaveLock(async () => {
      try {
        const data = JSON.parse(await fsp.readFile(autosaveFile, "utf-8"));
        delete data[safeTicketId];
        await writeAutosaveAtomic(data);
      } catch { /* nothing to delete */ }
    });
    return { success: true };
  }

  // Deletes a ticket's draft and all of its snapshots.
  async function deleteTicket(ticketId) {
    const safeTicketId = sanitizeTicketId(ticketId);
    await deleteAutosave(safeTicketId);
    try {
      await fsp.rm(path.join(dir, safeTicketId), { recursive: true, force: true });
    } catch { /* folder missing */ }
    return { success: true };
  }

  // Searches drafts and snapshots for a ticket ID or text.
  async function searchNotes(query) {
    if (!query || typeof query !== "string") return [];
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const results = [];
    const seen = new Set();

    // 1. Drafts. Wait for any in-flight write to settle before reading.
    await autosaveQueue.catch(() => {});
    for (const [ticketId, info] of Object.entries(await readAutosave())) {
      const safeId = sanitizeTicketId(ticketId);
      if (seen.has(safeId)) continue;
      const text = stripHtml(info.content);
      const preview = safeId.toLowerCase().includes(q) ? shortPreview(text) : contentPreview(text, q);
      if (preview !== null) {
        results.push({ ticketId: safeId, preview, updatedAt: info.updatedAt });
        seen.add(safeId);
      }
    }

    // 2. Snapshot files, newest first.
    try {
      const dirs = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
      for (const name of dirs) {
        const safeId = sanitizeTicketId(name);
        if (seen.has(safeId)) continue;
        const ticketDir = path.join(dir, name);
        const idMatches = safeId.toLowerCase().includes(q);
        let matchPreview = null;
        let matchTime = null;

        try {
          const files = (await fsp.readdir(ticketDir)).filter(isSnapshotFile).sort().reverse();
          for (const file of files) {
            try {
              const text = stripHtml(await fsp.readFile(path.join(ticketDir, file), "utf-8"));
              const fileTime = new Date((await fsp.stat(path.join(ticketDir, file))).mtimeMs).toISOString();
              if (idMatches && matchPreview === null) {
                matchPreview = shortPreview(text);
                matchTime = fileTime;
              }
              // A content match takes priority over an ID-only match.
              const cp = contentPreview(text, q);
              if (cp !== null) {
                matchPreview = cp;
                matchTime = fileTime;
                break;
              }
            } catch { /* skip unreadable file */ }
          }
        } catch { /* folder unreadable */ }

        if (matchPreview === null && idMatches) matchPreview = "";
        if (matchPreview !== null) {
          results.push({ ticketId: safeId, preview: matchPreview, updatedAt: matchTime });
          seen.add(safeId);
        }
      }
    } catch { /* folder missing */ }

    return results;
  }

  // Total size of the folder and its ticket subfolders.
  async function getSize() {
    await ensureDir();
    let totalBytes = 0;
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        try {
          for (const file of await fsp.readdir(entryPath)) {
            try { totalBytes += (await fsp.stat(path.join(entryPath, file))).size; } catch { /* skip */ }
          }
        } catch { /* skip unreadable folder */ }
      } else {
        try { totalBytes += (await fsp.stat(entryPath)).size; } catch { /* skip */ }
      }
    }
    return { totalBytes, totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10 };
  }

  // Deletes snapshots older than retentionDays, then empty ticket folders, then
  // old drafts that have no snapshots left. 0 keeps everything.
  async function cleanup(retentionDays) {
    if (!retentionDays) return { skipped: true };
    await ensureDir();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deletedFiles = 0;
    let deletedDirs = 0;
    let prunedAutosaves = 0;

    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const ticketDir = path.join(dir, entry.name);
        for (const file of await fsp.readdir(ticketDir)) {
          if (!isSnapshotFile(file)) continue;
          const filePath = path.join(ticketDir, file);
          try {
            if ((await fsp.stat(filePath)).mtimeMs < cutoff) {
              await fsp.unlink(filePath);
              deletedFiles++;
            }
          } catch { /* skip files we can't stat/delete */ }
        }
        if ((await fsp.readdir(ticketDir)).length === 0) {
          try {
            await fsp.rmdir(ticketDir);
            deletedDirs++;
          } catch (e) {
            if (e.code !== "ENOTEMPTY") throw e;
          }
        }
      } catch { /* skip a locked folder, keep cleaning the rest */ }
    }

    await withAutosaveLock(async () => {
      try {
        const data = JSON.parse(await fsp.readFile(autosaveFile, "utf-8"));
        let changed = false;
        for (const [ticketId, info] of Object.entries(data)) {
          if (new Date(info.updatedAt || 0).getTime() >= cutoff) continue;
          let hasHistory = false;
          try {
            hasHistory = (await fsp.readdir(path.join(dir, ticketId))).some(isSnapshotFile);
          } catch { /* no history folder */ }
          if (!hasHistory) {
            delete data[ticketId];
            prunedAutosaves++;
            changed = true;
          }
        }
        if (changed) await writeAutosaveAtomic(data);
      } catch (e) {
        if (e.code !== "ENOENT") console.error("[NoteBackup] Error pruning autosaves:", e);
      }
    });

    return { deletedFiles, deletedDirs, prunedAutosaves };
  }

  // Synchronous, because it runs while the window is closing.
  function saveEditorStateSync(state) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(editorStateFile, JSON.stringify({ blankAtClose: !!(state && state.blankAtClose) }), "utf-8");
  }

  async function loadEditorState() {
    try {
      return JSON.parse(await fsp.readFile(editorStateFile, "utf-8"));
    } catch {
      return null;
    }
  }

  return {
    dir,
    saveNote,
    loadAutosave,
    getHistory,
    getAllTickets,
    deleteAutosave,
    deleteTicket,
    searchNotes,
    getSize,
    cleanup,
    saveEditorStateSync,
    loadEditorState,
  };
}

module.exports = {

  defaultSettings: {
    backupRetentionDays: 7,
    signatureHtml: "",
    ticketSortField: "lastUpdated",
    ticketSortDirection: "desc",
    noteTemplates: [],
    liveSyncEnabled: true,
    snapshotThreshold: 5,
    backupStorageWarningMb: 100,
  },

  validateSettings: function (s) {
    if (s.backupRetentionDays !== undefined &&
      (typeof s.backupRetentionDays !== "number" || s.backupRetentionDays < 0 || s.backupRetentionDays > 365)) return false;
    if (s.signatureHtml !== undefined && (typeof s.signatureHtml !== "string" || s.signatureHtml.length > 100000)) return false;
    if (s.ticketSortField !== undefined && !["lastUpdated", "ticketNumber"].includes(s.ticketSortField)) return false;
    if (s.ticketSortDirection !== undefined && !["asc", "desc"].includes(s.ticketSortDirection)) return false;
    if (s.liveSyncEnabled !== undefined && typeof s.liveSyncEnabled !== "boolean") return false;
    if (s.snapshotThreshold !== undefined &&
      (typeof s.snapshotThreshold !== "number" || s.snapshotThreshold < 1 || s.snapshotThreshold > 9999)) return false;
    if (s.backupStorageWarningMb !== undefined &&
      (typeof s.backupStorageWarningMb !== "number" || s.backupStorageWarningMb < 0 || s.backupStorageWarningMb > 100000)) return false;
    if (s.noteTemplates !== undefined) {
      if (!Array.isArray(s.noteTemplates) || s.noteTemplates.length > 50) return false;
      for (const tmpl of s.noteTemplates) {
        if (typeof tmpl !== "object" || tmpl === null || Array.isArray(tmpl)) return false;
        if (typeof tmpl.name !== "string" || tmpl.name.length === 0 || tmpl.name.length > 100) return false;
        if (typeof tmpl.content !== "string" || tmpl.content.length > 10000) return false;
      }
    }
    return true;
  },

  sanitizeTicketId,
  createNoteStore,

  init: function (api) {
    const electron = require("electron");
    const store = createNoteStore(path.join(electron.app.getPath("userData"), "note-backups"));

    api.handle("save-note", async function (data) {
      const result = await store.saveNote(data || {});
      if (result.success) api.emit("note:saved", { ticketId: result.ticketId, timestamp: result.timestamp });
      return result;
    });
    api.handle("load-autosave", () => store.loadAutosave());
    api.handle("get-history", (ticketId) => store.getHistory(ticketId));
    api.handle("get-all-tickets", () => store.getAllTickets());
    api.handle("delete-autosave", (ticketId) => store.deleteAutosave(ticketId));
    api.handle("delete-ticket", (ticketId) => store.deleteTicket(ticketId));
    api.handle("search-notes", (query) => store.searchNotes(query));
    api.handle("check-backup-size", async function () {
      try { return await store.getSize(); } catch (err) { return { error: err.message || String(err) }; }
    });
    api.handle("load-editor-state", () => store.loadEditorState());
    api.handle("open-backup-folder", async function () {
      await fsp.mkdir(store.dir, { recursive: true });
      const err = await electron.shell.openPath(store.dir);
      return err ? { success: false, error: err } : { success: true };
    });

    api.onMessage("save-editor-state", function (state) {
      try { store.saveEditorStateSync(state); } catch (e) {
        console.error("[NoteBackup] Error saving editor state:", e);
      }
    });

    // Clean up old snapshots shortly after startup, once settings have settled.
    setTimeout(async function () {
      const days = api.getSettings().backupRetentionDays;
      const retentionDays = typeof days === "number" ? days : 7;
      try {
        const result = await store.cleanup(retentionDays);
        if (result.skipped) {
          api.log("Retention set to 0 (keep forever), skipping cleanup");
        } else if (result.deletedFiles || result.deletedDirs || result.prunedAutosaves) {
          api.log(`Removed ${result.deletedFiles} old snapshot(s), ${result.deletedDirs} empty folder(s), ` +
            `${result.prunedAutosaves} stale draft(s) (older than ${retentionDays} days)`);
        }
      } catch (err) {
        console.error("[NoteBackup] Cleanup failed:", err);
      }
    }, 2000);
  },
};
