"use strict";

const vm = require("vm");
const cw = require("../plugins/connectwise-manage/renderer");
const manifest = require("../plugins/connectwise-manage/manifest.json");

describe("connectwise-manage matchesUrl", () => {
  test("matches CW cloud hosts", () => {
    expect(cw.matchesUrl("https://na.myconnectwise.net/v4_6_release/ConnectWise.aspx")).toBe(true);
    expect(cw.matchesUrl("https://eu.myconnectwise.net/")).toBe(true);
  });

  test("rejects other hosts and look-alikes", () => {
    expect(cw.matchesUrl("https://acme.freshservice.com/a/tickets/1")).toBe(false);
    expect(cw.matchesUrl("https://myconnectwise.net.evil.com/")).toBe(false);
    expect(cw.matchesUrl("https://evilmyconnectwise.net/")).toBe(false);
    expect(cw.matchesUrl("file:///C:/x.myconnectwise.net")).toBe(false);
    expect(cw.matchesUrl("not a url")).toBe(false);
  });
});

describe("connectwise-manage ticket keys", () => {
  test("prefixes ticket numbers so they don't collide with Freshservice", () => {
    expect(cw.ticketKey("123456")).toBe("CW-123456");
    expect(cw.ticketKey(" 42 ")).toBe("CW-42");
    expect(cw.ticketKey("abc")).toBeNull();
    expect(cw.ticketNumberFromKey("CW-123456")).toBe("123456");
    expect(cw.ticketNumberFromKey("123456")).toBeNull();
  });

  test("reads the ticket from classic CW URLs", () => {
    expect(cw.ticketFromUrl("https://na.myconnectwise.net/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=987654&companyName=x")).toBe("987654");
    expect(cw.ticketFromUrl("https://na.myconnectwise.net/v4_6_release/ConnectWise.aspx?locale=en_US#XQAAA&srRecID=555123")).toBe("555123");
    expect(cw.ticketFromUrl("https://na.myconnectwise.net/v4_6_release/ConnectWise.aspx")).toBeNull();
  });
});

describe("connectwise-manage live sync hooks", () => {
  test("labels field types", () => {
    expect(cw.fieldTypeLabel("draft")).toBe("time entry");
    expect(cw.fieldTypeLabel("textarea")).toBe("stopwatch");
  });

  test("push delay follows the stopwatch popup", () => {
    const state = {};
    expect(cw.pushDelay("draft", state)).toBe(500);
    expect(cw.pushDelay("textarea", state)).toBe(2000);
    cw.onWatcherMessage({ kind: "popup", visible: true }, state);
    expect(cw.pushDelay("textarea", state)).toBe(100);
    cw.onWatcherMessage({ kind: "popup", visible: false }, state);
    expect(cw.pushDelay("textarea", state)).toBe(2000);
    expect(cw.pushDelay("other", state)).toBeUndefined();
  });

  test("adapter has the expected shape", () => {
    const a = cw.adapter;
    expect(a.id).toBe(manifest.id);
    expect(a.notes.watcherPrefix).toBe("[CW-SYNC] ");
    expect(a.notes.fieldTypes).toEqual(["draft", "textarea"]);
    expect(typeof a.notes.buildPushScript).toBe("function");
  });
});

describe("connectwise-manage page scripts", () => {
  test("all page scripts parse", () => {
    for (const src of [cw.NOTES_READ_SCRIPT, cw.WATCHER_SCRIPT, cw.RECORD_SCRIPT, cw.SCRAPE_SCRIPT, cw.buildPushScript("a `b` ${c} 'd' \"e\"\nline")]) {
      expect(() => new vm.Script(src)).not.toThrow();
    }
  });

  function runRecordScript({ search = "", hash = "", headings = {}, bodyText = "" }) {
    const document = {
      querySelectorAll: (sel) => (headings[sel] || []).map((t) => ({ innerText: t, getAttribute: () => null })),
      body: { innerText: bodyText },
    };
    return vm.runInNewContext(cw.RECORD_SCRIPT, { window: { location: { search, hash } }, document });
  }

  test("record script prefers the URL", () => {
    expect(runRecordScript({ search: "?service_recid=123456", headings: { h1: ["Ticket #999999"] } }))
      .toEqual({ ticket: "CW-123456", kind: "ticket", id: "123456", label: "Ticket #123456", source: "url" });
  });

  test("record script falls back to the page", () => {
    expect(runRecordScript({ headings: { ".cw-header-ticket-number": ["Service Ticket #4567890"] } }).ticket).toBe("CW-4567890");
    expect(runRecordScript({ bodyText: "Service Ticket # 12345 - Printer" }).ticket).toBe("CW-12345");
    expect(runRecordScript({})).toBeNull();
  });

  test("manifest declares the site", () => {
    expect(manifest.site.hosts).toEqual(["myconnectwise.net"]);
    expect(manifest.site.defaultUrl).toBe("https://na.myconnectwise.net/");
  });
});
