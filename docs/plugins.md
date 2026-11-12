# Plugin Development Guide

MSP++ supports an external plugin system that lets you add new features without modifying the core application source. Plugins are self-contained directories dropped into a `plugins/` folder — no build step required.

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
| **Renderer** | `renderer.js` | Add side panel tabs and toolbar buttons, show notifications, manipulate the main window UI, open tabs |
| **Settings window** | `settings.js` | Add nav items and panels to the Settings window via `window.pluginSettingsAPI` |

A plugin can include any combination of these three components.

On startup the app scans the `plugins/` directories, loads each `main.js` inside the main Electron process, and injects each `renderer.js` as a `<script>` tag into the main window after settings have loaded. Renderer scripts run one after another in folder order (bundled plugins first, alphabetically), so don't rely on a plugin that sorts after yours having run yet: use events or `notes.onReady()` instead. `settings.js` files are injected into the Settings window after `window.pluginSettingsAPI` has been constructed.

Notes themselves are a plugin too: the bundled **Note Backup** plugin (`plugins/note-backup`) owns the Notes tab, its files on disk and live sync with the page's note editor, and backs `pluginAPI.notes` for everyone else. It is a good reference for a larger plugin.

Support for a ticketing site is a plugin as well. The core app knows nothing about Freshservice: the bundled **Freshservice** plugin (`plugins/freshservice`) declares its hosts in a manifest `"site"` block and registers a **site adapter** with `pluginAPI.sites` (ticket detection, note editor sync scripts, record reading, knowledge base). Note Backup, AI Features and Solutions Chat work through whichever adapter claims the page in a tab. To add another site, see **[Site Plugins](sites.md)**.

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
| `site` | No | Makes this a site plugin: `{ name, shortName?, hosts, defaultUrl?, chromeUserAgent? }`. See [Site Plugins](sites.md). |
| `credentials` | No | Setting names that hold secrets, e.g. `["myApiKey"]` (`/^[a-z][A-Za-z0-9]{0,40}$/`). Your settings transformer should encrypt `myApiKey` with `api.encryptCredential` into `myApiKeyEncrypted` and delete the plain value. The app then keeps the encrypted value out of renderer processes (they see a `myApiKeySet` boolean instead), preserves it across saves that don't include a new key, refuses to save a new key it can't encrypt, and deletes it when settings are saved with `myApiKeyRemove: true`. |

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

#### `api.onMessage(action, fn)`

Registers a fire-and-forget handler for messages sent with `window.pluginAPI.send()`. Nothing is returned to the renderer, but the message is still delivered while the window is closing, so this is the place for `beforeunload` saves (use synchronous `fs` calls inside `fn`).

```js
api.onMessage("save-state", function (state) {
  fs.writeFileSync(path.join(api.getDataPath(), "state.json"), JSON.stringify(state));
});
```

#### `api.emit(eventName, data)`

Publishes an event to every main-process plugin's `api.on()` listeners. The Note Backup plugin uses it to fire `note:saved`.

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

> Calling an unregistered `action`, or a plugin that is disabled or not installed, rejects the Promise.

##### Handlers from bundled plugins

Renderer scripts can also call the bundled plugins, so a plugin can use the app's AI provider and Freshservice connection without asking for keys of its own. To stay site-agnostic, prefer `pluginAPI.sites` (`readActiveRecord()`, a site's `knowledge`) over calling the Freshservice plugin directly:

| Call | Returns | Notes |
|---|---|---|
| `invoke("ai-features", "complete", { prompt })` | `{ result }` or `{ error }` | Runs `prompt` (up to 60,000 characters) with the provider and model chosen in Settings → AI Features. |
| `invoke("freshservice", "get-ticket", { ticketId, host })` | `{ text }` or `{ error, skipped? }` | Plain-text ticket, description and conversation. |
| `invoke("freshservice", "get-ticket-fields", { ticketId, host })` | `{ subject, requester, requesterFirstName }` or `{ error, skipped? }` | A ticket's subject and requester name, for reply placeholders. |
| `invoke("freshservice", "search-solutions", { term })` | `{ articles }` or `{ error }` | Up to 10 Solutions articles: `{ id, title, status, updatedAt, url, text }`, with `text` cut to a short snippet. |
| `invoke("freshservice", "get-solution-article", { id })` | `{ article }` or `{ error }` | One article with its text (up to 6,000 characters) and a `truncated` flag. |
| `invoke("freshservice", "add-time-entry", { kind, id, minutes, note?, billable?, host? })` | `{ ok, id, timeSpent }` or `{ error, skipped? }` | Adds a time entry (`minutes` 1 to 1,440) to a ticket, change, problem or release (`kind`) for the agent the API key belongs to. Prefer the site's `timeEntry` adapter. |
| `invoke("freshservice", "count-tickets", { query, vars? })` | `{ count, query }` or `{ error, skipped? }` | Number of tickets matching a [ticket filter query](https://api.freshservice.com/) (no double quotes, 512 characters at most). `{name}` placeholders are filled from `vars`, which may only hold `YYYY-MM-DD` dates. |
| `invoke("freshservice", "filter-tickets", { query, vars?, maxPages? })` | `{ tickets, total, query }` or `{ error, skipped? }` | The tickets matching a filter query (same rules as `count-tickets`), 30 a page, up to `maxPages` pages (1 to 10, default 1). Each is `{ id, subject, status, priority, responderId, requesterId, createdAt, updatedAt }`. |
| `invoke("freshservice", "get-conversations", { ticketId })` | `{ ticketId, conversations }` or `{ error, skipped? }` | A ticket's replies and notes, oldest first: `{ id, userId, incoming, private, fromEmail, createdAt, snippet }`, with `snippet` cut to 300 characters. |
| `invoke("freshservice", "find-agent", { email })` | `{ agent }` or `{ error, skipped? }` | The agent with that email: `{ id, name, email }`. The API has no way to ask who owns the key, so this is how a plugin learns which tickets are "mine". |
| `invoke("freshservice", "search-tickets", { term, days? })` | `{ tickets, domain, days, scanned, scanFull, warnings }` or `{ error, skipped? }` | Tickets matching a number, subject words or a requester's name or email (up to 50, number matches first, then newest updated). Each is a `filter-tickets` summary plus `statusLabel`, `priorityLabel`, `requester`, `requesterEmail` and `matches` (`"number"`, `"subject"`, `"requester"`). Subjects are matched against up to 300 tickets updated in the last `days` (7, 30, 90, 180 or 365; default 30), cached for two minutes. Prefer the site's `ticketSearch` adapter. |

See `plugins/solutions-chat/renderer.js` for a plugin built on `pluginAPI.sites` and the AI Features handler.

#### `window.pluginAPI.ui.addSidePanelTab(opts)`

Adds a tab to the side panel on the right of the window and returns a handle for it. The panel shows whenever the **Side Panel** setting is on and at least one plugin has added a tab; with a single tab it still shows the tab strip.

| Option | Description |
|---|---|
| `id` | Required. Unique tab id, `/^[a-z0-9][a-z0-9_-]{0,62}$/`. Used to remember the last tab the user opened. |
| `label` | Text on the tab. |
| `icon` | Optional emoji or short text shown before the label. |
| `title` | Optional tooltip. |
| `order` | Optional number; lower comes first. Notes uses `10`, Ticket Search `15`, Solutions Chat `20`, Canned Responses `30`, Time Tracker `40`, Recent Tickets `50`, the default is `100`. |

The handle:

| Member | Description |
|---|---|
| `element` | The tab's content `<div>` (a flex column filling the panel). Put your UI in it. |
| `activate()` | Switches to this tab, expanding the panel if it was collapsed. |
| `isActive()` | Whether this tab is the one showing. |
| `onShow(fn)` / `onHide(fn)` | Called when the user switches to or away from this tab. |

```js
const tab = window.pluginAPI.ui.addSidePanelTab({ id: "my-plugin", label: "My Plugin", icon: "🧩", order: 50 });
tab.element.innerHTML = '<div style="padding:12px">Hello from my plugin</div>';
tab.onShow(function () { console.log("my tab is showing"); });
```

#### `window.pluginAPI.ui.addTabMenuItem(opts)`

Adds an item to the menu that opens when you right-click a tab. Plugin items appear after **Pin Tab**, below a separator. Returns `{ remove() }`.

| Option | Description |
|---|---|
| `id` | Required. Unique id, `/^[a-z0-9][a-z0-9_-]{0,62}$/`. |
| `label` | Text of the item. |
| `icon` | Optional emoji or short text shown before the label. |
| `title` | Optional tooltip. |
| `isVisible(tab)` | Optional. Return `false` to hide the item for this tab. |
| `onClick(tab)` | Required. Called with `{ tabId, webview, url, title }` for the tab that was right-clicked. |

```js
window.pluginAPI.ui.addTabMenuItem({
  id: "my-plugin-copy-title",
  icon: "📋",
  label: "Copy Page Title",
  onClick: function (tab) { navigator.clipboard.writeText(tab.title); },
});
```

The Bookmarks Bar plugin uses it for **Save to Bookmarks Bar**.

#### `window.pluginAPI.ui.notify(opts)`

Shows a notification under the bell icon in the tab bar. `opts` is `{ type, title, desc, action? }`; only one notification of each `type` is shown at a time. `action` is `{ label, onClick }` and adds a button.

```js
window.pluginAPI.ui.notify({
  type: "sync-failed",
  title: "Sync failed",
  desc: "Couldn't reach the server.",
  action: { label: "Retry", onClick: retry },
});
```

#### `window.pluginAPI.ui.confirm(message, options?)`

Shows the app's confirm dialog (use it instead of `window.confirm()`, which loses focus to the web page). Resolves `true` or `false`. Pass `{ defaultYes: true }` to focus **Yes**.

#### `window.pluginAPI.ui.addToolbarButton(opts)`

Appends a button to the note editor toolbar in the Notes tab. Returns the button element. The toolbar belongs to the Note Backup plugin, so the button appears once that plugin has loaded, and not at all while it is turned off.

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

Read and write the note in the Notes tab. These calls are answered by the Note Backup plugin. While it is turned off, `isAvailable()` is `false`, reads return empty values and writes do nothing, so hide any note actions in that case.

| Method | Returns | Description |
|---|---|---|
| `notes.isAvailable()` | `boolean` | Whether a notes provider (Note Backup) is loaded |
| `notes.onReady(fn)` | — | Calls `fn(provider)` once Note Backup has loaded, straight away if it already has. `provider.toolbar` is the editor toolbar and `provider.actionsRow` the row of sync buttons, for plugins that add their own controls next to them |
| `notes.getContent()` | `string` | Current editor content as HTML |
| `notes.setContent(html)` | — | Replace editor content and schedule an autosave |
| `notes.getTicketId()` | `string \| null` | Current ticket ID, or `null` if none set |
| `notes.getPlainText()` | `string` | Editor content stripped of HTML tags |
| `notes.registerProvider(impl)` | — | For a plugin that replaces Note Backup: registers the object that answers the calls above. Only one provider can register |
| `notes.saveSnapshot(incomingText, options?)` | `Promise<boolean>` | Saves a snapshot of the current editor content if it differs enough from the last snapshot (respects the configured snapshot threshold). Resolves to `false` when a snapshot was needed and could not be saved (for example a note over the size limit); do not replace the note in that case without asking. Pass `{ force: true }` to skip the size check, e.g. before replacing the note with a rewrite of similar length. Call this before overwriting the editor with bulk-imported or AI-generated content so the previous note can be recovered from history. |

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

#### `window.pluginAPI.send(pluginId, action, data)`

Sends a fire-and-forget message to a main-process handler registered with `api.onMessage()`. Use it instead of `invoke()` in `beforeunload`, where an `invoke()` reply may never arrive.

#### `window.pluginAPI.browser`

Interacts with the app's tab system and the active webview.

| Method | Returns | Description |
|---|---|---|
| `browser.newTab(url, options?)` | — | Opens `url` in a new tab and switches to it. Pass `{ activate: false }` to open it in the background |
| `browser.navigate(url)` | — | Loads `url` (http or https) in the active tab, or in a new tab if none is open |
| `browser.newWindow(url)` | `Promise<boolean>` | Opens `url` (http or https) in a plain child window with no tabs, side panel or plugins, like the tab menu's **Open in New Window** |
| `browser.executeInActiveTab(script)` | `Promise<any>` | Runs a JavaScript string in the active webview and returns its result. Rejects if no tab is open. |
| `browser.getActiveTab()` | `TabInfo \| null` | The active browser tab (see below) |
| `browser.getTabs()` | `Array<TabInfo>` | Every open browser tab, in tab-bar order |
| `browser.activateTab(tabId)` | `boolean` | Switches to the tab. `false` if no tab has that id |
| `browser.closeTab(tabId)` | `boolean` | Closes the tab like its × button. `false` if no tab has that id or it is pinned (pinned tabs can't be closed) |

A `TabInfo` is `{ tabId, webview, title, url, pinned, active, unread }`: the tab's id, its `<webview>` element, the title shown on the tab, its address (the address it is loading if the page hasn't started yet), whether it is pinned, whether it is the active tab, and whether it shows the unread badge (its page changed in the background since it was last viewed; `tab:updated` fires when that changes).

Browser tabs also raise `tab:created`, `tab:activated`, `tab:updated` and `tab:closed` events (see [Events reference](#events-reference)). The Tree Style Tabs plugin (`plugins/tree-tabs`) is built on these. Tabs restored at startup are created before your script runs, so call `getTabs()` once as well as listening for `tab:created`. You can add your own listeners to a tab's `webview` (for example `did-navigate` or `console-message`); remove them on `tab:closed`.

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
- `setupFn(panel)` — called once immediately with the panel's empty content `HTMLElement`; populate and attach listeners here

Every plugin's tab starts with an **Enabled** switch and the plugin's badges, added by the app above your content; it's the same switch as in the Plugins list. You don't need to add an on/off switch for the plugin itself. A plugin without a `settings.js`, or one that is turned off, still gets a tab with that switch and a short message such as "There's nothing to configure for this plugin."

#### `pluginSettingsAPI.getSettings()`

Returns a shallow copy of the current app settings object.

#### `pluginSettingsAPI.saveSettings(patch)`

Merges `patch` into the current settings and writes to disk. Returns a `Promise` that resolves once the save has finished; await it before calling a plugin handler that reads the new value. The main window receives a `settings:changed` event when the save completes.

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
| `note:saved` | `{ ticketId: string, timestamp: string }` | A note was saved (fired by the Note Backup plugin) |
| `ticket:changed` | `{ ticketId: string, previous: string \| null, site: string }` | The ticket in the Notes tab switched (fired by the Note Backup plugin); `site` is the site plugin's id |
| `settings:changed` | settings object | Settings were saved from the Settings window |

These are emitted on the renderer bus (`events.on()`) only, because their payload holds the tab's `<webview>` element:

| Event | Payload | When |
|---|---|---|
| `tab:created` | `TabInfo` plus `openerTabId` | A browser tab was opened. `openerTabId` is the tab whose page opened it (a link with `target="_blank"`, `window.open()` or **Open Link in New Tab**), otherwise `null` |
| `tab:activated` | `TabInfo` | A browser tab became the active one |
| `tab:updated` | `TabInfo` | A tab's title or address changed, or it was pinned or unpinned |
| `tab:closed` | `{ tabId, webview }` | A browser tab was closed |
| `site:registered` | `{ siteId }` | A site plugin registered its adapter with `pluginAPI.sites.register()` |

> **`app:ready` timing:** Main-process plugins receive `app:ready` during `initPlugins()`, before the renderer window opens. Renderer scripts are injected after `app:ready` has already fired, so there is no need to wait for it in your renderer script.

---

## Complete API reference

### Main-process (`api` object)

```ts
api.handle(action: string, fn: (data: any) => Promise<any>): void
api.on(event: "note:saved" | "ticket:changed" | "settings:changed" | "app:ready", fn: (data: any) => void): void
api.getDataPath(): string
api.onMessage(action: string, fn: (data: any) => void): void
api.emit(event: string, data?: any): void
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
pluginAPI.send(pluginId: string, action: string, data?: any): void

pluginAPI.ui.addSidePanelTab(opts: {
  id: string, label: string, icon?: string, title?: string, order?: number,
}): { id: string, element: HTMLElement, activate(): void, isActive(): boolean,
      onShow(fn: () => void): void, onHide(fn: () => void): void }

pluginAPI.ui.addTabMenuItem(opts: {
  id: string, label: string, icon?: string, title?: string,
  isVisible?: (tab: { tabId: string, webview: HTMLElement, url: string, title: string }) => boolean,
  onClick: (tab: { tabId: string, webview: HTMLElement, url: string, title: string }) => void,
}): { remove(): void }

pluginAPI.ui.notify(opts: {
  type: string, title: string, desc?: string,
  action?: { label: string, onClick: () => void },
}): void

pluginAPI.ui.confirm(message: string, options?: { defaultYes?: boolean }): Promise<boolean>

pluginAPI.ui.addToolbarButton(opts: {
  id?: string,
  label: string,
  title?: string,
  onClick: () => void,
}): HTMLButtonElement

pluginAPI.notes.isAvailable(): boolean
pluginAPI.notes.onReady(fn: (provider: { toolbar?: HTMLElement, actionsRow?: HTMLElement }) => void): void
pluginAPI.notes.getContent(): string
pluginAPI.notes.setContent(html: string): void
pluginAPI.notes.getTicketId(): string | null
pluginAPI.notes.getPlainText(): string
pluginAPI.notes.saveSnapshot(incomingText: string, options?: { force?: boolean }): Promise<boolean>

pluginAPI.sites.register(adapter: SiteAdapter): SiteAdapter   // see docs/sites.md
pluginAPI.sites.list(): SiteAdapter[]
pluginAPI.sites.get(id: string): SiteAdapter | null
pluginAPI.sites.forUrl(url: string): SiteAdapter | null
pluginAPI.sites.forWebview(webview: HTMLElement): SiteAdapter | null
pluginAPI.sites.forActiveTab(): { site: SiteAdapter, tabId: string, webview: HTMLElement } | null
pluginAPI.sites.readActiveRecord(): Promise<{ site, record, text: string, source: "api" | "page", label: string } | null>
pluginAPI.sites.onRegistered(fn: (site: SiteAdapter) => void): () => void

pluginAPI.browser.newTab(url: string, options?: { activate?: boolean }): void
pluginAPI.browser.navigate(url: string): void
pluginAPI.browser.newWindow(url: string): Promise<boolean>
pluginAPI.browser.executeInActiveTab(script: string): Promise<any>
pluginAPI.browser.getActiveTab(): TabInfo | null
pluginAPI.browser.getTabs(): TabInfo[]
pluginAPI.browser.activateTab(tabId: string): boolean
pluginAPI.browser.closeTab(tabId: string): boolean
// TabInfo = { tabId: string, webview: HTMLElement, title: string, url: string, pinned: boolean, active: boolean, unread: boolean }

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
MSP_PlusPlus/
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

Drop the plugin directory into the app's data folder. You can open it from within the app via **📁 Open Folder** in the Notes tab, then navigate up one level:

```
%APPDATA%\MSP++\plugins\
  my-plugin\
    manifest.json
    main.js
    renderer.js
```

If you upgraded from Freshservice++, the data folder is still `%APPDATA%\Freshservice++\` (or `%APPDATA%\freshservice-pp\`), so use its `plugins\` folder instead. See [`data-files.md`](data-files.md) for every folder the app uses.

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
- Give it its own side panel tab with `window.pluginAPI.ui.addSidePanelTab()`
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
