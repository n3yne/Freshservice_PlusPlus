// Side panel split view: which pane (top or bottom) each side panel tab sits in,
// and how much of the panel's height the top pane takes. Shared by the main
// process (settings validation, tests) and the renderer (loaded as a plain script).
//
// Settings:
//   sidePanelBottomTabs  ids of the tabs moved to the bottom pane (default [])
//   sidePanelBottomTab   the bottom pane's selected tab (default "")
//   sidePanelSplit       the top pane's share of the height, 0.15-0.85 (default 0.5)
(function (root) {
  "use strict";

  const DEFAULT_SPLIT = 0.5;
  const MIN_SPLIT = 0.15;
  const MAX_SPLIT = 0.85;
  const MAX_BOTTOM_TABS = 64;
  const TAB_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

  // A saved split, or the default when it is missing or out of range.
  function clampSplit(value) {
    if (typeof value !== "number" || !isFinite(value)) return DEFAULT_SPLIT;
    return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
  }

  function validSplit(value) {
    return typeof value === "number" && isFinite(value) && value >= MIN_SPLIT && value <= MAX_SPLIT;
  }

  function validBottomTabs(list) {
    if (!Array.isArray(list) || list.length > MAX_BOTTOM_TABS) return false;
    const seen = new Set();
    for (const id of list) {
      if (typeof id !== "string" || !TAB_ID.test(id) || seen.has(id)) return false;
      seen.add(id);
    }
    return true;
  }

  // The split for a drag to clientY over a split area that starts at areaTop
  // and is areaHeight tall. Each pane keeps at least minPanePx when there is room.
  function splitFromPointer(clientY, areaTop, areaHeight, minPanePx) {
    if (!(areaHeight > 0)) return DEFAULT_SPLIT;
    const minPx = Math.max(0, Math.min(minPanePx || 0, areaHeight / 2));
    const y = Math.min(areaHeight - minPx, Math.max(minPx, clientY - areaTop));
    return clampSplit(y / areaHeight);
  }

  // Splits tab ids (already in display order) into the two panes. The top pane
  // is never left empty: when every open tab is saved at the bottom (say the
  // top tabs' plugins are turned off), they all show at the top with no split.
  function placeTabs(tabIds, bottomTabs) {
    const bottomSet = new Set(Array.isArray(bottomTabs) ? bottomTabs : []);
    const top = [];
    const bottom = [];
    tabIds.forEach(function (id) { (bottomSet.has(id) ? bottom : top).push(id); });
    if (top.length === 0) return { top: bottom, bottom: [] };
    return { top: top, bottom: bottom };
  }

  // The saved bottom list after moving one tab to "top" or "bottom".
  function moveTab(bottomTabs, id, where) {
    const list = (Array.isArray(bottomTabs) ? bottomTabs : []).filter(function (x) { return x !== id; });
    if (where === "bottom") list.push(id);
    return list.slice(-MAX_BOTTOM_TABS);
  }

  // Which tab a pane shows: its saved tab when that is in the pane, else the first.
  function chooseActive(paneIds, savedId) {
    if (!paneIds.length) return null;
    return paneIds.indexOf(savedId) !== -1 ? savedId : paneIds[0];
  }

  const api = {
    DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT, MAX_BOTTOM_TABS,
    clampSplit, validSplit, validBottomTabs, splitFromPointer, placeTabs, moveTab, chooseActive,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SidePanelSplit = api;
})(typeof window !== "undefined" ? window : globalThis);
