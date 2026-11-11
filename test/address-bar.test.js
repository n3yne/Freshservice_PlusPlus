"use strict";

const { parseAddress, displayAddress } = require("../address-bar");

describe("parseAddress", () => {
  test("keeps full http and https URLs", () => {
    expect(parseAddress("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(parseAddress("http://example.com")).toBe("http://example.com/");
  });

  test("trims surrounding spaces", () => {
    expect(parseAddress("  https://example.com  ")).toBe("https://example.com/");
  });

  test("adds https:// to a bare host", () => {
    expect(parseAddress("example.com")).toBe("https://example.com/");
    expect(parseAddress("acme.freshservice.com/a/tickets/42")).toBe("https://acme.freshservice.com/a/tickets/42");
    expect(parseAddress("example.com:8443/x")).toBe("https://example.com:8443/x");
  });

  test("uses http:// for localhost", () => {
    expect(parseAddress("localhost:3000")).toBe("http://localhost:3000/");
    expect(parseAddress("127.0.0.1/x")).toBe("http://127.0.0.1/x");
  });

  test("rejects other schemes", () => {
    expect(parseAddress("javascript:alert(1)")).toBeNull();
    expect(parseAddress("file:///C:/Windows/win.ini")).toBeNull();
    expect(parseAddress("data:text/html,hi")).toBeNull();
    expect(parseAddress("ftp://example.com")).toBeNull();
    expect(parseAddress("about:blank")).toBeNull();
    expect(parseAddress("chrome://settings")).toBeNull();
  });

  test("rejects words, spaces and empty input", () => {
    expect(parseAddress("")).toBeNull();
    expect(parseAddress("   ")).toBeNull();
    expect(parseAddress("printer")).toBeNull();
    expect(parseAddress("reset password")).toBeNull();
    expect(parseAddress(null)).toBeNull();
    expect(parseAddress(42)).toBeNull();
  });

  test("rejects very long input", () => {
    expect(parseAddress("https://example.com/" + "a".repeat(2100))).toBeNull();
  });
});

describe("displayAddress", () => {
  test("shows page URLs as they are", () => {
    expect(displayAddress("https://example.com/x")).toBe("https://example.com/x");
  });

  test("shows nothing for blank pages", () => {
    expect(displayAddress("about:blank")).toBe("");
    expect(displayAddress("")).toBe("");
    expect(displayAddress(undefined)).toBe("");
  });
});

describe("ticketAddress", () => {
  const { ticketAddress } = require("../address-bar");
  const fs = { id: "fs", ticketUrl: (q) => (/^\d+$/.test(q) ? "https://acme.freshservice.com/a/tickets/" + q : null) };
  const cw = {
    id: "cw",
    ticketUrl: (q, ctx) => {
      const m = /^(CW-)?(\d+)$/i.exec(q);
      return m && (m[1] || ctx.active) ? "https://na.myconnectwise.net/t?service_recid=" + m[2] : null;
    },
  };

  test("asks sites in order and returns the first link", () => {
    expect(ticketAddress("123", [fs, cw], {})).toEqual({ url: "https://acme.freshservice.com/a/tickets/123", site: fs });
    expect(ticketAddress(" CW-9 ", [fs, cw], {}).site).toBe(cw);
  });

  test("asks the active tab's site first", () => {
    expect(ticketAddress("123", [fs, cw], { activeSite: cw }).site).toBe(cw);
  });

  test("passes tab URLs and the home URL", () => {
    let seen = null;
    const spy = { id: "spy", ticketUrl: (q, ctx) => { seen = ctx; return null; } };
    ticketAddress("1", [spy], { tabUrls: ["https://a.example/", 5], homeUrl: "https://h.example/", activeSite: spy });
    expect(seen).toEqual({ active: true, tabUrls: ["https://a.example/"], homeUrl: "https://h.example/" });
  });

  test("ignores sites without ticketUrl, bad links and throwing sites", () => {
    const bad = { id: "bad", ticketUrl: () => "javascript:alert(1)" };
    const boom = { id: "boom", ticketUrl: () => { throw new Error("x"); } };
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(ticketAddress("1", [{ id: "none" }, bad, boom, fs], {}).site).toBe(fs);
    err.mockRestore();
    expect(ticketAddress("1", [bad], {})).toBeNull();
  });

  test("rejects empty, spaced and long input", () => {
    expect(ticketAddress("", [fs], {})).toBeNull();
    expect(ticketAddress("1 2", [fs], {})).toBeNull();
    expect(ticketAddress("1".repeat(65), [fs], {})).toBeNull();
    expect(ticketAddress(null, [fs], {})).toBeNull();
    expect(ticketAddress("1", null, {})).toBeNull();
  });
});
