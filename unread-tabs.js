// Unread badge for tabs: decides when a tab in the background has changed on
// its own (a new reply bumps the page title, a count appears in the favicon)
// so the tab bar can mark it until the tab is viewed again.
//
// The renderer keeps one state object per tab and reports what happens to it.
// Changes that come from the user's own clicking don't count:
//   - the tab's first load (a tab opened in the background, a restored tab);
//   - a load that started while the tab was the active one, until it has
//     finished and settled (the user clicked a link, then switched away);
//   - the first few seconds after the user leaves the tab.
(function (root) {
  "use strict";

  // How long after a load finishes, or after the user leaves the tab, changes
  // are taken as the page settling rather than something new.
  const SETTLE_MS = 3000;

  function createUnreadState() {
    return {
      loaded: false,     // the first load has finished
      userLoad: false,   // a load that started while the tab was active is running
      quietUntil: 0,     // changes before this time only update the baseline
      title: null,
      favicon: null,
      unread: false,
    };
  }

  function loadStarted(state, isActive) {
    if (isActive || !state.loaded) state.userLoad = true;
  }

  function loadStopped(state, now) {
    if (!state.loaded || state.userLoad) state.quietUntil = Math.max(state.quietUntil, now + SETTLE_MS);
    state.loaded = true;
    state.userLoad = false;
  }

  // The user switched to the tab: it's read.
  function viewed(state) {
    const was = state.unread;
    state.unread = false;
    return was;
  }

  // The user switched away from the tab.
  function left(state, now) {
    state.quietUntil = Math.max(state.quietUntil, now + SETTLE_MS);
  }

  // Records a new value for key ("title" or "favicon"). Returns true when this
  // change made the tab unread.
  function changed(state, key, value, isActive, now) {
    if (typeof value !== "string" || value === "") return false;
    const prev = state[key];
    if (prev === value) return false;
    state[key] = value;
    if (prev === null || isActive || state.unread) return false;
    if (!state.loaded || state.userLoad || now < state.quietUntil) return false;
    state.unread = true;
    return true;
  }

  // Favicon updates come as a list of URLs; compare them as one value.
  function faviconKey(favicons) {
    if (!Array.isArray(favicons)) return "";
    return favicons.filter(function (f) { return typeof f === "string"; }).join(" ");
  }

  const api = { SETTLE_MS, createUnreadState, loadStarted, loadStopped, viewed, left, changed, faviconKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UnreadTabs = api;
})(typeof window !== "undefined" ? window : globalThis);
