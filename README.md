<p align="center"><img src="icon.svg" alt="MSP++ icon" width="128"></p>

# MSP++

An Electron-based wrapper for MSP and ticketing web apps (Freshservice and ConnectWise Manage today) that adds a persistent note editor, automatic backups, live two-way sync, AI assistance, a live metrics bar, and quality-of-life browser improvements on top of the standard web interface.

**Current version:** 0.7.3

> MSP++ was called **Freshservice++** before 0.6.0. Your settings, notes and sign-ins carry over: the app keeps using the existing Freshservice++ data folder.

---

## Features

### Browser
- **Multi-tab browsing** – Open multiple ticketing pages simultaneously. The tabs you had open come back the next time the app starts; turn off **Settings → General → Restore Tabs from Last Session** to start on the Home URL instead (pinned tabs always come back)
- **Address bar** – A row under the tab bar shows the active tab's URL, with back, forward and reload beside it. Type an address and press `Enter` to go there (`Ctrl+L` jumps to it, `Escape` puts the page's URL back). Only `http` and `https` pages open; a bare host such as `example.com` gets `https://` added. There is no web search, so plain words are ignored
- **Refresh all tabs** – **View → Refresh All Tabs** (`Ctrl+Alt+R`) reloads every open tab at once
- **Tab management** – Pin tabs, duplicate (the copy opens next to the original), close others, reopen closed tabs (`Ctrl+Shift+T` puts a tab back where it was), copy URL, copy a clean ticket link (on Freshservice, ConnectWise and Home URL pages; greyed out when no ticket is open), open in default browser (right-click any tab). Tab shortcuts work while you're typing in a page too. Double-click an empty part of the tab bar to open a new tab
- **Open in New Window** – Right-click a tab and choose **Open in New Window** to open its page in a plain browser window: just back, forward, reload and an address bar, with no tabs, side panel, metrics or bookmarks, so it can't be mistaken for the main window. It shares your sign-ins and closes when the main window closes. Links it opens go to tabs in the main window, and the ⇱ button moves its page to a tab. Right-clicking a link in a page also offers **Open Link in New Window**
- **Page zoom** – `Ctrl`+mouse wheel, `Ctrl+=` / `Ctrl+-`, or **View → Zoom In / Zoom Out** zooms the page in the active tab (the app's own toolbar and side panel stay the same size). Zoom is kept per site, so other tabs on the same site follow along. When a tab isn't at 100%, its zoom level shows at the end of the address bar; click it or press `Ctrl+0` to reset
- **Find in page** – `Ctrl+F` to search text on the current page, even on sites that use `Ctrl+F` for their own search; press it again to select the search text, `Escape` to close
- **Download manager** – Tracks in-progress and completed downloads with open/show-in-folder actions; a badge on the download icon shows how many files finished since you last opened the panel (resets when you open it)
- **Passkey sign-in** – Sites that offer "sign in with a passkey" (for example Microsoft sign-in) work in tabs. On Windows the Windows Hello prompt handles this PC's passkeys, security keys and phones (scan the QR code); when a security key holds several accounts for a site, the app asks which one to use
- **Permission prompts** – A site in a tab has to ask before it uses the microphone, camera, your location, notifications or the clipboard, or opens a link in another program. Harmless permissions (such as copying to the clipboard) are allowed without asking, and the app's own windows are never asked. Your **Allow** or **Block** answer is saved for that site and kept between launches; click **Forget Saved Answers** under **Settings → General → Site Permissions** to be asked again
- **Crashed tabs** – If a tab's page stops responding and its process dies, the tab says so and offers to reload it instead of going blank
- **Image context menu** – Right-click any image for **Copy Image** (copies pixel data to clipboard) and **Save Image As…** (native save dialog); image links open as downloads instead of new tabs

### Side Panel
- **One panel, a tab per plugin** – The panel on the right holds a tab for each plugin that adds one: **📋 Notes** (Note Backup) and **📚 Solutions** (Solutions Chat) out of the box. Your own plugins can add tabs too (see [`docs/plugins.md`](docs/plugins.md)). The last tab you used is reopened on launch
- **Turn it on or off** under **Settings → General → Side Panel**; collapse it with `Ctrl+Shift+B` or the ◀ button

### Note Editor (Note Backup plugin)
- **Rich text Notes tab** – Draft and edit notes with a full formatting toolbar (bold, italic, underline, lists, clear formatting)
- **Auto-save** – Notes are saved to disk ~1.5 seconds after you stop typing
- **Manual snapshots** – Click **💾 Save Snapshot** to create a timestamped backup at any time
- **Snapshot threshold** – Configurable minimum character difference before an auto-snapshot is triggered on tab switch or sync pull (default: 5 chars)
- **History & restore** – Browse all saved snapshots per ticket and click any entry to restore it
- **Note search** – Full-text search across all saved notes and autosave drafts
- **Copy to clipboard** – One-click copy of the current note
- **Signatures** – Save an HTML signature that can be inserted at the end of any note
- **Templates** – Create reusable note templates accessible from the toolbar
- **HTML source view** – Toggle button in the toolbar swaps the rich-text editor for a raw HTML textarea; formatting toolbar is disabled while in HTML mode and re-enabled on exit. Notes, templates and signatures are cleaned down to plain formatting before they're shown, so scripts, frames and similar content are dropped
- **No silent loss** – If a note can't be saved (for example it's over 10 MB, or the folder can't be written), you're told instead of it being treated as saved, and clearing, switching tickets, pulling from the site or applying an AI rewrite asks first rather than replacing a note whose backup failed. Typing that hasn't hit the auto-save timer yet is saved when the window closes
- **Delivered as a bundled plugin** — Note Backup, including live sync below, is implemented via the plugin system. Its settings (live sync, backup retention, templates, signature) are under **Settings → Plugins → Note Backup**. Turning it off removes the Notes tab; your saved notes stay on disk

### Freshservice Sync (Freshservice plugin)
- **Site support is a plugin** – Everything Freshservice-specific (ticket detection, note editor sync, page reading, the API) lives in the bundled **Freshservice** plugin. The core app and the other plugins are site-agnostic, so support for other ticketing systems can be added as further site plugins (see [`docs/sites.md`](docs/sites.md))
- **Live two-way sync** – With "Live Sync" enabled, the panel and the open Freshservice note editor (the rich-text **Add note** / **Reply** editor, or a note textarea such as the one on the time-entry form) stay in sync as you type — no manual copy-paste needed. When several editors are open, the one you last clicked into is used
- **Pull from FS / Push to FS** – Manual sync buttons for when live sync is off or you want an explicit transfer
- **Auto ticket detection** – The ticket number is read from the page URL (`/a/tickets/1234`), so switching tabs or navigating between tickets automatically loads the correct content into the panel. Changes, problems and releases are tracked too, saved as `CHN-45`, `PRB-12` and `RL-3` so they never collide with ticket numbers

### ConnectWise Manage
- **Works alongside Freshservice** – Open ConnectWise Manage (`*.myconnectwise.net`) in any tab; each tab uses the right site automatically
- **Live two-way sync** – The panel syncs with the time-entry notes editor and the stopwatch notes. Stopwatch notes are reached by opening the stopwatch popup out of sight, saving it as a draft and closing it again
- **Pull from CW / Push to CW** – Manual sync buttons, as for Freshservice
- **Auto ticket detection** – The ticket number is read from the URL or the page and saved as `CW-123456`, so it never collides with Freshservice numbers
- **AI Summarize** – Reads the ticket's notes (author, date and text) from the page
- **Delivered as a bundled plugin** — it can be disabled independently from Settings → Plugins

### Metrics Bar

A configurable stats bar displayed above the tab strip that periodically scrapes live numbers from one or more BrightGauge public dashboards.

- **Multiple dashboards** – Add as many dashboard sources as you need; fields from all dashboards are shown together in the bar
- **Auto-poll** – Refreshes on a configurable interval (5 / 15 / 30 / 60 minutes); a manual refresh button is also available
- **Visual field picker** – Click **+ Add Field**, navigate the dashboard inside the built-in picker overlay, then click any value to capture it; the app auto-generates a stable selector anchored to the person/row name rather than a fragile DOM position
- **Per-field labels** – Each metric displays a custom label beneath the value
- **View dashboard** – Click any metric card to open that card's source dashboard in a new tab
- **Editable selectors** – Each field's captured selector is shown in Settings and can be manually corrected; a **Test selectors** button per dashboard re-scrapes immediately and updates the "→ found value" badges
- **Re-pick** – Individual fields can be re-picked at any time without losing the others
- **Freshservice API counts** – A field can carry a Freshservice ticket filter query (e.g. `agent_id:123 AND status:2`). The bar then shows how many tickets match it, straight from the Freshservice API, and reads the dashboard for that field only if the API call fails. Queries can use `{today}`, `{weekStart}` and `{monthStart}`
- **Progress tracking** – Each field can have a configurable weekly target. Values turn green when the goal is reached, yellow when slightly behind pace, and red when significantly behind. Hover any card to see the exact on-track value for the current point in the week.
- **Cached values** – The last successfully scraped value for each field is persisted across launches; if a refresh fails the bar continues showing the cached value with a `⚠` indicator and a tooltip showing when it was last updated
- **Delivered as a bundled plugin** — the Metrics Bar is implemented via the plugin system; it can be disabled independently from Settings → Plugins

### Bookmarks Bar
A row of bookmarked sites under the address bar.
- **Save a page** – Right-click a tab and choose **⭐ Save to Bookmarks Bar**, or right-click an empty part of the bar for **Bookmark this page** and **Add bookmark…**
- **Open** – Click a bookmark to open it in the current tab, middle-click (or `Ctrl`+click) to open it in a new tab in the background, `Shift`+click to open it in a new window
- **Right-click a bookmark** for **Open site**, **Open site in new tab**, **Open site in new window**, **Edit bookmark…** and **Delete bookmark** (which asks first)
- **Reorder** – Drag bookmarks along the bar. Bookmarks that don't fit are under the **»** button at the end
- **Manage** – **Settings → Plugins → Bookmarks Bar** lists every bookmark with add, edit, delete, move up/down and drag to reorder, and a switch to show or hide the bar

### Canned Responses
Saved replies you can drop into a ticket in one click.
- **💬 Replies tab** – The side panel lists your replies, grouped by category. Click one to insert it at the cursor in the ticket's reply box: the Freshservice reply or note editor, or the ConnectWise Manage notes editor. Nothing already in the box is replaced
- **Search** – Type in the search box and press `Enter` to insert the top match, or use the arrow keys to pick another
- **Placeholders** – `{{requester}}`, `{{requester_first}}`, `{{subject}}`, `{{ticket}}`, `{{agent}}`, `{{agent_first}}`, `{{date}}`, `{{time}}` and `{{site}}` are filled in as the reply goes in. On Freshservice the requester and subject come from the API when it's set up, otherwise from the page. Any that can't be read are left in place and the panel tells you to fill them in
- **Copy** – Puts the filled-in reply on the clipboard, for sites without reply box support
- **Manage** – **Settings → Plugins → Canned Responses** has your name (for `{{agent}}`) and the list of replies with add, edit, delete and reorder
- **Delivered as a bundled plugin** — it can be disabled independently from Settings → Plugins

### AI Assistant
- **✨ Suggest** – Sends your current notes to the configured AI model and presents an improved version in a review overlay; apply or dismiss before anything changes. After a suggestion is returned, a **Refine** textarea appears — type follow-up instructions (e.g. "make it shorter", "keep this as a client-facing message") and click **↺ Refine** to generate a revised version without losing the Apply option
- **📋 Summarize** – Reads the ticket description, replies and notes from the open ticket (on Freshservice through the Freshservice API when it's set up, otherwise from the page; on ConnectWise Manage from the page) and asks the AI to produce a concise bullet-point summary
- Supports **Hatz AI**, **OpenAI**, **Anthropic**, **Azure OpenAI**, and **Microsoft 365 Copilot** as providers; for Hatz, OpenAI and Anthropic the model dropdown is populated automatically from the provider's API once an API key is entered
- **Delivered as a bundled plugin** — AI Features is implemented via the plugin system; it can be disabled independently from Settings → Plugins

### Freshservice API (Freshservice plugin)
- **Ticket details through the API** – With your Freshservice domain and API key entered under Settings → Plugins → Freshservice, Summarize and Suggest read the ticket's subject, status, priority, requester, description and every reply and note through the Freshservice REST API (v2) instead of scraping the page
- **Automatic fallback** – If the API is turned off, not set up, rate-limited or returns an error, or the open record is a change, problem or release, the page is read exactly as before
- **Safe key storage** – The API key is encrypted with the operating system's credential storage, never sent to the main window, and only sent to the configured domain over https. The key is tied to the domain it was entered for: if you change the domain, enter the key again. **Test connection** checks it and **Remove key** deletes it
- **Delivered as a bundled plugin** — part of the Freshservice plugin. To stop using the API but keep Freshservice support, untick **Read ticket details through the API**; turning the whole plugin off also turns off ticket detection and note sync on Freshservice pages

### Solutions Chat
- **Ask your knowledge base** – Open the **📚 Solutions** tab in the side panel for a chat that answers from your Freshservice Solutions articles. Ask how to handle something ("how do we reset MFA for a user?") and it searches Solutions, reads the best matches and answers from them only, citing each article with a link that opens it in a new tab
- **🔎 Check this ticket** – Reads the open ticket (through the Freshservice API, or the page) and looks for an existing documented solution or SOP for it. Leave **Use the open ticket** ticked to give every question the ticket as context
- **Says when nothing is documented** – If no article matches, it tells you instead of making up steps. Draft articles are marked as drafts
- **Copy** or **Add to note** puts the answer and its article links into your clipboard or the note in the Notes tab (a snapshot is saved first; **Add to note** needs Note Backup turned on)
- **Setup check** – **Settings → Plugins → Solutions Chat** shows whether AI Features and the Freshservice API are ready, and has a test search to confirm your API key can read Solutions articles
- **Requirements** – uses the provider set up in **Settings → Plugins → AI Features** and the domain and API key in **Settings → Plugins → Freshservice**; the API key needs permission to view Solutions articles. Each question makes two AI requests (one to choose search terms, one to answer)
- **Delivered as a bundled plugin** — it can be disabled independently from Settings → Plugins

### Plugin System

Extend the app with self-contained plugin directories — no build step required.

- **Bundled plugins** – Ship with the app and are always available: the **Freshservice** and **ConnectWise Manage** site plugins, **Note Backup**, **Metrics Bar**, **Bookmarks Bar**, **Canned Responses**, **AI Features** and **Solutions Chat**
- **User-installed plugins** – Drop a plugin folder into `%APPDATA%\MSP++\plugins\` (or `%APPDATA%\Freshservice++\plugins\` if you upgraded) for plugins that survive app updates
- **Plugin management** – Enable or disable individual plugins from Settings → Plugins, or with the **Enabled** switch at the top of each plugin's own settings tab; restart to apply. Every plugin gets a settings tab, and one with nothing to set up says so
- **Import plugin** – Click **Import Plugin** in Settings → Plugins to install a plugin from a folder on disk via a file dialog (no manual copy-paste required); an error is shown if a plugin with the same ID is already installed
- Plugins can add side panel tabs, toolbar buttons, Settings panels, notifications, backend IPC handlers, DOM elements, and application menu items
- See [`docs/plugins.md`](docs/plugins.md) for the full development guide and [`docs/example-plugin/`](docs/example-plugin/) for a reference skeleton

### Notifications
A bell icon in the tab bar shows a badge when there are unread notifications. Current notification types:
- **Updates** – Checks GitHub Releases on startup and every 6 hours. The installed Windows app downloads new versions in the background and shows **Update Ready** with a **Restart to Update** button; if you don't restart, the update installs the next time you close MSP++. Turn off **Settings → General → Download Updates Automatically** to be asked before anything downloads, or click **Check for Updates** there to check now. The portable .exe and the Mac app can't update themselves, so they show **Update Available** with a link to the release. Hide for now and Don't remind me for this version work as before.
- **Auto-save failed** – Fires once if a note cannot be written to disk (permissions or disk-full)
- **Backup storage warning** – Alerts when the backup folder exceeds a configurable size threshold (default: 100 MB; set to 0 to disable)
- **Live sync push failed** – Fires once when the first push to a site's notes field fails (e.g. session expired)

### Appearance & Settings
- **Dark / Light theme**
- **Collapsible panel** – Hide the side panel entirely; a slim toggle button brings it back
- **Resizable panel** – Drag the divider to adjust the panel width
- **Window state persistence** – The main window restores its last size and position on launch; validated against connected displays so it never opens off-screen
- **Native settings window** – Settings open in a separate OS window (`Ctrl+,` or **Edit → Settings**); the main window stays fully usable while settings are open. Re-invoking the shortcut focuses the existing window rather than opening a second one
- **Category sidebar** – Settings are organised into General and Plugins in a left-hand nav, with a tab for every installed plugin as an indented sub-item under Plugins
- All settings are persisted to disk and applied to the main window immediately

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` | Save snapshot |
| `Ctrl+Shift+B` | Toggle side panel |
| `Ctrl+Shift+V` | Paste as plain text (in note editor) |
| `Ctrl+F` | Find in page |
| `Ctrl+L` | Focus the address bar |
| `Ctrl`+mouse wheel, `Ctrl+=` / `Ctrl+-` | Zoom the page in / out |
| `Ctrl+0` | Reset page zoom |
| `Ctrl+,` | Open Settings |
| `Alt+Left` | Navigate back |
| `Alt+Right` | Navigate forward |
| `F5` or `Ctrl+R` | Refresh active tab |
| `Ctrl+Shift+R` | Refresh active tab, ignoring the cache |
| `Ctrl+Alt+R` | Refresh all tabs |
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+Tab` or `Ctrl+PageDown` | Next tab |
| `Ctrl+Shift+Tab` or `Ctrl+PageUp` | Previous tab |
| `Ctrl+1` – `Ctrl+8` | Switch to tab by position |
| `Ctrl+9` | Switch to the last tab |

---

## Where Are Backups Stored?

All data is saved under Electron's `userData` directory:

```
Windows: %APPDATA%\MSP++\note-backups\
macOS:   ~/Library/Application Support/MSP++/note-backups/
```

If you used the app when it was called Freshservice++, it keeps using that folder instead (`%APPDATA%\Freshservice++\` or `~/Library/Application Support/Freshservice++/`).

Inside you'll find:
- `autosave.json` – Latest auto-saved draft for each ticket
- `settings.json` – All app settings
- `open-tabs.json` – Tabs open when the app last closed, reopened on next launch
- `main-window-state.json` – The main window's last size and position
- `site-permissions.json` – Saved Allow / Block answers to site permission prompts
- A folder per ticket ID containing timestamped `.html` snapshot files

Click **📁 Open Folder** in the app to jump there directly.

---

## Getting Started

### Installing on Windows

Each release has two Windows downloads:

- **`MSP-PlusPlus-Setup-<version>.exe`** – Installer (called `MSP++ Setup <version>.exe` up to 0.7.0). It asks whether to install just for you (default: `%LOCALAPPDATA%\Programs\MSP++`, no admin rights needed) or for everyone on the PC (`C:\Program Files\MSP++`, needs admin), and lets you change the folder. It adds Start menu and desktop shortcuts. Running a newer installer updates the folder you picked the first time without asking again, so the path to `MSP++.exe` never changes. From 0.7.1 on, the installed app updates itself (see [Notifications](#notifications)); on 0.7.0 or earlier, install the next version by hand once. Close MSP++ before running an installer by hand. Uninstall from Windows Settings → Apps; your data folder is kept.
- **`MSP++ <version>.exe`** – Portable. Runs from wherever you put it, nothing is installed. It tells you when a new version is out but can't update itself.

Both use the same data folder (see [Where Are Backups Stored?](#where-are-backups-stored)), so you can switch between them.


### Prerequisites
- [Node.js](https://nodejs.org/) v20.19 or later (the release builds use Node 22)

### Install & Run

```bash
npm install
npm start
```

On first launch, open **Settings** (`Ctrl+,`) → **General** and set the **Home URL** to the page you want new tabs to open, such as your Freshservice instance (e.g. `https://yourcompany.freshservice.com/`) or ConnectWise Manage. It starts as the Freshservice login page. Log in once; the session persists across launches.

### Lint & Test

```bash
npm run lint
npm test
```

### Build a Distributable

```bash
# Windows portable .exe and installer
npm run build

# Just one of them
npm run build-portable
npm run build-installer

# macOS .dmg
npm run build-mac
```

Pushing a `v*` tag runs the GitHub Actions workflow, which lints, tests and builds both platforms and attaches them to a GitHub release. The release also gets `latest.yml` and the installer's `.blockmap`: installed copies read `latest.yml` to find and download updates, so a release without it won't reach them.

Output is placed in the `dist/` folder.

---

## Metrics Bar Setup

1. Open **Settings** (`Ctrl+,`) and go to **Plugins → Metrics Bar**
2. Enable the toggle and choose a **Refresh interval**
3. Click **+ Add Dashboard** and paste the URL of your BrightGauge public dashboard
4. Click **+ Add Field** — the dashboard opens in a picker overlay
5. Wait for the page to fully load, then click the value you want to track
6. Give the field a label and click **Add Metric**
7. Repeat for each value; the bar appears above the tabs once at least one field is saved
8. To pull stats from a second dashboard, click **+ Add Dashboard** again and repeat the process — all fields appear together in the bar

**Tips:**
- For leaderboard tables, click the value column cell in the row for your name — the picker anchors the selector to your name automatically, so it stays correct if your rank changes
- If a field shows `(not found — check selector)`, click **Test selectors** next to that dashboard to trigger an immediate scrape and see per-field results
- The **Re-pick** button on any field lets you re-capture its selector without deleting and re-adding it
- Clicking a metric card in the bar opens that card's source dashboard in a new tab
- A Freshservice dashboard widget is drawn after the page loads, so the bar keeps reading until the numbers hold steady (up to 30 seconds)

**Freshservice API queries (optional):** with the API key set in **Settings → Plugins → Freshservice**, fill in a field's **API query** and click **Test** to see the count. Freshservice has no API for dashboard widgets, so the query has to describe the same tickets as the widget. Filterable fields are `agent_id`, `group_id`, `requester_id`, `status` (2 Open, 3 Pending, 4 Resolved, 5 Closed), `priority`, `impact`, `urgency`, `tag`, `due_by`, `fr_due_by`, `created_at`, `updated_at` and custom fields. Text and dates go in single quotes, e.g. `agent_id:123 AND status:4 AND updated_at:>'{weekStart}'`. There is no "resolved on" date, so counts of tickets resolved this week can only be approximated with `updated_at`, and dates are compared in UTC.

---

## AI Assistant Setup

The AI Assistant is a bundled plugin. Make sure it is enabled in **Settings → Plugins** (it is on by default).

1. Open **Settings** (`Ctrl+,`) and go to **Plugins → AI Features**
2. Choose a **Provider**:
   - **Hatz AI** – paste your API key from the [Hatz Admin Dashboard](https://ai.hatz.ai)
   - **OpenAI** – paste a key from [platform.openai.com](https://platform.openai.com/api-keys)
   - **Anthropic** – paste a key from [console.anthropic.com](https://console.anthropic.com/settings/keys)
   - **Azure OpenAI** – see [Azure OpenAI](#azure-openai) below
   - **Microsoft 365 Copilot** – see [Microsoft 365 Copilot](#microsoft-365-copilot) below
3. For Hatz, OpenAI and Anthropic, the **Model** dropdown populates automatically once a valid key is saved
4. Select the model you want to use

The ✨ Suggest and 📋 Summarize buttons appear in the note panel once a provider and API key are configured.

A saved API key only works with the provider it was entered for. If you switch providers, paste that provider's key; the old key is never sent to the new provider.

### Azure OpenAI

Uses Microsoft-hosted OpenAI models in your own Azure OpenAI or Azure AI Foundry resource.

1. In the Azure portal (or [ai.azure.com](https://ai.azure.com)), deploy a chat model such as `gpt-4o` and note the **deployment name**
2. From the resource's **Keys and Endpoint** page, copy the **Endpoint** (e.g. `https://your-resource.openai.azure.com/`) and a **Key**
3. In **Settings → Plugins → AI Features**, choose **Azure OpenAI** and fill in **Endpoint**, **Deployment Name** and **API Key**

Requests go to the Azure OpenAI v1 API (`/openai/v1/chat/completions`). The key is tied to the endpoint it was entered for, so if you change the endpoint, enter the key again.

### Microsoft 365 Copilot

Uses Microsoft 365 Copilot through the [Microsoft 365 Copilot Chat API](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/overview). Each person signs in with their own work account.

> **Note:** The Chat API is currently in **preview** (Microsoft Graph `/beta`) and may change. Copilot also draws on the user's Microsoft 365 data (mail, chats, files) when answering; this app turns off web search grounding for every request.

**Requirements**
- Each user needs a **Microsoft 365 Copilot** license (the add-on license; free Copilot Chat isn't supported by the API)
- A one-time **Entra ID app registration**, set up by a tenant admin

**Admin setup (once per tenant)**
1. In the [Entra admin center](https://entra.microsoft.com), go to **App registrations → New registration**
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: platform **Public client/native (mobile & desktop)**, value `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add all of:
   `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All`
   (the Chat API requires every one of these), then click **Grant admin consent**
3. Share the **Directory (tenant) ID** and **Application (client) ID** from the app's **Overview** page with your team

**Per-user setup**
1. In **Settings → Plugins → AI Features**, choose **Microsoft 365 Copilot**
2. Enter the **Directory (Tenant) ID** (or your domain, e.g. `contoso.onmicrosoft.com`) and **Application (Client) ID**
3. Click **Sign in** and complete the Microsoft sign-in window

Your sign-in is stored encrypted with the operating system's credential store in the app's data folder (never in `settings.json`) and refreshes automatically. Click **Sign out** to remove it.

---

## Plugins

The **Freshservice** and **ConnectWise Manage** site plugins, **Note Backup**, **Metrics Bar**, **AI Features** and **Solutions Chat** are delivered as bundled plugins and are always available. To install additional plugins, drop a plugin directory into the app's user data folder:

```
%APPDATA%\MSP++\plugins\        (or %APPDATA%\Freshservice++\plugins\ if you upgraded)
  my-plugin\
    manifest.json
    renderer.js
```

Restart the app to activate newly installed plugins. Use **Settings → Plugins** to enable or disable any installed plugin.

For plugin development documentation — including the full API reference and a step-by-step walkthrough — see [`docs/plugins.md`](docs/plugins.md). To add support for another ticketing site, see [`docs/sites.md`](docs/sites.md). A reference skeleton with annotated examples lives in [`docs/example-plugin/`](docs/example-plugin/).

---

## Troubleshooting

- **Freshservice doesn't load** – The app sends a standard Chrome user-agent to `*.freshservice.com`, `*.freshworks.com` and `*.myfreshworks.com`. Ensure you have network access to your Freshservice instance, and set your instance URL (e.g. `https://yourcompany.freshservice.com/`) as the **Home URL** in Settings → General.
- **ConnectWise Manage doesn't load** – The app sends the same Chrome user-agent to `*.myconnectwise.net`. Check that the **ConnectWise Manage** plugin is enabled in Settings → Plugins.
- **Login issues** – The embedded browser keeps its own session cookies. Log in once and the session will persist across launches.
- **Live sync not working** – Freshservice only shows a note editor after you click **Add note** or **Reply** on a ticket, so open one first. On ConnectWise Manage, open a time entry or the stopwatch. The sync status pill at the bottom of the panel shows the current state (`⇅ Synced`, `⇅ Pushing…`, `⇅ No notes field`).
- **Ticket number not detected** – On Freshservice, detection relies on the record URL (`/a/tickets/<id>`, `/a/changes/<id>`, …); on ConnectWise Manage it uses the URL or the ticket page. You can always type an ID into the **Ticket / Reference ID** box manually.
- **Metrics bar shows `—` or `(not found)`** – Open Settings → Plugins → Metrics Bar, click **Test selectors** next to the relevant dashboard to trigger an immediate scrape and see per-field results. If a field still shows `(not found — check selector)`, use **Re-pick** on that field, wait for the dashboard to fully load in the picker, then click the correct value to recapture the selector.
- **Metrics bar shows `⚠` on a card** – The last refresh for that field failed (network issue, dashboard changed, etc.). The value shown is the last successfully cached value. Hover the `⚠` to see when it was last updated. The app will retry on the next poll interval.
- **Passkey sign-in doesn't offer Touch ID on macOS** – Electron only supports Touch ID passkeys in a signed build with a keychain entitlement, which the macOS build doesn't have yet. USB security keys still work. On Windows, passkeys go through Windows Hello, so check that Windows Hello is set up in Windows Settings → Accounts → Sign-in options.
- **A site says the microphone, camera or location is blocked** – You (or an earlier answer) chose **Block** for that site. Click **Forget Saved Answers** under Settings → General → Site Permissions and reload the page to be asked again.
- **No automatic update** – Only the installed Windows app updates itself. The portable .exe and the Mac app show **Update Available** with a link instead; download the new version from the release. Installed copies on 0.7.0 or earlier need one manual install of a newer version first.
- **Freshservice API or Azure OpenAI stopped working after changing the domain or endpoint** – Saved keys only work with the address they were entered for. Paste the key again.
- **Blank screen or errors** – Press `Ctrl+Shift+I` to open DevTools and check the console.
