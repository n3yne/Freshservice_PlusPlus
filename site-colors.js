// Site colours for tabs: a thin coloured stripe along the top of each tab whose
// page belongs to a site plugin, so Freshservice and ConnectWise tabs stand out
// from each other and from everything else.
//
// Each site plugin can suggest a colour in its manifest ("site.color"). The user
// can change it, or turn it off for one site, in Settings → General; those
// choices are saved as siteTabColorOverrides: { "<site id>": "#rrggbb" | "" },
// where "" means no stripe for that site. siteTabColors: false turns the stripes
// off everywhere.
//
// Shared by the main window, the settings window (script tags) and the main
// process and tests (require).
(function (root) {
  "use strict";

  const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
  const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
  const MAX_OVERRIDES = 50;

  // "#ABC" / "#AABBCC" (any case) → "#aabbcc"; anything else → "".
  function normalizeColor(value) {
    if (typeof value !== "string") return "";
    let v = value.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return COLOR_PATTERN.test(v) ? v : "";
  }

  function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  // Settings validator for siteTabColorOverrides (undefined is allowed).
  function validOverrides(overrides) {
    if (overrides === undefined) return true;
    if (!isPlainObject(overrides)) return false;
    const keys = Object.keys(overrides);
    if (keys.length > MAX_OVERRIDES) return false;
    return keys.every(function (k) {
      const v = overrides[k];
      return SITE_ID_PATTERN.test(k) && typeof v === "string" && (v === "" || COLOR_PATTERN.test(v));
    });
  }

  // The colour to show for a site, or "" for none.
  //   siteId: the site plugin's id; defaultColor: its manifest colour;
  //   settings: the app settings (siteTabColors, siteTabColorOverrides).
  function colorForSite(siteId, defaultColor, settings) {
    if (!siteId) return "";
    const s = settings || {};
    if (s.siteTabColors === false) return "";
    const overrides = isPlainObject(s.siteTabColorOverrides) ? s.siteTabColorOverrides : {};
    if (Object.prototype.hasOwnProperty.call(overrides, siteId)) {
      const chosen = overrides[siteId];
      return chosen === "" ? "" : normalizeColor(chosen);
    }
    return normalizeColor(defaultColor);
  }

  // A copy of overrides with siteId set to color ("" = off), or with siteId
  // removed when reset is true (back to the plugin's colour).
  function withOverride(overrides, siteId, color, reset) {
    const next = Object.assign({}, isPlainObject(overrides) ? overrides : {});
    if (reset) delete next[siteId];
    else next[siteId] = color === "" ? "" : normalizeColor(color);
    return next;
  }

  const api = { normalizeColor, validOverrides, colorForSite, withOverride };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SiteColors = api;
})(typeof window !== "undefined" ? window : globalThis);
