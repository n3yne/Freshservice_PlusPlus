"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const PluginPackage = require("../plugin-package");

const manifest = { id: "pkg-test", name: "Package test", version: "1.2.3", main: "main.js" };

function sampleFiles() {
  return [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: "main.js", data: Buffer.from("module.exports = function () {};\n".repeat(20)) },
    { name: "lib/util.js", data: Buffer.from("exports.x = 1;") },
  ];
}

// Hand-built single-entry zip, so tests can put in names and flags the writer refuses.
function rawZip(name, data, { madeBy = 20, externalAttr = 0, flags = 0x800 } = {}) {
  const nameBuf = Buffer.from(name, "utf8");
  const crc = PluginPackage.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(madeBy, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(externalAttr, 38);
  central.writeUInt32LE(0, 42);
  const cdOffset = 30 + nameBuf.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

describe("plugin-package", () => {
  test("writeZip and readZip round-trip, deflating where it helps", () => {
    const zip = PluginPackage.writeZip(sampleFiles());
    const files = PluginPackage.readZip(zip);
    expect(files.map((f) => f.name).sort()).toEqual(["lib/util.js", "main.js", "manifest.json"]);
    expect(files.find((f) => f.name === "main.js").data.toString()).toContain("module.exports");
    // Same files give the same bytes, so the directory's SHA-256 is stable.
    expect(PluginPackage.writeZip(sampleFiles().reverse()).equals(zip)).toBe(true);
  });

  test("the CRC-32 matches zlib's", () => {
    const buf = Buffer.from("The quick brown fox jumps over the lazy dog");
    expect(PluginPackage.crc32(buf)).toBe(zlib.crc32 ? zlib.crc32(buf) : 0x414fa339);
  });

  test("readPackage returns the manifest, and strips one wrapping folder", () => {
    const wrapped = sampleFiles().map((f) => ({ name: "pkg-test/" + f.name, data: f.data }));
    const { manifest: m, files } = PluginPackage.readPackage(PluginPackage.writeZip(wrapped));
    expect(m.id).toBe("pkg-test");
    expect(files.map((f) => f.name)).toContain("lib/util.js");
  });

  test("readPackage refuses packages without a valid manifest", () => {
    expect(() => PluginPackage.readPackage(PluginPackage.writeZip([{ name: "main.js", data: Buffer.from("") }])))
      .toThrow(/no manifest/);
    expect(() => PluginPackage.readPackage(PluginPackage.writeZip([{ name: "manifest.json", data: Buffer.from("{") }])))
      .toThrow(/valid JSON/);
    expect(() => PluginPackage.readPackage(PluginPackage.writeZip([
      { name: "manifest.json", data: Buffer.from(JSON.stringify({ id: "../evil" })) },
    ]))).toThrow(/invalid or missing id/);
  });

  test.each([
    "../evil.js",
    "a/../../evil.js",
    "/etc/passwd",
    "C:/Windows/evil.js",
    "a\\..\\evil.js",
    "con:",
  ])("refuses the unsafe entry name %s", (name) => {
    expect(() => PluginPackage.readZip(rawZip(name, Buffer.from("x")))).toThrow(/unsafe file name/);
  });

  test("refuses symlinks, encrypted entries and non-zips", () => {
    const link = rawZip("link.js", Buffer.from("/etc/passwd"), { madeBy: (3 << 8) | 20, externalAttr: (0o120777 << 16) >>> 0 });
    expect(() => PluginPackage.readZip(link)).toThrow(/link or special file/);
    expect(() => PluginPackage.readZip(rawZip("a.js", Buffer.from("x"), { flags: 0x801 }))).toThrow(/encrypted/);
    expect(() => PluginPackage.readZip(Buffer.from("not a zip at all, just some text here"))).toThrow(/not a zip/);
  });

  test("refuses a damaged file (CRC mismatch)", () => {
    const zip = rawZip("a.js", Buffer.from("hello"));
    zip[30 + "a.js".length] = "j".charCodeAt(0); // first byte of the data
    expect(() => PluginPackage.readZip(zip)).toThrow(/damaged/);
  });

  test("refuses packages over the size limit", () => {
    expect(() => PluginPackage.readZip(Buffer.alloc(PluginPackage.MAX_PACKAGE_BYTES + 1))).toThrow(/too large/);
  });

  test("packFolder skips dot-files, and writeFiles unpacks into a new folder", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "mspp-pack-"));
    for (const f of sampleFiles()) {
      fs.mkdirSync(path.dirname(path.join(src, f.name)), { recursive: true });
      fs.writeFileSync(path.join(src, f.name), f.data);
    }
    fs.writeFileSync(path.join(src, ".DS_Store"), "junk");
    const { files } = PluginPackage.readPackage(PluginPackage.packFolder(src));
    expect(files.map((f) => f.name)).not.toContain(".DS_Store");

    const dest = path.join(src, "out");
    PluginPackage.writeFiles(files, dest);
    expect(fs.readFileSync(path.join(dest, "lib", "util.js"), "utf8")).toBe("exports.x = 1;");
  });
});
