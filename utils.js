"use strict";

// Shared between main process (required directly) and tests.
// renderer.js cannot require this — it mirrors DEFAULT_SETTINGS as a literal.

const DEFAULT_SETTINGS = {
  notePanelEnabled: true,
  backupRetentionDays: 7,
  signatureHtml: "",
  ticketSortField: "lastUpdated",
  ticketSortDirection: "desc",
  panelCollapsed: false,
};

function sanitizeTicketId(raw) {
  return (raw || "no-ticket").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function validateSettings(s) {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  if (typeof s.notePanelEnabled !== "boolean") return false;
  if (
    typeof s.backupRetentionDays !== "number" ||
    s.backupRetentionDays < 0 ||
    s.backupRetentionDays > 365
  )
    return false;
  if (typeof s.signatureHtml !== "string" || s.signatureHtml.length > 100000)
    return false;
  if (!["lastUpdated", "ticketNumber"].includes(s.ticketSortField)) return false;
  if (!["asc", "desc"].includes(s.ticketSortDirection)) return false;
  if (typeof s.panelCollapsed !== "boolean") return false;
  return true;
}

module.exports = { DEFAULT_SETTINGS, sanitizeTicketId, validateSettings };
