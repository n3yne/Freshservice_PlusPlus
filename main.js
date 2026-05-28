"use strict";

const electron = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { DEFAULT_SETTINGS, sanitizeTicketId, validateSettings } = require("./utils");

let mainWindow;
let BACKUP_DIR;
let AUTOSAVE_FILE;
let TABS_FILE;
let SETTINGS_FILE;
let EDITOR_STATE_FILE;

// Microsoft SSO hostnames — these popups communicate login state back to the
// ConnectWise page via window.opener / postMessage and must open as real windows.
const MICROSOFT_SSO_PATTERNS = [
  /^login\.microsoftonline\.com$/i,
  /^login\.microsoft\.com$/i,
  /^login\.live\.com$/i,
];

// CW's SSO flow often starts on the CW domain (e.g. an auth redirect endpoint)
// before handing off to Microsoft. Popups to these path segments on the CW
// domain are allowed as real windows so the redirect chain isn't broken.
// Everything else on the CW domain (PDFs, reports, etc.) goes to a tab.
// The pattern requires a path-segment boundary after the keyword so that
// e.g. /ConnectWise.aspx does not accidentally match /connect.
const CW_HOSTNAME_PATTERN = /\.myconnectwise\.net$/i;
const CW_AUTH_PATH_PATTERN =
  /\/(?:auth|login|sso|oauth|saml|openid|signin)(?:[/?#]|$)/i;

// ===================== Settings Persistence =====================

async function loadSettings() {
  try {
    const raw = await fsp.readFile(SETTINGS_FILE, "utf-8");
    return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[Settings] Error loading settings:", e);
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

async function saveSettings(settings) {
  try {
    await ensureBackupDir();
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("[Settings] Error saving settings:", e);
  }
}

async function ensureBackupDir() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}

// ===================== Auto-Cleanup Old Backups =====================

async function cleanupOldBackups() {
  try {
    await ensureBackupDir();
    const settings = await loadSettings();
    const retentionDays = settings.backupRetentionDays;

    if (retentionDays === 0) {
      console.log("[Cleanup] Retention set to 0 (keep forever) — skipping cleanup");
      return;
    }

    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;
    let deletedFiles = 0;
    let deletedDirs = 0;
    let prunedAutosaves = 0;

    // 1. Scan all ticket history folders and delete old snapshot files
    const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const ticketDir = path.join(BACKUP_DIR, entry.name);
      const files = await fsp.readdir(ticketDir);

      for (const file of files) {
        if (!file.endsWith(".html") && !file.endsWith(".txt")) continue;

        const filePath = path.join(ticketDir, file);
        try {
          const stat = await fsp.stat(filePath);
          if (stat.mtimeMs < cutoff) {
            await fsp.unlink(filePath);
            deletedFiles++;
          }
        } catch {
          // Skip files we can't stat/delete
        }
      }

      // 2. Remove the ticket folder if it's now empty
      const remaining = await fsp.readdir(ticketDir);
      if (remaining.length === 0) {
        await fsp.rmdir(ticketDir);
        deletedDirs++;
      }
    }

    // 3. Prune stale autosave entries (old + no remaining history folder)
    try {
      const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
      const data = JSON.parse(raw);
      let changed = false;

      for (const [ticketId, info] of Object.entries(data)) {
        const updatedAt = new Date(info.updatedAt || 0).getTime();
        if (updatedAt >= cutoff) continue;

        const historyDir = path.join(BACKUP_DIR, ticketId);
        let hasHistory = false;
        try {
          const histFiles = await fsp.readdir(historyDir);
          hasHistory = histFiles.some((f) => f.endsWith(".html") || f.endsWith(".txt"));
        } catch {
          // Directory doesn't exist — no history
        }

        if (!hasHistory) {
          delete data[ticketId];
          prunedAutosaves++;
          changed = true;
        }
      }

      if (changed) {
        await fsp.writeFile(AUTOSAVE_FILE, JSON.stringify(data, null, 2), "utf-8");
      }
    } catch (e) {
      if (e.code !== "ENOENT") console.error("[Cleanup] Error pruning autosaves:", e);
    }

    if (deletedFiles > 0 || deletedDirs > 0 || prunedAutosaves > 0) {
      console.log(
        `[Cleanup] Removed ${deletedFiles} old snapshot(s), ${deletedDirs} empty folder(s), ${prunedAutosaves} stale autosave(s) (older than ${retentionDays} days)`,
      );
    } else {
      console.log(
        `[Cleanup] Nothing to clean up (all backups are within ${retentionDays} days)`,
      );
    }
  } catch (err) {
    console.error("[Cleanup] Error during auto-cleanup:", err);
  }
}

function createWindow() {
  // Ensure the backup directory exists early; IPC handlers also call this
  // individually, so this is just a best-effort warm-up.
  ensureBackupDir().catch((e) => console.error("[App] Error creating backup dir:", e));

  mainWindow = new electron.BrowserWindow({
    width: 1600,
    height: 1000,
    title: "ConnectWise Manage++",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true,
    },
  });

  mainWindow.loadFile("index.html");

  // ===================== Application Menu =====================
  const menuTemplate = [
    {
      label: "File",
      submenu: [{ role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find...",
          accelerator: "CmdOrCtrl+F",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("find-in-page");
            }
          },
        },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("open-settings");
            }
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ];

  const menu = electron.Menu.buildFromTemplate(menuTemplate);
  electron.Menu.setApplicationMenu(menu);

  // ===================== Renderer Context Menu (notes editor, inputs) =====================
  mainWindow.webContents.on("context-menu", (event, params) => {
    const menuItems = [];

    // Spellcheck suggestions (if any)
    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuItems.push(
          new electron.MenuItem({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion),
          }),
        );
      }
      menuItems.push(new electron.MenuItem({ type: "separator" }));
    }

    // Add misspelled word to dictionary
    if (params.misspelledWord) {
      menuItems.push(
        new electron.MenuItem({
          label: `Add "${params.misspelledWord}" to Dictionary`,
          click: () =>
            mainWindow.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        }),
      );
      menuItems.push(new electron.MenuItem({ type: "separator" }));
    }

    // Standard editing actions
    if (params.isEditable) {
      menuItems.push(new electron.MenuItem({ role: "undo" }));
      menuItems.push(new electron.MenuItem({ role: "redo" }));
      menuItems.push(new electron.MenuItem({ type: "separator" }));
      menuItems.push(new electron.MenuItem({ role: "cut" }));
      menuItems.push(new electron.MenuItem({ role: "copy" }));
      menuItems.push(new electron.MenuItem({ role: "paste" }));
      menuItems.push(new electron.MenuItem({ type: "separator" }));
      menuItems.push(new electron.MenuItem({ role: "selectAll" }));
    } else if (params.selectionText) {
      // Non-editable area but text is selected — offer copy
      menuItems.push(new electron.MenuItem({ role: "copy" }));
    }

    if (menuItems.length > 0) {
      const contextMenu = electron.Menu.buildFromTemplate(menuItems);
      contextMenu.popup();
    }
  });

  // Open external links in the default browser (only http/https)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        electron.shell.openExternal(url);
      }
    } catch {
      // Ignore invalid URLs
    }
    return { action: "deny" };
  });

  // Intercept keyboard shortcuts from webview guest pages that Electron's menu
  // accelerator may not capture reliably on Windows (e.g. Ctrl+,).
  mainWindow.webContents.on("did-attach-webview", (event, webviewContents) => {
    webviewContents.on("before-input-event", (e, input) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (input.type !== "keyDown") return;
      // Ctrl+, → Settings
      if (input.control && !input.shift && !input.alt && input.key === ",") {
        mainWindow.webContents.send("open-settings");
      }
    });
  });

  // Intercept new-window requests from webview guest pages and redirect to tabs
  mainWindow.webContents.on("did-attach-webview", (event, webviewContents) => {
    webviewContents.setWindowOpenHandler(({ url }) => {
      // Microsoft SSO popups and CW auth-path popups open as real windows so the
      // window.opener / postMessage login handshake works. Everything else goes
      // to a new tab. The console log below shows the exact URL and disposition
      // for each popup — useful if the SSO flow breaks and you need to widen the
      // auth-path pattern.
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        console.log("[Popup] window.open() from webview:", url);

        const isMicrosoftSSO = MICROSOFT_SSO_PATTERNS.some((re) => re.test(host));
        const isCwAuthPopup =
          CW_HOSTNAME_PATTERN.test(host) &&
          CW_AUTH_PATH_PATTERN.test(parsed.pathname);

        if (isMicrosoftSSO || isCwAuthPopup) {
          console.log("[Popup] Allowing auth/popup window:", url);
          const parent =
            mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
          return {
            action: "allow",
            overrideBrowserWindowOptions: {
              width: 600,
              height: 700,
              ...(parent ? { parent, modal: false } : {}),
              title: "Sign In",
              webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
              },
            },
          };
        }
      } catch {
        // Invalid URL — fall through to tab redirect
      }

      // Normal links: open in a new tab instead
      mainWindow.webContents.send("open-in-new-tab", url);
      return { action: "deny" };
    });

    // Native OS right-click context menu inside webviews
    webviewContents.on("context-menu", (event, params) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      const menuItems = [];

      // Spellcheck suggestions
      if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
        for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
          menuItems.push({
            label: suggestion,
            click: () => webviewContents.replaceMisspelling(suggestion),
          });
        }
        menuItems.push({ type: "separator" });
      }
      if (params.misspelledWord) {
        menuItems.push({
          label: `Add "${params.misspelledWord}" to Dictionary`,
          click: () =>
            webviewContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        });
        menuItems.push({ type: "separator" });
      }

      // Editing actions for input/textarea fields
      if (params.isEditable) {
        menuItems.push({ label: "Cut", click: () => webviewContents.cut() });
        menuItems.push({ label: "Copy", click: () => webviewContents.copy() });
        menuItems.push({
          label: "Paste",
          click: () => webviewContents.paste(),
        });
        menuItems.push({ type: "separator" });
        menuItems.push({
          label: "Select All",
          click: () => webviewContents.selectAll(),
        });
      } else if (params.selectionText) {
        menuItems.push({
          label: "Copy",
          click: () => webviewContents.copy(),
        });
      }

      // Link actions
      if (params.linkURL) {
        if (menuItems.length > 0) menuItems.push({ type: "separator" });
        menuItems.push({
          label: "Open Link in New Tab",
          click: () =>
            mainWindow.webContents.send("open-in-new-tab", params.linkURL),
        });
        menuItems.push({
          label: "Open Link in Default Browser",
          click: () => {
            try {
              const parsed = new URL(params.linkURL);
              if (
                parsed.protocol === "http:" ||
                parsed.protocol === "https:"
              ) {
                electron.shell.openExternal(params.linkURL);
              }
            } catch {
              // Ignore invalid URLs
            }
          },
        });
        menuItems.push({
          label: "Copy Link Address",
          click: () => electron.clipboard.writeText(params.linkURL),
        });
      }

      // Image actions
      if (params.mediaType === "image" && params.srcURL) {
        if (menuItems.length > 0) menuItems.push({ type: "separator" });
        menuItems.push({
          label: "Open Image in New Tab",
          click: () =>
            mainWindow.webContents.send("open-in-new-tab", params.srcURL),
        });
        menuItems.push({
          label: "Copy Image Address",
          click: () => electron.clipboard.writeText(params.srcURL),
        });
      }

      if (menuItems.length === 0) return;

      electron.Menu.buildFromTemplate(menuItems).popup({ window: mainWindow });
    });

    // Handle guest page beforeunload dialogs (e.g. unsaved form changes)
    webviewContents.on("will-prevent-unload", (e) => {
      // Show a confirmation dialog instead of silently suppressing
      const choice = electron.dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["Leave Page", "Stay"],
        title: "Leave this page?",
        message: "Changes you made may not be saved.",
        defaultId: 1,
        cancelId: 1,
      });
      if (choice === 0) {
        e.preventDefault(); // Allow the navigation/close to proceed
      }
      // If choice === 1 (Stay), do nothing — the unload is already prevented
    });

    webviewContents.on("destroyed", () => {
      // When guest webContents is destroyed, notify renderer to close the tab
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("webview-close", webviewContents.id);
      }
    });
  });
}

function registerIpcHandlers() {
  // Save a single note entry (autosave or manual)
  electron.ipcMain.handle(
    "save-note",
    async (event, { ticketId, noteContent, isManual }) => {
      await ensureBackupDir();

      const timestamp = new Date().toISOString();
      const safeTicketId = sanitizeTicketId(ticketId);

      // Always update the autosave file (latest state of all drafts)
      let autosaveData = {};
      try {
        const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
        autosaveData = JSON.parse(raw);
      } catch {
        // File doesn't exist yet or is corrupt — start fresh
      }
      autosaveData[safeTicketId] = { content: noteContent, updatedAt: timestamp };
      await fsp.writeFile(
        AUTOSAVE_FILE,
        JSON.stringify(autosaveData, null, 2),
        "utf-8",
      );

      // On manual save, also write a timestamped history file (HTML format)
      if (isManual) {
        const historyDir = path.join(BACKUP_DIR, safeTicketId);
        await fsp.mkdir(historyDir, { recursive: true });
        const safeTimestamp = timestamp.replace(/[:.]/g, "-");
        await fsp.writeFile(
          path.join(historyDir, `${safeTimestamp}.html`),
          noteContent,
          "utf-8",
        );
      }

      return { success: true, timestamp };
    },
  );

  // Load autosaved drafts
  electron.ipcMain.handle("load-autosave", async () => {
    await ensureBackupDir();
    try {
      const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  });

  // Get history for a specific ticket
  electron.ipcMain.handle("get-history", async (event, ticketId) => {
    await ensureBackupDir();
    const safeTicketId = sanitizeTicketId(ticketId);
    const historyDir = path.join(BACKUP_DIR, safeTicketId);

    try {
      const files = (await fsp.readdir(historyDir))
        .filter((f) => f.endsWith(".html") || f.endsWith(".txt"))
        .sort()
        .reverse();

      return await Promise.all(
        files.map(async (f) => ({
          filename: f,
          content: await fsp.readFile(path.join(historyDir, f), "utf-8"),
        })),
      );
    } catch {
      return [];
    }
  });

  // Get list of all tickets that have backups
  electron.ipcMain.handle("get-all-tickets", async () => {
    await ensureBackupDir();

    const entries = [];
    const seen = new Set();

    try {
      const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
      const data = JSON.parse(raw);
      for (const [ticketId, info] of Object.entries(data)) {
        const safeId = sanitizeTicketId(ticketId);
        if (seen.has(safeId)) continue;
        seen.add(safeId);
        entries.push({ ticketId: safeId, updatedAt: info.updatedAt, source: "autosave" });
      }
    } catch {
      // No autosave file yet
    }

    try {
      const dirs = (await fsp.readdir(BACKUP_DIR, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const dir of dirs) {
        const safeDir = sanitizeTicketId(dir);
        if (!seen.has(safeDir)) {
          seen.add(safeDir);
          // Find the mtime of the most recently modified file in this folder
          // so history-only tickets can show a date in the UI.
          let updatedAt = null;
          try {
            const files = await fsp.readdir(path.join(BACKUP_DIR, dir));
            let latestMs = 0;
            for (const f of files) {
              if (!f.endsWith(".html") && !f.endsWith(".txt")) continue;
              try {
                const st = await fsp.stat(path.join(BACKUP_DIR, dir, f));
                if (st.mtimeMs > latestMs) {
                  latestMs = st.mtimeMs;
                  updatedAt = new Date(st.mtimeMs).toISOString();
                }
              } catch {
                // Skip unreadable files
              }
            }
          } catch {
            // Folder unreadable — leave updatedAt as null
          }
          entries.push({ ticketId: safeDir, updatedAt, source: "history" });
        }
      }
    } catch {
      // BACKUP_DIR might not exist yet
    }

    return entries;
  });

  // Delete autosave entry for a ticket
  electron.ipcMain.handle("delete-autosave", async (event, ticketId) => {
    const safeTicketId = sanitizeTicketId(ticketId);
    try {
      const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
      const data = JSON.parse(raw);
      delete data[safeTicketId];
      await fsp.writeFile(AUTOSAVE_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // File doesn't exist or is corrupt — nothing to delete
    }
    return { success: true };
  });

  // Delete ALL data for a ticket (autosave entry + history folder)
  electron.ipcMain.handle("delete-ticket", async (event, ticketId) => {
    const safeTicketId = sanitizeTicketId(ticketId);

    // Remove from autosave.json
    try {
      const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
      const data = JSON.parse(raw);
      delete data[safeTicketId];
      await fsp.writeFile(AUTOSAVE_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // File doesn't exist or is corrupt
    }

    // Remove the history folder
    try {
      await fsp.rm(path.join(BACKUP_DIR, safeTicketId), { recursive: true, force: true });
    } catch {
      // Directory doesn't exist
    }

    return { success: true };
  });

  // Open backup folder in file explorer
  electron.ipcMain.handle("open-backup-folder", async () => {
    await ensureBackupDir();
    electron.shell.openPath(BACKUP_DIR);
    return { success: true };
  });

  // Save open tab URLs to disk (async, returns result)
  electron.ipcMain.handle("save-tabs", async (event, tabUrls) => {
    await ensureBackupDir();
    try {
      await fsp.writeFile(TABS_FILE, JSON.stringify(tabUrls, null, 2), "utf-8");
      return { success: true };
    } catch (e) {
      console.error("[Tabs] Error saving tabs:", e);
      return { success: false };
    }
  });

  // Save open tab URLs to disk (fire-and-forget sync path used by beforeunload)
  electron.ipcMain.on("save-tabs-sync", (event, tabUrls) => {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.writeFileSync(TABS_FILE, JSON.stringify(tabUrls, null, 2), "utf-8");
    } catch (e) {
      console.error("[Tabs] Error saving tabs (sync):", e);
    }
  });

  // Save editor state (blank/not-blank) synchronously on beforeunload
  electron.ipcMain.on("save-editor-state-sync", (event, state) => {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.writeFileSync(EDITOR_STATE_FILE, JSON.stringify(state), "utf-8");
    } catch (e) {
      console.error("[EditorState] Error saving editor state (sync):", e);
    }
  });

  // Load editor state on startup
  electron.ipcMain.handle("load-editor-state", async () => {
    try {
      const raw = await fsp.readFile(EDITOR_STATE_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  // Open a URL in the user's default browser
  electron.ipcMain.handle("open-in-browser", async (event, url) => {
    if (url && typeof url === "string") {
      // Only allow http/https URLs to prevent opening file:// or other schemes
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          electron.shell.openExternal(url);
        } else {
          console.warn("[Browser] Blocked non-http URL:", parsed.protocol);
        }
      } catch {
        console.warn("[Browser] Invalid URL:", url);
      }
    }
    return { success: true };
  });

  // Load settings from disk
  electron.ipcMain.handle("load-settings", async () => {
    return loadSettings();
  });

  // Save settings to disk and notify the renderer
  electron.ipcMain.handle("save-settings", async (event, settings) => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
    if (!validateSettings(merged)) {
      console.warn("[Settings] Rejected invalid settings payload");
      return { success: false };
    }
    await saveSettings(merged);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("settings-changed", merged);
    }
    return { success: true };
  });

  // Search through saved note content (autosave drafts + snapshot files)
  electron.ipcMain.handle("search-notes", async (event, query) => {
    if (!query || typeof query !== "string") return [];
    const q = query.toLowerCase().trim();
    if (!q) return [];

    function stripHtml(html) {
      return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }

    function contentPreview(text, q) {
      const lowerText = text.toLowerCase();
      const idx = lowerText.indexOf(q);
      if (idx === -1) return null;
      const start = Math.max(0, idx - 25);
      const end = Math.min(text.length, idx + q.length + 50);
      return (start > 0 ? "…" : "") + text.substring(start, end) + (end < text.length ? "…" : "");
    }

    const results = [];
    const seen = new Set();

    // 1. Search autosave.json (current drafts)
    try {
      const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
      const data = JSON.parse(raw);
      for (const [ticketId, info] of Object.entries(data)) {
        const safeId = sanitizeTicketId(ticketId);
        if (seen.has(safeId)) continue;
        const text = stripHtml(info.content || "");
        const lowerTicket = safeId.toLowerCase();
        let preview = null;
        if (lowerTicket.includes(q)) {
          preview = text.substring(0, 80) + (text.length > 80 ? "…" : "");
        } else {
          preview = contentPreview(text, q);
        }
        if (preview !== null) {
          results.push({ ticketId: safeId, preview, updatedAt: info.updatedAt });
          seen.add(safeId);
        }
      }
    } catch { /* no autosave file */ }

    // 2. Search snapshot .html/.txt files in ticket history directories
    try {
      const dirs = (await fsp.readdir(BACKUP_DIR, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const dir of dirs) {
        const safeId = sanitizeTicketId(dir);
        if (seen.has(safeId)) continue;

        const ticketDir = path.join(BACKUP_DIR, dir);
        const idMatches = safeId.toLowerCase().includes(q);
        let matchPreview = null;
        let matchTime = null;

        try {
          const files = (await fsp.readdir(ticketDir))
            .filter((f) => f.endsWith(".html") || f.endsWith(".txt"))
            .sort()
            .reverse(); // most recent first

          for (const file of files) {
            try {
              const content = await fsp.readFile(path.join(ticketDir, file), "utf-8");
              const text = stripHtml(content);
              const st = await fsp.stat(path.join(ticketDir, file));
              const fileTime = new Date(st.mtimeMs).toISOString();

              // Use most-recent snapshot as the preview source for ID matches
              if (idMatches && matchPreview === null) {
                matchPreview = text.substring(0, 80) + (text.length > 80 ? "…" : "");
                matchTime = fileTime;
              }

              // Check for content match (takes priority over ID-only match)
              const cp = contentPreview(text, q);
              if (cp !== null) {
                matchPreview = cp;
                matchTime = fileTime;
                break;
              }
            } catch { /* skip unreadable file */ }
          }
        } catch { /* directory unreadable */ }

        // If ID matched but no snapshots existed, still return it with empty preview
        if (matchPreview === null && idMatches) matchPreview = "";

        if (matchPreview !== null) {
          results.push({ ticketId: safeId, preview: matchPreview, updatedAt: matchTime });
          seen.add(safeId);
        }
      }
    } catch { /* BACKUP_DIR may not exist */ }

    return results;
  });

  // AI: send panel notes to Hatz AI for wording/clarity suggestions
  electron.ipcMain.handle("ai-suggest", async (_event, { text, settings: aiSettings }) => {
    if (!aiSettings || aiSettings.aiProvider !== "hatz" || !aiSettings.aiApiKey) {
      return { error: "No AI provider configured. Add your API key in Settings → AI Assistant." };
    }
    const model = aiSettings.aiModelName || "gpt-4o";
    const prompt =
      "Review the following technical support notes and provide an improved version with better clarity, grammar, and professionalism. " +
      "Reply with only the improved notes text — no preamble, no labels, no explanation:\n\n" + text;
    try {
      const resp = await fetch("https://ai.hatz.ai/v1/chat/completions", {
        method: "POST",
        headers: { "X-API-Key": aiSettings.aiApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], model }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { error: `Hatz AI error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}` };
      }
      const json = await resp.json();
      return { result: json.choices?.[0]?.message?.content ?? "" };
    } catch (err) {
      return { error: "Request failed: " + (err.message || String(err)) };
    }
  });

  // AI: summarize all scraped note text from the active CW ticket page
  electron.ipcMain.handle("ai-summarize", async (_event, { text, settings: aiSettings }) => {
    if (!aiSettings || aiSettings.aiProvider !== "hatz" || !aiSettings.aiApiKey) {
      return { error: "No AI provider configured. Add your API key in Settings → AI Assistant." };
    }
    const model = aiSettings.aiModelName || "gpt-4o";
    const prompt =
      "Summarize the following ConnectWise ticket notes into a concise bullet-point summary. " +
      "Capture the key issue, actions taken, and current status. " +
      "Reply with only the summary, no preamble:\n\n" + text;
    try {
      const resp = await fetch("https://ai.hatz.ai/v1/chat/completions", {
        method: "POST",
        headers: { "X-API-Key": aiSettings.aiApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], model }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { error: `Hatz AI error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}` };
      }
      const json = await resp.json();
      return { result: json.choices?.[0]?.message?.content ?? "" };
    } catch (err) {
      return { error: "Request failed: " + (err.message || String(err)) };
    }
  });

  // Load saved tab URLs from disk
  electron.ipcMain.handle("load-tabs", async () => {
    try {
      const raw = await fsp.readFile(TABS_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  });
}

// ===================== App Lifecycle =====================

// Prevent multiple instances - if already running, focus the existing window
const gotTheLock = electron.app.requestSingleInstanceLock();

if (!gotTheLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    // Someone tried to open a second instance - focus our existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

electron.app.whenReady().then(() => {
  // Initialize paths now that app is ready
  BACKUP_DIR = path.join(electron.app.getPath("userData"), "note-backups");
  AUTOSAVE_FILE = path.join(BACKUP_DIR, "autosave.json");
  TABS_FILE = path.join(BACKUP_DIR, "open-tabs.json");
  SETTINGS_FILE = path.join(BACKUP_DIR, "settings.json");
  EDITOR_STATE_FILE = path.join(BACKUP_DIR, "editor-state.json");

  // Set a realistic user agent for ConnectWise requests only
  // (scoped to myconnectwise.net to avoid affecting other services)
  const CW_URL_FILTER = { urls: ["*://*.myconnectwise.net/*"] };
  electron.session.defaultSession.webRequest.onBeforeSendHeaders(
    CW_URL_FILTER,
    (details, callback) => {
      details.requestHeaders["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  // Register all IPC handlers
  registerIpcHandlers();

  // Create the window
  createWindow();

  // Clean up old backups after window is created (non-blocking)
  setTimeout(() => cleanupOldBackups(), 0);

  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
