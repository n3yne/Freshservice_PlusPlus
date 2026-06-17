# Plugin Development Guide

ConnectWise Manage++ supports an external plugin system that lets you add new features without modifying the core application source. Plugins are self-contained directories dropped into a `plugins/` folder — no build step required.

---

## Table of Contents

1. [How plugins work](#how-plugins-work)
2. [Plugin structure](#plugin-structure)
3. [The manifest](#the-manifest)
4. [Main-process component (`main.js`)](#main-process-component-mainjs)
5. [Renderer component (`renderer.js`)](#renderer-component-rendererjs)
6. [Settings window component (`settings.js`)](#settings-window-component-settingsjs)
7. [Events reference](#events-reference)
8. [Complete API reference](#complete-api-reference)
9. [Installing plugins](#installing-plugins)
10. [Walkthrough: building a simple plugin](#walkthrough-building-a-simple-plugin)
11. [Troubleshooting](#troubleshooting)

---

## How plugins work

The plugin system has three tiers:

| Tier | File | What it can do |
|---|---|---|
| **Main process** | `main.js` | Register backend IPC handlers, react to app events, read/write files, add menu items |
| **Renderer** | `renderer.js` | Manipulate the main window UI, add toolbar buttons, inject DOM elements, open tabs |
| **Settings window** | `settings.js` | Add nav items and panels to the Settings window via `window.pluginSettingsAPI` |

A plugin can include any combination of these three components.

On startup the app scans the `plugins/` directories, loads each `main.js` inside the main Electron process, and injects each `renderer.js` as a `<script>` tag into the main window after settings have loaded. `settings.js` files are injected into the Settings window after `window.pluginSettingsAPI` has been constructed.

---

## Plugin structure

```
my-plugin/
  manifest.json     ← required
  main.js           ← optional, runs in the main process
  renderer.js       ← optional, runs in the main renderer window
  settings.js       ← optional, runs in the settings window
  data/             ← any supporting files your plugin needs
```

All three script files are optional — a plugin can include any combination.

---

## The manifest

Every plugin must have a `manifest.json` at its root:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "One-line description of what this plugin does.",
  "author": "Your Name",
  "main": "main.js",
  "renderer": "renderer.js",
  "minAppVersion": "0.2.2"
}
```

### Fields

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique identifier. Must match `/^[a-z0-9][a-z0-9_-]{0,62}$/`. Used as an IPC namespace and data directory name. |
| `name` | No | Human-readable display name. |
| `version` | No | Plugin version string (semver recommended). |
| `description` | No | One-line summary. |
| `author` | No | Plugin author name. |
| `main` | No | Relative path to the main-process entry file. |
| `renderer` | No | Relative path to the main-window renderer entry file. |
| `settings` | No | Relative path to the settings-window entry file. |
| `minAppVersion` | No | Minimum app version required. Plugins below this threshold are skipped with a warning. |

> **ID rules:** Use only lowercase letters, digits, hyphens, and underscores. Path-traversal characters (`../`, `/`, `\`) cause the plugin to be rejected at load time.

---

## Main-process component (`main.js`)

The main-process file must export a function (or an object with an `init` method) that receives the plugin API object:

```js
"use strict";

// Export a function — called once when the app starts
module.exports = function (api) {
  api.log("Plugin loaded");

  // Register an IPC handler callable from the renderer
  api.handle("do-something", async function (data) {
    // data is whatever the renderer passed to window.pluginAPI.invoke()
    return { result: "ok", received: data };
  });

  // React to app events
  api.on("note:saved", function (data) {
    api.log("Note saved for ticket:", data.ticketId);
  });
};
```

Alternatively, export an object with an `init` method:

```js
module.exports = {
  init(api) {
    api.log("Plugin ready");
  },
};
```

### Main-process API reference

The `api` object passed to your plugin:

#### `api.handle(action, asyncFn)`

Registers a backend IPC handler that renderer code can call via `window.pluginAPI.invoke()`.

- `action` — string, must match `/^[a-z0-9_-]+$/i`
- `asyncFn(data)` — async function; `data` is the value passed from the renderer
- The channel is automatically namespaced as `plugin:<id>:<action>`, so there are no collisions between plugins

```js
api.handle("get-report", async function (data) {
  const report = await buildReport(data.ticketId);
  return { report };
});
```

#### `api.on(eventName, fn)`

Subscribes to an app-level event. See [Events reference](#events-reference) for available events.

```js
api.on("settings:changed", function (settings) {
  if (settings.theme === "light") {
    api.log("Light mode enabled");
  }
});
```

#### `api.getDataPath()`

Returns the absolute path to a writable directory for this plugin: `<userData>/plugins/<id>/`. The directory is created automatically on first call.

```js
const fs = require("fs");
const path = require("path");

const dataDir = api.getDataPath();
const filePath = path.join(dataDir, "cache.json");
fs.writeFileSync(filePath, JSON.stringify({ ts: Date.now() }));
```

> **Note:** The main-process API does not expose `fs`, `path`, or `require` — you use Node's built-in `require()` inside your `main.js` directly, just like any Node module.

#### `api.getSettings()`

Returns a deep-frozen snapshot of the current app settings object.

```js
const settings = api.getSettings();
api.log("Current theme:", settings.theme);
```

#### `api.addMenuItem(opts)`

Adds an item to the **Edit** menu. Maximum 10 items total across all plugins.

```js
api.addMenuItem({
  label: "My Plugin Action",
  accelerator: "Ctrl+Shift+M",   // optional
  click: function () {
    api.log("Menu item clicked");
  },
});
```

#### `api.log(...args)`

Logs a message to the console with a `[Plugin:<id>]` prefix.

```js
api.log("Hello", { from: "my-plugin" });
// → [Plugin:my-plugin] Hello { from: 'my-plugin' }
```

---

## Renderer component (`renderer.js`)

The renderer file is a plain browser-environment script. It has no `module.exports` — it runs directly in the renderer window and can access `window.pluginAPI`.

```js
(function () {
  // Always wrap in an IIFE to avoid polluting the global scope

  window.pluginAPI.events.on("note:saved", function (data) {
    console.log("[my-plugin] Note saved:", data.ticketId);
  });

  // Add a toolbar button to the note panel
  window.pluginAPI.ui.addToolbarButton({
    id: "my-action",
    label: "Go",
    title: "Run my plugin action",
    onClick: async function () {
      const result = await window.pluginAPI.invoke("my-plugin", "do-something", {
        ticketId: window.pluginAPI.notes.getTicketId(),
      });
      console.log("[my-plugin] Result:", result);
    },
  });
})();
```

> **When does it run?** Renderer scripts are injected after the app has fully loaded settings and constructed `window.pluginAPI`. This means `app:ready` has already fired by the time your script starts executing. Register your `events.on()` listeners at the top level (not inside a callback) so they're ready immediately.

### Renderer API reference (`window.pluginAPI`)

#### `window.pluginAPI.events`

An in-process event bus shared between the app and all loaded plugins.

| Method | Description |
|---|---|
| `events.on(name, fn)` | Subscribe to an event. Returns an unsubscribe function. |
| `events.off(name, fn)` | Unsubscribe a specific handler. |
| `events.emit(name, data)` | Publish a custom event (useful for cross-plugin communication). |

```js
// Subscribe
const unsub = window.pluginAPI.events.on("ticket:changed", function (data) {
  console.log("Now on ticket:", data.ticketId);
});

// Unsubscribe later
unsub();

// Emit a custom event for other plugins
window.pluginAPI.events.emit("my-plugin:did-thing", { value: 42 });
```

#### `window.pluginAPI.invoke(pluginId, action, data)`

Calls a handler registered by `api.handle()` in the main process. Returns a `Promise`.

```js
const result = await window.pluginAPI.invoke("my-plugin", "get-report", {
  ticketId: "12345",
});
console.log(result.report);
```

> Only handlers your plugin registered are reachable. Calling an unregistered `action` rejects the Promise.

#### `window.pluginAPI.ui.addToolbarButton(opts)`

Appends a button to the note editor toolbar. Returns the button element.

```js
window.pluginAPI.ui.addToolbarButton({
  id: "my-btn",          // optional, used for the element id
  label: "📋 Copy All", // button text
  title: "Copy all note content to clipboard",  // tooltip
  onClick: function () {
    const text = window.pluginAPI.notes.getPlainText();
    navigator.clipboard.writeText(text);
  },
});
```

#### `window.pluginAPI.notes`

Read and write the current note editor content.

| Method | Returns | Description |
|---|---|---|
| `notes.getContent()` | `string` | Current editor content as HTML |
| `notes.setContent(html)` | — | Replace editor content and schedule an autosave |
| `notes.getTicketId()` | `string \| null` | Current ticket ID, or `null` if none set |
| `notes.getPlainText()` | `string` | Editor content stripped of HTML tags |
| `notes.saveSnapshot(incomingText)` | `Promise<void>` | Saves a snapshot of the current editor content if it differs enough from the last snapshot (respects the configured snapshot threshold). Call this before overwriting the editor with bulk-imported or AI-generated content so the previous note can be recovered from history. |

```js
// Append a timestamp to the note
const existing = window.pluginAPI.notes.getContent();
window.pluginAPI.notes.setContent(existing + "<br><em>Updated: " + new Date().toLocaleString() + "</em>");
```

#### `window.pluginAPI.getSettings()`

Returns a shallow copy of the current app settings object.

```js
const settings = window.pluginAPI.getSettings();
if (settings.theme === "dark") {
  // adjust your UI for dark mode
}
```

#### `window.pluginAPI.browser`

Interacts with the app's tab system and the active webview.

| Method | Returns | Description |
|---|---|---|
| `browser.newTab(url)` | — | Opens `url` in a new tab and switches to it |
| `browser.executeInActiveTab(script)` | `Promise<any>` | Runs a JavaScript string in the active webview and returns its result. Rejects if no tab is open. |

```js
window.pluginAPI.browser.newTab("https://my-dashboard.example.com");

// Read text from the active page
const heading = await window.pluginAPI.browser.executeInActiveTab(
  "document.querySelector('h1')?.innerText || ''"
);
```

---

## Settings window component (`settings.js`)

The settings file is a plain browser-environment script injected into the Settings window. Use it to add a nav item and content panel to the Settings UI.

```js
(function () {
  // Guard: this script is only meaningful in the settings window
  if (!window.pluginSettingsAPI) return;

  window.pluginSettingsAPI.addPanel("options", "My Plugin", function (panel) {
    // Populate the panel with your settings UI
    panel.innerHTML =
      '<div class="settings-section">' +
      '<h3 class="settings-section-title">My Plugin</h3>' +
      '<label class="settings-toggle">' +
      '<input type="checkbox" id="plugin-my-enabled" />' +
      '<span class="settings-toggle-slider"></span>' +
      '<span class="settings-toggle-label">Enable feature</span>' +
      '</label>' +
      '</div>';

    const checkbox = panel.querySelector("#plugin-my-enabled");

    function populate(settings) {
      checkbox.checked = !!settings.myPluginEnabled;
    }

    // Seed form from current settings
    populate(window.pluginSettingsAPI.getSettings());

    // Keep form in sync when settings change externally
    window.pluginSettingsAPI.onSettingsChanged(populate);

    checkbox.addEventListener("change", function () {
      window.pluginSettingsAPI.saveSettings({ myPluginEnabled: checkbox.checked });
    });
  });
})();
```

> **Always guard with `if (!window.pluginSettingsAPI) return;`** — the API only exists in the settings window. Your `settings.js` will not run in the main window, but defensive coding here costs nothing.

> **ID namespacing:** Use a `plugin-` prefix on element IDs (e.g. `plugin-my-enabled`) to avoid collisions with core settings element IDs.

### Settings window API (`window.pluginSettingsAPI`)

#### `pluginSettingsAPI.addPanel(id, label, setupFn)`

Adds a nav button and a content panel `<div>` to the Settings window.

- `id` — string; the panel element gets `id="panel-plugin-<id>"`
- `label` — text shown in the left-hand nav button
- `setupFn(panel)` — called once immediately with the empty panel `HTMLElement`; populate and attach listeners here

#### `pluginSettingsAPI.getSettings()`

Returns a shallow copy of the current app settings object.

#### `pluginSettingsAPI.saveSettings(patch)`

Merges `patch` into the current settings and writes to disk. The main window receives a `settings:changed` event immediately.

```js
window.pluginSettingsAPI.saveSettings({ myPluginEnabled: true, myPluginThreshold: 10 });
```

#### `pluginSettingsAPI.onSettingsChanged(fn)`

Registers a callback that fires whenever settings are saved — from any window. Use it to keep your panel's form fields in sync.

```js
window.pluginSettingsAPI.onSettingsChanged(function (settings) {
  checkbox.checked = !!settings.myPluginEnabled;
});
```

---

## Events reference

These events are emitted on both the main-process bus (`api.on()`) and the renderer bus (`events.on()`):

| Event | Payload | When |
|---|---|---|
| `app:ready` | `{}` | App has fully initialized and settings are loaded |
| `note:saved` | `{ ticketId: string, timestamp: string }` | An autosave completed successfully |
| `ticket:changed` | `{ ticketId: string, previous: string \| null }` | The active ticket switched |
| `settings:changed` | settings object | Settings were saved from the Settings window |

> **`app:ready` timing:** Main-process plugins receive `app:ready` during `initPlugins()`, before the renderer window opens. Renderer scripts are injected after `app:ready` has already fired, so there is no need to wait for it in your renderer script.

---

## Complete API reference

### Main-process (`api` object)

```ts
api.handle(action: string, fn: (data: any) => Promise<any>): void
api.on(event: "note:saved" | "ticket:changed" | "settings:changed" | "app:ready", fn: (data: any) => void): void
api.getDataPath(): string
api.getSettings(): Readonly<AppSettings>
api.addMenuItem(opts: { label: string, accelerator?: string, click: () => void }): void
api.log(...args: any[]): void
```

### Renderer (`window.pluginAPI`)

```ts
pluginAPI.events.on(name: string, fn: (data: any) => void): () => void
pluginAPI.events.off(name: string, fn: (data: any) => void): void
pluginAPI.events.emit(name: string, data: any): void

pluginAPI.invoke(pluginId: string, action: string, data?: any): Promise<any>

pluginAPI.ui.addToolbarButton(opts: {
  id?: string,
  label: string,
  title?: string,
  onClick: () => void,
}): HTMLButtonElement

pluginAPI.notes.getContent(): string
pluginAPI.notes.setContent(html: string): void
pluginAPI.notes.getTicketId(): string | null
pluginAPI.notes.getPlainText(): string
pluginAPI.notes.saveSnapshot(incomingText: string): Promise<void>

pluginAPI.browser.newTab(url: string): void
pluginAPI.browser.executeInActiveTab(script: string): Promise<any>

pluginAPI.getSettings(): AppSettings
```

### Settings window (`window.pluginSettingsAPI`)

```ts
pluginSettingsAPI.addPanel(
  id: string,
  label: string,
  setupFn: (panel: HTMLElement) => void
): void

pluginSettingsAPI.getSettings(): AppSettings
pluginSettingsAPI.saveSettings(patch: Partial<AppSettings>): void
pluginSettingsAPI.onSettingsChanged(fn: (settings: AppSettings) => void): void
```

---

## Installing plugins

### Bundled plugins (version-controlled)

Place your plugin directory inside the `plugins/` folder at the root of the project:

```
ConnectWise_Manage_PlusPlus/
  plugins/
    my-plugin/
      manifest.json
      main.js
      renderer.js
```

These plugins ship with the app and are loaded for all users.

### User-installed plugins

**Option A — Import via the UI (recommended)**

1. Open **Settings → Plugins**
2. Click **Import Plugin** and select your plugin folder in the file dialog
3. The app copies it into the user data directory and confirms the name; restart to activate

If a plugin with the same `id` is already installed, the import is blocked and an error is shown — remove the existing plugin first.

**Option B — Copy manually**

Drop the plugin directory into the app's data folder. You can open it from within the app via **📁 Open Folder** in the note panel, then navigate up one level:

```
%APPDATA%\connectwise-manage-pp\plugins\
  my-plugin\
    manifest.json
    main.js
    renderer.js
```

Plugins in both locations are loaded on every launch. User-installed plugins survive app updates.

> **Restart required.** Plugins are loaded once at startup. Add, remove, or update a plugin, then restart the app for changes to take effect.

---

## Walkthrough: building a simple plugin

This walkthrough builds a plugin that adds a **"Word Count"** button to the toolbar. Clicking it shows the current word count in the note.

### Step 1 — Create the directory

```
plugins/
  word-count/
```

### Step 2 — Write the manifest

`plugins/word-count/manifest.json`:
```json
{
  "id": "word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "description": "Shows a word count for the current note.",
  "renderer": "renderer.js",
  "minAppVersion": "0.2.2"
}
```

This plugin only needs a renderer script — no main-process work required.

### Step 3 — Write the renderer script

`plugins/word-count/renderer.js`:
```js
(function () {
  function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  window.pluginAPI.ui.addToolbarButton({
    id: "word-count-btn",
    label: "Wc",
    title: "Show word count",
    onClick: function () {
      const text  = window.pluginAPI.notes.getPlainText();
      const count = countWords(text);
      alert("Word count: " + count);
    },
  });
})();
```

### Step 4 — Restart and test

1. Restart the app (`npm start` or the packaged executable)
2. Open a note — a **Wc** button appears at the end of the toolbar
3. Click it — an alert shows the word count

### Going further

To make it interactive instead of using `alert`, you could:
- Render a count into a small `<span>` appended near the toolbar
- Update the count live using `events.on("note:saved", ...)`
- Store a word-count history using `api.getDataPath()` in a `main.js` entry

---

## Troubleshooting

**Plugin doesn't load**
- Check that `manifest.json` exists and contains a valid `id` field
- Open DevTools (`Ctrl+Shift+I`) and look for `[PluginManager]` lines in the console
- Ensure `minAppVersion` is not higher than the running app version

**Main-process errors**
- Syntax errors in `main.js` are caught and logged: look for `[PluginManager] Failed to load plugin "<id>"` in the console
- A failed `main.js` also prevents the renderer script from loading

**Renderer script not running**
- Look for `[Plugin loader] Failed to load:` errors in the renderer console (DevTools)
- Verify the `renderer` field in `manifest.json` matches the actual filename

**IPC handler not found**
- `window.pluginAPI.invoke()` rejects if the handler was never registered — check that your `main.js` calls `api.handle("action", ...)` with the exact action name you're invoking

**`window.pluginAPI` is undefined**
- Renderer scripts are injected after settings load. If you're testing from the DevTools console immediately on page load, the API may not yet be constructed — wait for the `DOMContentLoaded` cycle to complete

**Data directory not created**
- `api.getDataPath()` creates the directory on first call. Make sure you call it before attempting to read or write files in it.
