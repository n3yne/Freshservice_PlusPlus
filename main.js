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
  autosaveWriteQueue = queued.catch((err) => { console.error("[Autosave] Write failed:", err); });
  return queued;
}

// Serializes save-settings calls. Each save reads the file, merges and writes with
// awaits in between; overlapping saves could otherwise write back a stale copy
// (for example an old encrypted API key over one that was just entered).
let settingsSaveQueue = Promise.resolve();
function withSettingsLock(fn) {
  const queued = settingsSaveQueue.then(fn);
  settingsSaveQueue = queued.catch((err) => { console.error("[Settings] Save failed:", err); });
  return queued;
}

// Atomically overwrites autosave.json via a tmp-file + rename to prevent
// truncation on crash/power-loss mid-write.
async function writeAutosaveAtomic(data) {
  const tmp = AUTOSAVE_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fsp.rename(tmp, AUTOSAVE_FILE);
}

// Identity-provider hostnames — these popups communicate login state back to the
// Freshservice page via window.opener / postMessage and must open as real windows.
const SSO_PROVIDER_PATTERNS = [
  /^login\.microsoftonline\.com$/i,
  /^login\.microsoft\.com$/i,
  /^login\.live\.com$/i,
  /^accounts\.google\.com$/i,
];

// Freshservice instances (*.freshservice.com) and Freshworks accounts / org SSO
// (*.freshworks.com, *.myfreshworks.com). Used to scope the user-agent override
// and to recognise auth popups that start on a Freshworks domain.
const FRESHWORKS_HOSTNAME_PATTERN = /(?:^|\.)(?:freshservice|freshworks|myfreshworks)\.com$/i;
const FRESHWORKS_URL_FILTER = {
  urls: [
    "*://*.freshservice.com/*",
    "*://*.freshworks.com/*",
    "*://*.myfreshworks.com/*",
  ],
};

// Freshworks' SSO flow often starts on a Freshworks domain (e.g. an auth redirect
// endpoint) before handing off to the identity provider. Popups to these path
// segments on Freshworks domains are allowed as real windows so the redirect chain
// isn't broken. Everything else (attachments, reports, etc.) goes to a tab.
// The pattern requires a path-segment boundary after the keyword so that
// e.g. /loginhistory does not accidentally match /login.
const FRESHWORKS_AUTH_PATH_PATTERN =
  /\/(?:auth|login|sso|oauth|saml|openid|signin)(?:[/?#]|$)/i;

function isWebUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// The main and settings windows run the preload (window.backupAPI), so they must
// only ever show the app's own pages. Without this, dropping a link or file on the
// window navigates it to that page, which would then get full backupAPI access.
function lockDownWindow(win) {
  win.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    console.warn("[Security] Blocked navigation of app window to:", url);
  });

  // Webviews get no preload and no Node, whatever attributes the page sets,
  // and may only start on a web page or about:blank.
  win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    if (params.src && params.src !== "about:blank" && !isWebUrl(params.src)) {
      console.warn("[Security] Blocked webview with src:", params.src);
      event.preventDefault();
    }
  });
}

// ===================== Settings Persistence =====================

// Reads and parses settings.json with no transformations applied.
async function readSettingsFile() {
  try {
    const raw = await fsp.readFile(SETTINGS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[Settings] Error reading settings file:", e);
    return {};
  }
}

// Merges core + plugin defaults onto a raw parsed object. Does NOT run migrations —
// those are run once at startup (after initPlugins) so they never fire on routine reads.
function applySettingsDefaults(parsed) {
  return Object.assign({}, DEFAULT_SETTINGS, pluginManager.getPluginDefaultSettings(), parsed);
}

async function loadSettings() {
  return applySettingsDefaults(await readSettingsFile());
}

async function saveSettings(settings) {
  try {
    await ensureBackupDir();
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("[Settings] Error saving settings:", e);
  }
}

// Credentials that plugins encrypt before saving (see registerSettingsTransformer).
// They never leave the main process: renderers only see the boolean flag. Saving
// with the remove flag set deletes the stored key.
const CREDENTIAL_FIELDS = [
  { plain: "aiApiKey", encrypted: "aiApiKeyEncrypted", flag: "aiApiKeySet" },
  { plain: "fsApiKey", encrypted: "fsApiKeyEncrypted", flag: "fsApiKeySet", remove: "fsApiKeyRemove" },
];

// Returns a copy of settings safe to broadcast to renderer processes and plugins.
// Strips credentials and replaces each with a boolean flag.
function toPublicSettings(s) {
  const out = Object.assign({}, s);
  for (const c of CREDENTIAL_FIELDS) {
    out[c.flag] = Boolean(out[c.plain] || out[c.encrypted]);
    delete out[c.plain];
    delete out[c.encrypted];
  }
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
      try {
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
          try {
            await fsp.rmdir(ticketDir);
            deletedDirs++;
          } catch (e) {
            if (e.code !== "ENOTEMPTY") throw e;
          }
        }
      } catch {
        // Skip locked/unreadable ticket folder — don't abort cleanup for the rest
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
    show: false,
    title: "Freshservice++",
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

  mainWindow.once("ready-to-show", () => {
    if (usesSaved && saved.maximized) {
      mainWindow.maximize();
    }
    mainWindow.show();
  });

  mainWindow.on("close", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // getNormalBounds: the un-maximized size, so restoring a maximized window
      // and then un-maximizing it doesn't leave a screen-sized window.
      saveMainWindowState(mainWindow.getNormalBounds(), mainWindow.isMaximized());
    }
  });

  lockDownWindow(mainWindow);
  mainWindow.loadFile("index.html");

  setApplicationMenu();

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
      // Identity-provider popups and Freshworks auth-path popups open as real windows so the
      // window.opener / postMessage login handshake works. Everything else goes
      // to a new tab. The console log below shows the exact URL and disposition
      // for each popup — useful if the SSO flow breaks and you need to widen the
      // auth-path pattern.
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        console.log("[Popup] window.open() from webview:", url);

        const isSsoProvider = SSO_PROVIDER_PATTERNS.some((re) => re.test(host));
        const isFreshworksAuthPopup =
          FRESHWORKS_HOSTNAME_PATTERN.test(host) &&
          FRESHWORKS_AUTH_PATH_PATTERN.test(parsed.pathname);

        if (isSsoProvider || isFreshworksAuthPopup) {
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

      // Normal links: open in a new tab instead (web pages only — no file: or other schemes)
      if (isWebUrl(url)) {
        mainWindow.webContents.send("open-in-new-tab", url);
      } else {
        console.warn("[Popup] Blocked non-web URL:", url);
      }
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
        if (isWebUrl(params.linkURL)) {
          menuItems.push({
            label: "Open Link in New Tab",
            click: () =>
              mainWindow.webContents.send("open-in-new-tab", params.linkURL),
          });
        }
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
        if (isWebUrl(params.srcURL)) {
          menuItems.push({
            label: "Open Image in New Tab",
            click: () =>
              mainWindow.webContents.send("open-in-new-tab", params.srcURL),
          });
        }
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

// ===================== Application Menu =====================

// Items plugins add with api.addMenuItem — shown at the end of the Edit menu.
let pluginMenuItems = [];

function setApplicationMenu() {
  const pluginEditItems = pluginMenuItems.length
    ? [
        { type: "separator" },
        ...pluginMenuItems.map((item) => ({
          label: item.label,
          accelerator: item.accelerator,
          click: () => {
            try { item.click(); } catch (err) {
              console.error(`[Plugin:${item.pluginId}] Menu item "${item.label}" failed:`, err);
            }
          },
        })),
      ]
    : [];

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
        ...pluginEditItems,
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        {
          label: "Refresh All Tabs",
          accelerator: "CmdOrCtrl+Alt+R",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("refresh-all-tabs");
            }
          },
        },
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
}

// Called by the plugin manager whenever a plugin adds a menu item. Plugins load
// before the window exists, so the menu is only rebuilt once the app is ready.
function rebuildPluginMenu(items) {
  pluginMenuItems = items.slice();
  if (electron.app.isReady()) setApplicationMenu();
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

function saveMainWindowState(bounds, maximized) {
  if (!MAIN_WINDOW_STATE_FILE) return;
  try {
    fs.writeFileSync(MAIN_WINDOW_STATE_FILE, JSON.stringify({ ...bounds, maximized: !!maximized }), "utf-8");
  } catch (e) {
    console.error("[Main window] Error saving window state:", e);
  }
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
  lockDownWindow(settingsWindow);
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) electron.shell.openExternal(url);
    return { action: "deny" };
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
            const files = await fsp.readdir(path.join(BACKUP_DIR, safeDir));
            let latestMs = 0;
            for (const f of files) {
              if (!f.endsWith(".html") && !f.endsWith(".txt")) continue;
              try {
                const st = await fsp.stat(path.join(BACKUP_DIR, safeDir, f));
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
  electron.ipcMain.handle("save-settings", (event, settings) => withSettingsLock(async () => {
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      return { success: false };
    }
    const existing = await loadSettings();
    const merged = Object.assign({}, DEFAULT_SETTINGS, pluginManager.getPluginDefaultSettings(), settings);
    // If caller didn't supply a new plaintext key, preserve whatever encrypted key is on disk.
    for (const c of CREDENTIAL_FIELDS) {
      const removing = Boolean(c.remove && settings[c.remove] === true);
      if (c.remove) delete merged[c.remove];
      delete merged[c.flag];
      if (removing) {
        delete merged[c.plain];
        delete merged[c.encrypted];
      } else if (!settings[c.plain]) {
        merged[c.encrypted] = existing[c.encrypted];
        if (existing[c.plain]) merged[c.plain] = existing[c.plain]; // backward compat
      }
    }
    if (!validateSettings(merged) || !pluginManager.validatePluginSettings(merged)) {
      console.warn("[Settings] Rejected invalid settings payload");
      return { success: false };
    }
    const toSave = pluginManager.transformSettingsForSave(merged);
    // Plugin transformers always strip the plaintext key; if one couldn't encrypt
    // a newly entered key (OS credential storage unavailable, or its plugin is
    // disabled), saving would drop or expose the key, so refuse and tell the
    // settings window.
    for (const c of CREDENTIAL_FIELDS) {
      if (settings[c.plain] && (!toSave[c.encrypted] || toSave[c.plain])) {
        console.warn("[Settings] Rejected API key: OS credential encryption unavailable");
        return {
          success: false,
          error: "The API key could not be saved because secure credential storage isn't available on this computer.",
        };
      }
    }
    await saveSettings(toSave);
    const publicMerged = toPublicSettings(toSave);
    pluginManager.fireEvent("settings:changed", publicMerged);
    pluginManager.updateSettings(toSave);
    const sender = electron.BrowserWindow.fromWebContents(event.sender);
    electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (win !== sender && !win.isDestroyed()) {
        win.webContents.send("settings-changed", publicMerged);
      }
    });
    return { success: true };
  }));

  // Plugin system: return renderer script paths for injection
  electron.ipcMain.handle("plugin-get-scripts", () => {
    return pluginManager.getRendererScripts();
  });

  // Plugin system: return settings-window script paths for injection
  electron.ipcMain.handle("plugin-get-settings-scripts", () => {
    return pluginManager.getSettingsScripts();
  });

  // Plugin system: return stylesheet paths for injection in both windows
  electron.ipcMain.handle("plugin-get-stylesheets", () => {
    return pluginManager.getPluginStylesheets();
  });

  // Plugin system: forward renderer-originated events to main-process plugin listeners.
  // Only events the renderer owns are accepted; note:saved and settings:changed
  // are fired by the main process itself, so a renderer can't spoof them.
  const RENDERER_PLUGIN_EVENTS = new Set(["app:ready", "ticket:changed"]);
  electron.ipcMain.on("plugin-event-from-renderer", (_event, payload) => {
    if (payload && typeof payload.name === "string" && RENDERER_PLUGIN_EVENTS.has(payload.name)) {
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
      // Wait for any in-flight write to settle before reading
      await autosaveWriteQueue.catch(() => {});
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

  // Only files this app downloaded can be opened or shown — shell.openPath runs
  // executables, so a renderer-supplied path must never reach it unchecked.
  function isCompletedDownload(savePath) {
    return typeof savePath === "string" && savePath.length > 0 &&
      downloads.some((d) => d.state === "completed" && d.savePath === savePath);
  }

  electron.ipcMain.handle("open-download-file", async (_e, savePath) => {
    if (!isCompletedDownload(savePath)) {
      return { error: "Invalid path" };
    }
    const err = await electron.shell.openPath(savePath);
    return err ? { error: err } : { ok: true };
  });

  electron.ipcMain.handle("show-download-folder", (_e, savePath) => {
    if (!isCompletedDownload(savePath)) {
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
        "https://api.github.com/repos/n3yne/Freshservice_PlusPlus/releases/latest",
        { headers: { "User-Agent": "Freshservice-PP/" + currentVersion } },
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

electron.app.whenReady().then(async () => {
  // A second instance quits above; don't let it run startup (settings
  // migration write, backup cleanup) against the first instance's files.
  if (!gotTheLock) return;

  // Initialize paths now that app is ready
  BACKUP_DIR = path.join(electron.app.getPath("userData"), "note-backups");
  AUTOSAVE_FILE = path.join(BACKUP_DIR, "autosave.json");
  TABS_FILE = path.join(BACKUP_DIR, "open-tabs.json");
  SETTINGS_FILE = path.join(BACKUP_DIR, "settings.json");
  EDITOR_STATE_FILE = path.join(BACKUP_DIR, "editor-state.json");
  MAIN_WINDOW_STATE_FILE = path.join(BACKUP_DIR, "main-window-state.json");

  // Present a plain Chrome user agent (no "Electron/…" token) to Freshservice and
  // Freshworks only, so the app isn't treated as an unsupported browser. Scoped to
  // those domains to avoid affecting other services. The Chrome version tracks the
  // bundled Chromium so it never looks outdated.
  const chromeUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
    process.versions.chrome + " Safari/537.36";
  electron.session.defaultSession.webRequest.onBeforeSendHeaders(
    FRESHWORKS_URL_FILTER,
    (details, callback) => {
      details.requestHeaders["User-Agent"] = chromeUserAgent;
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
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("download-update", { ...record });
        }
      } catch { /* window closed mid-download */ }
    });

    item.once("done", (_e, state) => {
      record.state = state;
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.savePath = item.getSavePath();
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("download-update", { ...record });
        }
      } catch { /* window closed mid-download */ }
    });
  });

  // Two-phase startup: read raw file first so plugins can see persisted values during init,
  // then run plugin migrations + merge defaults to produce the final settings object.
  const rawParsed = await readSettingsFile();
  try {
    await pluginManager.initPlugins(
      electron.app.getPath("userData"),
      Object.assign({}, DEFAULT_SETTINGS, rawParsed),
      electron.ipcMain,
      rebuildPluginMenu
    );
  } catch (e) {
    console.error("[Plugins] initPlugins failed — starting without plugins:", e);
  }
  // Run migrations exactly once — plugins are now registered so all migrators are available.
  // If any migration modified rawParsed, write the upgraded data back to disk so future
  // loadSettings() calls (IPC, backup cleanup) never see the legacy format again.
  const preMigration = JSON.stringify(rawParsed);
  pluginManager.runMigrations(rawParsed);
  let effectiveRaw = rawParsed;
  if (JSON.stringify(rawParsed) !== preMigration) {
    // Route through plugin transformers so a legacy plaintext credential is encrypted on the migration write.
    effectiveRaw = pluginManager.transformSettingsForSave(rawParsed);
    await saveSettings(effectiveRaw);
  }

  const initialSettings = applySettingsDefaults(effectiveRaw);
  pluginManager.updateSettings(initialSettings);

  registerIpcHandlers();
  createWindow();
  setTimeout(() => cleanupOldBackups(), 0);

  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error("[App] Fatal startup error:", err);
  electron.dialog.showErrorBox(
    "Freshservice++ — startup failed",
    String(err.message || err),
  );
  electron.app.quit();
});

electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
