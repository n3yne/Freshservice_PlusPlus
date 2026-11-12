"use strict";

const U = require("../unread-tabs");

// A tab that finished its first load at time 0 and has settled.
function settledTab(title = "Ticket #1") {
  const s = U.createUnreadState();
  U.loadStarted(s, false);
  U.changed(s, "title", title, false, 0);
  U.loadStopped(s, 0);
  return s;
}
const LATER = U.SETTLE_MS + 1;

describe("unread tabs", () => {
  test("a background title change after the page settled marks the tab unread", () => {
    const s = settledTab();
    expect(U.changed(s, "title", "(1) Ticket #1", false, LATER)).toBe(true);
    expect(s.unread).toBe(true);
    // Further changes don't report again until it's read.
    expect(U.changed(s, "title", "(2) Ticket #1", false, LATER + 5)).toBe(false);
    expect(U.viewed(s)).toBe(true);
    expect(s.unread).toBe(false);
  });

  test("changes on the active tab never count", () => {
    const s = settledTab();
    expect(U.changed(s, "title", "New", true, LATER)).toBe(false);
    expect(s.unread).toBe(false);
  });

  test("the same title again isn't a change", () => {
    const s = settledTab("Same");
    expect(U.changed(s, "title", "Same", false, LATER)).toBe(false);
  });

  test("a tab's first load in the background doesn't count", () => {
    const s = U.createUnreadState();
    U.loadStarted(s, false);
    expect(U.changed(s, "title", "Loading page", false, 10)).toBe(false);
    expect(U.changed(s, "title", "Ticket #5", false, 20)).toBe(false);
    U.loadStopped(s, 30);
    // A late title from the page settling right after the load.
    expect(U.changed(s, "title", "Ticket #5 - Helpdesk", false, 30 + 100)).toBe(false);
    expect(U.changed(s, "title", "(1) Ticket #5 - Helpdesk", false, 30 + LATER)).toBe(true);
  });

  test("a load the user started stays quiet after they switch away", () => {
    const s = settledTab();
    U.loadStarted(s, true); // clicked a link while viewing the tab
    U.left(s, LATER);       // then switched to another tab
    expect(U.changed(s, "title", "Ticket #2", false, LATER + 10 * U.SETTLE_MS)).toBe(false); // still loading
    U.loadStopped(s, LATER + 10 * U.SETTLE_MS);
    expect(U.changed(s, "title", "Ticket #2 - Helpdesk", false, LATER + 10 * U.SETTLE_MS + 100)).toBe(false);
    expect(U.changed(s, "title", "(1) Ticket #2", false, LATER + 12 * U.SETTLE_MS)).toBe(true);
  });

  test("changes just after leaving a tab are the page catching up", () => {
    const s = settledTab();
    U.left(s, 10000);
    expect(U.changed(s, "title", "Saved", false, 10000 + 500)).toBe(false);
    expect(U.changed(s, "title", "New reply", false, 10000 + LATER)).toBe(true);
  });

  test("a load the page starts on its own in the background counts once it changes the title", () => {
    const s = settledTab();
    U.loadStarted(s, false); // auto-refresh
    expect(U.changed(s, "title", "Refreshed", false, LATER)).toBe(true);
  });

  test("favicon changes count the same way", () => {
    const s = settledTab();
    expect(U.changed(s, "favicon", U.faviconKey(["https://x/fav.ico"]), false, LATER)).toBe(false); // first one is the baseline
    expect(U.changed(s, "favicon", U.faviconKey(["https://x/fav-1.ico"]), false, LATER)).toBe(true);
  });

  test("faviconKey tolerates bad input", () => {
    expect(U.faviconKey(null)).toBe("");
    expect(U.faviconKey(["a", 3, "b"])).toBe("a b");
    expect(U.changed(U.createUnreadState(), "favicon", "", false, 0)).toBe(false);
  });
});
