// Page zoom steps for tab content (Ctrl+wheel, Ctrl+=/-/0). Shared by the main
// process (tests) and the renderer (loaded as a plain script).
(function (root) {
  "use strict";

  // The same zoom presets Chromium uses, so steps feel like a normal browser.
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  const EPSILON = 0.001;

  // The zoom factor after one step "in" or "out" from `current`, or 1 for "reset".
  // A factor between presets moves to the nearest preset in that direction.
  function nextZoomFactor(current, action) {
    if (action === "reset") return 1;
    const cur = typeof current === "number" && isFinite(current) && current > 0 ? current : 1;
    if (action === "in") {
      for (let i = 0; i < ZOOM_STEPS.length; i++) {
        if (ZOOM_STEPS[i] > cur + EPSILON) return ZOOM_STEPS[i];
      }
      return ZOOM_STEPS[ZOOM_STEPS.length - 1];
    }
    if (action === "out") {
      for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
        if (ZOOM_STEPS[i] < cur - EPSILON) return ZOOM_STEPS[i];
      }
      return ZOOM_STEPS[0];
    }
    return cur;
  }

  // The zoom action for a key press, or null. Accepts Electron's input object
  // (before-input-event) and DOM KeyboardEvents alike.
  function zoomActionForKey(input) {
    if (!input || input.alt) return null;
    const ctrl = input.control || input.ctrlKey || input.meta || input.metaKey;
    if (!ctrl) return null;
    const key = input.key;
    if (key === "=" || key === "+") return "in";
    if (key === "-" || key === "_") return "out";
    if (key === "0") return "reset";
    return null;
  }

  // "110%" style label for a zoom factor.
  function zoomPercent(factor) {
    return Math.round(factor * 100) + "%";
  }

  const api = { ZOOM_STEPS, nextZoomFactor, zoomActionForKey, zoomPercent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PageZoom = api;
})(typeof window !== "undefined" ? window : globalThis);
