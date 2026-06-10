"use strict";

// Main-process entry point for the example plugin.
// Receives a restricted pluginApi object — no direct access to ipcMain, fs, etc.
module.exports = function (api) {
  api.log("Main-process component loaded");

  // Listen for app-level events
  api.on("note:saved", function (data) {
    api.log("Note saved for ticket:", data.ticketId);
  });

  api.on("settings:changed", function (settings) {
    api.log("Settings updated (theme:", settings.theme + ")");
  });

  // Register a backend IPC handler callable from the renderer via
  // window.pluginAPI.invoke("example-plugin", "ping", { msg: "hello" })
  api.handle("ping", async function (data) {
    api.log("Received ping:", data);
    return { pong: true, echo: data };
  });

  // Uncomment to add a menu item under Edit:
  // api.addMenuItem({
  //   label: "Example Plugin Action",
  //   click: () => api.log("Menu item clicked"),
  // });
};
