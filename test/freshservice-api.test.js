"use strict";

const fsApi = require("../plugins/freshservice-api/main");

const { validateSettings, defaultSettings, normalizeDomain, formatTicketText } = fsApi;

// Placeholder only — never a real key.
const FAKE_KEY = "test-key-not-real";

describe("freshservice-api validateSettings", () => {
  test("accepts defaults and an empty object", () => {
    expect(validateSettings(defaultSettings)).toBe(true);
    expect(validateSettings({})).toBe(true);
  });

  test("validates the toggle, domain and key fields", () => {
    expect(validateSettings({ fsApiEnabled: "yes" })).toBe(false);
    expect(validateSettings({ fsApiDomain: "acme.freshservice.com" })).toBe(true);
    expect(validateSettings({ fsApiDomain: "http://acme.freshservice.com" })).toBe(false);
    expect(validateSettings({ fsApiDomain: "not a host" })).toBe(false);
    expect(validateSettings({ fsApiKey: "x".repeat(201) })).toBe(false);
    expect(validateSettings({ fsApiKeyEncrypted: 42 })).toBe(false);
  });
});

describe("freshservice-api normalizeDomain", () => {
  test("reduces URLs and bare hosts to a lowercase hostname", () => {
    expect(normalizeDomain("Acme.Freshservice.com")).toBe("acme.freshservice.com");
    expect(normalizeDomain("https://acme.freshservice.com/a/tickets/12")).toBe("acme.freshservice.com");
    expect(normalizeDomain(" helpdesk.acme.co.uk ")).toBe("helpdesk.acme.co.uk");
  });

  test("rejects anything that could send the key somewhere unexpected", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("http://acme.freshservice.com")).toBeNull();
    expect(normalizeDomain("https://user:pw@acme.freshservice.com")).toBeNull();
    expect(normalizeDomain("acme.freshservice.com:8443")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("10.0.0.1")).toBeNull();
  });
});

describe("freshservice-api formatTicketText", () => {
  test("lists header, description, then conversations in time order", () => {
    const text = formatTicketText(
      {
        id: 42, subject: "Printer offline", status: 2, priority: 3,
        requester: { name: "Pat Lee", email: "pat@example.com" },
        description_text: "The printer on floor 2 is offline.",
      },
      [
        { body_text: "Restarted the spooler.", private: true, created_at: "2026-10-02T10:00:00Z" },
        { body_text: "It stopped printing this morning.", incoming: true, created_at: "2026-10-01T09:00:00Z" },
        { body: "<p>Fixed &amp; tested</p>", private: false, created_at: "2026-10-03T08:00:00Z" },
      ],
    );
    expect(text).toContain("Ticket #42: Printer offline");
    expect(text).toContain("Status: Open | Priority: High | Requester: Pat Lee <pat@example.com>");
    expect(text).toContain("Description:\nThe printer on floor 2 is offline.");
    expect(text).toContain("Fixed & tested");
    const order = ["It stopped printing", "Restarted the spooler", "Fixed & tested"].map((s) => text.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toMatch(/\[Message from requester, [^\]]+\]/);
    expect(text).toMatch(/\[Private note, [^\]]+\]/);
  });
});

describe("freshservice-api handlers", () => {
  let handlers;
  let settings;
  let transformer;
  let realFetch;

  function initPlugin() {
    handlers = {};
    fsApi.init({
      handle: (name, fn) => { handlers[name] = fn; },
      getSettings: () => settings,
      // Identity "encryption" keeps the test independent of the OS keychain.
      encryptCredential: (v) => "enc:" + v,
      decryptCredential: (v) => v.replace(/^enc:/, ""),
      registerSettingsTransformer: (fn) => { transformer = fn; },
      log: () => {},
    });
  }

  function jsonResponse(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
  }

  beforeEach(() => {
    realFetch = global.fetch;
    settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com", fsApiKeyEncrypted: "enc:" + FAKE_KEY };
    initPlugin();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  test("the transformer encrypts a new key and never keeps the plain text", () => {
    const out = transformer({ fsApiKey: FAKE_KEY, fsApiDomain: "https://ACME.freshservice.com/" });
    expect(out.fsApiKey).toBeUndefined();
    expect(out.fsApiKeyEncrypted).toBe("enc:" + FAKE_KEY);
    expect(out.fsApiDomain).toBe("acme.freshservice.com");
  });

  test("get-ticket calls the v2 ticket and conversation endpoints with Basic auth", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/conversations")) {
        return jsonResponse({ conversations: [{ body_text: "Rebooted it.", private: true, created_at: "2026-10-01" }] });
      }
      return jsonResponse({ ticket: { id: 7, subject: "VPN down", description_text: "Cannot connect." } });
    });
    const result = await handlers["get-ticket"]({ ticketId: "7", host: "acme.freshservice.com" });
    expect(result.text).toContain("Ticket #7: VPN down");
    expect(result.text).toContain("Rebooted it.");

    const urls = global.fetch.mock.calls.map((c) => c[0]);
    expect(urls).toContain("https://acme.freshservice.com/api/v2/tickets/7?include=requester");
    expect(urls).toContain("https://acme.freshservice.com/api/v2/tickets/7/conversations?per_page=100&page=1");
    const auth = global.fetch.mock.calls[0][1].headers.Authorization;
    expect(auth).toBe("Basic " + Buffer.from(FAKE_KEY + ":X").toString("base64"));
  });

  test("get-ticket follows conversation pages until a short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ body_text: "n" + i, created_at: "2026-10-01" }));
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith("&page=1")) return jsonResponse({ conversations: full });
      if (url.endsWith("&page=2")) return jsonResponse({ conversations: [{ body_text: "last" }] });
      return jsonResponse({ ticket: { id: 7 } });
    });
    await handlers["get-ticket"]({ ticketId: "7" });
    const pages = global.fetch.mock.calls.map((c) => c[0]).filter((u) => u.includes("/conversations"));
    expect(pages).toHaveLength(2);
  });

  test("get-ticket skips without calling the API when it can't be used", async () => {
    global.fetch = jest.fn();
    expect((await handlers["get-ticket"]({ ticketId: "CHN-4" })).skipped).toBe(true);
    expect((await handlers["get-ticket"]({ ticketId: "7", host: "other.freshservice.com" })).skipped).toBe(true);
    settings = Object.assign({}, settings, { fsApiEnabled: false });
    expect((await handlers["get-ticket"]({ ticketId: "7" })).skipped).toBe(true);
    settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com" };
    expect((await handlers["get-ticket"]({ ticketId: "7" })).skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("API errors are reported without the key", async () => {
    global.fetch = jest.fn(async () => jsonResponse({}, 401));
    const result = await handlers["get-ticket"]({ ticketId: "7" });
    expect(result.error).toMatch(/rejected the API key/);
    expect(result.error).not.toContain(FAKE_KEY);
    expect(result.text).toBeUndefined();
  });

  test("test-connection reports success with the domain", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ tickets: [] }));
    expect(await handlers["test-connection"]()).toEqual({ ok: true, domain: "acme.freshservice.com" });
    expect(global.fetch.mock.calls[0][0]).toBe("https://acme.freshservice.com/api/v2/tickets?per_page=1");
  });
});
