"use strict";

const { nextZoomFactor, zoomActionForKey, zoomPercent, ZOOM_STEPS } = require("../page-zoom");

describe("nextZoomFactor", () => {
  test("steps through browser presets", () => {
    expect(nextZoomFactor(1, "in")).toBe(1.1);
    expect(nextZoomFactor(1.1, "in")).toBe(1.25);
    expect(nextZoomFactor(1, "out")).toBe(0.9);
    expect(nextZoomFactor(0.9, "out")).toBe(0.8);
  });

  test("stops at the ends", () => {
    expect(nextZoomFactor(ZOOM_STEPS[ZOOM_STEPS.length - 1], "in")).toBe(5);
    expect(nextZoomFactor(ZOOM_STEPS[0], "out")).toBe(0.25);
  });

  test("moves an in-between factor to the next preset", () => {
    expect(nextZoomFactor(1.05, "in")).toBe(1.1);
    expect(nextZoomFactor(1.05, "out")).toBe(1);
  });

  test("tolerates float noise around a preset", () => {
    expect(nextZoomFactor(1.0999999, "in")).toBe(1.25);
    expect(nextZoomFactor(0.6700001, "out")).toBe(0.5);
  });

  test("reset goes to 100%, bad input is treated as 100%", () => {
    expect(nextZoomFactor(2.5, "reset")).toBe(1);
    expect(nextZoomFactor(NaN, "in")).toBe(1.1);
    expect(nextZoomFactor(undefined, "out")).toBe(0.9);
    expect(nextZoomFactor(1.5, "sideways")).toBe(1.5);
  });
});

describe("zoomActionForKey", () => {
  test("maps Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0", () => {
    expect(zoomActionForKey({ control: true, key: "=" })).toBe("in");
    expect(zoomActionForKey({ control: true, shift: true, key: "+" })).toBe("in");
    expect(zoomActionForKey({ control: true, key: "-" })).toBe("out");
    expect(zoomActionForKey({ control: true, key: "0" })).toBe("reset");
  });

  test("accepts DOM-style events and Cmd on Mac", () => {
    expect(zoomActionForKey({ ctrlKey: true, key: "=" })).toBe("in");
    expect(zoomActionForKey({ meta: true, key: "-" })).toBe("out");
  });

  test("ignores other keys and modifiers", () => {
    expect(zoomActionForKey({ key: "=" })).toBeNull();
    expect(zoomActionForKey({ control: true, key: "a" })).toBeNull();
    expect(zoomActionForKey({ control: true, alt: true, key: "0" })).toBeNull();
    expect(zoomActionForKey(null)).toBeNull();
  });
});

test("zoomPercent", () => {
  expect(zoomPercent(1)).toBe("100%");
  expect(zoomPercent(0.67)).toBe("67%");
  expect(zoomPercent(1.25)).toBe("125%");
});
