import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,

  // Main process + Node.js files
  {
    files: ["main.js", "preload.js", "launch.js", "utils.js", "plugin-manager.js", "plugins/**/main.js"],
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
    files: ["renderer.js", "settings_renderer.js", "plugins/**/renderer.js"],
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
    ignores: ["node_modules/**", "dist/**"],
  },
];
