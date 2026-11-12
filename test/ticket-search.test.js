"use strict";

const ts = require("../plugins/ticket-search/renderer");
const tsMain = require("../plugins/ticket-search/main");
const fsApi = require("../plugins/freshservice/main");

// Placeholder only — never a real key.
const FAKE_KEY = "test-key-not-real";

describe("ticket-search renderer helpers", () => {
  test("shouldSearch waits for two characters, except ticket numbers", () => {
    expect(ts.shouldSearch("")).toBe(false);
    expect(ts.shouldSearch("a")).toBe(false);
    expect(ts.shouldSearch("7")).toBe(true);
    expect(ts.shouldSearch("#7")).toBe(true);
    expect(ts.shouldSearch("vp")).toBe(true);
    expect(ts.shouldSearch("x".repeat(101))).toBe(false);
  });

  test("relativeTime and metaLine", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    expect(ts.relativeTime("2026-11-12T11:59:40Z", now)).toBe("just now");
    expect(ts.relativeTime("2026-11-12T11:15:00Z", now)).toBe("45m ago");
    expect(ts.relativeTime("2026-11-12T09:00:00Z", now)).toBe("3h ago");
    expect(ts.relativeTime("2026-11-10T12:00:00Z", now)).toBe("2d ago");
    expect(ts.relativeTime("nope", now)).toBe("");
    expect(ts.metaLine({ requester: "Pat Lee", status: "Open", priority: "High", updatedAt: "2026-11-12T09:00:00Z" }, now))
      .toBe("Pat Lee · Open · High · updated 3h ago");
    expect(ts.metaLine({}, now)).toBe("");
  });

  test("pickSite prefers the active tab's site, then the chosen one, then the first", () => {
    const a = { id: "a", ticketSearch: {} };
    const b = { id: "b", ticketSearch: {} };
    const c = { id: "c" };
    expect(ts.pickSite([a, b, c], "b", null)).toBe(b);
    expect(ts.pickSite([a, b, c], "c", "b")).toBe(b);
    expect(ts.pickSite([a, b, c], null, null)).toBe(a);
    expect(ts.pickSite([c], "c", null)).toBeNull();
  });
});

describe("ticket-search settings", () => {
  test("validates the open-in and days choices", () => {
    expect(tsMain.validateSettings(tsMain.defaultSettings)).toBe(true);
    expect(tsMain.validateSettings({ ticketSearchOpenIn: "current" })).toBe(true);
    expect(tsMain.validateSettings({ ticketSearchOpenIn: "window" })).toBe(false);
    expect(tsMain.validateSettings({ ticketSearchDays: 90 })).toBe(true);
    expect(tsMain.validateSettings({ ticketSearchDays: 45 })).toBe(false);
    expect(tsMain.validateSettings({ ticketSearchDays: "30" })).toBe(false);
  });
});

describe("freshservice ticket search helpers", () => {
  test("parseTicketSearch splits numbers, words, emails and the requester query", () => {
    expect(fsApi.parseTicketSearch("  ")).toEqual({ empty: true });
    expect(fsApi.parseTicketSearch("x".repeat(101)).error).toMatch(/100/);
    expect(fsApi.parseTicketSearch("#0123")).toMatchObject({ id: "123", words: [], requesterQuery: "" });
    expect(fsApi.parseTicketSearch("INC-55").id).toBe("55");
    const words = fsApi.parseTicketSearch("VPN  Drops");
    expect(words).toMatchObject({ id: "", words: ["vpn", "drops"], email: "" });
    expect(words.requesterQuery).toBe("~[first_name|last_name|primary_email]:'vpn'");
    const email = fsApi.parseTicketSearch("Pat.Lee@Example.com");
    expect(email.email).toBe("pat.lee@example.com");
    expect(email.requesterQuery).toBe("~[first_name|last_name|primary_email]:'pat.lee@example.com'");
  });

  test("parseTicketSearch strips quotes and filter syntax out of the requester query", () => {
    expect(fsApi.parseTicketSearch("o'brien").requesterQuery).toBe("~[first_name|last_name|primary_email]:'obrien'");
    expect(fsApi.parseTicketSearch("a' OR status:2").requesterQuery).toBe("");
    expect(fsApi.parseTicketSearch("\"x\"").requesterQuery).toBe("");
    expect(fsApi.parseTicketSearch("José").requesterQuery).toBe("~[first_name|last_name|primary_email]:'josé'");
  });

  test("subjectMatches and personMatches need every word", () => {
    expect(fsApi.subjectMatches("VPN keeps dropping", ["vpn", "drop"])).toBe(true);
    expect(fsApi.subjectMatches("VPN keeps dropping", ["vpn", "printer"])).toBe(false);
    expect(fsApi.subjectMatches("anything", [])).toBe(false);
    expect(fsApi.personMatches({ name: "Pat Lee", email: "pat@x.com" }, ["pat", "lee"])).toBe(true);
    expect(fsApi.personMatches({ name: "Pat Lee", email: "pat@x.com" }, ["pat", "smith"])).toBe(false);
  });

  test("formatPerson reads requesters and agents", () => {
    expect(fsApi.formatPerson({ first_name: "Pat", last_name: "Lee", primary_email: "pat@x.com" })).toEqual({ name: "Pat Lee", email: "pat@x.com" });
    expect(fsApi.formatPerson({ name: "Sam", email: "sam@x.com" })).toEqual({ name: "Sam", email: "sam@x.com" });
    expect(fsApi.formatPerson({ primary_email: "only@x.com" })).toEqual({ name: "only@x.com", email: "only@x.com" });
    expect(fsApi.formatPerson({})).toBeNull();
    expect(fsApi.formatPerson(null)).toBeNull();
  });

  test("mergeTicketResults dedupes, tags matches and puts number matches first", () => {
    const t = (id, updatedAt) => ({ id, updatedAt });
    const out = fsApi.mergeTicketResults([
      { tickets: [t(9, "2026-01-01T00:00:00Z")], match: "number" },
      { tickets: [t(1, "2026-11-01T00:00:00Z"), t(2, "2026-11-05T00:00:00Z")], match: "requester" },
      { tickets: [t(2, "2026-11-05T00:00:00Z"), t(3, "2026-11-03T00:00:00Z")], match: "subject" },
    ], 50);
    expect(out.map((x) => x.id)).toEqual([9, 2, 3, 1]);
    expect(out[1].matches).toEqual(["requester", "subject"]);
    expect(fsApi.mergeTicketResults([{ tickets: [t(1), t(2), t(3)], match: "subject" }], 2)).toHaveLength(2);
  });
});

describe("freshservice search-tickets handler", () => {
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

  const ticket = (id, subject, requesterId, updatedAt) => ({
    id, subject, status: 2, priority: 3, requester_id: requesterId, updated_at: updatedAt, created_at: updatedAt,
  });

  test("finds tickets by subject and by requester, with names filled in", async () => {
    global.fetch = jest.fn(async (url) => {
      const u = decodeURIComponent(url);
      if (u.includes("/requesters?query=")) {
        return jsonResponse({ requesters: [
          { id: 11, first_name: "Vpn", last_name: "Admin", primary_email: "vpn@x.com" },
          { id: 12, first_name: "Vpnx", last_name: "Other", primary_email: "o@x.com" },
        ] });
      }
      if (u.includes("/tickets/filter?query=")) return jsonResponse({ tickets: [ticket(5, "Laptop", 11, "2026-11-10T00:00:00Z")], total: 1 });
      if (u.includes("/tickets?updated_since=")) {
        return jsonResponse({ tickets: [
          ticket(7, "VPN keeps dropping", 20, "2026-11-11T00:00:00Z"),
          ticket(8, "Printer jam", 21, "2026-11-11T00:00:00Z"),
        ] });
      }
      if (u.endsWith("/requesters/20")) return jsonResponse({ requester: { first_name: "Pat", last_name: "Lee", primary_email: "pat@x.com" } });
      return jsonResponse({}, 404);
    });
    const res = await handlers["search-tickets"]({ term: "vpn", days: 90 });
    expect(res.error).toBeUndefined();
    expect(res.tickets.map((t) => t.id)).toEqual([7, 5]);
    expect(res.tickets[0]).toMatchObject({ requester: "Pat Lee", statusLabel: "Open", priorityLabel: "High", matches: ["subject"] });
    expect(res.tickets[1]).toMatchObject({ requester: "Vpn Admin", matches: ["requester"] });
    expect(res.days).toBe(90);
    expect(res.scanned).toBe(2);

    const urls = global.fetch.mock.calls.map((c) => decodeURIComponent(c[0]));
    expect(urls.find((u) => u.includes("/requesters?query="))).toContain("\"~[first_name|last_name|primary_email]:'vpn'\"&include_agents=true");
    // Every requester matched "vpn"; both are asked about in one filter query.
    expect(urls.find((u) => u.includes("/tickets/filter"))).toContain("\"requester_id:11 OR requester_id:12\"");
    expect(urls.every((u) => u.startsWith("https://acme.freshservice.com/api/v2/"))).toBe(true);

    // The scan is cached: a second search doesn't list tickets again.
    global.fetch.mockClear();
    await handlers["search-tickets"]({ term: "printer", days: 90 });
    expect(global.fetch.mock.calls.some((c) => c[0].includes("updated_since"))).toBe(false);
  });

  test("a ticket number is looked up directly", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/tickets/42?include=requester")) {
        return jsonResponse({ ticket: Object.assign(ticket(42, "Old one", 30, "2025-01-01T00:00:00Z"), { requester: { name: "Sam Roe", email: "sam@x.com" } }) });
      }
      return jsonResponse({}, 404);
    });
    const res = await handlers["search-tickets"]({ term: "#42" });
    expect(res.tickets).toHaveLength(1);
    expect(res.tickets[0]).toMatchObject({ id: 42, requester: "Sam Roe", matches: ["number"] });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("an unknown ticket number is an empty result, not an error", async () => {
    global.fetch = jest.fn(async () => jsonResponse({}, 404));
    expect(await handlers["search-tickets"]({ term: "999" })).toMatchObject({ tickets: [] });
  });

  test("one part failing still returns the rest, with a warning", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/requesters?query=")) return jsonResponse({}, 400);
      if (url.includes("updated_since")) return jsonResponse({ tickets: [ticket(7, "VPN down", null, "2026-11-11T00:00:00Z")] });
      return jsonResponse({}, 404);
    });
    const res = await handlers["search-tickets"]({ term: "vpn down" });
    expect(res.tickets.map((t) => t.id)).toEqual([7]);
    expect(res.warnings[0]).toMatch(/Couldn't search requesters/);
  });

  test("every part failing is an error", async () => {
    global.fetch = jest.fn(async () => jsonResponse({}, 401));
    expect((await handlers["search-tickets"]({ term: "vpn" })).error).toMatch(/401/);
  });

  test("skips without a key and returns nothing for an empty term", async () => {
    global.fetch = jest.fn();
    expect(await handlers["search-tickets"]({ term: "" })).toEqual({ tickets: [] });
    settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com" };
    expect((await handlers["search-tickets"]({ term: "vpn" })).skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
