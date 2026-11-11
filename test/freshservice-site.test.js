"use strict";

// Loads the Freshservice site adapter (plugins/freshservice/renderer.js) with a
// stub pluginAPI and runs its page scripts against stub pages.

const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(path.join(__dirname, "../plugins/freshservice/renderer.js"), "utf-8");

function loadAdapter(settings, invoke, others) {
  let adapter = null;
  const listeners = {};
  global.window = {
    pluginAPI: {
      sites: { register: (a) => { adapter = a; return a; }, list: () => (others || []).concat(adapter ? [adapter] : []) },
      getSettings: () => Object.assign({}, settings),
      events: { on: (name, fn) => { listeners[name] = fn; } },
      invoke: invoke || (async () => ({})),
    },
  };
  try {
    new Function(SOURCE)();
  } finally {
    delete global.window;
  }
  return { adapter, listeners };
}

// Runs a page script with a stub location/document.
function runPageScript(script, { path: pagePath = "/", hash = "", title = "", headers = [] } = {}) {
  const location = { pathname: pagePath, hash, href: "https://acme.freshservice.com" + pagePath };
  const document = { title, querySelectorAll: () => headers, querySelector: () => null };
  return new Function("window", "document", "location", "return " + script)({ location }, document, location);
}

describe("freshservice site adapter", () => {
  test("registers with the fields core and the feature plugins use", () => {
    const { adapter } = loadAdapter({});
    expect(adapter.id).toBe("freshservice");
    expect(adapter.name).toBe("Freshservice");
    expect(adapter.notes.watcherPrefix).toBe("[FS-SYNC] ");
    expect(adapter.notes.fieldTypes).toEqual(["editor", "textarea"]);
    expect(adapter.notes.fieldTypeLabel("editor")).toBe("note editor");
    expect(adapter.notes.pushDelay("editor")).toBe(500);
    expect(adapter.notes.pushDelay("textarea")).toBe(300);
    expect(typeof adapter.notes.buildPushScript("hello")).toBe("string");
    expect(adapter.notes.buildPushScript("a\"b")).toContain(JSON.stringify("a\"b"));
    expect(adapter.knowledge.name).toBe("Solutions");
  });

  test("claims Freshworks hosts and the configured API domain only", () => {
    const { adapter, listeners } = loadAdapter({ fsApiDomain: "help.acme.com" });
    expect(adapter.matchesUrl("https://acme.freshservice.com/a/tickets/1")).toBe(true);
    expect(adapter.matchesUrl("https://acme.myfreshworks.com/login")).toBe(true);
    expect(adapter.matchesUrl("https://help.acme.com/a/tickets/1")).toBe(true);
    expect(adapter.matchesUrl("https://freshservice.com.evil.net/")).toBe(false);
    expect(adapter.matchesUrl("file:///C:/freshservice.com")).toBe(false);
    listeners["settings:changed"]({ fsApiDomain: "" });
    expect(adapter.matchesUrl("https://help.acme.com/")).toBe(false);
  });

  test("claims the Home URL's custom domain unless another site does", () => {
    const { adapter } = loadAdapter({ defaultUrl: "https://help.acme.com/a" });
    expect(adapter.matchesUrl("https://help.acme.com/a/tickets/1")).toBe(true);
    expect(adapter.matchesUrl("https://other.acme.com/")).toBe(false);
    const cw = { id: "connectwise-manage", matchesUrl: (u) => u.includes("help.acme.com") };
    const second = loadAdapter({ defaultUrl: "https://help.acme.com/a" }, undefined, [cw]).adapter;
    expect(second.matchesUrl("https://help.acme.com/a/tickets/1")).toBe(false);
  });

  test("finds the open record from the URL, title or header", () => {
    const { adapter } = loadAdapter({});
    expect(runPageScript(adapter.recordScript, { path: "/a/tickets/123" }))
      .toMatchObject({ ticket: "123", kind: "ticket", id: "123", label: "ticket #123", source: "url" });
    expect(runPageScript(adapter.recordScript, { path: "/itil/changes/45" }))
      .toMatchObject({ ticket: "CHN-45", kind: "change", id: "45" });
    expect(runPageScript(adapter.recordScript, { path: "/a/foo", title: "[#SR-77] Printer" }))
      .toMatchObject({ ticket: "77", kind: "ticket", source: "title" });
    expect(runPageScript(adapter.recordScript, { path: "/x", headers: [{ innerText: "PRB-9 Outage" }] }))
      .toMatchObject({ ticket: "PRB-9", kind: "problem", id: "9", source: "header" });
    expect(runPageScript(adapter.recordScript, { path: "/a/tickets", title: "INC-1" }).ticket).toBeNull();
  });

  test("reads tickets through the API and leaves other records to the page", async () => {
    const calls = [];
    const { adapter } = loadAdapter({}, async (plugin, action, data) => {
      calls.push([plugin, action, data]);
      return { text: "Ticket text" };
    });
    const ticket = await adapter.readRecord({
      url: "https://acme.freshservice.com/a/tickets/5",
      record: { ticket: "5", kind: "ticket", id: "5" },
    });
    expect(ticket).toEqual({ text: "Ticket text", source: "api" });
    expect(calls).toEqual([["freshservice", "get-ticket", { ticketId: "5", host: "acme.freshservice.com" }]]);
    expect(await adapter.readRecord({ url: "https://acme.freshservice.com/a/changes/5", record: { kind: "change", id: "5" } })).toBeNull();
  });

  test("returns null when the API is skipped so the page is scraped", async () => {
    const { adapter } = loadAdapter({}, async () => ({ skipped: true, error: "off" }));
    expect(await adapter.readRecord({ url: "https://a.freshservice.com/", record: { kind: "ticket", id: "1" } })).toBeNull();
  });
});

describe("freshservice recordLink", () => {
  const { adapter } = loadAdapter({});
  test("strips view and query parameters from record pages", () => {
    expect(adapter.recordLink("https://acme.freshservice.com/a/tickets/123?current_tab=details#notes")).toBe("https://acme.freshservice.com/a/tickets/123");
    expect(adapter.recordLink("https://acme.freshservice.com/a/tickets/123/edit")).toBe("https://acme.freshservice.com/a/tickets/123");
    expect(adapter.recordLink("https://acme.freshservice.com/itil/changes/45")).toBe("https://acme.freshservice.com/itil/changes/45");
    expect(adapter.recordLink("https://help.acme.com/helpdesk/tickets/9")).toBe("https://help.acme.com/helpdesk/tickets/9");
  });
  test("null on list pages", () => {
    expect(adapter.recordLink("https://acme.freshservice.com/a/tickets?filter=open")).toBeNull();
    expect(adapter.recordLink("https://acme.freshservice.com/a/tickets/view/1")).toBeNull();
    expect(adapter.recordLink("nope")).toBeNull();
  });
});
