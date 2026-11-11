"use strict";

// Bookmarks Bar plugin: settings only. The bar lives in renderer.js and the
// editor in settings.js; both save the whole list to bookmarksBarItems.

const MAX_BOOKMARKS = 500;
const MAX_TITLE = 200;
const MAX_URL = 2048;

function isWebUrl(url) {
  try {
    const p = new URL(url);
    return (p.protocol === "http:" || p.protocol === "https:") && Boolean(p.hostname);
  } catch {
    return false;
  }
}

function isBookmark(b) {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return false;
  if (typeof b.id !== "string" || b.id.length === 0 || b.id.length > 50) return false;
  if (typeof b.title !== "string" || b.title.length > MAX_TITLE) return false;
  if (typeof b.url !== "string" || b.url.length > MAX_URL || !isWebUrl(b.url)) return false;
  return true;
}

module.exports = {
  defaultSettings: {
    bookmarksBarVisible: true,
    bookmarksBarItems: [],
  },

  validateSettings: function (s) {
    if (s.bookmarksBarVisible !== undefined && typeof s.bookmarksBarVisible !== "boolean") return false;
    if (s.bookmarksBarItems !== undefined) {
      if (!Array.isArray(s.bookmarksBarItems) || s.bookmarksBarItems.length > MAX_BOOKMARKS) return false;
      const ids = new Set();
      for (const b of s.bookmarksBarItems) {
        if (!isBookmark(b) || ids.has(b.id)) return false;
        ids.add(b.id);
      }
    }
    return true;
  },

  // For the tests.
  _isWebUrl: isWebUrl,
  MAX_BOOKMARKS,
};
