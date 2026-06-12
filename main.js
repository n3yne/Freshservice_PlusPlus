"use strict";

const electron = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { DEFAULT_SETTINGS, sanitizeTicketId, validateSettings } = require("./utils");
const pluginManager = require("./plugin-manager");

let mainWindow;
let BACKUP_DIR;
let AUTOSAVE_FILE;
let TABS_FILE;
let SETTINGS_FILE;
let EDITOR_STATE_FILE;
let MAIN_WINDOW_STATE_FILE;

// In-memory download history (cleared on app restart)
const downloads = [];
let nextDownloadId = 1;

// Pending save paths for "Save Image As" — keyed by URL, consumed in will-download
const pendingSavePaths = new Map();

// Serializes all reads+writes to autosave.json so concurrent IPC calls
// (autosave, live-sync snapshot, ticket-swap snapshot) can't interleave and
// overwrite each other with stale data.
let autosaveWriteQueue = Promise.resolve();
function withAutosaveLock(fn) {
  const queued = autosaveWriteQueue.then(fn);
  autosaveWriteQueue = queued.catch(() => {});
  return queued;
}

// Atomically overwrites autosave.json via a tmp-file + rename to prevent
// truncation on crash/power-loss mid-write.
async function writeAutosaveAtomic(data) {
  const tmp = AUTOSAVE_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fsp.rename(tmp, AUTOSAVE_FILE);
}

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
    const parsed = JSON.parse(raw);
    // Migrate old single-dashboard format to metricsBarDashboards array
    if (!parsed.metricsBarDashboards && (parsed.metricsBarUrl || parsed.metricsBarFields)) {
      parsed.metricsBarDashboards = parsed.metricsBarUrl ? [{
        id: "db-migrated",
        url: parsed.metricsBarUrl,
        fields: parsed.metricsBarFields || [],
      }] : [];
    }
    return Object.assign({}, DEFAULT_SETTINGS, parsed);
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

// Returns a copy of settings safe to broadcast to renderer processes and plugins.
// Strips the AI API key (a billing credential) and replaces it with a boolean
// so plugin scripts can check whether a key is configured without reading it.
function toPublicSettings(s) {
  const out = Object.assign({}, s);
  out.aiApiKeySet = Boolean(out.aiApiKey);
  delete out.aiApiKey;
  return out;
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

    // 3. Prune stale autosave entries (old + no remaining history folder).
    // Serialized through withAutosaveLock so a concurrent save-note IPC call
    // can't land between our read and write and have its draft overwritten by
    // our stale snapshot.
    await withAutosaveLock(async () => {
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
          await writeAutosaveAtomic(data);
        }
      } catch (e) {
        if (e.code !== "ENOENT") console.error("[Cleanup] Error pruning autosaves:", e);
      }
    });

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

  const defaultWidth = 1600;
  const defaultHeight = 1000;
  const saved = loadMainWindowState();
  const usesSaved = saved && isWindowOnScreen(saved);
  const winWidth = usesSaved ? saved.width : defaultWidth;
  const winHeight = usesSaved ? saved.height : defaultHeight;
  const winX = usesSaved ? saved.x : undefined;
  const winY = usesSaved ? saved.y : undefined;

  mainWindow = new electron.BrowserWindow({
    width: winWidth,
    height: winHeight,
    ...(winX !== undefined && winY !== undefined ? { x: winX, y: winY } : {}),
    title: "ConnectWise Manage++",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true,
      webSecurity: true,
      sandbox: true,
    },
  });

  mainWindow.on("close", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      saveMainWindowState(mainWindow.getBounds());
    }
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
          click: () => { createSettingsWindow(); },
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
        createSettingsWindow();
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

      // Image URLs: download instead of opening in a new tab
      try {
        const imgPath = new URL(url).pathname;
        if (/\.(jpe?g|png|gif|webp|bmp|svg|ico|tiff?)$/i.test(imgPath)) {
          webviewContents.downloadURL(url);
          return { action: "deny" };
        }
      } catch {
        // Ignore malformed URLs
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
          label: "Copy Image",
          click: () => webviewContents.copyImageAt(params.x, params.y),
        });
        menuItems.push({
          label: "Save Image As…",
          click: async () => {
            let defaultFilename = "image";
            try {
              const urlPathname = new URL(params.srcURL).pathname;
              const base = urlPathname.split("/").pop();
              if (base) defaultFilename = base.split("?")[0];
            } catch {
              // Ignore malformed URLs
            }
            const { filePath } = await electron.dialog.showSaveDialog(mainWindow, {
              defaultPath: defaultFilename,
              filters: [
                { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"] },
                { name: "All Files", extensions: ["*"] },
              ],
            });
            if (!filePath) return;
            pendingSavePaths.set(params.srcURL, filePath);
            webviewContents.downloadURL(params.srcURL);
          },
        });
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

let settingsWindow = null;

function loadMainWindowState() {
  try {
    if (!MAIN_WINDOW_STATE_FILE) return null;
    const raw = fs.readFileSync(MAIN_WINDOW_STATE_FILE, "utf-8");
    const s = JSON.parse(raw);
    if (typeof s.x === "number" && typeof s.y === "number" &&
        typeof s.width === "number" && typeof s.height === "number") {
      return s;
    }
  } catch { /* no saved state */ }
  return null;
}

function isWindowOnScreen(bounds) {
  return electron.screen.getAllDisplays().some(function (d) {
    const wa = d.workArea;
    return bounds.x < wa.x + wa.width &&
           bounds.x + bounds.width > wa.x &&
           bounds.y < wa.y + wa.height &&
           bounds.y + bounds.height > wa.y;
  });
}

function saveMainWindowState(bounds) {
  if (!MAIN_WINDOW_STATE_FILE) return;
  fsp.writeFile(MAIN_WINDOW_STATE_FILE, JSON.stringify(bounds), "utf-8")
    .catch((e) => console.error("[Main window] Error saving window state:", e));
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const width = 720;
  const height = 780;
  let winX, winY;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const mb = mainWindow.getBounds();
    winX = Math.round(mb.x + (mb.width - width) / 2);
    winY = Math.round(mb.y + (mb.height - height) / 2);
  }

  settingsWindow = new electron.BrowserWindow({
    width,
    height,
    x: winX,
    y: winY,
    minWidth: 600,
    minHeight: 500,
    title: "Settings",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true,
      webSecurity: true,
      sandbox: true,
    },
  });
  settingsWindow.loadFile("settings.html");
  settingsWindow.on("closed", () => { settingsWindow = null; });
}

function registerIpcHandlers() {
  // Save a single note entry (autosave or manual)
  electron.ipcMain.handle(
    "save-note",
    async (event, { ticketId, noteContent, isManual }) => {
      const MAX_NOTE_BYTES = 10 * 1024 * 1024; // 10 MB
      if (typeof noteContent !== "string" || noteContent.length > MAX_NOTE_BYTES) {
        return { success: false, error: "Note content exceeds size limit" };
      }
      await ensureBackupDir();

      const timestamp = new Date().toISOString();
      const safeTicketId = sanitizeTicketId(ticketId);

      // Serialized through withAutosaveLock to prevent concurrent read-modify-write races on autosave.json.
      await withAutosaveLock(async () => {
        let autosaveData = {};
        try {
          const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
          autosaveData = JSON.parse(raw);
        } catch (e) {
          if (e.code !== "ENOENT") {
            // Corrupt file (truncated write, disk error) — preserve it before starting fresh
            // so the data isn't silently destroyed and can be manually recovered.
            const corruptPath = `${AUTOSAVE_FILE}.corrupt-${timestamp.replace(/[:.]/g, "-")}`;
            await fsp.rename(AUTOSAVE_FILE, corruptPath).catch(() => {});
            console.error("[Autosave] Corrupt autosave.json preserved at", corruptPath, e);
          }
        }
        autosaveData[safeTicketId] = { content: noteContent, updatedAt: timestamp };
        await writeAutosaveAtomic(autosaveData);
      });

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

      pluginManager.fireEvent("note:saved", { ticketId: safeTicketId, timestamp });
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
    await withAutosaveLock(async () => {
      try {
        const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
        const data = JSON.parse(raw);
        delete data[safeTicketId];
        await writeAutosaveAtomic(data);
      } catch {
        // File doesn't exist or is corrupt — nothing to delete
      }
    });
    return { success: true };
  });

  // Delete ALL data for a ticket (autosave entry + history folder)
  electron.ipcMain.handle("delete-ticket", async (event, ticketId) => {
    const safeTicketId = sanitizeTicketId(ticketId);

    // Remove from autosave.json
    await withAutosaveLock(async () => {
      try {
        const raw = await fsp.readFile(AUTOSAVE_FILE, "utf-8");
        const data = JSON.parse(raw);
        delete data[safeTicketId];
        await writeAutosaveAtomic(data);
      } catch {
        // File doesn't exist or is corrupt
      }
    });

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
    const err = await electron.shell.openPath(BACKUP_DIR);
    return err ? { success: false, error: err } : { success: true };
  });

  function sanitizeTabUrls(tabUrls) {
    if (!Array.isArray(tabUrls)) return [];
    return tabUrls.filter((entry) => {
      const url = typeof entry === "string" ? entry : entry?.url;
      if (typeof url !== "string") return false;
      try {
        const p = new URL(url);
        return p.protocol === "http:" || p.protocol === "https:";
      } catch { return false; }
    });
  }

  // Save open tab URLs to disk (async, returns result)
  electron.ipcMain.handle("save-tabs", async (event, tabUrls) => {
    await ensureBackupDir();
    try {
      await fsp.writeFile(TABS_FILE, JSON.stringify(sanitizeTabUrls(tabUrls), null, 2), "utf-8");
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
      fs.writeFileSync(TABS_FILE, JSON.stringify(sanitizeTabUrls(tabUrls), null, 2), "utf-8");
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

  // Open (or focus) the settings window
  electron.ipcMain.handle("open-settings-window", () => {
    createSettingsWindow();
  });

  // Load settings from disk (returns public form — aiApiKey stripped, aiApiKeySet added)
  electron.ipcMain.handle("load-settings", async () => {
    return toPublicSettings(await loadSettings());
  });

  // Save settings to disk and notify the renderer
  electron.ipcMain.handle("save-settings", async (event, settings) => {
    const existing = await loadSettings();
    const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
    // If the caller didn't supply a key (e.g. renderers that received a stripped
    // broadcast and then saved a non-key setting), preserve whatever is on disk.
    if (!settings.aiApiKey) {
      merged.aiApiKey = existing.aiApiKey;
    }
    if (!validateSettings(merged)) {
      console.warn("[Settings] Rejected invalid settings payload");
      return { success: false };
    }
    await saveSettings(merged);
    const publicMerged = toPublicSettings(merged);
    pluginManager.fireEvent("settings:changed", publicMerged);
    pluginManager.updateSettings(merged); // plugin-manager keeps the full settings for main-process plugins
    const sender = electron.BrowserWindow.fromWebContents(event.sender);
    electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (win !== sender && !win.isDestroyed()) {
        win.webContents.send("settings-changed", publicMerged);
      }
    });
    return { success: true };
  });

  // Plugin system: return renderer script paths for injection
  electron.ipcMain.handle("plugin-get-scripts", () => {
    return pluginManager.getRendererScripts();
  });

  // Plugin system: return settings-window script paths for injection
  electron.ipcMain.handle("plugin-get-settings-scripts", () => {
    return pluginManager.getSettingsScripts();
  });

  // Plugin system: forward renderer-originated events to main-process plugin listeners
  electron.ipcMain.on("plugin-event-from-renderer", (_event, payload) => {
    if (payload && typeof payload.name === "string") {
      pluginManager.fireEvent(payload.name, payload.data);
    }
  });

  // Plugin system: return metadata for all discovered plugins
  electron.ipcMain.handle("plugin-get-info", () => {
    return pluginManager.getPluginInfo();
  });

  // Plugin system: enable or disable a plugin (persisted; takes effect after restart)
  electron.ipcMain.handle("plugin-set-enabled", async (_event, { id, enabled }) => {
    if (typeof id !== "string" || typeof enabled !== "boolean") {
      return { success: false, error: "Invalid arguments" };
    }
    await pluginManager.setPluginEnabled(id, enabled);
    return { success: true };
  });

  // Plugin system: open a folder picker and import the selected directory as a plugin
  electron.ipcMain.handle("plugin-import", async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Select Plugin Folder",
      properties: ["openDirectory"],
      buttonLabel: "Import Plugin",
    });
    if (result.canceled || !result.filePaths.length) {
      return { cancelled: true };
    }
    return pluginManager.importPlugin(result.filePaths[0]);
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

  // Load saved tab URLs from disk
  electron.ipcMain.handle("load-tabs", async () => {
    try {
      const raw = await fsp.readFile(TABS_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  });

  // Download manager IPC
  electron.ipcMain.handle("get-downloads", () => downloads.map((d) => ({ ...d })));

  electron.ipcMain.handle("open-download-file", async (_e, savePath) => {
    if (!savePath || typeof savePath !== "string" || !path.isAbsolute(savePath)) {
      return { error: "Invalid path" };
    }
    const err = await electron.shell.openPath(savePath);
    return err ? { error: err } : { ok: true };
  });

  electron.ipcMain.handle("show-download-folder", (_e, savePath) => {
    if (!savePath || typeof savePath !== "string" || !path.isAbsolute(savePath)) {
      return { error: "Invalid path" };
    }
    electron.shell.showItemInFolder(savePath);
    return { ok: true };
  });

  electron.ipcMain.handle("clear-downloads", () => {
    downloads.splice(0);
    return { ok: true };
  });

  electron.ipcMain.handle("check-backup-size", async () => {
    try {
      await ensureBackupDir();
      let totalBytes = 0;
      const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(BACKUP_DIR, entry.name);
        if (entry.isDirectory()) {
          try {
            const files = await fsp.readdir(entryPath);
            for (const file of files) {
              try {
                const stat = await fsp.stat(path.join(entryPath, file));
                totalBytes += stat.size;
              } catch { /* skip unreadable file */ }
            }
          } catch { /* skip unreadable directory */ }
        } else {
          try {
            const stat = await fsp.stat(entryPath);
            totalBytes += stat.size;
          } catch { /* skip unreadable entry */ }
        }
      }
      return { totalBytes, totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10 };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  electron.ipcMain.handle("check-for-updates", async () => {
    const currentVersion = electron.app.getVersion();
    try {
      const resp = await fetch(
        "https://api.github.com/repos/PGH-Networks/Connectwise_Manage_PlusPlus/releases/latest",
        { headers: { "User-Agent": "ConnectWise-Manage-PP/" + currentVersion } },
      );
      if (!resp.ok) return { error: `GitHub API error ${resp.status}`, currentVersion };
      const json = await resp.json();
      const tagName = typeof json.tag_name === "string" ? json.tag_name : "";
      const latestVersion = tagName.replace(/^v/, "");
      const releaseUrl = typeof json.html_url === "string" ? json.html_url : "";
      const releaseName = typeof json.name === "string" ? json.name : tagName;
      return { currentVersion, latestVersion, releaseUrl, releaseName };
    } catch (err) {
      return { error: err.message || String(err), currentVersion };
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

electron.app.whenReady().then(async () => {
  // Initialize paths now that app is ready
  BACKUP_DIR = path.join(electron.app.getPath("userData"), "note-backups");
  AUTOSAVE_FILE = path.join(BACKUP_DIR, "autosave.json");
  TABS_FILE = path.join(BACKUP_DIR, "open-tabs.json");
  SETTINGS_FILE = path.join(BACKUP_DIR, "settings.json");
  EDITOR_STATE_FILE = path.join(BACKUP_DIR, "editor-state.json");
  MAIN_WINDOW_STATE_FILE = path.join(BACKUP_DIR, "main-window-state.json");

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

  electron.session.defaultSession.on("will-download", (_event, item) => {
    const itemUrl = item.getURL();
    if (pendingSavePaths.has(itemUrl)) {
      item.setSavePath(pendingSavePaths.get(itemUrl));
      pendingSavePaths.delete(itemUrl);
    }
    const id = nextDownloadId++;
    const record = {
      id,
      filename: item.getFilename(),
      savePath: "",
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: "progressing",
      startTime: Date.now(),
    };
    downloads.unshift(record);

    item.on("updated", (_e, state) => {
      record.state = state;
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.savePath = item.getSavePath();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("download-update", { ...record });
      }
    });

    item.once("done", (_e, state) => {
      record.state = state;
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.savePath = item.getSavePath();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("download-update", { ...record });
      }
    });
  });

  const initialSettings = await loadSettings();
  await pluginManager.initPlugins(electron.app.getPath("userData"), initialSettings, electron.ipcMain);

  registerIpcHandlers();
  createWindow();
  setTimeout(() => cleanupOldBackups(), 0);

  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
