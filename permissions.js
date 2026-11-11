"use strict";

// Permission requests from pages in tabs (microphone, location, notifications...).
//
// Electron grants every permission request when the app sets no handler, so a page
// in a tab could turn on the microphone, read the clipboard or start another
// program without anyone being asked. This file answers those requests instead:
// harmless ones are allowed, the sensitive ones ask the person in a native dialog
// naming the site, and everything else is refused. The app's own windows (the
// side panel and Settings) are trusted and never asked.
//
// Answers are remembered per site until MSP++ is closed, so a site asks once per
// run rather than on every page load, and nothing is written to disk.

// Granted without asking: nothing here exposes data or devices.
const ALWAYS_ALLOWED = new Set([
  "fullscreen",
  "pointerLock",
  "keyboardLock",
  "clipboard-sanitized-write",
  "storage-access",
  "top-level-storage-access",
]);

// Asked once per site and run. Anything in neither list is refused.
const ASK_LABELS = {
  geolocation: "know your location",
  notifications: "show notifications",
  "clipboard-read": "read what you have copied to the clipboard",
};

function parseUrl(url) {
  try {
    return new URL(String(url || ""));
  } catch {
    return null;
  }
}

// True for the app's own pages: loaded from disk, and not inside a tab's webview.
function isAppRequest(webContents, requestingUrl) {
  const parsed = parseUrl(requestingUrl);
  if (!parsed || parsed.protocol !== "file:") return false;
  try {
    return !(webContents && webContents.getType && webContents.getType() === "webview");
  } catch {
    return false; // a destroyed tab is not the app
  }
}

// The site a request comes from, or null when it is not a web page.
function siteOf(requestingUrl) {
  const parsed = parseUrl(requestingUrl);
  if (!parsed) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return { origin: parsed.origin, host: parsed.host };
}

function mediaLabel(types) {
  const audio = types.includes("audio");
  const video = types.includes("video");
  if (audio && video) return "use your microphone and camera";
  if (audio) return "use your microphone";
  if (video) return "use your camera";
  return "use your microphone or camera";
}

// Turns one request into the things to remember (keys) and the wording to show.
// Returns null for a permission that is always refused.
function describeRequest(permission, details) {
  const d = details || {};
  if (permission === "media") {
    const types = (Array.isArray(d.mediaTypes) ? d.mediaTypes : [])
      .filter((t) => t === "audio" || t === "video");
    const keys = types.length ? types.map((t) => "media:" + t) : ["media:audio", "media:video"];
    return { keys, label: mediaLabel(types), detail: "" };
  }
  if (permission === "openExternal") {
    const target = parseUrl(d.externalURL);
    if (!target) return null;
    const scheme = target.protocol.replace(/:$/, "");
    const shown = String(d.externalURL).length > 200
      ? String(d.externalURL).slice(0, 200) + "..."
      : String(d.externalURL);
    return {
      keys: ["openExternal:" + scheme],
      label: 'open a "' + scheme + '" link in another program',
      detail: shown,
    };
  }
  if (Object.prototype.hasOwnProperty.call(ASK_LABELS, permission)) {
    return { keys: [permission], label: ASK_LABELS[permission], detail: "" };
  }
  return null;
}

// Builds the two handlers for a session. dialog is Electron's dialog module and
// getParentWindow returns the window the question belongs to (or null).
function createPermissionPolicy(dialog, getParentWindow) {
  // "<origin> <key>" -> true (allowed) or false (blocked), until the app closes.
  const remembered = new Map();
  // Questions on screen now, so a page asking twice gets one dialog.
  const pending = new Map();

  async function ask(site, described) {
    const options = {
      type: "question",
      title: "Permission request",
      message: site.host + " wants to " + described.label + ".",
      detail: (described.detail ? described.detail + "\n\n" : "") +
        "Your answer applies to this site until you close MSP++.",
      buttons: ["Allow", "Block"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    let parent;
    try { parent = getParentWindow ? getParentWindow() : null; } catch { parent = null; }
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return Boolean(result) && result.response === 0;
  }

  // Resolves to true (grant) or false (refuse) for one request.
  async function decide(webContents, permission, details) {
    const requestingUrl = details && details.requestingUrl;
    if (isAppRequest(webContents, requestingUrl)) return true;
    const site = siteOf(requestingUrl);
    if (!site) return false;
    if (ALWAYS_ALLOWED.has(permission)) return true;

    const described = describeRequest(permission, details);
    if (!described) return false;

    const answers = described.keys.map((key) => remembered.get(site.origin + " " + key));
    if (answers.some((a) => a === false)) return false;
    if (answers.every((a) => a === true)) return true;

    const pendingKey = site.origin + " " + described.keys.join(",");
    let question = pending.get(pendingKey);
    if (!question) {
      question = ask(site, described)
        .catch((err) => {
          console.error("[Permissions] Could not ask about", permission, err);
          return false;
        })
        .then((allowed) => {
          pending.delete(pendingKey);
          for (const key of described.keys) remembered.set(site.origin + " " + key, allowed);
          return allowed;
        });
      pending.set(pendingKey, question);
    }
    return question;
  }

  // Electron's request handler: always answers exactly once.
  function onRequest(webContents, permission, callback, details) {
    decide(webContents, permission, details)
      .catch((err) => {
        console.error("[Permissions] Request failed:", err);
        return false;
      })
      .then((allowed) => {
        if (!allowed) console.warn("[Permissions] Refused", permission, "for", details && details.requestingUrl);
        try { callback(Boolean(allowed)); } catch { /* request already gone */ }
      });
  }

  // Electron's check handler: a yes/no with no chance to ask, so it only reports
  // what is always allowed or was already answered with Allow.
  function onCheck(webContents, permission, requestingOrigin, details) {
    const d = details || {};
    const url = d.requestingUrl || requestingOrigin || d.securityOrigin || "";
    if (isAppRequest(webContents, url)) return true;
    const site = siteOf(url);
    if (!site) return false;
    if (ALWAYS_ALLOWED.has(permission)) return true;
    if (permission === "media") {
      const types = d.mediaType === "audio" || d.mediaType === "video"
        ? [d.mediaType]
        : ["audio", "video"];
      return types.some((t) => remembered.get(site.origin + " media:" + t) === true);
    }
    return remembered.get(site.origin + " " + permission) === true;
  }

  return { decide, onRequest, onCheck };
}

// Puts the policy on one session.
function installPermissionHandlers(session, policy) {
  session.setPermissionRequestHandler(policy.onRequest);
  session.setPermissionCheckHandler(policy.onCheck);
}

module.exports = {
  ALWAYS_ALLOWED,
  isAppRequest,
  siteOf,
  describeRequest,
  createPermissionPolicy,
  installPermissionHandlers,
};
