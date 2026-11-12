"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const cr = require("../plugins/canned-responses/renderer");
const crMain = require("../plugins/canned-responses/main");
const cw = require("../plugins/connectwise-manage/renderer");
const fsApi = require("../plugins/freshservice/main");

const ok = (over) => Object.assign({ id: "cr-1", title: "Done", body: "Hi {{requester_first}}" }, over);

describe("canned-responses validateSettings", () => {
  const { validateSettings, defaultSettings, MAX_RESPONSES, MAX_BODY } = crMain;

  test("accepts the defaults and an empty object", () => {
    expect(validateSettings(defaultSettings)).toBe(true);
    expect(validateSettings({})).toBe(true);
  });

  test("accepts replies with or without a category", () => {
    expect(validateSettings({ cannedResponses: [ok(), ok({ id: "cr-2", category: "Accounts", body: "" })] })).toBe(true);
  });

  test("rejects malformed replies, duplicate ids and oversized lists", () => {
    expect(validateSettings({ cannedResponses: "x" })).toBe(false);
    expect(validateSettings({ cannedResponses: [null] })).toBe(false);
    expect(validateSettings({ cannedResponses: [ok({ id: "" })] })).toBe(false);
    expect(validateSettings({ cannedResponses: [ok({ title: "  " })] })).toBe(false);
    expect(validateSettings({ cannedResponses: [ok({ title: "x".repeat(101) })] })).toBe(false);
    expect(validateSettings({ cannedResponses: [ok({ body: 5 })] })).toBe(false);
    expect(validateSettings({ cannedResponses: [ok({ body: "x".repeat(MAX_BODY + 1) })] })).toBe(false);
    expect(validateSettings({ cannedResponses: [ok({ category: 3 })] })).toBe(false);
    expect(validateSettings({ cannedResponses: [ok(), ok()] })).toBe(false);
    const many = Array.from({ length: MAX_RESPONSES + 1 }, (_, i) => ok({ id: "cr-" + i }));
    expect(validateSettings({ cannedResponses: many })).toBe(false);
  });

  test("your name must be a short string", () => {
    expect(validateSettings({ cannedResponsesAgentName: "Sam Taylor" })).toBe(true);
    expect(validateSettings({ cannedResponsesAgentName: 1 })).toBe(false);
    expect(validateSettings({ cannedResponsesAgentName: "x".repeat(101) })).toBe(false);
  });

  test("manifest matches the app version rules", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../plugins/canned-responses/manifest.json"), "utf-8"));
    expect(manifest.id).toBe("canned-responses");
    expect(manifest.renderer).toBe("renderer.js");
    expect(manifest.settings).toBe("settings.js");
  });
});

describe("canned-responses placeholders", () => {
  const now = new Date(2026, 10, 11, 14, 5);

  test("fills known placeholders, case- and space-insensitive", () => {
    const values = cr.placeholderValues({
      record: { ticket: "123", id: "123" },
      context: { requester: "Jane Doe", subject: "Printer jam" },
      agentName: "Sam Taylor",
      siteName: "Freshservice",
      now,
    });
    const out = cr.fillPlaceholders("Hi {{ Requester_First }}, re #{{ticket}} ({{subject}}) on {{site}}. — {{agent_first}} / {{agent}}", values);
    expect(out.text).toBe("Hi Jane, re #123 (Printer jam) on Freshservice. — Sam / Sam Taylor");
    expect(out.missing).toEqual([]);
    expect(values.date).toBe(now.toLocaleDateString());
  });

  test("leaves missing ones in place and lists each once; unknown names untouched", () => {
    const out = cr.fillPlaceholders("{{requester}} {{requester}} {{agent}} {{nope}}", { agent: "Sam" });
    expect(out.text).toBe("{{requester}} {{requester}} Sam {{nope}}");
    expect(out.missing).toEqual(["requester"]);
  });

  test("prefers the site's first name over splitting the full name", () => {
    expect(cr.placeholderValues({ context: { requester: "Mary Ann Smith", requesterFirstName: "Mary Ann" } }).requester_first).toBe("Mary Ann");
  });

  test("only asks the site for the ticket when a body needs it", () => {
    expect(cr.needsContext("Thanks, {{agent}} {{date}}")).toBe(false);
    expect(cr.needsContext("Hi {{ requester_first }}")).toBe(true);
    expect(cr.placeholdersIn("{{date}} {{x}} {{DATE}} {{ticket}}")).toEqual(["date", "ticket"]);
  });
});

describe("canned-responses list", () => {
  const list = cr.sanitize([
    { id: "a", title: "Password reset", body: "Your password was reset", category: "Accounts" },
    { id: "b", title: "Closing", body: "Closing this ticket" },
    { id: "c", title: "MFA", body: "Re-register your authenticator", category: "accounts" },
    { id: "d", title: "Printer", body: "Driver reinstalled", category: "Hardware" },
    null,
    { id: "e", title: 5, body: "" },
  ]);

  test("sanitize drops malformed entries", () => {
    expect(list.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("groups by category, uncategorised first, categories case-insensitive", () => {
    const groups = cr.filterAndGroup(list, "");
    expect(groups.map((g) => g.category)).toEqual(["", "Accounts", "Hardware"]);
    expect(groups[1].items.map((r) => r.id)).toEqual(["a", "c"]);
  });

  test("search matches every word across title, category and body", () => {
    expect(cr.filterAndGroup(list, "accounts reset").flatMap((g) => g.items.map((r) => r.id))).toEqual(["a"]);
    expect(cr.filterAndGroup(list, "DRIVER").flatMap((g) => g.items.map((r) => r.id))).toEqual(["d"]);
    expect(cr.filterAndGroup(list, "zzz")).toEqual([]);
  });

  test("preview is one short line", () => {
    expect(cr.preview("a\n\nb   c")).toBe("a b c");
    expect(cr.preview("x".repeat(200)).length).toBe(91);
  });
});

// ---- Site adapters' reply parts ----

function textareaStub(value, start, end) {
  const events = [];
  const ta = {
    tagName: "TEXTAREA", value, selectionStart: start, selectionEnd: end,
    isConnected: true, disabled: false, readOnly: false, name: "note",
    getClientRects: () => [1], focus() {}, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    dispatchEvent: (e) => events.push(e.type), getAttribute: () => null,
    matches: () => false, closest: () => null, nodeType: 1,
  };
  return { ta, events };
}

function pageGlobals(ta) {
  class HTMLTextAreaElement {}
  // The page scripts call the native value setter; route it to the stub.
  Object.defineProperty(HTMLTextAreaElement.prototype, "value", { set: function (v) { ta.value = v; } });
  return {
    window: { HTMLTextAreaElement },
    Event: class { constructor(type) { this.type = type; } },
  };
}

describe("connectwise-manage reply insert", () => {
  test("adapter offers a reply part and its scripts parse", () => {
    expect(typeof cw.adapter.reply.buildInsertScript).toBe("function");
    expect(typeof cw.adapter.reply.readContext).toBe("function");
    for (const src of [cw.REPLY_CONTEXT_SCRIPT, cw.buildReplyInsertScript("a `b` ${c} 'd' \"e\"\nline")]) {
      expect(() => new vm.Script(src)).not.toThrow();
    }
  });

  test("inserts at the caret in an open stopwatch textarea, keeping the rest", () => {
    const { ta, events } = textareaStub("Hello world", 6, 6);
    const document = { querySelector: (sel) => (sel.startsWith("textarea") ? ta : null) };
    const out = vm.runInNewContext(cw.buildReplyInsertScript("big "), Object.assign({ document }, pageGlobals(ta)));
    expect(out).toEqual({ type: "textarea" });
    expect(ta.value).toBe("Hello big world");
    expect(events).toEqual(["input", "change"]);
  });

  test("returns null when no notes field is on screen", () => {
    const document = { querySelector: () => null };
    expect(vm.runInNewContext(cw.buildReplyInsertScript("x"), { document, window: {} })).toBeNull();
  });
});

describe("freshservice reply insert", () => {
  const SOURCE = fs.readFileSync(path.join(__dirname, "../plugins/freshservice/renderer.js"), "utf-8");

  function loadAdapter(invoke) {
    let adapter = null;
    global.window = {
      pluginAPI: {
        sites: { register: (a) => { adapter = a; return a; }, list: () => [] },
        getSettings: () => ({}),
        events: { on: () => {} },
        invoke: invoke || (async () => ({})),
      },
    };
    try { new Function(SOURCE)(); } finally { delete global.window; }
    return adapter;
  }

  test("adapter offers a reply part whose script parses", () => {
    const a = loadAdapter();
    expect(a.reply.label).toBe("reply or note editor");
    expect(() => new vm.Script(a.reply.buildInsertScript("a `b` ${c} 'd' \"e\"\n<b>x</b>"))).not.toThrow();
  });

  test("inserts at the caret in a note textarea", () => {
    const a = loadAdapter();
    const { ta } = textareaStub("ab", 1, 1);
    const document = {
      activeElement: ta,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const out = vm.runInNewContext(a.reply.buildInsertScript("X"), Object.assign({ document }, pageGlobals(ta)));
    expect(out).toEqual({ type: "textarea" });
    expect(ta.value).toBe("aXb");
  });

  test("readContext uses the API's requester and subject", async () => {
    const calls = [];
    const a = loadAdapter(async (id, action, data) => {
      calls.push([id, action, data]);
      return { subject: "Printer jam", requester: "Jane Doe", requesterFirstName: "Jane" };
    });
    const ctx = await a.reply.readContext({
      url: "https://acme.freshservice.com/a/tickets/42",
      record: { kind: "ticket", id: "42" },
      webview: { executeJavaScript: async () => { throw new Error("page not needed"); } },
    });
    expect(ctx).toEqual({ subject: "Printer jam", requester: "Jane Doe", requesterFirstName: "Jane" });
    expect(calls).toEqual([["freshservice", "get-ticket-fields", { ticketId: "42", host: "acme.freshservice.com" }]]);
  });

  test("readContext falls back to the page when the API can't help", async () => {
    const a = loadAdapter(async () => ({ skipped: true, error: "off" }));
    const ctx = await a.reply.readContext({
      url: "https://acme.freshservice.com/a/changes/4",
      record: { kind: "change", id: "4" },
      webview: { executeJavaScript: async () => ({ subject: "Patch", requester: "Bo" }) },
    });
    expect(ctx).toEqual({ subject: "Patch", requester: "Bo" });
  });

  test("ticketFields picks the requester's names", () => {
    expect(fsApi.ticketFields({ subject: " VPN  down ", requester: { first_name: "Jane", last_name: "Doe" } }))
      .toEqual({ subject: "VPN down", requester: "Jane Doe", requesterFirstName: "Jane" });
    expect(fsApi.ticketFields({ requester: { name: "Bob Ray" } }))
      .toEqual({ subject: "", requester: "Bob Ray", requesterFirstName: "Bob" });
    expect(fsApi.ticketFields({})).toEqual({ subject: "", requester: "", requesterFirstName: "" });
  });
});
