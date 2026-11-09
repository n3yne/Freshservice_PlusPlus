"use strict";

// Turns what the user typed in the address bar into a URL to load, or null when
// it isn't one. Loaded in the window (window.AddressBar) and by the tests.
// Only http and https pages open in a tab, the same rule the main process
// applies to webviews; there is no web search, so plain words are rejected.
(function (root) {
  const ALLOWED = ["http:", "https:"];

  function isLocalHost(host) {
    return /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i.test(host);
  }

  function parseAddress(input) {
    if (typeof input !== "string") return null;
    const text = input.trim();
    if (text === "" || text.length > 2048 || /\s/.test(text)) return null;

    // Anything with an explicit scheme must be http or https. "host:port" (a
    // bare hostname then digits) isn't a scheme, so it falls through below.
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
    if (scheme && !/^[^:/]+:\d+(?:[/?#]|$)/.test(text)) {
      try {
        const url = new URL(text);
        return ALLOWED.includes(url.protocol) && url.hostname ? url.href : null;
      } catch { return null; }
    }

    // No scheme: accept it if it looks like a host, e.g. "example.com/path",
    // "localhost:3000" or an IP address.
    const host = text.split(/[/?#]/)[0].replace(/:\d+$/, "");
    const looksLikeHost = isLocalHost(host) || /^[^.\s]+(\.[^.\s]+)+$/.test(host);
    if (!looksLikeHost) return null;
    try {
      const url = new URL((isLocalHost(host) ? "http://" : "https://") + text);
      return url.hostname ? url.href : null;
    } catch { return null; }
  }

  // What the address bar shows for a page URL: blank pages show nothing.
  function displayAddress(url) {
    if (typeof url !== "string" || url === "" || url === "about:blank") return "";
    return url;
  }

  const api = { parseAddress, displayAddress };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AddressBar = api;
})(typeof window !== "undefined" ? window : globalThis);
