"use strict";

const C = require("../site-colors");

describe("site tab colours", () => {
  test("normalizeColor accepts #rgb and #rrggbb only", () => {
    expect(C.normalizeColor("#22B573")).toBe("#22b573");
    expect(C.normalizeColor(" #abc ")).toBe("#aabbcc");
    expect(C.normalizeColor("red")).toBe("");
    expect(C.normalizeColor("#12345")).toBe("");
    expect(C.normalizeColor("#123456; color: red")).toBe("");
    expect(C.normalizeColor(undefined)).toBe("");
  });

  test("colorForSite uses the plugin colour unless the user changed it", () => {
    expect(C.colorForSite("freshservice", "#22b573", {})).toBe("#22b573");
    expect(C.colorForSite("freshservice", "#22b573", { siteTabColorOverrides: { freshservice: "#0000ff" } })).toBe("#0000ff");
    expect(C.colorForSite("freshservice", "#22b573", { siteTabColorOverrides: { freshservice: "" } })).toBe("");
    expect(C.colorForSite("other", "", {})).toBe("");
    expect(C.colorForSite("other", "", { siteTabColorOverrides: { other: "#123456" } })).toBe("#123456");
    expect(C.colorForSite("", "#22b573", {})).toBe("");
  });

  test("the master switch turns every stripe off", () => {
    expect(C.colorForSite("freshservice", "#22b573", { siteTabColors: false })).toBe("");
    expect(C.colorForSite("freshservice", "#22b573", { siteTabColors: false, siteTabColorOverrides: { freshservice: "#0000ff" } })).toBe("");
  });

  test("overrides don't inherit from Object.prototype", () => {
    expect(C.colorForSite("constructor", "", {})).toBe("");
    expect(C.validOverrides(JSON.parse('{"__proto__": "#123456"}'))).toBe(false);
  });

  test("withOverride sets, turns off and resets without touching the original", () => {
    const start = { freshservice: "#111111" };
    expect(C.withOverride(start, "connectwise-manage", "#ABCDEF")).toEqual({ freshservice: "#111111", "connectwise-manage": "#abcdef" });
    expect(C.withOverride(start, "freshservice", "")).toEqual({ freshservice: "" });
    expect(C.withOverride(start, "freshservice", "", true)).toEqual({});
    expect(start).toEqual({ freshservice: "#111111" });
    expect(C.withOverride(undefined, "x", "#000000")).toEqual({ x: "#000000" });
  });

  test("validOverrides", () => {
    expect(C.validOverrides(undefined)).toBe(true);
    expect(C.validOverrides({})).toBe(true);
    expect(C.validOverrides({ freshservice: "#22b573", cw: "" })).toBe(true);
    expect(C.validOverrides({ freshservice: "#ABC" })).toBe(false);
    expect(C.validOverrides(null)).toBe(false);
    const many = {};
    for (let i = 0; i < 51; i++) many["s" + i] = "";
    expect(C.validOverrides(many)).toBe(false);
  });
});
