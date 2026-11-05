"use strict";

const fsApi = require("../plugins/freshservice/main");

const { validateSettings, defaultSettings, normalizeDomain, formatTicketText, formatArticle } = fsApi;

// Placeholder only — never a real key.
const FAKE_KEY = "test-key-not-real";

describe("freshservice validateSettings", () => {
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

describe("freshservice normalizeDomain", () => {
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

describe("freshservice formatTicketText", () => {
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

describe("freshservice formatArticle", () => {
  test("keeps plain text, marks drafts and builds the portal link from the domain", () => {
    const a = formatArticle({ id: 9, title: " Reset MFA ", status: 1, description: "<p>Step 1</p><p>Step 2 &amp; 3</p>" }, "acme.freshservice.com", 100);
    expect(a).toEqual(expect.objectContaining({
      id: "9", title: "Reset MFA", status: "draft", url: "https://acme.freshservice.com/support/solutions/articles/9",
      text: "Step 1\nStep 2 & 3", truncated: false,
    }));
    expect(formatArticle({ id: 9, status: 2, description_text: "x".repeat(50) }, "acme.freshservice.com", 10))
      .toEqual(expect.objectContaining({ status: "published", text: "x".repeat(10), truncated: true, title: "Article 9" }));
  });

  test("rejects entries without a numeric ID", () => {
    expect(formatArticle({ id: "../tickets" }, "acme.freshservice.com")).toBeNull();
    expect(formatArticle(null, "acme.freshservice.com")).toBeNull();
  });
});

describe("freshservice handlers", () => {
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

  test("search-solutions URL-encodes the term and returns short entries", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ articles: [
      { id: 1, title: "VPN setup", status: 2, description_text: "y".repeat(2000) },
      { id: "bad" },
    ] }));
    const res = await handlers["search-solutions"]({ term: "  vpn & certs  " });
    expect(global.fetch.mock.calls[0][0]).toBe("https://acme.freshservice.com/api/v2/solutions/articles/search?search_term=vpn%20%26%20certs");
    expect(res.articles).toHaveLength(1);
    expect(res.articles[0].text.length).toBe(500);
    expect(res.articles[0].url).toBe("https://acme.freshservice.com/support/solutions/articles/1");
  });

  test("search-solutions skips empty terms and reports setup problems", async () => {
    global.fetch = jest.fn();
    expect(await handlers["search-solutions"]({ term: "   " })).toEqual({ articles: [] });
    settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com" };
    expect((await handlers["search-solutions"]({ term: "vpn" })).error).toMatch(/API key/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("get-solution-article validates the ID and names articles in errors", async () => {
    global.fetch = jest.fn(async () => jsonResponse({}, 404));
    expect((await handlers["get-solution-article"]({ id: "1/../2" })).error).toMatch(/Invalid/);
    expect(global.fetch).not.toHaveBeenCalled();
    expect((await handlers["get-solution-article"]({ id: "5" })).error).toBe("Solution article not found in Freshservice (404).");
    expect(global.fetch.mock.calls[0][0]).toBe("https://acme.freshservice.com/api/v2/solutions/articles/5");
  });

  test("get-solution-article returns the full article text", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ article: { id: 5, title: "Printer SOP", status: 2, description_text: "Do the thing." } }));
    const res = await handlers["get-solution-article"]({ id: 5 });
    expect(res.article).toEqual(expect.objectContaining({ id: "5", title: "Printer SOP", text: "Do the thing." }));
  });
});
