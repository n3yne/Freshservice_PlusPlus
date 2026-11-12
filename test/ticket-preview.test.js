"use strict";

const fs = require("fs");
const path = require("path");

const TP = require("../ticket-preview");
const fsApi = require("../plugins/freshservice/main");
const tsMain = require("../plugins/ticket-search/main");
const rtMain = require("../plugins/recent-tickets/main");

// Placeholder only — never a real key.
const FAKE_KEY = "test-key-not-real";
const NOW = Date.parse("2026-11-12T12:00:00Z");

describe("ticket preview card helpers", () => {
  test("ago() says how long ago, in words", () => {
    expect(TP.ago("2026-11-12T11:59:30Z", NOW)).toBe("just now");
    expect(TP.ago("2026-11-12T11:55:00Z", NOW)).toBe("5 min ago");
    expect(TP.ago("2026-11-12T09:00:00Z", NOW)).toBe("3 h ago");
    expect(TP.ago("2026-11-11T11:00:00Z", NOW)).toBe("1 day ago");
    expect(TP.ago("2026-11-09T11:00:00Z", NOW)).toBe("3 days ago");
    expect(TP.ago("nope", NOW)).toBe("");
  });

  test("placeCard() puts the card left of the row, else right, and inside the window", () => {
    const viewport = { width: 1200, height: 800 };
    const card = { width: 320, height: 200 };
    // A row in a right-hand side panel: the card goes to its left.
    expect(TP.placeCard({ left: 820, right: 1190, top: 100 }, card, viewport)).toEqual({ left: 492, top: 100 });
    // A row on the left edge: the card goes to its right.
    expect(TP.placeCard({ left: 10, right: 380, top: 100 }, card, viewport)).toEqual({ left: 388, top: 100 });
    // Near the bottom: moved up to fit.
    expect(TP.placeCard({ left: 820, right: 1190, top: 750 }, card, viewport).top).toBe(592);
    // No room either side: kept inside the window.
    const narrow = TP.placeCard({ left: 100, right: 300, top: 0 }, card, { width: 400, height: 800 });
    expect(narrow.left).toBeGreaterThanOrEqual(8);
    expect(narrow.left + 320).toBeLessThanOrEqual(400 - 8 + 1);
    expect(narrow.top).toBe(8);
  });

  test("refKey() tells tickets on different sites apart", () => {
    expect(TP.refKey("freshservice", { id: 7, kind: "ticket" })).toBe("freshservice|ticket|7");
    expect(TP.refKey("connectwise-manage", { key: "CW-7" })).toBe("connectwise-manage||CW-7");
  });

  test("replyHeading() says who wrote the newest conversation and when", () => {
    expect(TP.replyHeading({ type: "requester", from: "Ann Lee", at: "2026-11-12T11:55:00Z" }, NOW))
      .toBe("Requester replied (Ann Lee) · 5 min ago");
    expect(TP.replyHeading({ type: "note", from: "Bo", at: "" }, NOW)).toBe("Private note by Bo");
    expect(TP.replyHeading({ type: "reply", from: "" }, NOW)).toBe("Agent replied");
    expect(TP.replyHeading(null, NOW)).toBe("");
  });

  test("detailRows() leaves out what's empty", () => {
    expect(TP.detailRows({
      status: "Open", priority: "High", requester: "Ann Lee", requesterEmail: "ann@example.com",
      agent: "Bo", updatedAt: "2026-11-12T09:00:00Z",
    }, NOW)).toEqual([
      ["Status", "Open · High priority"],
      ["Requester", "Ann Lee <ann@example.com>"],
      ["Agent", "Bo"],
      ["Updated", "3 h ago"],
    ]);
    expect(TP.detailRows({ requesterEmail: "ann@example.com" }, NOW)).toEqual([["Requester", "ann@example.com"]]);
    expect(TP.detailRows({}, NOW)).toEqual([]);
  });
});

describe("freshservice formatTicketPreview", () => {
  const { formatTicketPreview, latestConversation } = fsApi;

  test("picks the newest conversation", () => {
    const list = [
      { id: 1, created_at: "2026-11-10T00:00:00Z" },
      { id: 3, created_at: "2026-11-12T00:00:00Z" },
      { id: 2, created_at: "2026-11-11T00:00:00Z" },
    ];
    expect(latestConversation(list).id).toBe(3);
    expect(latestConversation([])).toBeNull();
    expect(latestConversation(null)).toBeNull();
  });

  test("builds the preview fields from the ticket, its newest reply and the people", () => {
    const ticket = {
      id: 7, subject: "  VPN   down ", status: 3, priority: 4,
      requester: { name: "Ann Lee", email: "ann@example.com" },
      created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-12T00:00:00Z", due_by: "2026-11-13T00:00:00Z",
      description_text: "It stopped working",
    };
    const p = formatTicketPreview(ticket, { id: 9, incoming: false, private: true, user_id: 5, body_text: "Rebooted the  gateway", created_at: "2026-11-12T00:00:00Z" },
      { agent: { name: "Bo" }, author: { name: "Cy" } });
    expect(p).toMatchObject({
      id: 7, subject: "VPN down", status: "Pending", priority: "Urgent", requester: "Ann Lee", requesterEmail: "ann@example.com",
      agent: "Bo", description: "It stopped working",
      lastReply: { type: "note", from: "Cy", snippet: "Rebooted the gateway", at: "2026-11-12T00:00:00Z" },
    });
  });

  test("a requester's reply is credited to the requester; no conversations means no reply", () => {
    const ticket = { id: 7, requester: { first_name: "Ann", last_name: "Lee" } };
    expect(formatTicketPreview(ticket, { id: 1, incoming: true, body: "<p>Still&nbsp;broken</p>", created_at: "x" }, {}).lastReply)
      .toMatchObject({ type: "requester", from: "Ann Lee", snippet: "Still broken" });
    expect(formatTicketPreview(ticket, null, {}).lastReply).toBeNull();
    expect(formatTicketPreview({ id: 7, status: 99 }, null, {}).status).toBe("");
  });
});

describe("freshservice preview-ticket handler", () => {
  let handlers;
  let settings;
  let realFetch;

  function jsonResponse(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
  }

  beforeEach(() => {
    realFetch = global.fetch;
    settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com", fsApiKeyEncrypted: "enc:" + FAKE_KEY };
    handlers = {};
    fsApi.init({
      handle: (name, fn) => { handlers[name] = fn; },
      getSettings: () => settings,
      encryptCredential: (v) => "enc:" + v,
      decryptCredential: (v) => v.replace(/^enc:/, ""),
      registerSettingsTransformer: () => {},
      log: () => {},
    });
  });

  afterEach(() => { global.fetch = realFetch; });

  test("reads the ticket, its conversations and the agent", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/tickets/7?include=requester")) {
        return jsonResponse({ ticket: { id: 7, subject: "VPN", status: 2, priority: 1, responder_id: 11, requester: { name: "Ann", email: "ann@example.com" } } });
      }
      if (url.includes("/tickets/7/conversations")) {
        return jsonResponse({ conversations: [
          { id: 1, incoming: true, body_text: "help", created_at: "2026-11-11T00:00:00Z" },
          { id: 2, incoming: false, private: false, user_id: 11, body_text: "On it", created_at: "2026-11-12T00:00:00Z" },
        ] });
      }
      if (url.endsWith("/requesters/11")) return jsonResponse({}, 404);
      if (url.endsWith("/agents/11")) return jsonResponse({ agent: { first_name: "Bo", last_name: "Diaz", email: "bo@example.com" } });
      return jsonResponse({}, 500);
    });
    const res = await handlers["preview-ticket"]({ ticketId: "7", host: "acme.freshservice.com" });
    expect(res.preview).toMatchObject({
      id: 7, subject: "VPN", status: "Open", priority: "Low", requester: "Ann", agent: "Bo Diaz",
      lastReply: { type: "reply", from: "Bo Diaz", snippet: "On it" },
    });
  });

  test("refuses other record types, other domains and a missing key without calling the API", async () => {
    global.fetch = jest.fn();
    expect((await handlers["preview-ticket"]({ ticketId: "CHN-4" })).skipped).toBe(true);
    expect((await handlers["preview-ticket"]({ ticketId: "7", host: "other.freshservice.com" })).skipped).toBe(true);
    settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com" };
    expect((await handlers["preview-ticket"]({ ticketId: "7" })).skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("a deleted ticket says so", async () => {
    global.fetch = jest.fn(async () => jsonResponse({}, 404));
    expect((await handlers["preview-ticket"]({ ticketId: "7" })).error).toMatch(/wasn't found/);
  });
});

describe("freshservice adapter ticketPreview", () => {
  const SOURCE = fs.readFileSync(path.join(__dirname, "../plugins/freshservice/renderer.js"), "utf-8");

  function loadAdapter(invoke) {
    let adapter = null;
    global.window = {
      pluginAPI: {
        sites: { register: (a) => { adapter = a; return a; }, list: () => [] },
        getSettings: () => ({}),
        events: { on: () => {} },
        invoke,
      },
    };
    try { new Function(SOURCE)(); } finally { delete global.window; }
    return adapter;
  }

  test("supports tickets only, by id or Recent Tickets key", () => {
    const a = loadAdapter(async () => ({}));
    expect(a.ticketPreview.supports({ id: "7" })).toBe(true);
    expect(a.ticketPreview.supports({ key: "123", kind: "ticket" })).toBe(true);
    expect(a.ticketPreview.supports({ key: "CHN-45", kind: "change" })).toBe(false);
    expect(a.ticketPreview.supports({ key: "abc" })).toBe(false);
  });

  test("passes the ticket's host so another account's number isn't read", async () => {
    const invoke = jest.fn(async () => ({ preview: { subject: "VPN" } }));
    const a = loadAdapter(invoke);
    const res = await a.ticketPreview.preview({ key: "123", kind: "ticket", url: "https://acme.freshservice.com/a/tickets/123" });
    expect(invoke).toHaveBeenCalledWith("freshservice", "preview-ticket", { ticketId: "123", host: "acme.freshservice.com" });
    expect(res.preview).toEqual({ subject: "VPN", label: "#123" });
    const err = await loadAdapter(async () => ({ error: "nope", skipped: true })).ticketPreview.preview({ id: 5 });
    expect(err).toEqual({ error: "nope", skipped: true });
  });
});

describe("hover preview settings", () => {
  test("Ticket Search and Recent Tickets accept only a boolean", () => {
    expect(tsMain.defaultSettings.ticketSearchHoverPreview).toBe(true);
    expect(tsMain.validateSettings({ ticketSearchHoverPreview: false })).toBe(true);
    expect(tsMain.validateSettings({ ticketSearchHoverPreview: "no" })).toBe(false);
    expect(rtMain.defaultSettings.recentTicketsHoverPreview).toBe(true);
    expect(rtMain.validateSettings({ recentTicketsHoverPreview: false })).toBe(true);
    expect(rtMain.validateSettings({ recentTicketsHoverPreview: 1 })).toBe(false);
  });
});
