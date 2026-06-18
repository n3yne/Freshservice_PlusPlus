"use strict";

module.exports = {

  defaultSettings: {
    metricsBarEnabled: false,
    metricsBarInterval: 15,
    metricsBarDashboards: [],
    metricsProgressEnabled: false,
    metricsWorkDays: [1, 2, 3, 4, 5],
    metricsWorkHoursStart: "08:00",
    metricsWorkHoursEnd: "17:00",
    metricsWorkWeekEndDay: 5,
    metricsLunchMinutes: 0,
    metricsTimeOff: [],
  },

  migrateSettings: function (parsed) {
    // Migrate old single-dashboard format (metricsBarUrl + metricsBarFields) to the dashboards array.
    if (!parsed.metricsBarDashboards && (parsed.metricsBarUrl || parsed.metricsBarFields)) {
      parsed.metricsBarDashboards = parsed.metricsBarUrl ? [{
        id: "db-migrated",
        url: parsed.metricsBarUrl,
        fields: parsed.metricsBarFields || [],
      }] : [];
    }
    delete parsed.metricsBarUrl;
    delete parsed.metricsBarFields;
  },

  validateSettings: function (s) {
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
    if (s.metricsProgressEnabled !== undefined && typeof s.metricsProgressEnabled !== "boolean") return false;
    if (s.metricsWorkDays !== undefined) {
      if (!Array.isArray(s.metricsWorkDays) || s.metricsWorkDays.length > 7) return false;
      for (const d of s.metricsWorkDays) {
        if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) return false;
      }
    }
    if (s.metricsWorkWeekEndDay !== undefined && (typeof s.metricsWorkWeekEndDay !== "number" || !Number.isInteger(s.metricsWorkWeekEndDay) || s.metricsWorkWeekEndDay < 0 || s.metricsWorkWeekEndDay > 6)) return false;
    if (s.metricsWorkHoursStart !== undefined && (typeof s.metricsWorkHoursStart !== "string" || !/^\d{2}:\d{2}$/.test(s.metricsWorkHoursStart))) return false;
    if (s.metricsWorkHoursEnd !== undefined && (typeof s.metricsWorkHoursEnd !== "string" || !/^\d{2}:\d{2}$/.test(s.metricsWorkHoursEnd))) return false;
    if (s.metricsLunchMinutes !== undefined && (typeof s.metricsLunchMinutes !== "number" || s.metricsLunchMinutes < 0 || s.metricsLunchMinutes > 480)) return false;
    if (s.metricsTimeOff !== undefined) {
      if (!Array.isArray(s.metricsTimeOff)) return false;
      if (s.metricsTimeOff.length > 365) return false;
      for (const t of s.metricsTimeOff) {
        if (typeof t !== "object" || t === null || Array.isArray(t)) return false;
        if (typeof t.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return false;
        if (typeof t.hours !== "number" || t.hours < 0 || t.hours > 24) return false;
      }
    }
    return true;
  },

};
