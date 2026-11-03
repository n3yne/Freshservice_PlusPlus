// Renderer entry point for the example plugin.
// window.pluginAPI is available and frozen when this script executes.
(function () {
  console.log("[Example plugin] Renderer component loaded");

  // Listen for bus events
  window.pluginAPI.events.on("note:saved", function (data) {
    console.log("[Example plugin] note:saved →", data.ticketId);
  });

  window.pluginAPI.events.on("ticket:changed", function (data) {
    console.log("[Example plugin] ticket:changed →", data.ticketId, "(was:", data.previous + ")");
  });

  // Uncomment to add a tab to the side panel:
  // const tab = window.pluginAPI.ui.addSidePanelTab({ id: "example-plugin", label: "Example", icon: "🧩" });
  // tab.element.innerHTML = '<div style="padding:12px">Hello from the example plugin</div>';

  // Uncomment to add a toolbar button to the Notes tab:
  // window.pluginAPI.ui.addToolbarButton({
  //   id: "example-ping",
  //   label: "Ping",
  //   title: "Send a test ping to the main process",
  //   onClick: async function () {
  //     const result = await window.pluginAPI.invoke("example-plugin", "ping", { msg: "hello from renderer" });
  //     console.log("[Example plugin] pong:", result);
  //   },
  // });
})();
