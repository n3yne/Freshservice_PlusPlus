import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,

  // Main process + Node.js files
  {
    files: ["main.js", "preload.js", "launch.js", "utils.js", "updater.js", "webauthn.js", "permissions.js", "settings-transfer.js", "plugin-manager.js", "plugins/**/main.js", "plugins/ai-features/m365.js", "plugins/ai-features/http.js", "plugins/note-backup/legacy-import.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "off",
    },
  },

  // Renderer scripts (browser — no import/export, no Node globals)
  {
    files: ["renderer.js", "settings_renderer.js", "child-window.js", "plugins/**/renderer.js", "plugins/**/settings.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // Electron exposes this via contextBridge — not a standard browser global
        ClipboardItem: "readonly",
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "off",
    },
  },

  // Shared by the window (script tag) and the tests (require)
  {
    files: ["address-bar.js", "page-zoom.js", "safe-html.js", "tab-shortcuts.js", "plugins/tree-tabs/renderer.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, module: "writable" },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  // Tests
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },

  // Global ignores
  {
    ignores: ["node_modules/**", "dist/**", "docs/**"],
  },
];
