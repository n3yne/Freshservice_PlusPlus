"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { readPluginManifests, checkManifests, buildDirectory } = require("../scripts/build-plugin-directory");
const PluginDirectory = require("../plugin-directory");
const PluginPackage = require("../plugin-package");
const pkg = require("../package.json");

const quiet = { warn: () => {}, error: () => {}, log: () => {} };

function makeRoot(plugins) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mspp-build-"));
  for (const [folder, manifest, files = {}] of plugins) {
    const dir = path.join(root, "plugins", folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  }
  return root;
}

describe("plugin manifests in this repo", () => {
  const plugins = readPluginManifests();

  test("have valid distribution and requires fields", () => {
    expect(checkManifests(plugins)).toEqual([]);
  });

  test("directory plugins are left out of the app build, bundled ones are packed", () => {
    const excluded = new Set(pkg.build.files
      .filter((f) => /^!plugins\/[^/]+\/\*\*$/.test(f))
      .map((f) => f.slice("!plugins/".length, -"/**".length)));
    const directory = plugins.filter((p) => p.distribution === "directory").map((p) => p.folder).sort();
    expect([...excluded].sort()).toEqual(directory);
    expect(pkg.build.files).toContain("plugins/**/*");
  });
});

describe("checkManifests", () => {
  test("reports bad distribution values, unknown requirements and missing directory fields", () => {
    const problems = checkManifests([
      { folder: "a", manifest: { id: "a", distribution: "elsewhere" }, distribution: "bundled" },
      { folder: "b", manifest: { id: "b", requires: ["nope", "b"] }, distribution: "bundled" },
      { folder: "c", manifest: { id: "c-other", distribution: "directory", version: "1.0" }, distribution: "directory" },
    ]);
    expect(problems.join("\n")).toMatch(/a: "distribution" must be/);
    expect(problems.join("\n")).toMatch(/b: requires "nope"/);
    expect(problems.join("\n")).toMatch(/b: requires itself/);
    expect(problems.join("\n")).toMatch(/c: folder name must match/);
    expect(problems.join("\n")).toMatch(/c: directory plugins need a version/);
    expect(problems.join("\n")).toMatch(/c: directory plugins need a name and description/);
    expect(problems.join("\n")).toMatch(/c: directory plugins need a category/);
  });
});

describe("buildDirectory", () => {
  const root = makeRoot([
    ["core-thing", { id: "core-thing", name: "Core", version: "1.0.0", description: "Stays bundled", category: "Tickets" }],
    ["extra-thing", {
      id: "extra-thing", name: "Extra", version: "2.1.0", description: "From the directory", category: "tickets",
      distribution: "directory", requires: ["core-thing"], minAppVersion: "0.8.0", renderer: "renderer.js",
    }, { "renderer.js": "console.log('hi');" }],
  ]);

  test("packages only directory plugins, with an index the app accepts", () => {
    const outDir = path.join(root, "out");
    const index = buildDirectory({ root, outDir });
    expect(index.plugins.map((p) => p.id)).toEqual(["extra-thing"]);
    const entry = index.plugins[0];
    expect(entry).toMatchObject({ category: "Tickets", version: "2.1.0", requires: ["core-thing"], minAppVersion: "0.8.0", url: "extra-thing-2.1.0.mspplugin" });

    const buf = fs.readFileSync(path.join(outDir, entry.url));
    expect(buf.length).toBe(entry.size);
    expect(crypto.createHash("sha256").update(buf).digest("hex")).toBe(entry.sha256);
    expect(PluginPackage.readPackage(buf).manifest.id).toBe("extra-thing");

    const written = JSON.parse(fs.readFileSync(path.join(outDir, "index.json"), "utf8"));
    const parsed = PluginDirectory.parseIndex(written, PluginDirectory.DEFAULT_INDEX_URL, quiet);
    expect(parsed.plugins.map((p) => p.id)).toEqual(["extra-thing"]);
  });

  test("gives the same bytes when nothing changed", () => {
    const a = buildDirectory({ root, outDir: path.join(root, "out-a") }).plugins[0].sha256;
    const b = buildDirectory({ root, outDir: path.join(root, "out-b") }).plugins[0].sha256;
    expect(a).toBe(b);
  });

  test("refuses to build when a manifest has problems", () => {
    const bad = makeRoot([["x", { id: "x", distribution: "directory" }]]);
    expect(() => buildDirectory({ root: bad, outDir: path.join(bad, "out") })).toThrow(/problems/);
  });
});
