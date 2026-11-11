// Tab and find keyboard shortcuts. Shared by the main process, which catches
// them while a page in a tab has focus (a page's key presses never reach the
// app window's document), and the renderer, which catches them everywhere else.
(function (root) {
  "use strict";

  // The action for a key press, or null:
  //   { action: "new-tab" | "close-tab" | "reopen-closed" | "next-tab" |
  //             "prev-tab" | "last-tab" | "find" }
  //   { action: "select-tab", index: 0-7 }   (Ctrl+1 to Ctrl+8)
  // Ctrl+9 is the last tab, as in browsers. Accepts Electron's input object
  // (before-input-event) and DOM KeyboardEvents alike.
  function tabShortcutForKey(input) {
    if (!input || input.alt) return null;
    const ctrl = input.control || input.ctrlKey || input.meta || input.metaKey;
    if (!ctrl) return null;
    const shift = !!(input.shift || input.shiftKey);
    const key = typeof input.key === "string" ? input.key : "";
    const lower = key.length === 1 ? key.toLowerCase() : key;

    if (key === "Tab") return { action: shift ? "prev-tab" : "next-tab" };
    if (!shift && key === "PageDown") return { action: "next-tab" };
    if (!shift && key === "PageUp") return { action: "prev-tab" };
    if (lower === "t") return { action: shift ? "reopen-closed" : "new-tab" };
    if (shift) return null;
    if (lower === "w") return { action: "close-tab" };
    if (lower === "f") return { action: "find" };
    if (key >= "1" && key <= "8" && key.length === 1) return { action: "select-tab", index: Number(key) - 1 };
    if (key === "9") return { action: "last-tab" };
    return null;
  }

  // The index of the tab a shortcut moves to, given the active tab's index and
  // the tab count, or -1 when it does nothing (no such tab, or already there).
  function targetTabIndex(shortcut, activeIndex, count) {
    if (!shortcut || count < 1) return -1;
    let target;
    switch (shortcut.action) {
      case "next-tab": target = count > 1 && activeIndex >= 0 ? (activeIndex + 1) % count : -1; break;
      case "prev-tab": target = count > 1 && activeIndex >= 0 ? (activeIndex - 1 + count) % count : -1; break;
      case "last-tab": target = count - 1; break;
      case "select-tab": target = shortcut.index < count ? shortcut.index : -1; break;
      default: return -1;
    }
    return target === activeIndex ? -1 : target;
  }

  const api = { tabShortcutForKey, targetTabIndex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TabShortcuts = api;
})(typeof window !== "undefined" ? window : globalThis);
