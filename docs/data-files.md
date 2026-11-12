# Files and folders MSP++ uses

This page lists every file and folder MSP++ reads from or writes to, so you know what to back up, what to exclude from antivirus or cleanup tools, and what is left behind after uninstalling.

**R** means the app reads it, **W** means it writes it, and **D** means it can delete it.

## The data folder

Everything the app keeps lives in one data folder, called **DATA** below.

| OS | Path |
|---|---|
| Windows | `%APPDATA%\MSP++\` (usually `C:\Users\<you>\AppData\Roaming\MSP++\`) |
| macOS | `~/Library/Application Support/MSP++/` |

If the app was used when it was called Freshservice++, it keeps using the old folder: `%APPDATA%\Freshservice++\` or `%APPDATA%\freshservice-pp\` (and the same names on macOS). It picks the old folder when the MSP++ folder has no `note-backups` subfolder yet and an old one does. Nothing is moved, so an older build pointed at the same folder still works.

Uninstalling MSP++ leaves the data folder in place.

## App files: `DATA\note-backups\`

The folder is still called `note-backups` from before Note Backup became a plugin.

| File | Access | What it holds |
|---|---|---|
| `settings.json` | R W | All app and plugin settings, including bookmarks and canned responses. Freshservice and AI API keys are stored encrypted (Windows DPAPI or the macOS keychain, through Electron's `safeStorage`). |
| `open-tabs.json` | R W | Tabs open at close, reopened on the next launch. |
| `main-window-state.json` | R W | Main window size, position and maximized state. |
| `site-permissions.json` | R W | Saved Allow / Block answers to site permission prompts. Cleared by the reset button in Settings → General. |
| `plugins-config.json` | R W | Which plugins are turned on. |

## Note Backup: `DATA\note-backups\`

| File | Access | What it holds |
|---|---|---|
| `autosave.json` | R W | The latest draft for each ticket. |
| `<ticket>\<timestamp>.html` | R W D | Manual and automatic snapshots, one folder per ticket (Freshservice tickets by number, ConnectWise tickets as `CW-<number>`). Retention cleanup deletes old snapshots and removes ticket folders once they're empty. |
| `editor-state.json` | R W | Whether the note editor was blank when the app closed. |
| `legacy-import.json` | R W | Which ConnectWise Manage++ notes have already been imported. |
| `autosave.json.corrupt-<time>` | W | A copy of `autosave.json`, written only if it couldn't be read. |

## ConnectWise Manage++ import (read only)

At startup, Note Backup copies notes from ConnectWise Manage++ if it was used on the same computer. It reads `autosave.json` and the ticket folders in:

- `%APPDATA%\connectwise-manage-pp\note-backups\`
- `%APPDATA%\ConnectWise Manage++\note-backups\`

(and the same names under `~/Library/Application Support/` on macOS). These folders are never changed.

## Plugin data: `DATA\plugins\<plugin-id>\`

Plugins get their own folder through `api.getDataPath()`. It is created the first time a plugin asks for it.

| File | Access | What it holds |
|---|---|---|
| `tree-tabs\tree.json` | R W | The Tree Style Tabs tree. |
| `time-tracker\timers.json` | R W | Running and stopped timers. If it can't be read, it is kept as `timers.json.corrupt-<time>` and a new list is started. |
| `recent-tickets\recent.json` | R W | The Recent Tickets list (site, ticket, subject, link, when it was last viewed, pinned). If it can't be read, it is kept as `recent.json.corrupt-<time>` and a new list is started. |
| `ticket-notifications\state.json` | R W | Which tickets and updates have already been seen. |
| `ai-features\m365-token.dat` | R W D | The encrypted Microsoft 365 sign-in. Deleted when you sign out. |

`DATA\plugins\` is also where user-installed plugins go. The app reads every plugin folder in it at startup, and **Settings → Plugins → Import Plugin** copies the folder you pick into it.

## Browser profile: `DATA\`

Electron (Chromium) keeps the browsing data for the tabs here. This is where your site sign-ins live, so deleting these signs you out of every site. All are read and written by Electron itself:

- `Cookies`, `Network\` – cookies and sign-ins
- `Local Storage\`, `Session Storage\`, `IndexedDB\` – site storage (the Metrics Bar plugin also keeps a few values in Local Storage)
- `Cache\`, `Code Cache\`, `GPUCache\` – caches, safe to delete while the app is closed
- `Preferences`, `Crashpad\`, the single-instance lock files and other Chromium housekeeping files
- `Partitions\fspp-m365-auth\` – a separate profile used only by the Microsoft 365 sign-in window

## Install and update locations (Windows)

| Location | Access | What it is |
|---|---|---|
| `%LOCALAPPDATA%\Programs\MSP++\` | R W | Installed app, when installed just for you (the default). |
| `C:\Program Files\MSP++\` | R W | Installed app, when installed for everyone on the PC. |
| Start menu and desktop shortcuts | W | Added by the installer. |
| Uninstall entry in the registry (HKCU or HKLM) | W | Added by the installer, so the app shows in Windows Settings → Apps. |
| `%LOCALAPPDATA%\msp-pp-updater\` | R W D | Updates downloaded by the installed app, installed from here when you quit. |
| A temporary folder under `%TEMP%` | R W | The portable `.exe` unpacks itself here each time it starts. |

## Files you choose

- **Downloads** and **Save Image As** go wherever you pick in the Save dialog. The download list in the app is kept in memory only and is cleared on restart.
- **Import Plugin** reads the folder you pick.

## Logs

MSP++ doesn't write log files. Messages from the app and plugins go to the developer console only.
