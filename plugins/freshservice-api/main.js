"use strict";

// Reads ticket details through the Freshservice REST API v2. The API key is
// encrypted at rest, only ever decrypted in the main process, and only sent to
// the configured Freshservice domain over https. Callers fall back to scraping
// the page whenever this returns an error or is skipped.

const REQUEST_TIMEOUT_MS = 15000;
const CONVERSATIONS_PER_PAGE = 100;
const MAX_CONVERSATION_PAGES = 5;
const MAX_TEXT_CHARS = 15000;

const STATUS_LABELS = { 2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed" };
const PRIORITY_LABELS = { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };

// A bare hostname such as acme.freshservice.com (or a custom helpdesk domain).
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

module.exports = {

  defaultSettings: {
    fsApiEnabled: true,
    fsApiDomain: "",
  },

  validateSettings: function (s) {
    if (s.fsApiEnabled !== undefined && typeof s.fsApiEnabled !== "boolean") return false;
    if (s.fsApiDomain !== undefined) {
      if (typeof s.fsApiDomain !== "string" || s.fsApiDomain.length > 300) return false;
      if (s.fsApiDomain && normalizeDomain(s.fsApiDomain) === null) return false;
    }
    if (s.fsApiKey !== undefined && (typeof s.fsApiKey !== "string" || s.fsApiKey.length > 200)) return false;
    if (s.fsApiKeyEncrypted !== undefined && (typeof s.fsApiKeyEncrypted !== "string" || s.fsApiKeyEncrypted.length > 2000)) return false;
    return true;
  },

  init: function (api) {

    // Encrypt a newly entered key before it reaches disk; never write it in plain text.
    api.registerSettingsTransformer(function (settings) {
      if (settings.fsApiKey) {
        const encrypted = api.encryptCredential(settings.fsApiKey);
        if (encrypted) settings.fsApiKeyEncrypted = encrypted;
      }
      delete settings.fsApiKey;
      if (settings.fsApiDomain) settings.fsApiDomain = normalizeDomain(settings.fsApiDomain) || "";
      return settings;
    });

    function getApiKey(settings) {
      if (settings.fsApiKey) return settings.fsApiKey;
      if (settings.fsApiKeyEncrypted) return api.decryptCredential(settings.fsApiKeyEncrypted) || "";
      return "";
    }

    // Returns { domain, key } when the API is enabled and fully set up, else { error }.
    function connection() {
      const s = api.getSettings();
      if (s.fsApiEnabled === false) return { skipped: true, error: "The Freshservice API is turned off." };
      const domain = normalizeDomain(s.fsApiDomain || "");
      if (!domain) return { skipped: true, error: "Enter your Freshservice domain in Settings → Freshservice API." };
      const key = getApiKey(s);
      if (!key) return { skipped: true, error: "Enter your Freshservice API key in Settings → Freshservice API." };
      return { domain, key };
    }

    async function apiGet(conn, pathAndQuery) {
      let resp;
      try {
        resp = await fetch("https://" + conn.domain + "/api/v2" + pathAndQuery, {
          headers: {
            // Freshservice uses Basic auth with the API key as the user name and any password.
            "Authorization": "Basic " + Buffer.from(conn.key + ":X").toString("base64"),
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw new Error(`Freshservice did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds`, { cause: err });
        }
        throw new Error("Could not reach Freshservice: " + (err && err.message ? err.message : String(err)), { cause: err });
      }
      if (!resp.ok) throw new Error(describeHttpError(resp));
      return resp.json();
    }

    async function fetchConversations(conn, ticketId) {
      const all = [];
      for (let page = 1; page <= MAX_CONVERSATION_PAGES; page++) {
        const json = await apiGet(conn, `/tickets/${ticketId}/conversations?per_page=${CONVERSATIONS_PER_PAGE}&page=${page}`);
        const batch = Array.isArray(json.conversations) ? json.conversations : [];
        all.push(...batch);
        if (batch.length < CONVERSATIONS_PER_PAGE) break;
      }
      return all;
    }

    api.handle("get-ticket", async function (data) {
      const ticketId = String((data && data.ticketId) || "");
      if (!/^\d{1,12}$/.test(ticketId)) return { skipped: true, error: "Only tickets can be read through the API." };
      const conn = connection();
      if (conn.error) return conn;
      // The page and the API must be the same Freshservice account, or ticket
      // numbers would point at different tickets.
      const host = typeof data.host === "string" ? data.host.toLowerCase() : "";
      if (host && host !== conn.domain) {
        return { skipped: true, error: `The open page (${host}) isn't the configured Freshservice domain.` };
      }
      try {
        const [ticketJson, conversations] = await Promise.all([
          apiGet(conn, `/tickets/${ticketId}?include=requester`),
          fetchConversations(conn, ticketId),
        ]);
        const ticket = ticketJson.ticket || {};
        return { ticketId, text: formatTicketText(ticket, conversations) };
      } catch (err) {
        api.log("get-ticket failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    api.handle("test-connection", async function () {
      const conn = connection();
      if (conn.error) return { error: conn.error };
      try {
        await apiGet(conn, "/tickets?per_page=1");
        return { ok: true, domain: conn.domain };
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });
  },

  // Exported for tests.
  normalizeDomain,
  formatTicketText,
};

// Accepts "acme.freshservice.com", "https://acme.freshservice.com/a/tickets/1", etc.
// and returns the lowercase hostname, or null if it isn't a plain https host.
function normalizeDomain(raw) {
  let value = String(raw || "").trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  return HOSTNAME_PATTERN.test(host) ? host : null;
}

function describeHttpError(resp) {
  switch (resp.status) {
    case 401: return "Freshservice rejected the API key (401). Check it in Settings → Freshservice API.";
    case 403: return "This API key isn't allowed to view that ticket (403).";
    case 404: return "Ticket not found in Freshservice (404).";
    case 429: {
      const retry = resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("retry-after") : null;
      return "Freshservice API rate limit reached (429)" + (retry ? `, retry in ${retry} seconds.` : ".");
    }
    default: return `Freshservice API error ${resp.status}.`;
  }
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyText(item, textField, htmlField) {
  const text = typeof item[textField] === "string" ? item[textField].trim() : "";
  return text || htmlToText(item[htmlField]);
}

function conversationLabel(c) {
  if (c.incoming) return "Message from requester";
  if (c.private) return "Private note";
  return "Reply / public note";
}

// Builds the plain-text view of a ticket that the AI features read: a header,
// the description, then each conversation in order, separated like the page scrape.
function formatTicketText(ticket, conversations) {
  const header = [];
  header.push(`Ticket #${ticket.id || ""}${ticket.subject ? ": " + ticket.subject : ""}`);
  const meta = [];
  if (STATUS_LABELS[ticket.status]) meta.push("Status: " + STATUS_LABELS[ticket.status]);
  if (PRIORITY_LABELS[ticket.priority]) meta.push("Priority: " + PRIORITY_LABELS[ticket.priority]);
  const r = ticket.requester;
  if (r && (r.name || r.first_name || r.email)) {
    const name = r.name || [r.first_name, r.last_name].filter(Boolean).join(" ");
    meta.push("Requester: " + [name, r.email ? `<${r.email}>` : ""].filter(Boolean).join(" "));
  }
  if (ticket.created_at) meta.push("Created: " + ticket.created_at);
  if (meta.length) header.push(meta.join(" | "));

  const parts = [header.join("\n")];
  const description = bodyText(ticket, "description_text", "description");
  if (description) parts.push("Description:\n" + description);

  const sorted = (Array.isArray(conversations) ? conversations : [])
    .slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  for (const c of sorted) {
    const text = bodyText(c, "body_text", "body");
    if (!text) continue;
    parts.push(`[${conversationLabel(c)}${c.created_at ? ", " + c.created_at : ""}]\n${text}`);
  }
  return parts.join("\n\n---\n\n").substring(0, MAX_TEXT_CHARS);
}
