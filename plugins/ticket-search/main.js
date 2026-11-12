"use strict";

// Ticket Search plugin, main process: only its settings. The search itself is
// done by the site plugins (their ticketSearch adapter part, e.g. the
// Freshservice REST API); the side panel tab is renderer.js.

const OPEN_IN_CHOICES = ["new", "current"];
const DAY_CHOICES = [7, 30, 90, 180, 365];

module.exports = {
  defaultSettings: {
    ticketSearchOpenIn: "new",
    ticketSearchDays: 30,
  },

  validateSettings: function (s) {
    if (s.ticketSearchOpenIn !== undefined && !OPEN_IN_CHOICES.includes(s.ticketSearchOpenIn)) return false;
    if (s.ticketSearchDays !== undefined && !DAY_CHOICES.includes(s.ticketSearchDays)) return false;
    return true;
  },

  init: function () {},

  OPEN_IN_CHOICES,
  DAY_CHOICES,
};
