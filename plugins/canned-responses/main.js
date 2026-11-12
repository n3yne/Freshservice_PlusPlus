"use strict";

// Canned Responses plugin: settings only. The side panel tab is renderer.js and
// the editor is settings.js; both read cannedResponses.

const MAX_RESPONSES = 200;
const MAX_TITLE = 100;
const MAX_BODY = 10000;
const MAX_CATEGORY = 50;
const MAX_NAME = 100;

function isResponse(r) {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return false;
  if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 50) return false;
  if (typeof r.title !== "string" || !r.title.trim() || r.title.length > MAX_TITLE) return false;
  if (typeof r.body !== "string" || r.body.length > MAX_BODY) return false;
  if (r.category !== undefined && (typeof r.category !== "string" || r.category.length > MAX_CATEGORY)) return false;
  return true;
}

module.exports = {
  defaultSettings: {
    cannedResponses: [],
    cannedResponsesAgentName: "",
  },

  validateSettings: function (s) {
    if (s.cannedResponsesAgentName !== undefined) {
      if (typeof s.cannedResponsesAgentName !== "string" || s.cannedResponsesAgentName.length > MAX_NAME) return false;
    }
    if (s.cannedResponses !== undefined) {
      if (!Array.isArray(s.cannedResponses) || s.cannedResponses.length > MAX_RESPONSES) return false;
      const ids = new Set();
      for (const r of s.cannedResponses) {
        if (!isResponse(r) || ids.has(r.id)) return false;
        ids.add(r.id);
      }
    }
    return true;
  },

  // For the tests.
  MAX_RESPONSES,
  MAX_TITLE,
  MAX_BODY,
};
