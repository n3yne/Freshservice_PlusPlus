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
  loadSettings: () => ipcRenderer.invoke("load-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  onOpenSettings: (callback) => onIpc("open-settings", () => callback()),
  onSettingsChanged: (callback) =>
    onIpc("settings-changed", (event, settings) => callback(settings)),
});
