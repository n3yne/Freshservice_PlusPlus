"use strict";

// Quick Actions plugin, main process: only its settings. The changes are made
// by the site plugins (their ticketActions adapter part, e.g. the Freshservice
// REST API); the side panel tab is renderer.js.

module.exports = {
  defaultSettings: {
    quickActionsReloadTab: true,
    quickActionsConfirmResolve: true,
  },

  validateSettings: function (s) {
    if (s.quickActionsReloadTab !== undefined && typeof s.quickActionsReloadTab !== "boolean") return false;
    if (s.quickActionsConfirmResolve !== undefined && typeof s.quickActionsConfirmResolve !== "boolean") return false;
    return true;
  },

  init: function () {},
};
