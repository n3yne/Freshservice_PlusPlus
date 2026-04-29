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

// Known SSO / auth provider hostnames — popups from these are allowed as real
// windows so login flows that rely on window.opener / postMessage work correctly.
const AUTH_HOSTNAME_PATTERNS = [
  /^login\.microsoftonline\.com$/i,
  /^login\.microsoft\.com$/i,
  /^login\.live\.com$/i,
  /^accounts\.google\.com$/i,
  /\.okta\.com$/i,
  /\.oktapreview\.com$/i,
  /\.onelogin\.com$/i,
  /\.pingone\.com$/i,
  /\.pingidentity\.com$/i,
  /\.connectwiseidentity\.com$/i,
  /\.auth0\.com$/i,
];

// ConnectWise's own domain — window.open("new-window") requests here are also
// allowed through (e.g. inline PDF viewers, print dialogs).
const CW_HOSTNAME_PATTERN = /\.myconnectwise\.net$/i;

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

  // Intercept new-window requests from webview guest pages and redirect to tabs
  mainWindow.webContents.on("did-attach-webview", (event, webviewContents) => {
    webviewContents.setWindowOpenHandler(({ url, disposition }) => {
      // Allow auth/SSO popups to open as real windows so login flows work.
      // ConnectWise SSO uses popups that communicate back via window.opener,
      // which requires a real browser window (not a tab redirect).
      //
      // Security: only known auth provider hostnames are allowed. Additionally,
      // window.open() calls with disposition "new-window" are only passed through
      // for the ConnectWise domain itself (not arbitrary third-party content).
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();

        const isKnownAuth = AUTH_HOSTNAME_PATTERNS.some((re) => re.test(host));
        const isCwNewWindow =
          CW_HOSTNAME_PATTERN.test(host) && disposition === "new-window";

        if (isKnownAuth || isCwNewWindow) {
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

    // Right-click context menu inside webviews (links, text selection, etc.)
    webviewContents.on("context-menu", (event, params) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      // Build context data for the renderer
      const contextData = {
        x: params.x,
        y: params.y,
        linkURL: params.linkURL || "",
        selectionText: params.selectionText || "",
        mediaType: params.mediaType || "",
        srcURL: params.srcURL || "",
      };

      // Only send if there's something actionable to show
      if (contextData.linkURL || contextData.selectionText) {
        mainWindow.webContents.send("webview-context-menu", contextData);
      }
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
          entries.push({ ticketId: safeDir, source: "history" });
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
