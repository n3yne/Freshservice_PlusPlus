"use strict";

const {
  isAppRequest,
  siteOf,
  describeRequest,
  createPermissionPolicy,
  installPermissionHandlers,
} = require("../permissions");

const TAB = { getType: () => "webview" };
const APP_WINDOW = { getType: () => "window" };
const APP_URL = "file:///C:/Program%20Files/MSP++/resources/app.asar/index.html";

function fakeDialog(response) {
  return { showMessageBox: jest.fn(async () => ({ response })) };
}

function request(policy, webContents, permission, details) {
  return new Promise((resolve) => policy.onRequest(webContents, permission, resolve, details));
}

describe("isAppRequest", () => {
  test("the app's own pages are trusted", () => {
    expect(isAppRequest(APP_WINDOW, APP_URL)).toBe(true);
    expect(isAppRequest(null, APP_URL)).toBe(true);
  });
  test("a tab is never the app, even on a file: page", () => {
    expect(isAppRequest(TAB, APP_URL)).toBe(false);
    expect(isAppRequest(APP_WINDOW, "https://example.com/")).toBe(false);
    expect(isAppRequest(APP_WINDOW, "")).toBe(false);
  });
});

describe("siteOf", () => {
  test("web pages only", () => {
    expect(siteOf("https://Example.com:8443/a?b")).toEqual({ origin: "https://example.com:8443", host: "example.com:8443" });
    expect(siteOf("file:///etc/passwd")).toBeNull();
    expect(siteOf("data:text/html,x")).toBeNull();
    expect(siteOf(undefined)).toBeNull();
  });
});

describe("describeRequest", () => {
  test("names the devices asked for", () => {
    expect(describeRequest("media", { mediaTypes: ["audio"] })).toMatchObject({ keys: ["media:audio"], label: "use your microphone" });
    expect(describeRequest("media", { mediaTypes: ["video", "audio"] }).label).toBe("use your microphone and camera");
    expect(describeRequest("media", {}).keys).toEqual(["media:audio", "media:video"]);
  });
  test("shows the link another program would get", () => {
    const d = describeRequest("openExternal", { externalURL: "ms-msdt:/id PCWDiagnostic" });
    expect(d.keys).toEqual(["openExternal:ms-msdt"]);
    expect(d.detail).toContain("ms-msdt:");
    expect(describeRequest("openExternal", { externalURL: "not a url" })).toBeNull();
  });
  test("unknown permissions are not offered", () => {
    expect(describeRequest("hid", {})).toBeNull();
    expect(describeRequest("constructor", {})).toBeNull();
  });
});

describe("permission policy", () => {
  // Refusals are logged; keep the test output quiet.
  beforeEach(() => { jest.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { console.warn.mockRestore(); });

  test("the app's own windows are allowed without asking", async () => {
    const dialog = fakeDialog(1);
    const policy = createPermissionPolicy(dialog, () => null);
    await expect(request(policy, APP_WINDOW, "clipboard-read", { requestingUrl: APP_URL })).resolves.toBe(true);
    expect(policy.onCheck(APP_WINDOW, "clipboard-read", "file://", {})).toBe(true);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  test("harmless permissions are allowed for tabs without asking", async () => {
    const dialog = fakeDialog(1);
    const policy = createPermissionPolicy(dialog, () => null);
    await expect(request(policy, TAB, "fullscreen", { requestingUrl: "https://a.example/" })).resolves.toBe(true);
    expect(policy.onCheck(TAB, "clipboard-sanitized-write", "https://a.example", {})).toBe(true);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  test("a tab asking for the microphone gets a dialog naming the site, Block by default", async () => {
    const dialog = fakeDialog(0);
    const win = {};
    const policy = createPermissionPolicy(dialog, () => win);
    const allowed = await request(policy, TAB, "media", { requestingUrl: "https://meet.example/room", mediaTypes: ["audio"] });
    expect(allowed).toBe(true);
    const [parent, options] = dialog.showMessageBox.mock.calls[0];
    expect(parent).toBe(win);
    expect(options.message).toBe("meet.example wants to use your microphone.");
    expect(options.buttons).toEqual(["Allow", "Block"]);
    expect(options.defaultId).toBe(1);
    expect(options.cancelId).toBe(1);
  });

  test("the answer is remembered for that site only", async () => {
    const dialog = fakeDialog(0);
    const policy = createPermissionPolicy(dialog, () => null);
    const details = { requestingUrl: "https://a.example/x", mediaTypes: ["audio"] };
    expect(policy.onCheck(TAB, "media", "https://a.example", { mediaType: "audio" })).toBe(false);
    await request(policy, TAB, "media", details);
    await request(policy, TAB, "media", details);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(policy.onCheck(TAB, "media", "https://a.example", { mediaType: "audio" })).toBe(true);
    expect(policy.onCheck(TAB, "media", "https://a.example", { mediaType: "video" })).toBe(false);
    expect(policy.onCheck(TAB, "media", "https://b.example", { mediaType: "audio" })).toBe(false);

    // The camera was not part of that answer, so it asks again.
    await request(policy, TAB, "media", { requestingUrl: "https://a.example/x", mediaTypes: ["audio", "video"] });
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
  });

  test("Block is remembered too, and closing the dialog counts as Block", async () => {
    const dialog = fakeDialog(1);
    const policy = createPermissionPolicy(dialog, () => null);
    const details = { requestingUrl: "https://a.example/" };
    await expect(request(policy, TAB, "notifications", details)).resolves.toBe(false);
    await expect(request(policy, TAB, "notifications", details)).resolves.toBe(false);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(policy.onCheck(TAB, "notifications", "https://a.example", {})).toBe(false);
  });

  test("two requests at once share one dialog", async () => {
    let answer;
    const dialog = { showMessageBox: jest.fn(() => new Promise((r) => { answer = r; })) };
    const policy = createPermissionPolicy(dialog, () => null);
    const details = { requestingUrl: "https://a.example/" };
    const first = request(policy, TAB, "geolocation", details);
    const second = request(policy, TAB, "geolocation", details);
    await new Promise((r) => setImmediate(r));
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    answer({ response: 0 });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  test("starting another program asks and shows the link", async () => {
    const dialog = fakeDialog(1);
    const policy = createPermissionPolicy(dialog, () => null);
    const allowed = await request(policy, TAB, "openExternal", {
      requestingUrl: "https://a.example/",
      externalURL: "ms-msdt:/id PCWDiagnostic",
    });
    expect(allowed).toBe(false);
    const options = dialog.showMessageBox.mock.calls[0][0];
    expect(options.message).toContain('open a "ms-msdt" link in another program');
    expect(options.detail).toContain("ms-msdt:/id PCWDiagnostic");
  });

  test("everything else is refused without asking", async () => {
    const dialog = fakeDialog(0);
    const policy = createPermissionPolicy(dialog, () => null);
    for (const permission of ["hid", "serial", "usb", "midiSysex", "display-capture", "fileSystem", "unknown"]) {
      await expect(request(policy, TAB, permission, { requestingUrl: "https://a.example/" })).resolves.toBe(false);
      expect(policy.onCheck(TAB, permission, "https://a.example", {})).toBe(false);
    }
    await expect(request(policy, TAB, "geolocation", { requestingUrl: "file:///C:/page.html" })).resolves.toBe(false);
    await expect(request(policy, TAB, "geolocation", {})).resolves.toBe(false);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  test("a failing dialog refuses the request", async () => {
    const dialog = { showMessageBox: jest.fn(async () => { throw new Error("no display"); }) };
    const policy = createPermissionPolicy(dialog, () => { throw new Error("no window"); });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(request(policy, TAB, "geolocation", { requestingUrl: "https://a.example/" })).resolves.toBe(false);
    spy.mockRestore();
  });

  test("installs both handlers on a session", () => {
    const session = { setPermissionRequestHandler: jest.fn(), setPermissionCheckHandler: jest.fn() };
    const policy = createPermissionPolicy(fakeDialog(1), () => null);
    installPermissionHandlers(session, policy);
    expect(session.setPermissionRequestHandler).toHaveBeenCalledWith(policy.onRequest);
    expect(session.setPermissionCheckHandler).toHaveBeenCalledWith(policy.onCheck);
  });
});
