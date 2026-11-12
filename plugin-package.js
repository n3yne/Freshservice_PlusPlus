"use strict";

// Plugin packages (.mspplugin files): a plain zip of a plugin folder, with
// manifest.json at the top. Used by the plugin directory (plugin-directory.js)
// and by Settings > Plugins > Import Plugin File.
//
// This is a small, strict zip reader and writer built on Node's zlib, so the app
// needs no extra dependency. The reader only accepts what a plugin needs: plain
// files, stored or deflated, no encryption, no zip64, no links, no paths that
// could land outside the folder they are unpacked into.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;      // compressed .mspplugin file
const MAX_UNPACKED_BYTES = 20 * 1024 * 1024;    // all files once unpacked
const MAX_ENTRIES = 500;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

// ===================== CRC-32 =====================

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ===================== Paths =====================

// A zip entry name is safe when it is a relative path made of ordinary parts:
// no leading slash, no drive letter, no backslash, no "." or ".." parts.
function isSafeEntryName(name) {
  if (typeof name !== "string" || !name || name.length > 255) return false;
  if (name.includes("\\") || name.includes("\0") || name.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  const parts = name.replace(/\/$/, "").split("/");
  return parts.every(p => p && p !== "." && p !== ".." && !/[<>:"|?*]/.test(p) && !/[. ]$/.test(p));
}

// ===================== Reading =====================

// Returns [{ name, data }] for the files in a zip buffer (folders left out).
// Throws an Error with a readable message when the zip is broken or unsafe.
function readZip(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error("Not a plugin package");
  if (buf.length > MAX_PACKAGE_BYTES) throw new Error("Plugin package is too large");

  // End of central directory: in the last 22 + 65535 bytes.
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_END) { end = i; break; }
  }
  if (end < 0) throw new Error("Not a plugin package (not a zip file)");

  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("Plugin package uses zip64, which isn't supported");
  if (count > MAX_ENTRIES) throw new Error("Plugin package has too many files");
  if (cdOffset + cdSize > end) throw new Error("Plugin package is damaged");

  const files = [];
  const seen = new Set();
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error("Plugin package is damaged");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const madeBy = buf.readUInt16LE(p + 4) >> 8;
    const externalAttr = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new Error("Plugin package is encrypted");
    if (!isSafeEntryName(name)) throw new Error(`Plugin package has an unsafe file name: ${name}`);
    // Unix-made zips keep the file type in the top bits: only plain files and folders.
    if (madeBy === 3) {
      const type = (externalAttr >>> 16) & 0o170000;
      if (type && type !== 0o100000 && type !== 0o040000) throw new Error(`Plugin package has a link or special file: ${name}`);
    }
    if (name.endsWith("/")) continue; // folder entry

    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Plugin package lists a file twice: ${name}`);
    seen.add(key);

    total += size;
    if (total > MAX_UNPACKED_BYTES) throw new Error("Plugin package is too large once unpacked");

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error("Plugin package is damaged");
    }
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compSize > buf.length) throw new Error("Plugin package is damaged");
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new Error(`Plugin package is damaged: ${name}`);
      }
    } else {
      throw new Error(`Plugin package uses an unsupported compression method: ${name}`);
    }
    if (data.length !== size || crc32(data) !== crc) throw new Error(`Plugin package is damaged: ${name}`);
    files.push({ name, data });
  }
  return files;
}

// Packages made by zipping the folder itself (right-click > Compress) have every
// file under one top folder. Strip it so manifest.json is at the top.
function stripCommonFolder(files) {
  if (files.some(f => f.name === "manifest.json")) return files;
  const tops = new Set(files.map(f => f.name.split("/")[0]));
  if (tops.size !== 1 || files.some(f => !f.name.includes("/"))) return files;
  const top = [...tops][0] + "/";
  if (!files.some(f => f.name === top + "manifest.json")) return files;
  return files.map(f => ({ name: f.name.slice(top.length), data: f.data }));
}

// Reads a package and returns { manifest, files } without writing anything.
function readPackage(buf) {
  const files = stripCommonFolder(readZip(buf));
  const manifestFile = files.find(f => f.name === "manifest.json");
  if (!manifestFile) throw new Error("Plugin package has no manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.data.toString("utf8"));
  } catch {
    throw new Error("Plugin package's manifest.json isn't valid JSON");
  }
  if (!manifest || typeof manifest !== "object" || !manifest.id || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(manifest.id)) {
    throw new Error("Plugin package's manifest has an invalid or missing id");
  }
  return { manifest, files };
}

// Writes files into destDir (which must not exist yet), refusing anything that
// would land outside it.
function writeFiles(files, destDir) {
  const base = path.resolve(destDir) + path.sep;
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of files) {
    const target = path.resolve(destDir, f.name);
    if (!target.startsWith(base)) throw new Error(`Plugin package has an unsafe file name: ${f.name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
  }
}

// ===================== Writing =====================

// Builds a zip from [{ name, data }]. Entries get a fixed 1980-01-01 time stamp
// so the same files always give the same bytes (and the same SHA-256).
function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const sorted = entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { name, data } of sorted) {
    if (!isSafeEntryName(name)) throw new Error(`Unsafe file name: ${name}`);
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const method = useDeflate ? 8 : 0;
    const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Every file under dir as [{ name, data }], names with forward slashes. Skips
// dot-files (.DS_Store, .git) and anything that isn't a plain file or folder.
function collectFolder(dir) {
  const out = [];
  (function walk(rel) {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const relPath = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.isFile()) out.push({ name: relPath, data: fs.readFileSync(path.join(dir, relPath)) });
    }
  })("");
  return out;
}

function packFolder(dir) {
  return writeZip(collectFolder(dir));
}

module.exports = {
  MAX_PACKAGE_BYTES,
  MAX_UNPACKED_BYTES,
  crc32,
  isSafeEntryName,
  readZip,
  readPackage,
  writeFiles,
  writeZip,
  collectFolder,
  packFolder,
};
