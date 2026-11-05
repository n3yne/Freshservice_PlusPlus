"use strict";

const electron = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { DEFAULT_SETTINGS, validateSettings, migrateCoreSettings, findLegacyUserDataDir } = require("./utils");
const pluginManager = require("./plugin-manager");

// Keep using the Freshservice++ data folder after the rename to MSP++. This must
// run before anything touches userData (the single-instance lock, sessions).
try {
  const legacyDir = findLegacyUserDataDir(
    electron.app.getPath("appData"),
    electron.app.getPath("userData"),
    fs.existsSync,
    path.join,
  );
  if (legacyDir) electron.app.setPath("userData", legacyDir);
} catch (err) {
  console.error("[App] Could not check for the Freshservice++ data folder:", err);
}

let mainWindow;
// App data folder. Still named "note-backups" from when note backup was built in:
// it holds settings.json, open tabs and window state, and the Note Backup plugin
// keeps its snapshots here too, so existing installs keep working.
let DATA_DIR;
let TABS_FILE;
let SETTINGS_FILE;
let MAIN_WINDOW_STATE_FILE;

// In-memory download history (cleared on app restart)
const downloads = [];
let nextDownloadId = 1;

// Pending save paths for "Save Image As" — keyed by URL, consumed in will-download
const pendingSavePaths = new Map();

// Serializes save-settings calls. Each save reads the file, merges and writes with
// awaits in between; overlapping saves could otherwise write back a stale copy
// (for example an old encrypted API key over one that was just entered).
let settingsSaveQueue = Promise.resolve();
function withSettingsLock(fn) {
  const queued = settingsSaveQueue.then(fn);
  settingsSaveQueue = queued.catch((err) => { console.error("[Settings] Save failed:", err); });
  return queued;
}

// Identity-provider hostnames — these popups communicate login state back to the
// site's page via window.opener / postMessage and must open as real windows.
const SSO_PROVIDER_PATTERNS = [
  /^login\.microsoftonline\.com$/i,
  /^login\.microsoft\.com$/i,
  /^login\.live\.com$/i,
  /^accounts\.google\.com$/i,
];

// A site's own SSO flow often starts on the site's domain (e.g. an auth redirect
// endpoint) before handing off to the identity provider. Popups to these path
// segments on a site plugin's hosts (manifest "site.hosts") are allowed as real
// windows so the redirect chain isn't broken. Everything else (attachments,
// reports, etc.) goes to a tab. The pattern requires a path-segment boundary
// after the keyword so that e.g. /loginhistory does not match /login.
const AUTH_PATH_PATTERN =
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
    await ensureDataDir();
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("[Settings] Error saving settings:", e);
  }
}

// Returns a copy of settings safe to broadcast to renderer processes and plugins.
// Strips the credentials plugins declare in their manifests ("credentials") and
// replaces each with a boolean flag, so keys never leave the main process.
function toPublicSettings(s) {
  const out = Object.assign({}, s);
  for (const c of pluginManager.getCredentialFields()) {
    out[c.flag] = Boolean(out[c.plain] || out[c.encrypted]);
    delete out[c.plain];
    delete out[c.encrypted];
  }
  return out;
}

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

function createWindow() {
  // Ensure the data directory exists early; IPC handlers also call this
  // individually, so this is just a best-effort warm-up.
  ensureDataDir().catch((e) => console.error("[App] Error creating data dir:", e));

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
    title: "MSP++",
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
      // Identity-provider popups and auth-path popups on a site's hosts open as real windows so the
      // window.opener / postMessage login handshake works. Everything else goes
      // to a new tab. The console log below shows the exact URL and disposition
      // for each popup — useful if the SSO flow breaks and you need to widen the
      // auth-path pattern.
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        console.log("[Popup] window.open() from webview:", url);

        const isSsoProvider = SSO_PROVIDER_PATTERNS.some((re) => re.test(host));
        const isSiteAuthPopup =
          Boolean(pluginManager.findSiteForUrl(url)) &&
          AUTH_PATH_PATTERN.test(parsed.pathname);

        if (isSsoProvider || isSiteAuthPopup) {
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
    await ensureDataDir();
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
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(TABS_FILE, JSON.stringify(sanitizeTabUrls(tabUrls), null, 2), "utf-8");
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
    // If caller didn't supply a new plaintext key, preserve whatever encrypted key
    // is on disk. Saving with "<name>Remove": true deletes the stored key instead.
    const credentialFields = pluginManager.getCredentialFields();
    for (const c of credentialFields) {
      const removing = settings[c.remove] === true;
      delete merged[c.remove];
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
    for (const c of credentialFields) {
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

  electron.ipcMain.handle("check-for-updates", async () => {
    const currentVersion = electron.app.getVersion();
    try {
      const resp = await fetch(
        "https://api.github.com/repos/n3yne/Freshservice_PlusPlus/releases/latest",
        { headers: { "User-Agent": "MSP-PP/" + currentVersion } },
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

// ===================== Site user agent =====================

// Builds the webRequest URL filter for a list of bare domains: each domain and
// every subdomain of it, over http and https.
function siteUrlFilter(hosts) {
  const urls = [];
  for (const h of hosts) urls.push(`*://${h}/*`, `*://*.${h}/*`);
  return { urls };
}

// Presents a plain Chrome user agent (no "Electron/…" token) to the hosts of site
// plugins that ask for it ("site.chromeUserAgent": true), so those sites don't treat
// the app as an unsupported browser. Scoped to those hosts so other services see
// the real user agent. The Chrome version tracks the bundled Chromium so it never
// looks outdated.
function installSiteUserAgent() {
  const hosts = [];
  for (const site of pluginManager.getSites()) {
    if (!site.chromeUserAgent) continue;
    for (const h of site.hosts) if (!hosts.includes(h)) hosts.push(h);
  }
  if (!hosts.length) return;
  const chromeUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
    process.versions.chrome + " Safari/537.36";
  electron.session.defaultSession.webRequest.onBeforeSendHeaders(
    siteUrlFilter(hosts),
    (details, callback) => {
      details.requestHeaders["User-Agent"] = chromeUserAgent;
      callback({ requestHeaders: details.requestHeaders });
    },
  );
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
  DATA_DIR = path.join(electron.app.getPath("userData"), "note-backups");
  TABS_FILE = path.join(DATA_DIR, "open-tabs.json");
  SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
  MAIN_WINDOW_STATE_FILE = path.join(DATA_DIR, "main-window-state.json");

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
  const preMigration = JSON.stringify(rawParsed);
  migrateCoreSettings(rawParsed);
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
  pluginManager.runMigrations(rawParsed);
  let effectiveRaw = rawParsed;
  if (JSON.stringify(rawParsed) !== preMigration) {
    // Route through plugin transformers so a legacy plaintext credential is encrypted on the migration write.
    effectiveRaw = pluginManager.transformSettingsForSave(rawParsed);
    await saveSettings(effectiveRaw);
  }

  const initialSettings = applySettingsDefaults(effectiveRaw);
  pluginManager.updateSettings(initialSettings);

  installSiteUserAgent();

  registerIpcHandlers();
  createWindow();

  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error("[App] Fatal startup error:", err);
  electron.dialog.showErrorBox(
    "MSP++ — startup failed",
    String(err.message || err),
  );
  electron.app.quit();
});

electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
