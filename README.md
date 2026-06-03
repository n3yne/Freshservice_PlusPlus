# ConnectWise Manage++

An Electron-based wrapper for ConnectWise Manage that adds a persistent note editor, automatic backups, live two-way sync, AI assistance, and quality-of-life browser improvements on top of the standard web interface.

**Current version:** 0.1.2

---

## Features

### Browser
- **Multi-tab browsing** – Open multiple ConnectWise pages simultaneously; tabs persist between launches
- **Tab management** – Pin tabs, duplicate, close others, reopen closed tabs, copy URL, open in default browser (right-click any tab)
- **Find in page** – `Ctrl+F` to search text on the current page
- **Download manager** – Tracks in-progress and completed downloads with open/show-in-folder actions and an active-download badge

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

### ConnectWise Sync
- **Live two-way sync** – With "Live Sync" enabled, the panel and the active CW notes field (Draft.js time-entry editor or stopwatch textarea) stay in sync as you type — no manual copy-paste needed
- **Pull from CW / Push to CW** – Manual sync buttons for when live sync is off or you want an explicit transfer
- **Auto ticket detection** – Switching tabs automatically loads the correct ticket content into the panel

### AI Assistant
- **✨ Suggest** – Sends your current notes to the configured AI model and presents an improved version in a review overlay; apply or dismiss before anything changes
- **📋 Summarize** – Scrapes all visible note content from the active CW ticket page and asks the AI to produce a concise bullet-point summary
- Supports **Hatz AI** as the provider; model is selected from a live dropdown populated from the API

### Notifications
A bell icon in the tab bar shows a badge when there are unread notifications. Current notification types:
- **Update available** – Checks GitHub Releases on startup and alerts you when a newer version is published; includes View Release, Hide for now, and Don't remind me for this version actions
- **Auto-save failed** – Fires once if a note cannot be written to disk (permissions or disk-full)
- **Backup storage warning** – Alerts when the backup folder exceeds a configurable size threshold (default: 100 MB; set to 0 to disable)
- **Live sync push failed** – Fires once when the first push to a CW notes field fails (e.g. session expired)

### Appearance & Settings
- **Dark / Light theme**
- **Collapsible panel** – Hide the side panel entirely; a slim toggle button brings it back
- **Resizable panel** – Drag the divider to adjust the panel width
- All settings are persisted to disk and applied immediately

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
%APPDATA%\connectwise-manage-pp\note-backups\
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

### Build a Distributable

```bash
# Windows portable .exe
npm run build

# macOS .dmg
npm run build-mac
```

Output is placed in the `dist/` folder.

---

## AI Assistant Setup

1. Open **Settings** and go to the **AI Assistant** section
2. Set **Provider** to **Hatz AI**
3. Paste your API key from the [Hatz Admin Dashboard](https://ai.hatz.ai)
4. Select a model from the dropdown (populated automatically from the API)

The ✨ Suggest and 📋 Summarize buttons will appear in the note panel once a provider is configured.

---

## Troubleshooting

- **ConnectWise doesn't load** – The app sets a Chrome user-agent for `*.myconnectwise.net`. Ensure you have network access to your CW instance.
- **Login issues** – The embedded browser keeps its own session cookies. Log in once and the session will persist across launches.
- **Live sync not working** – Check that you're on a ticket page with a visible notes field. The sync status pill at the bottom of the panel shows the current state (`⇅ Synced`, `⇅ Pushing…`, `⇅ No CW field`).
- **Blank screen or errors** – Press `Ctrl+Shift+I` to open DevTools and check the console.
