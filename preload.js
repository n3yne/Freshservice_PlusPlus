const { contextBridge, ipcRenderer } = require("electron");

// Helper: register an IPC listener and return a cleanup function.
// This avoids leaking the ipcRenderer reference through the context bridge
// (ipcRenderer.on() returns the ipcRenderer instance itself, which would be
// exposed to the renderer if returned directly).
function onIpc(channel, handler) {
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("backupAPI", {
  saveNote: (data) => ipcRenderer.invoke("save-note", data),
  loadAutosave: () => ipcRenderer.invoke("load-autosave"),
  getHistory: (ticketId) => ipcRenderer.invoke("get-history", ticketId),
  getAllTickets: () => ipcRenderer.invoke("get-all-tickets"),
  deleteAutosave: (ticketId) => ipcRenderer.invoke("delete-autosave", ticketId),
  deleteTicket: (ticketId) => ipcRenderer.invoke("delete-ticket", ticketId),
  openBackupFolder: () => ipcRenderer.invoke("open-backup-folder"),
  saveTabs: (tabUrls) => ipcRenderer.invoke("save-tabs", tabUrls),
  saveTabsSync: (tabUrls) => ipcRenderer.send("save-tabs-sync", tabUrls),
  loadTabs: () => ipcRenderer.invoke("load-tabs"),
  saveEditorStateSync: (state) => ipcRenderer.send("save-editor-state-sync", state),
  loadEditorState: () => ipcRenderer.invoke("load-editor-state"),
  onOpenInNewTab: (callback) =>
    onIpc("open-in-new-tab", (event, url) => callback(url)),
  onWebviewClose: (callback) =>
    onIpc("webview-close", (event, webContentsId) => callback(webContentsId)),
  openInBrowser: (url) => ipcRenderer.invoke("open-in-browser", url),
  searchNotes: (query) => ipcRenderer.invoke("search-notes", query),
  loadSettings: () => ipcRenderer.invoke("load-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  checkBackupSize: () => ipcRenderer.invoke("check-backup-size"),
  getDownloads: () => ipcRenderer.invoke("get-downloads"),
  openDownloadFile: (savePath) => ipcRenderer.invoke("open-download-file", savePath),
  showDownloadFolder: (savePath) => ipcRenderer.invoke("show-download-folder", savePath),
  clearDownloads: () => ipcRenderer.invoke("clear-downloads"),
  onDownloadUpdate: (callback) =>
    onIpc("download-update", (event, data) => callback(data)),
  onOpenSettings: (callback) => onIpc("open-settings", () => callback()),
  onFindInPage: (callback) => onIpc("find-in-page", () => callback()),
  onSettingsChanged: (callback) =>
    onIpc("settings-changed", (event, settings) => callback(settings)),
  openSettingsWindow: () => ipcRenderer.invoke("open-settings-window"),
  getPluginScripts: () => ipcRenderer.invoke("plugin-get-scripts"),
  getPluginSettingsScripts: () => ipcRenderer.invoke("plugin-get-settings-scripts"),
  getPluginStylesheets: () => ipcRenderer.invoke("plugin-get-stylesheets"),
  pluginInvoke: (channel, data) => {
    if (typeof channel !== "string" || !/^plugin:[a-z0-9][a-z0-9_-]*:[a-z0-9_-]+$/i.test(channel))
      return Promise.reject(new Error("Invalid plugin channel"));
    return ipcRenderer.invoke(channel, data);
  },
  onPluginEvent: (cb) =>
    onIpc("plugin-event", (_event, payload) => cb(payload)),
  emitPluginEvent: (name, data) =>
    ipcRenderer.send("plugin-event-from-renderer", { name, data }),
  getPluginInfo: () => ipcRenderer.invoke("plugin-get-info"),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke("plugin-set-enabled", { id, enabled }),
  importPlugin: () => ipcRenderer.invoke("plugin-import"),
});
