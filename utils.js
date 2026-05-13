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
  defaultUrl: "https://na.myconnectwise.net/",
  theme: "dark",
  noteTemplates: [],
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
  if (typeof s.defaultUrl !== "string" || s.defaultUrl.length === 0 || s.defaultUrl.length > 2048) return false;
  try {
    const parsed = new URL(s.defaultUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  } catch { return false; }
  if (!["dark", "light"].includes(s.theme)) return false;
  if (!Array.isArray(s.noteTemplates)) return false;
  if (s.noteTemplates.length > 50) return false;
  for (const tmpl of s.noteTemplates) {
    if (typeof tmpl !== "object" || tmpl === null || Array.isArray(tmpl)) return false;
    if (typeof tmpl.name !== "string" || tmpl.name.length === 0 || tmpl.name.length > 100) return false;
    if (typeof tmpl.content !== "string" || tmpl.content.length > 10000) return false;
  }
  return true;
}

module.exports = { DEFAULT_SETTINGS, sanitizeTicketId, validateSettings };
