"use strict";

// Turns what the user typed in the address bar into a URL to load, or null when
// it isn't one. Loaded in the window (window.AddressBar) and by the tests.
// Only http and https pages open in a tab, the same rule the main process
// applies to webviews; there is no web search, so plain words are rejected.
// A ticket number ("12345", "CW-12345") is handed to the site plugins, which
// turn it into a link to that ticket (ticketAddress).
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

  // Ticket quick-open: what the user typed (e.g. "12345" or "CW-12345") as a
  // link to that ticket, asking each site plugin's ticketUrl(query, ctx). The
  // active tab's site is asked first, so a bare number opens a ticket on the
  // site you're looking at. Returns { url, site } or null when no site knows
  // the query. sites: registered adapters; ctx: { activeSite, tabUrls, homeUrl }.
  const MAX_TICKET_QUERY = 64;
  function ticketAddress(input, sites, ctx) {
    if (typeof input !== "string") return null;
    const text = input.trim();
    if (text === "" || text.length > MAX_TICKET_QUERY || /\s/.test(text)) return null;
    const c = ctx || {};
    const list = (Array.isArray(sites) ? sites : []).filter(function (s) {
      return s && typeof s.ticketUrl === "function";
    });
    const active = list.indexOf(c.activeSite);
    if (active > 0) list.unshift(list.splice(active, 1)[0]);
    const tabUrls = Array.isArray(c.tabUrls) ? c.tabUrls.filter(function (u) { return typeof u === "string"; }) : [];
    for (const site of list) {
      let out;
      try {
        out = site.ticketUrl(text, {
          active: site === c.activeSite,
          tabUrls: tabUrls.slice(),
          homeUrl: typeof c.homeUrl === "string" ? c.homeUrl : "",
        });
      } catch (err) {
        console.error("[Address] " + site.id + " ticketUrl:", err);
        continue;
      }
      if (typeof out !== "string") continue;
      try {
        const url = new URL(out);
        if (ALLOWED.includes(url.protocol) && url.hostname) return { url: url.href, site: site };
      } catch { /* not a URL; ask the next site */ }
    }
    return null;
  }

  const api = { parseAddress, displayAddress, ticketAddress };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AddressBar = api;
})(typeof window !== "undefined" ? window : globalThis);
