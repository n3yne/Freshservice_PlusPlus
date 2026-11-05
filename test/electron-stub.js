"use strict";

// Stand-in for the "electron" package in tests (mapped in package.json "jest").
// Electron 42 downloads its binary the first time the real package is required
// if it isn't there yet, which is always the case right after `npm ci` on CI.
// A bundled plugin's init requiring "electron" during a test then spent most of
// the test's 5 s timeout downloading. Tests that need specific Electron
// behaviour still mock it with jest.doMock("electron", ...).
const os = require("os");
const path = require("path");

const userData = path.join(os.tmpdir(), "msp-pp-test-userdata");

module.exports = {
  app: {
    getPath: () => userData,
    getVersion: () => "0.0.0-test",
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
};
