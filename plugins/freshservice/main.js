"use strict";

// Main-process half of the Freshservice site plugin: reads ticket details and
// Solutions articles through the Freshservice REST API v2 (the page-side half,
// the site adapter, is renderer.js). The API key is
// encrypted at rest, only ever decrypted in the main process, and only sent to
// the configured Freshservice domain over https. Callers fall back to scraping
// the page whenever this returns an error or is skipped.

const REQUEST_TIMEOUT_MS = 15000;
const CONVERSATIONS_PER_PAGE = 100;
const MAX_CONVERSATION_PAGES = 5;
const MAX_TEXT_CHARS = 15000;
const MAX_SEARCH_TERM_CHARS = 200;
const MAX_SEARCH_RESULTS = 10;
const MAX_ARTICLE_CHARS = 6000;
const MAX_SNIPPET_CHARS = 500;
// Freshservice caps a filter query at 512 characters.
const MAX_FILTER_QUERY_CHARS = 512;
const DATE_VAR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
    if (s.fsApiKeyHost !== undefined && (typeof s.fsApiKeyHost !== "string" || s.fsApiKeyHost.length > 300)) return false;
    return true;
  },

  init: function (api) {

    // Encrypt a newly entered key before it reaches disk; never write it in plain text.
    //
    // The key is also tied to the domain it was entered for (fsApiKeyHost), so
    // changing the domain later can never send the saved key to a different
    // server: the key has to be entered again. The tie comes from what is already
    // saved, never from what the caller sent.
    api.registerSettingsTransformer(function (settings) {
      const current = api.getSettings();
      const newKey = Boolean(settings.fsApiKey);
      if (newKey) {
        const encrypted = api.encryptCredential(settings.fsApiKey);
        if (encrypted) settings.fsApiKeyEncrypted = encrypted;
      }
      delete settings.fsApiKey;
      if (settings.fsApiDomain) settings.fsApiDomain = normalizeDomain(settings.fsApiDomain) || "";

      if (newKey) {
        settings.fsApiKeyHost = settings.fsApiDomain || "";
      } else if (settings.fsApiKeyEncrypted) {
        // A key saved before a domain was set is tied to the first domain entered.
        settings.fsApiKeyHost = keyHost(current) || settings.fsApiDomain || "";
      } else {
        delete settings.fsApiKeyHost;
      }
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
      if (!domain) return { skipped: true, error: "Enter your Freshservice domain in Settings → Freshservice." };
      const key = getApiKey(s);
      if (!key) return { skipped: true, error: "Enter your Freshservice API key in Settings → Freshservice." };
      const boundTo = keyHost(s);
      if (boundTo && boundTo !== domain) {
        return {
          skipped: true,
          error: "The saved API key was entered for " + boundTo + ". Enter the API key again in Settings → Freshservice to use it with " + domain + ".",
        };
      }
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
      if (!resp.ok) throw new Error(describeHttpError(resp, conn.what));
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

    // Searches the Solutions (knowledge base) articles the API key can see.
    // Returns short entries; use get-solution-article for an article's full text.
    api.handle("search-solutions", async function (data) {
      const term = String((data && data.term) || "").replace(/\s+/g, " ").trim().substring(0, MAX_SEARCH_TERM_CHARS);
      if (!term) return { articles: [] };
      const conn = connection();
      if (conn.error) return conn;
      try {
        const json = await apiGet(Object.assign({ what: "Solution article" }, conn),
          "/solutions/articles/search?search_term=" + encodeURIComponent(term));
        const list = Array.isArray(json.articles) ? json.articles : [];
        return {
          articles: list.slice(0, MAX_SEARCH_RESULTS)
            .map((a) => formatArticle(a, conn.domain, MAX_SNIPPET_CHARS))
            .filter(Boolean),
        };
      } catch (err) {
        api.log("search-solutions failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    api.handle("get-solution-article", async function (data) {
      const id = String((data && data.id) || "");
      if (!/^\d{1,20}$/.test(id)) return { error: "Invalid solution article ID." };
      const conn = connection();
      if (conn.error) return conn;
      try {
        const json = await apiGet(Object.assign({ what: "Solution article" }, conn), "/solutions/articles/" + id);
        const article = formatArticle(json.article || json, conn.domain, MAX_ARTICLE_CHARS);
        if (!article) return { error: "Freshservice returned no article." };
        return { article };
      } catch (err) {
        api.log("get-solution-article failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // Counts the tickets matching a Freshservice filter query, such as
    // "agent_id:123 AND status:2" or "status:4 AND updated_at:>'{weekStart}'".
    // {name} placeholders are filled from data.vars (dates only). Used by the
    // Metrics Bar, which falls back to its dashboard scrape on any error.
    api.handle("count-tickets", async function (data) {
      const built = buildFilterQuery(data && data.query, data && data.vars);
      if (built.error) return built;
      const conn = connection();
      if (conn.error) return conn;
      try {
        const json = await apiGet(Object.assign({ what: "Ticket filter" }, conn),
          "/tickets/filter?query=" + encodeURIComponent("\"" + built.query + "\"") + "&page=1");
        if (typeof json.total !== "number") return { error: "Freshservice returned no ticket count." };
        return { count: json.total, query: built.query };
      } catch (err) {
        api.log("count-tickets failed:", err.message);
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
  keyHost,
  buildFilterQuery,
  formatTicketText,
  formatArticle,
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

// The domain a saved API key belongs to, or "" when there is no key or no domain
// yet. Keys saved before the tie was recorded belong to the domain saved with them.
function keyHost(settings) {
  if (!settings || !(settings.fsApiKeyEncrypted || settings.fsApiKey)) return "";
  if (typeof settings.fsApiKeyHost === "string" && settings.fsApiKeyHost) return settings.fsApiKeyHost;
  return normalizeDomain(settings.fsApiDomain || "") || "";
}

// Checks a ticket filter query and fills in its {name} placeholders from vars.
// Returns { query } or { error }. Double quotes aren't allowed because the
// whole query is sent wrapped in them.
function buildFilterQuery(raw, vars) {
  const template = String(raw || "").replace(/\s+/g, " ").trim();
  if (!template) return { error: "Enter a ticket filter query." };
  if (template.includes("\"")) return { error: "Use single quotes in the query, not double quotes." };
  const values = vars && typeof vars === "object" ? vars : {};
  let unknown = null;
  const query = template.replace(/\{([a-zA-Z]+)\}/g, function (whole, name) {
    const v = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    if (typeof v === "string" && DATE_VAR_PATTERN.test(v)) return v;
    unknown = unknown || whole;
    return whole;
  });
  if (unknown) return { error: `Unknown placeholder ${unknown}. Use {today}, {weekStart} or {monthStart}.` };
  if (query.length > MAX_FILTER_QUERY_CHARS) return { error: `The query is longer than ${MAX_FILTER_QUERY_CHARS} characters.` };
  return { query };
}

function describeHttpError(resp, what) {
  const noun = what || "Ticket";
  switch (resp.status) {
    case 400: return what === "Ticket filter"
      ? "Freshservice didn't accept the filter query (400). Check the field names and quotes."
      : "Freshservice rejected the request (400).";
    case 401: return "Freshservice rejected the API key (401). Check it in Settings → Freshservice.";
    case 403: return `This API key isn't allowed to view that ${noun.toLowerCase()} (403).`;
    case 404: return `${noun} not found in Freshservice (404).`;
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

// Reduces a Solutions article from the API to what the chat needs: plain text
// capped at maxChars and a link built only from the configured domain and the ID.
function formatArticle(a, domain, maxChars) {
  if (!a || typeof a !== "object") return null;
  const id = String(a.id || "");
  if (!/^\d{1,20}$/.test(id)) return null;
  const text = bodyText(a, "description_text", "description");
  return {
    id,
    title: typeof a.title === "string" && a.title.trim() ? a.title.trim().substring(0, 300) : "Article " + id,
    status: a.status === 1 ? "draft" : "published",
    updatedAt: typeof a.updated_at === "string" ? a.updated_at : "",
    url: domain ? `https://${domain}/support/solutions/articles/${id}` : "",
    text: text.substring(0, maxChars || MAX_ARTICLE_CHARS),
    truncated: text.length > (maxChars || MAX_ARTICLE_CHARS),
  };
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
