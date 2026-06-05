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
  liveSyncEnabled: true,
  snapshotThreshold: 5,
  aiProvider: "none",
  aiModelName: "",
  aiApiKey: "",
  dismissedReleaseVersion: "",
  backupStorageWarningMb: 100,
  metricsBarEnabled: false,
  metricsBarInterval: 15,
  metricsBarDashboards: [],
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
  if (s.liveSyncEnabled !== undefined && typeof s.liveSyncEnabled !== "boolean") return false;
  if (
    s.snapshotThreshold !== undefined &&
    (typeof s.snapshotThreshold !== "number" || s.snapshotThreshold < 1 || s.snapshotThreshold > 9999)
  )
    return false;
  if (s.aiProvider !== undefined && !["none", "hatz", "openai", "anthropic"].includes(s.aiProvider)) return false;
  if (s.aiModelName !== undefined && (typeof s.aiModelName !== "string" || s.aiModelName.length > 100)) return false;
  if (s.aiApiKey !== undefined && (typeof s.aiApiKey !== "string" || s.aiApiKey.length > 500)) return false;
  if (s.dismissedReleaseVersion !== undefined && (typeof s.dismissedReleaseVersion !== "string" || s.dismissedReleaseVersion.length > 20)) return false;
  if (s.backupStorageWarningMb !== undefined && (typeof s.backupStorageWarningMb !== "number" || s.backupStorageWarningMb < 0 || s.backupStorageWarningMb > 100000)) return false;
  if (s.metricsBarEnabled !== undefined && typeof s.metricsBarEnabled !== "boolean") return false;
  if (s.metricsBarInterval !== undefined && (typeof s.metricsBarInterval !== "number" || ![5, 15, 30, 60].includes(s.metricsBarInterval))) return false;
  if (s.metricsBarDashboards !== undefined) {
    if (!Array.isArray(s.metricsBarDashboards)) return false;
    if (s.metricsBarDashboards.length > 10) return false;
    for (const db of s.metricsBarDashboards) {
      if (typeof db !== "object" || db === null || Array.isArray(db)) return false;
      if (typeof db.id !== "string" || db.id.length === 0 || db.id.length > 50) return false;
      if (typeof db.url !== "string" || db.url.length > 500) return false;
      if (!Array.isArray(db.fields)) return false;
      if (db.fields.length > 20) return false;
      for (const f of db.fields) {
        if (typeof f !== "object" || f === null || Array.isArray(f)) return false;
        if (typeof f.id !== "string" || f.id.length === 0 || f.id.length > 50) return false;
        if (typeof f.label !== "string" || f.label.length === 0 || f.label.length > 50) return false;
        if (typeof f.selector !== "string" || f.selector.length === 0 || f.selector.length > 2000) return false;
      }
    }
  }
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
