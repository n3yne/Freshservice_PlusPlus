"use strict";

// Loads the Metrics Bar renderer (plugins/metrics-bar/renderer.js) against a
// stub DOM and a stub scraper webview, with fake timers, to check how it reads
// a dashboard that fills in its numbers after the page has loaded.

const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(path.join(__dirname, "../plugins/metrics-bar/renderer.js"), "utf-8");

function makeElement(tag) {
  const listeners = {};
  const el = {
    tagName: tag,
    attributes: {},
    children: [],
    style: {},
    textContent: "",
    set innerHTML(v) { this.children = []; this._html = v; },
    get innerHTML() { return this._html || ""; },
    title: "",
    classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); } },
    setAttribute(k, v) { this.attributes[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); },
    emit(name, e) { (listeners[name] || []).slice().forEach((fn) => fn(e)); },
    listenerCount(name) { return (listeners[name] || []).length; },
  };
  return el;
}

// reads: array of results executeJavaScript returns in turn (the last repeats).
// loadEvent: "finish" (default), or a did-fail-load event object, or "never".
function setup({ settings, reads, finalUrl, loadEvent = "finish", cached, invoke }) {
  const byId = {};
  const getById = (id) => (byId[id] = byId[id] || makeElement("div"));
  let scraper = null;
  let readCount = 0;
  const store = cached ? { "fspp-metrics-cache": JSON.stringify(cached) } : {};

  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  global.document = {
    getElementById: getById,
    body: makeElement("body"),
    createElement(tag) {
      const el = makeElement(tag);
      if (tag === "webview") {
        scraper = el;
        let src = "about:blank";
        Object.defineProperty(el, "src", {
          get: () => src,
          set: (v) => {
            src = v;
            if (v === "about:blank") return;
            Promise.resolve().then(() => {
              if (loadEvent === "finish") el.emit("did-finish-load");
              else if (loadEvent !== "never") el.emit("did-fail-load", loadEvent);
            });
          },
        });
        el.getURL = () => finalUrl || src;
        el.executeJavaScript = async () => {
          const r = reads[Math.min(readCount, reads.length - 1)];
          readCount++;
          return r;
        };
      }
      return el;
    },
  };
  const listeners = {};
  global.window = {
    pluginAPI: {
      getSettings: () => settings,
      events: { on: (name, fn) => { listeners[name] = fn; } },
      browser: { newTab: () => {} },
      invoke: invoke || (async () => { throw new Error("no handler"); }),
    },
    backupAPI: { saveSettings: () => {} },
  };
  new Function(SOURCE)();
  return {
    scraper,
    status: getById("metrics-bar-status"),
    items: getById("metrics-bar-items"),
    refresh: getById("btn-metrics-refresh"),
    reads: () => readCount,
    cache: () => JSON.parse(store["fspp-metrics-cache"] || "{}"),
  };
}

const SETTINGS = {
  metricsBarEnabled: true,
  metricsBarInterval: 15,
  metricsBarDashboards: [{
    id: "db1",
    url: "https://acme.freshservice.com/a/dashboard/7",
    fields: [
      { id: "open", label: "Open", selector: ".open" },
      { id: "done", label: "Closed", selector: ".done" },
    ],
  }],
};

function cardValues(items) {
  return items.children.map((c) => c.children[0].textContent);
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  delete global.window;
  delete global.document;
  delete global.localStorage;
});

describe("metrics bar scraping", () => {
  test("keeps reading until widgets that load late have steady values", async () => {
    const t = setup({
      settings: SETTINGS,
      reads: [
        { open: null, done: null },   // widgets not drawn yet
        { open: "0", done: null },    // placeholder, still loading
        { open: "12", done: "4" },
        { open: "12", done: "4" },    // same twice: settled
      ],
    });
    expect(t.scraper.attributes.webpreferences).toBe("backgroundThrottling=no");
    await jest.advanceTimersByTimeAsync(10000);
    expect(t.reads()).toBe(4);
    expect(cardValues(t.items)).toEqual(["12", "4"]);
    expect(t.cache().open.value).toBe("12");
    expect(t.status.textContent).toMatch(/^Updated /);
    expect(t.status.textContent).not.toMatch(/not refreshed/);
  });

  test("gives up after the settle timeout and marks missing fields stale with a reason", async () => {
    const t = setup({
      settings: SETTINGS,
      reads: [{ open: "3", done: null }],
    });
    await jest.advanceTimersByTimeAsync(40000);
    expect(t.reads()).toBeGreaterThan(20);
    expect(t.status.textContent).toMatch(/\(1 not refreshed\)$/);
    expect(t.cache().open.value).toBe("3");
  });

  test("says the user looks signed out when the dashboard redirected to a login page", async () => {
    const t = setup({
      settings: SETTINGS,
      reads: [{ open: null, done: null }],
      finalUrl: "https://acme.freshservice.com/support/login",
      cached: { open: { value: "9", ts: Date.now() }, done: { value: "2", ts: Date.now() } },
    });
    await jest.advanceTimersByTimeAsync(40000);
    expect(t.status.textContent).toMatch(/2 not refreshed/);
    const staleMarker = t.items.children[0].children[2];
    expect(staleMarker.title).toMatch(/signed out of acme\.freshservice\.com/);
    expect(cardValues(t.items)).toEqual(["9", "2"]);
  });

  test("a failed page load fails fast instead of waiting for the load timeout", async () => {
    const t = setup({
      settings: SETTINGS,
      reads: [{ open: "1", done: "1" }],
      loadEvent: { isMainFrame: true, errorCode: -106, errorDescription: "ERR_INTERNET_DISCONNECTED" },
    });
    await jest.advanceTimersByTimeAsync(100);
    expect(t.status.textContent).toBe("Refresh failed");
    expect(t.reads()).toBe(0);
    expect(t.scraper.listenerCount("did-finish-load")).toBe(0);
    expect(t.scraper.listenerCount("did-fail-load")).toBe(0);
  });

  test("an aborted load (redirect) is ignored and the final page is read", async () => {
    const t = setup({ settings: SETTINGS, reads: [{ open: "5", done: "6" }] });
    // Replace the auto event with an abort followed by a finish.
    t.scraper.emit("did-fail-load", { isMainFrame: true, errorCode: -3 });
    await jest.advanceTimersByTimeAsync(10000);
    expect(cardValues(t.items)).toEqual(["5", "6"]);
  });

  test("clicking Refresh during a refresh runs another pass afterwards", async () => {
    const t = setup({ settings: SETTINGS, reads: [{ open: "7", done: "8" }] });
    await jest.advanceTimersByTimeAsync(500);
    t.refresh.emit("click");
    expect(t.status.textContent).toMatch(/again after this pass/);
    await jest.advanceTimersByTimeAsync(10000);
    // Two passes, each needs two matching reads.
    expect(t.reads()).toBe(4);
    expect(t.status.textContent).toMatch(/^Updated /);
  });

  describe("Freshservice API queries", () => {
    const API_SETTINGS = {
      metricsBarEnabled: true,
      metricsBarInterval: 15,
      metricsWorkDays: [1, 2, 3, 4, 5],
      metricsWorkWeekEndDay: 5,
      metricsBarDashboards: [{
        id: "db1",
        url: "https://acme.freshservice.com/a/dashboard/7",
        fields: [
          { id: "open", label: "Open", selector: ".open", apiQuery: "status:2" },
          { id: "done", label: "Closed", selector: ".done", apiQuery: "status:4 AND updated_at:>'{weekStart}'" },
        ],
      }],
    };

    test("uses the API counts and skips loading the dashboard when every field has a query", async () => {
      jest.setSystemTime(new Date(2026, 10, 12, 10, 0)); // Thursday 12 Nov 2026
      const calls = [];
      const t = setup({
        settings: API_SETTINGS,
        reads: [{ open: "1", done: "1" }],
        invoke: async (plugin, action, data) => {
          calls.push([plugin, action, data]);
          return { count: data.query === "status:2" ? 17 : 5 };
        },
      });
      await jest.advanceTimersByTimeAsync(100);
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe("freshservice");
      expect(calls[0][1]).toBe("count-tickets");
      expect(calls[1][2].vars).toEqual({ today: "2026-11-12", weekStart: "2026-11-09", monthStart: "2026-11-01" });
      expect(cardValues(t.items)).toEqual(["17", "5"]);
      expect(t.items.children[0].title).toMatch(/From the Freshservice API/);
      expect(t.reads()).toBe(0);
      expect(t.scraper.src).toBe("about:blank");
      expect(t.status.textContent).toMatch(/^Updated /);
    });

    test("scrapes only the fields whose API query failed, and keeps the API error in the reason", async () => {
      const t = setup({
        settings: API_SETTINGS,
        reads: [{ done: null }],
        invoke: async (plugin, action, data) => (data.query === "status:2"
          ? { count: 3 }
          : { error: "Freshservice API rate limit reached (429)." }),
        cached: { done: { value: "4", ts: Date.now() } },
      });
      await jest.advanceTimersByTimeAsync(40000);
      expect(cardValues(t.items)).toEqual(["3", "4"]);
      const staleMarker = t.items.children[1].children[2];
      expect(staleMarker.title).toMatch(/API: Freshservice API rate limit reached \(429\)\.; dashboard: the value wasn't found/);
      expect(t.status.textContent).toMatch(/\(1 not refreshed\)/);
    });

    test("falls back to the dashboard when the Freshservice plugin isn't there", async () => {
      const t = setup({ settings: API_SETTINGS, reads: [{ open: "8", done: "9" }] });
      await jest.advanceTimersByTimeAsync(10000);
      expect(cardValues(t.items)).toEqual(["8", "9"]);
      expect(t.items.children[0].title).toMatch(/From the dashboard/);
    });
  });
});
