"use strict";

// Imports note backups from ConnectWise Manage++, the app MSP++'s ConnectWise
// Manage support came from.
//
// CW++ kept its notes in the same layout as MSP++ (<userData>/note-backups:
// autosave.json plus a folder of snapshots per ticket), but under bare ticket
// numbers. MSP++ files ConnectWise tickets under "CW-<number>" so they can't
// collide with Freshservice ticket numbers, so the old backups don't show up
// on their own. This copies them across under the new keys.
//
// - The CW++ folder is only read, never changed.
// - Nothing in MSP++ is overwritten. When a ticket already has a draft in
//   MSP++, the CW++ draft is added to that ticket's history as a snapshot.
// - A record of what was imported (legacy-import.json) means a note deleted in
//   MSP++ doesn't come back on the next start, while notes still being written
//   in CW++ keep coming across.
// - Imported notes count as new for backup retention (snapshots get a fresh
//   file time, drafts an importedAt time), so the cleanup that runs at startup
//   doesn't delete old notes right after they arrive.

const path = require("path");
const fsp = require("fs").promises;

const SNAPSHOT_EXTENSIONS = [".html", ".txt"];
const MAX_NOTE_CHARS = 10 * 1024 * 1024;
const LEDGER_FILE = "legacy-import.json";

const LEGACY_SOURCES = [
  {
    id: "connectwise-manage-pp",
    name: "ConnectWise Manage++",
    // Electron names the data folder after the package name or the product name.
    dirNames: ["connectwise-manage-pp", "ConnectWise Manage++"],
    mapKey: mapConnectWiseKey,
  },
];

function sanitizeTicketId(raw) {
  return (raw || "no-ticket").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isSnapshotFile(name) {
  return SNAPSHOT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// CW++ key → MSP++ key. Ticket numbers get the "CW-" prefix the ConnectWise
// Manage plugin uses; anything else ("general", a typed label) keeps its name.
function mapConnectWiseKey(key) {
  const safe = sanitizeTicketId(key);
  return /^\d+$/.test(safe) ? "CW-" + safe : safe;
}

function timestampFileName(iso) {
  const d = new Date(iso);
  const stamp = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  return stamp.replace(/[:.]/g, "-") + ".html";
}

async function readJson(file) {
  try {
    const data = JSON.parse(await fsp.readFile(file, "utf-8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

// The note-backups folders of every legacy app found under appDataDir.
async function findLegacyNoteDirs(appDataDir, targetDir) {
  const found = [];
  for (const source of LEGACY_SOURCES) {
    for (const name of source.dirNames) {
      const dir = path.join(appDataDir, name, "note-backups");
      if (path.resolve(dir) === path.resolve(targetDir)) continue;
      if (await exists(dir)) {
        found.push({ source, dir });
        break; // both names point at the same folder on case-insensitive disks
      }
    }
  }
  return found;
}

// Writes content to dir/fileName without replacing an existing file. Returns
// false when the same content is already there.
async function writeNewFile(dir, fileName, content) {
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(fileName);
  const base = fileName.slice(0, -ext.length);
  for (let i = 0; i < 100; i++) {
    const name = i === 0 ? fileName : `${base}-cwpp${i > 1 ? i : ""}${ext}`;
    const target = path.join(dir, name);
    try {
      await fsp.writeFile(target, content, { encoding: "utf-8", flag: "wx" });
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if ((await fsp.readFile(target, "utf-8").catch(() => null)) === content) return false;
    }
  }
  throw new Error(`Too many files named like ${fileName}`);
}

// Copies one legacy folder into the store. `store` is the note store from
// createNoteStore (its updateAutosave runs under the store's write lock).
async function importFrom(source, legacyDir, store, ledger) {
  const record = ledger[source.id] || (ledger[source.id] = { drafts: {}, snapshots: {} });
  record.drafts = record.drafts || {};
  record.snapshots = record.snapshots || {};
  const result = { source: source.name, from: legacyDir, drafts: 0, draftsAsSnapshots: 0, snapshots: 0, tickets: new Set() };
  const now = new Date().toISOString();

  // 1. Drafts.
  const legacyDrafts = (await readJson(path.join(legacyDir, "autosave.json"))) || {};
  const pending = [];
  for (const [rawKey, info] of Object.entries(legacyDrafts)) {
    if (!info || typeof info.content !== "string" || info.content.length > MAX_NOTE_CHARS) continue;
    const legacyKey = sanitizeTicketId(rawKey);
    const stamp = String(info.updatedAt || "");
    if (record.drafts[legacyKey] === stamp) continue; // already imported this version
    pending.push({ legacyKey, key: source.mapKey(legacyKey), content: info.content, stamp });
  }
  if (pending.length) {
    const conflicts = [];
    await store.updateAutosave((data) => {
      for (const item of pending) {
        const current = data[item.key];
        if (current && current.content === item.content) {
          // Nothing new.
        } else if (current) {
          conflicts.push(item);
        } else {
          // Keeps its own date, so it doesn't jump to the top of the ticket list
          // or get restored as the latest draft. importedAt holds off the
          // retention cleanup (see cleanup in main.js).
          const t = new Date(item.stamp).getTime();
          const updatedAt = !isNaN(t) && t <= Date.now() ? new Date(t).toISOString() : now;
          data[item.key] = { content: item.content, updatedAt, importedAt: now };
          result.drafts++;
          result.tickets.add(item.key);
        }
      }
      return data;
    });
    for (const item of conflicts) {
      if (await writeNewFile(path.join(store.dir, item.key), timestampFileName(item.stamp), item.content)) {
        result.draftsAsSnapshots++;
        result.tickets.add(item.key);
      }
    }
    for (const item of pending) record.drafts[item.legacyKey] = item.stamp;
  }

  // 2. Snapshot folders.
  let entries = [];
  try { entries = await fsp.readdir(legacyDir, { withFileTypes: true }); } catch { /* unreadable */ }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const legacyKey = sanitizeTicketId(entry.name);
    if (legacyKey !== entry.name) continue; // not a folder CW++ made
    const key = source.mapKey(legacyKey);
    const done = new Set(record.snapshots[legacyKey] || []);
    let files;
    try { files = (await fsp.readdir(path.join(legacyDir, entry.name))).filter(isSnapshotFile); } catch { continue; }
    for (const file of files.sort()) {
      if (done.has(file)) continue;
      let content;
      try { content = await fsp.readFile(path.join(legacyDir, entry.name, file), "utf-8"); } catch { continue; }
      if (await writeNewFile(path.join(store.dir, key), file, content)) {
        result.snapshots++;
        result.tickets.add(key);
      }
      done.add(file);
    }
    if (done.size) record.snapshots[legacyKey] = [...done].sort();
  }

  return result;
}

// Finds legacy backups under appDataDir and imports anything new. Returns one
// summary per legacy app found.
async function importLegacyNotes(appDataDir, store) {
  const found = await findLegacyNoteDirs(appDataDir, store.dir);
  if (!found.length) return [];
  await fsp.mkdir(store.dir, { recursive: true });
  const ledgerPath = path.join(store.dir, LEDGER_FILE);
  const ledger = (await readJson(ledgerPath)) || {};
  const results = [];
  for (const { source, dir } of found) {
    try {
      const r = await importFrom(source, dir, store, ledger);
      results.push(Object.assign(r, { tickets: r.tickets.size }));
    } catch (err) {
      results.push({ source: source.name, from: dir, error: err.message || String(err) });
    }
  }
  const tmp = ledgerPath + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(ledger, null, 2), "utf-8");
  await fsp.rename(tmp, ledgerPath);
  return results;
}

module.exports = { importLegacyNotes, findLegacyNoteDirs, mapConnectWiseKey, LEGACY_SOURCES, LEDGER_FILE };
