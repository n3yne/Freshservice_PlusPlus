"use strict";

// Builds the plugin directory: one .mspplugin package per plugin whose manifest
// says "distribution": "directory", plus index.json listing them with their
// SHA-256 and size. .github/workflows/plugins.yml runs this and uploads the
// result to the "plugin-directory" release, where the app reads it
// (plugin-directory.js).
//
//   node scripts/build-plugin-directory.js [outDir]     (default: dist-plugins)
//
// Packages are byte-for-byte the same for the same files, so rebuilding an
// unchanged plugin gives the same SHA-256.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PluginPackage = require("../plugin-package");
const PluginCategories = require("../plugin-categories");

const ROOT = path.join(__dirname, "..");
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

// Every plugin folder's manifest, with its distribution ("bundled" when not set).
function readPluginManifests(root = ROOT) {
  const dir = path.join(root, "plugins");
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, e.name, "manifest.json"), "utf8"));
      return {
        folder: e.name,
        dir: path.join(dir, e.name),
        manifest,
        distribution: manifest.distribution === "directory" ? "directory" : "bundled",
      };
    })
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
}

// Problems that would make a broken directory: returns a list of messages.
function checkManifests(plugins) {
  const problems = [];
  const ids = new Set(plugins.map((p) => p.manifest.id));
  for (const p of plugins) {
    const m = p.manifest;
    if (m.distribution !== undefined && m.distribution !== "bundled" && m.distribution !== "directory") {
      problems.push(`${p.folder}: "distribution" must be "bundled" or "directory"`);
    }
    if (m.requires !== undefined) {
      if (!Array.isArray(m.requires) || !m.requires.every((r) => typeof r === "string" && ID_PATTERN.test(r))) {
        problems.push(`${p.folder}: "requires" must be a list of plugin ids`);
      } else {
        for (const r of m.requires) {
          if (r === m.id) problems.push(`${p.folder}: requires itself`);
          else if (!ids.has(r)) problems.push(`${p.folder}: requires "${r}", which isn't a plugin in this repo`);
        }
      }
    }
    if (p.distribution === "directory") {
      if (m.id !== p.folder) problems.push(`${p.folder}: folder name must match the id "${m.id}" for directory plugins`);
      if (!/^\d+\.\d+\.\d+$/.test(m.version || "")) problems.push(`${p.folder}: directory plugins need a version like 1.2.3`);
      if (!m.name || !m.description) problems.push(`${p.folder}: directory plugins need a name and description`);
      if (!m.site && !PluginCategories.normalizeCategory(m.category)) problems.push(`${p.folder}: directory plugins need a category`);
    }
  }
  return problems;
}

function buildDirectory({ root = ROOT, outDir = path.join(ROOT, "dist-plugins") } = {}) {
  const plugins = readPluginManifests(root);
  const problems = checkManifests(plugins);
  if (problems.length) throw new Error("Plugin manifests have problems:\n  " + problems.join("\n  "));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const entries = [];
  for (const p of plugins.filter((x) => x.distribution === "directory")) {
    const m = p.manifest;
    const buf = PluginPackage.packFolder(p.dir);
    if (buf.length > PluginPackage.MAX_PACKAGE_BYTES) throw new Error(`${m.id} is over the package size limit`);
    PluginPackage.readPackage(buf); // the app must be able to read it back
    const file = `${m.id}-${m.version}.mspplugin`;
    fs.writeFileSync(path.join(outDir, file), buf);
    const entry = {
      id: m.id,
      name: m.name,
      description: m.description,
      category: m.site ? "Sites" : PluginCategories.normalizeCategory(m.category),
      version: m.version,
      requires: Array.isArray(m.requires) ? m.requires : [],
      url: file,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      size: buf.length,
    };
    if (m.minAppVersion) entry.minAppVersion = m.minAppVersion;
    if (m.site) entry.site = true;
    if (typeof m.changelog === "string" && m.changelog.trim()) entry.changelog = m.changelog.trim();
    entries.push(entry);
  }

  const index = { schema: 1, plugins: entries };
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

if (require.main === module) {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, "dist-plugins"));
  try {
    const index = buildDirectory({ outDir });
    console.log(`Built ${index.plugins.length} plugin package(s) in ${outDir}:`);
    for (const e of index.plugins) console.log(`  ${e.url}  ${e.size} bytes  sha256 ${e.sha256}`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { readPluginManifests, checkManifests, buildDirectory };
