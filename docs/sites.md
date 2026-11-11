# Site Plugins

MSP++ wraps ticketing sites in tabs and adds features on top of them: a Notes tab that syncs with the page's note editor, AI summaries, knowledge base chat. The core app knows nothing about any particular site. Everything that knows what a site's pages look like lives in a **site plugin**, and the feature plugins talk to whichever site plugin claims the page open in a tab.

Bundled site plugins:

| Plugin | Folder | Hosts |
|---|---|---|
| Freshservice | `plugins/freshservice` | `freshservice.com`, `freshworks.com`, `myfreshworks.com`, plus the domain set for its API and the Home URL's host (unless another site claims it) |
| ConnectWise Manage | `plugins/connectwise-manage` | `myconnectwise.net` (cloud instances such as `na.myconnectwise.net`) |

Several site plugins can be installed at once. The adapter is chosen **per tab, by URL**, so a Freshservice tab and another site's tab can sit side by side, each with its own ticket detection and note sync.

A site plugin is an ordinary plugin (see [plugins.md](plugins.md)) with two extra parts:

1. a `"site"` block in `manifest.json`, read by the main process, and
2. a renderer script that calls `pluginAPI.sites.register(adapter)`.

---

## 1. The manifest `"site"` block

```json
{
  "id": "freshservice",
  "name": "Freshservice",
  "main": "main.js",
  "renderer": "renderer.js",
  "site": {
    "name": "Freshservice",
    "shortName": "FS",
    "hosts": ["freshservice.com", "freshworks.com", "myfreshworks.com"],
    "defaultUrl": "https://freshservice.com/login",
    "chromeUserAgent": true
  }
}
```

| Field | Type | What core does with it |
|---|---|---|
| `name` | string | Display name. Defaults to the plugin id. |
| `shortName` | string | Short label. Defaults to `name`. |
| `hosts` | string[] | Bare domains (no scheme, port, path or wildcard), up to 20. Each matches that host and all its subdomains. Used for the two items below. |
| `defaultUrl` | string | `http(s)` start page. The first loaded site plugin with one becomes the **Home URL** default for users who haven't set their own. |
| `chromeUserAgent` | boolean | When `true`, requests to `hosts` carry a plain Chrome user agent (no `Electron/…` token), so the site doesn't reject the app as an unsupported browser. Other sites see the real user agent. |

Core also opens **sign-in popups as real windows** (so `window.opener` / `postMessage` handshakes work) when the popup's URL is on one of `hosts` and its path has an auth segment (`/auth`, `/login`, `/sso`, `/oauth`, `/saml`, `/openid`, `/signin`). Popups to Microsoft and Google sign-in pages always open as windows. Every other popup opens in a new tab.

Only an **enabled plugin that loaded** contributes its site block. Invalid hosts are skipped with a warning in the log.

---

## 2. The site adapter (`pluginAPI.sites`)

The renderer script registers an adapter object:

```js
window.pluginAPI.sites.register({
  id: "freshservice",          // required: your plugin id
  name: "Freshservice",        // required
  shortName: "FS",             // optional, used on buttons ("Pull from FS")
  matchesUrl(url) { … },       // required
  recordScript: "…",           // optional page script
  scrapeScript: "…",           // optional page script
  readRecord: async (ctx) => …,// optional
  formatTitle(title) { … },    // optional
  recordLink(url) { … },       // optional
  notes: { … },                // optional: note editor sync
  knowledge: { … },            // optional: knowledge base
});
```

`register()` validates the adapter and throws on a missing or mistyped field. It returns the frozen adapter. Each id can register once.

"Page script" below means a JavaScript expression string run in the tab with `webview.executeJavaScript()`. Write it as an IIFE: `(function() { … return value; })()`. It may return a Promise. It runs in the site's page, so keep it self-contained, and return plain JSON-safe values.

### `matchesUrl(url) → boolean` (required)

True when this site owns the page. Called often (every tab switch, every watcher message), so keep it cheap. Return false for anything that isn't `http(s)`. It may read your own settings (via `pluginAPI.getSettings()` and the `settings:changed` event), for example to claim a customer's custom domain.

If no adapter claims a URL, but the URL is on the host of the user's Home URL and exactly one site plugin is installed, that site is used. This keeps custom domains working for single-site users.

### `recordScript` (page script)

Finds the record open in the tab. Returns `null`, or:

```js
{
  ticket: "123",        // required when found: the key the Notes tab files notes under
  kind: "ticket",       // optional: "ticket", "change", … (site-defined)
  id: "123",            // optional: the record's number as the site's API knows it
  label: "ticket #123", // optional: shown in the UI ("used ticket #123")
  source: "url"         // optional: how it was found, for debugging
}
```

Return `{ ticket: null }` (or `null`) on list pages and anything that isn't one record. Note keys share one storage folder across sites, so **prefix keys that could collide** with another site's numbers. Freshservice keeps bare numbers for tickets (for backward compatibility) and prefixes other record types (`CHN-45`, `PRB-67`, `RL-89`).

### `scrapeScript` (page script) and `readRecord(ctx)`

How the AI features read the open record's description and conversation.

- `readRecord({ webview, url, record })` is tried first. `record` is the `recordScript` result. Return `{ text, source: "api" }` (or `"page"`), or `null` to fall back. Freshservice uses its REST API here.
- `scrapeScript` returns the record's text as one string (keep it under about 15,000 characters). It's used when `readRecord` is missing or returns nothing.

### `formatTitle(title) → string`

Optional. Shortens the tab title for pages this site owns (for example, stripping a product-name prefix).

### `recordLink(url) → string | null`

Optional. A clean link to the record open at `url`, without view, filter or tab parameters, for the tab menu's **Copy Ticket Link**. Return `null` when the URL isn't a record page. The menu item shows for tabs on a site plugin's hosts or the Home URL's host, and is greyed out when no site returns a link. Keep it cheap and pure (no page access): it runs each time the tab menu opens.

### `notes` (note editor sync)

Lets the Notes tab pull from, push to and live-sync with the page's note field.

```js
notes: {
  readScript: "…",                 // page script → { type, text } | null
  buildPushScript(text) { … },     // → page script that writes text, → { type } | null
  watcherScript: "…",              // page script installed once per page load
  watcherPrefix: "[XX-SYNC] ",     // console prefix the watcher writes with
  fieldTypes: ["editor", "textarea"],
  fieldTypeLabel(type) { … },      // optional: "note editor", "time entry", …
  pushDelay(type, siteState) { … },// optional: ms before a live push
  onWatcherMessage(msg, siteState) { … }, // optional: your own watcher message kinds
}
```

- **`readScript`** returns the visible note field's type (one of `fieldTypes`) and its plain text, or `null` when there's no field. Normalise the text the same way the Notes tab does, so panel and page text compare equal: replace non-breaking spaces with spaces, trim, and collapse three or more newlines to two.
- **`buildPushScript(text)`** returns a page script that writes `text` (plain text, `\n` line breaks) into the field and returns `{ type }`, or `null` when there's no field. Embed the text with `JSON.stringify(text)`. It may be async (return a Promise from the page script), for example to open and close a popup.
- **`watcherScript`** is installed after each page load in pages the site claims. It must guard against double installation (e.g. `if (window.__xxWatcher) return;`). It reports changes by writing `console.log(watcherPrefix + JSON.stringify(message))`. Messages:

  | Message | When |
  |---|---|
  | `{ kind: "fields", type }` | The target field changed. `type` is one of `fieldTypes`, or `null` for no field. |
  | `{ kind: "focus", focused }` | The page field gained or lost focus. |
  | `{ kind: "input", field, text }` | The user typed in the page field. `text` is the normalised plain text. Debounce this (Freshservice waits 150 ms). |
  | anything else | Passed to `onWatcherMessage(msg, siteState)`. |

  Only messages from a tab whose current URL your adapter claims, starting with your exact prefix, are accepted, at most one every 50 ms per tab.
- **`pushDelay(type, siteState)`** returns how many milliseconds to wait after the user stops typing in the panel before a live push (0 to 10,000). Return `undefined` for the default: 500 ms for type `"editor"`, 300 ms for anything else.
- **`siteState`** is a plain object per tab that only your adapter reads or writes. It's reset when the tab navigates. Use it to carry state from `onWatcherMessage` to `pushDelay` (for example, "the stopwatch popup is visible").

### `knowledge` (knowledge base)

Lets Solutions Chat answer from the site's knowledge base.

```js
knowledge: {
  name: "Solutions",                       // what the site calls it
  search: async (term) => ({ articles }),  // or { error }
  getArticle: async (id) => ({ article }), // or { error }
}
```

Search results are up to 10 `{ id, title, status, url, text }`, with `text` a short snippet and `status` `"draft"` or `"published"`. `getArticle` returns one article with its full `text` (keep it under about 6,000 characters) and a `truncated` flag. `url` must be `https://`. Solutions Chat uses the active tab's site when it has a knowledge base, else the first installed site that has one.

---

## Using sites from a feature plugin

```js
const api = window.pluginAPI;

api.sites.list();                 // all registered adapters
api.sites.get("freshservice");    // one by id, or null
api.sites.forUrl(url);            // the adapter for a URL, or null
api.sites.forWebview(webview);    // the adapter for a tab's current page, or null
api.sites.forActiveTab();         // { site, tabId, webview } | null
await api.sites.readActiveRecord(); // { site, record, text, source, label } | null
api.sites.onRegistered((site) => { … }); // existing and future registrations; returns an unsubscribe
api.events.on("site:registered", ({ siteId }) => { … }); // future registrations only
```

Plugins load in folder order, so a site plugin may register after your script runs. Look adapters up when you need them (as above) rather than caching them at load time.

`ticket:changed` (fired by the Notes tab) includes `site`, the id of the site whose page the ticket came from.

---

## Writing a new site plugin: checklist

1. `manifest.json` with `main` (if you call an API), `renderer`, optional `settings`, `"minAppVersion": "0.5.7"` and a `"site"` block.
2. `renderer.js` that registers the adapter. Copy `plugins/freshservice/renderer.js` as a starting point.
3. Pick a unique `watcherPrefix` and a guard variable name for the watcher.
4. Decide your note-key scheme (`recordScript().ticket`) so it can't collide with other sites.
5. Put any credentials in the manifest's `"credentials"` list and keep API calls in `main.js` (see the Freshservice plugin's `get-ticket` handler).
6. Test: open a ticket and check the Notes tab picks up its number, Pull/Push work, live sync works both ways, Summarize reads the ticket, and sign-in still works.
