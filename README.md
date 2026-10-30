# Freshservice++

An Electron-based wrapper for Freshservice that adds a persistent note editor, automatic backups, live two-way sync, AI assistance, a live metrics bar, and quality-of-life browser improvements on top of the standard web interface.

**Current version:** 0.5.2

---

## Features

### Browser
- **Multi-tab browsing** – Open multiple Freshservice pages simultaneously; tabs persist between launches
- **Tab management** – Pin tabs, duplicate, close others, reopen closed tabs, copy URL, open in default browser (right-click any tab)
- **Find in page** – `Ctrl+F` to search text on the current page
- **Download manager** – Tracks in-progress and completed downloads with open/show-in-folder actions; a badge on the download icon shows how many files finished since you last opened the panel (resets when you open it)
- **Image context menu** – Right-click any image for **Copy Image** (copies pixel data to clipboard) and **Save Image As…** (native save dialog); image links open as downloads instead of new tabs

### Note Editor
- **Rich text side panel** – Draft and edit notes with a full formatting toolbar (bold, italic, underline, lists, clear formatting)
- **Auto-save** – Notes are saved to disk ~1.5 seconds after you stop typing
- **Manual snapshots** – Click **💾 Save Snapshot** to create a timestamped backup at any time
- **Snapshot threshold** – Configurable minimum character difference before an auto-snapshot is triggered on tab switch or sync pull (default: 5 chars)
- **History & restore** – Browse all saved snapshots per ticket and click any entry to restore it
- **Note search** – Full-text search across all saved notes and autosave drafts
- **Copy to clipboard** – One-click copy of the current note
- **Signatures** – Save an HTML signature that can be inserted at the end of any note
- **Templates** – Create reusable note templates accessible from the toolbar
- **HTML source view** – Toggle button in the toolbar swaps the rich-text editor for a raw HTML textarea; formatting toolbar is disabled while in HTML mode and re-enabled on exit

### Freshservice Sync
- **Live two-way sync** – With "Live Sync" enabled, the panel and the open Freshservice note editor (the rich-text **Add note** / **Reply** editor, or a note textarea such as the one on the time-entry form) stay in sync as you type — no manual copy-paste needed. When several editors are open, the one you last clicked into is used
- **Pull from FS / Push to FS** – Manual sync buttons for when live sync is off or you want an explicit transfer
- **Auto ticket detection** – The ticket number is read from the page URL (`/a/tickets/1234`), so switching tabs or navigating between tickets automatically loads the correct content into the panel. Changes, problems and releases are tracked too, saved as `CHN-45`, `PRB-12` and `RL-3` so they never collide with ticket numbers

### Metrics Bar

A configurable stats bar displayed above the tab strip that periodically scrapes live numbers from one or more BrightGauge public dashboards.

- **Multiple dashboards** – Add as many dashboard sources as you need; fields from all dashboards are shown together in the bar
- **Auto-poll** – Refreshes on a configurable interval (5 / 15 / 30 / 60 minutes); a manual refresh button is also available
- **Visual field picker** – Click **+ Add Field**, navigate the dashboard inside the built-in picker overlay, then click any value to capture it; the app auto-generates a stable selector anchored to the person/row name rather than a fragile DOM position
- **Per-field labels** – Each metric displays a custom label beneath the value
- **View dashboard** – Click any metric card to open that card's source dashboard in a new tab
- **Editable selectors** – Each field's captured selector is shown in Settings and can be manually corrected; a **Test selectors** button per dashboard re-scrapes immediately and updates the "→ found value" badges
- **Re-pick** – Individual fields can be re-picked at any time without losing the others
- **Progress tracking** – Each field can have a configurable weekly target. Values turn green when the goal is reached, yellow when slightly behind pace, and red when significantly behind. Hover any card to see the exact on-track value for the current point in the week.
- **Cached values** – The last successfully scraped value for each field is persisted across launches; if a refresh fails the bar continues showing the cached value with a `⚠` indicator and a tooltip showing when it was last updated
- **Delivered as a bundled plugin** — the Metrics Bar is implemented via the plugin system; it can be disabled independently from Settings → Plugins

### AI Assistant
- **✨ Suggest** – Sends your current notes to the configured AI model and presents an improved version in a review overlay; apply or dismiss before anything changes. After a suggestion is returned, a **Refine** textarea appears — type follow-up instructions (e.g. "make it shorter", "keep this as a client-facing message") and click **↺ Refine** to generate a revised version without losing the Apply option
- **📋 Summarize** – Reads the ticket description, replies and notes from the open Freshservice ticket (through the Freshservice API when it's set up, otherwise from the page) and asks the AI to produce a concise bullet-point summary
- Supports **Hatz AI**, **OpenAI**, **Anthropic**, **Azure OpenAI**, and **Microsoft 365 Copilot** as providers; for Hatz, OpenAI and Anthropic the model dropdown is populated automatically from the provider's API once an API key is entered
- **Delivered as a bundled plugin** — AI Features is implemented via the plugin system; it can be disabled independently from Settings → Plugins

### Freshservice API
- **Ticket details through the API** – With your Freshservice domain and API key entered under Settings → Freshservice API, Summarize and Suggest read the ticket's subject, status, priority, requester, description and every reply and note through the Freshservice REST API (v2) instead of scraping the page
- **Automatic fallback** – If the API is turned off, not set up, rate-limited or returns an error, or the open record is a change, problem or release, the page is read exactly as before
- **Safe key storage** – The API key is encrypted with the operating system's credential storage, never sent to the main window, and only sent to the configured domain over https. **Test connection** checks it and **Remove key** deletes it
- **Delivered as a bundled plugin** — it can be disabled independently from Settings → Plugins

### Plugin System

Extend the app with self-contained plugin directories — no build step required.

- **Bundled plugins** – Ship with the app and are always available (e.g. the Metrics Bar)
- **User-installed plugins** – Drop a plugin folder into `%APPDATA%\freshservice-pp\plugins\` for plugins that survive app updates
- **Plugin management** – Enable or disable individual plugins from Settings → Plugins; restart to apply
- **Import plugin** – Click **Import Plugin** in Settings → Plugins to install a plugin from a folder on disk via a file dialog (no manual copy-paste required); an error is shown if a plugin with the same ID is already installed
- Plugins can add toolbar buttons, Settings panels, backend IPC handlers, DOM elements, and application menu items
- See [`docs/plugins.md`](docs/plugins.md) for the full development guide and [`docs/example-plugin/`](docs/example-plugin/) for a reference skeleton

### Notifications
A bell icon in the tab bar shows a badge when there are unread notifications. Current notification types:
- **Update available** – Checks GitHub Releases on startup and alerts you when a newer version is published; includes View Release, Hide for now, and Don't remind me for this version actions
- **Auto-save failed** – Fires once if a note cannot be written to disk (permissions or disk-full)
- **Backup storage warning** – Alerts when the backup folder exceeds a configurable size threshold (default: 100 MB; set to 0 to disable)
- **Live sync push failed** – Fires once when the first push to a Freshservice notes field fails (e.g. session expired)

### Appearance & Settings
- **Dark / Light theme**
- **Collapsible panel** – Hide the side panel entirely; a slim toggle button brings it back
- **Resizable panel** – Drag the divider to adjust the panel width
- **Window state persistence** – The main window restores its last size and position on launch; validated against connected displays so it never opens off-screen
- **Native settings window** – Settings open in a separate OS window (`Ctrl+,` or **Edit → Settings**); the main window stays fully usable while settings are open. Re-invoking the shortcut focuses the existing window rather than opening a second one
- **Category sidebar** – Settings are organised into sections (General, Data, Templates, Signature, Plugins) accessible from a left-hand nav; enabled plugins that provide a settings panel appear as indented sub-items under Plugins automatically
- All settings are persisted to disk and applied to the main window immediately

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` | Save snapshot |
| `Ctrl+Shift+B` | Toggle side panel |
| `Ctrl+Shift+V` | Paste as plain text (in note editor) |
| `Ctrl+F` | Find in page |
| `Alt+Left` | Navigate back |
| `Alt+Right` | Navigate forward |
| `F5` | Refresh active tab |
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+1` – `Ctrl+9` | Switch to tab by position |

---

## Where Are Backups Stored?

All data is saved under Electron's `userData` directory:

```
%APPDATA%\freshservice-pp\note-backups\
```

Inside you'll find:
- `autosave.json` – Latest auto-saved draft for each ticket
- `settings.json` – All app settings
- `open-tabs.json` – Tab URLs restored on next launch
- A folder per ticket ID containing timestamped `.html` snapshot files

Click **📁 Open Folder** in the app to jump there directly.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or later

### Install & Run

```bash
npm install
npm start
```

On first launch, open **Settings** (`Ctrl+,`) → **General** and set the **Home URL** to your Freshservice instance (e.g. `https://yourcompany.freshservice.com/`). Log in once; the session persists across launches.

### Build a Distributable

```bash
# Windows portable .exe
npm run build

# macOS .dmg
npm run build-mac
```

Output is placed in the `dist/` folder.

---

## Metrics Bar Setup

1. Open **Settings** (`Ctrl+,`) and go to the **Metrics Bar** section
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

Requests go to the Azure OpenAI v1 API (`/openai/v1/chat/completions`).

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

The **Metrics Bar** and **AI Features** are both delivered as bundled plugins and are always available. To install additional plugins, drop a plugin directory into the app's user data folder:

```
%APPDATA%\freshservice-pp\plugins\
  my-plugin\
    manifest.json
    renderer.js
```

Restart the app to activate newly installed plugins. Use **Settings → Plugins** to enable or disable any installed plugin.

For plugin development documentation — including the full API reference and a step-by-step walkthrough — see [`docs/plugins.md`](docs/plugins.md). A reference skeleton with annotated examples lives in [`docs/example-plugin/`](docs/example-plugin/).

---

## Troubleshooting

- **Freshservice doesn't load** – The app sends a standard Chrome user-agent to `*.freshservice.com`, `*.freshworks.com` and `*.myfreshworks.com`. Ensure you have network access to your Freshservice instance, and set your instance URL (e.g. `https://yourcompany.freshservice.com/`) as the **Home URL** in Settings → General.
- **Login issues** – The embedded browser keeps its own session cookies. Log in once and the session will persist across launches.
- **Live sync not working** – Freshservice only shows a note editor after you click **Add note** or **Reply** on a ticket, so open one first. The sync status pill at the bottom of the panel shows the current state (`⇅ Synced`, `⇅ Pushing…`, `⇅ No FS field`).
- **Ticket number not detected** – Detection relies on the record URL (`/a/tickets/<id>`, `/a/changes/<id>`, …). You can always type an ID into the **Ticket / Reference ID** box manually.
- **Metrics bar shows `—` or `(not found)`** – Open Settings → Metrics Bar, click **Test selectors** next to the relevant dashboard to trigger an immediate scrape and see per-field results. If a field still shows `(not found — check selector)`, use **Re-pick** on that field, wait for the dashboard to fully load in the picker, then click the correct value to recapture the selector.
- **Metrics bar shows `⚠` on a card** – The last refresh for that field failed (network issue, dashboard changed, etc.). The value shown is the last successfully cached value. Hover the `⚠` to see when it was last updated. The app will retry on the next poll interval.
- **Blank screen or errors** – Press `Ctrl+Shift+I` to open DevTools and check the console.
