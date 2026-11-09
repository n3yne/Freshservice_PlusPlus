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
