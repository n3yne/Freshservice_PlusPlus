// Ticket Notifications: checks the Freshservice tickets assigned to you every
// few minutes and shows a desktop notification (and a bell entry) when one
// gets a new reply or note from someone else.
//
// Freshservice has no "something changed" feed for an agent, so each check:
//   1. asks the ticket filter API for your tickets updated since the day
//      before the last check (the filter only compares dates),
//   2. keeps the ones whose updated_at is after the last check,
//   3. reads each one's conversations and picks the entries created after the
//      last check that you didn't write and haven't been seen before.
// The last check time is from this PC's clock and the timestamps are from
// Freshservice, so each check looks back an extra OVERLAP_MS; the list of
// conversation IDs already seen stops that overlap from notifying twice.
/* global module */
(function () {
  "use strict";

  const PLUGIN_ID = "ticket-notifications";
  const OVERLAP_MS = 10 * 60 * 1000;
  // After a long break (a weekend with the app closed) look back at most this far.
  const MAX_CATCH_UP_MS = 3 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_TICKETS_PER_CHECK = 25;
  const MAX_FILTER_PAGES = 5;
  const MAX_SEEN = 1000;
  // More tickets than this in one check get one summary popup instead.
  const MAX_POPUPS = 3;
  const RATE_LIMIT_PAUSE_MS = 5 * 60 * 1000;

  function utcDate(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  // A ticket filter query for the agent's tickets updated on or after the day
  // before sinceMs (in UTC, so a time zone difference can't skip a day).
  function buildQuery(agentId, sinceMs) {
    return "agent_id:" + agentId + " AND updated_at:>'" + utcDate(sinceMs - DAY_MS) + "'";
  }

  function ticketUrl(domain, id) {
    return "https://" + domain + "/a/tickets/" + id;
  }

  function isFromRequester(c, requesterId) {
    return c.incoming === true || (requesterId != null && c.userId === requesterId);
  }

  // The conversations that deserve a notification.
  // opts: { sinceMs, seen: Set, agentId, otherAgents, requesterId }
  function pickNewReplies(conversations, opts) {
    return (conversations || []).filter(function (c) {
      if (!c || opts.seen.has(c.id)) return false;
      if (!(Date.parse(c.createdAt) > opts.sinceMs)) return false;
      if (c.userId != null && c.userId === opts.agentId) return false;
      if (isFromRequester(c, opts.requesterId)) return true;
      return opts.otherAgents;
    });
  }

  function kindOf(c, requesterId) {
    if (isFromRequester(c, requesterId)) return "reply";
    return c.private ? "note" : "agent-reply";
  }

  // Title and body for one ticket's new entries.
  function describe(ticket, replies) {
    const latest = replies[replies.length - 1];
    const kind = kindOf(latest, ticket.requesterId);
    let title;
    if (replies.length > 1) {
      title = replies.length + " new updates on #" + ticket.id;
    } else if (kind === "reply") {
      title = "New reply on #" + ticket.id;
    } else if (kind === "note") {
      title = "New private note on #" + ticket.id;
    } else {
      title = "Another agent replied on #" + ticket.id;
    }
    const who = latest.fromEmail || (kind === "reply" ? "Requester" : "Another agent");
    const lines = [];
    if (ticket.subject) lines.push(ticket.subject);
    lines.push(latest.snippet ? who + ": " + latest.snippet : "From " + who);
    return { title, body: lines.join("\n") };
  }

  function describeSummary(notifications) {
    const lines = notifications.slice(0, 5).map(function (n) {
      return "#" + n.ticket.id + (n.ticket.subject ? " " + n.ticket.subject : "");
    });
    if (notifications.length > 5) lines.push("and " + (notifications.length - 5) + " more");
    return { title: notifications.length + " of your tickets have new replies", body: lines.join("\n") };
  }

  // Why a check can't run with these settings, or "" when it can.
  function setupProblem(settings) {
    if (!settings.ticketNotifyAgentId) return "Choose your Freshservice agent in Settings → Ticket Notifications.";
    if (settings.fsApiEnabled === false) return "The Freshservice API is turned off in Settings → Freshservice.";
    if (!settings.fsApiDomain || !settings.fsApiKeySet) return "Set up the Freshservice API in Settings → Freshservice.";
    return "";
  }

  // One check. deps: { invoke(pluginId, action, data), settings, state, now }.
  // Resolves { state, notifications: [{ ticket, replies }], tickets, error?, skipped?, baseline? }.
  // state is what to remember for the next check (unchanged on an error, so the
  // next check covers the same time again).
  async function check(deps) {
    const settings = deps.settings || {};
    const problem = setupProblem(settings);
    if (problem) return { state: deps.state, notifications: [], skipped: true, error: problem };

    const agentId = settings.ticketNotifyAgentId;
    const now = deps.now();
    const state = deps.state;
    if (!state || state.agentId !== agentId || !state.lastCheck) {
      // First check for this agent: start from now rather than notifying about
      // everything that ever happened.
      return { state: { agentId, lastCheck: now, seen: [] }, notifications: [], baseline: true, tickets: null };
    }

    const sinceMs = Math.max(Math.min(state.lastCheck, now) - OVERLAP_MS, now - MAX_CATCH_UP_MS);
    const list = await deps.invoke("freshservice", "filter-tickets", {
      query: buildQuery(agentId, sinceMs),
      maxPages: MAX_FILTER_PAGES,
    });
    if (!list || list.error || !Array.isArray(list.tickets)) {
      return { state, notifications: [], error: (list && list.error) || "No answer from Freshservice.", skipped: !!(list && list.skipped) };
    }

    // Oldest first, so a check that stops early can carry on from there next time.
    const updated = list.tickets
      .filter(function (t) { return Date.parse(t.updatedAt) > sinceMs; })
      .sort(function (a, b) { return Date.parse(a.updatedAt) - Date.parse(b.updatedAt); });
    const batch = updated.slice(0, MAX_TICKETS_PER_CHECK);

    const seen = new Set(state.seen || []);
    const notifications = [];
    let failed = null;
    for (const ticket of batch) {
      const res = await deps.invoke("freshservice", "get-conversations", { ticketId: ticket.id });
      if (!res || res.error || !Array.isArray(res.conversations)) {
        failed = (res && res.error) || "No answer from Freshservice.";
        if (/\(429\)/.test(failed)) break;
        continue;
      }
      const replies = pickNewReplies(res.conversations, {
        sinceMs,
        seen,
        agentId,
        otherAgents: settings.ticketNotifyOtherAgents !== false,
        requesterId: ticket.requesterId,
      });
      for (const c of res.conversations) {
        if (c && Date.parse(c.createdAt) > sinceMs) seen.add(c.id);
      }
      if (replies.length) notifications.push({ ticket, replies });
    }

    let lastCheck = now;
    if (failed) {
      lastCheck = state.lastCheck; // look at the same time again; seen stops repeats
    } else if (updated.length > batch.length) {
      // Too many to read at once: carry on after the last ticket read.
      lastCheck = Math.min(now, Date.parse(batch[batch.length - 1].updatedAt));
    }
    return {
      state: { agentId, lastCheck, seen: Array.from(seen).slice(-MAX_SEEN) },
      notifications,
      tickets: updated.length,
      error: failed || undefined,
    };
  }

  const exported = { check, pickNewReplies, describe, describeSummary, buildQuery, ticketUrl, setupProblem, OVERLAP_MS };
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }
  if (typeof window === "undefined" || !window.pluginAPI) return;

  // ===================== In the app =====================

  const pluginAPI = window.pluginAPI;
  let state;
  let stateLoaded = false;
  let running = false;
  let timer = null;
  let pauseUntil = 0;
  let lastNotifiedAt = null;

  function settings() {
    return pluginAPI.getSettings();
  }

  function intervalMs() {
    const minutes = settings().ticketNotifyInterval;
    return (typeof minutes === "number" && minutes > 0 ? minutes : 2) * 60 * 1000;
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  // The ticket ID shown in the active tab, when it is on the configured domain.
  function activeTicketId() {
    const tab = pluginAPI.browser.getActiveTab();
    if (!tab || !tab.webview) return null;
    let url;
    try { url = new URL(tab.webview.getURL()); } catch { return null; }
    if (url.hostname !== settings().fsApiDomain) return null;
    const m = url.pathname.match(/\/(?:a|helpdesk)\/tickets\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function openTicket(id) {
    if (activeTicketId() === id) return;
    const domain = settings().fsApiDomain;
    if (domain) pluginAPI.browser.newTab(ticketUrl(domain, id));
  }

  function focusWindow() {
    pluginAPI.invoke(PLUGIN_ID, "focus-window", {}).catch(function () {});
  }

  function popup(text, tag, onClick) {
    if (typeof Notification !== "function") return;
    try {
      const n = new Notification(text.title, { body: text.body, tag, silent: settings().ticketNotifySound === false });
      n.onclick = function () {
        focusWindow();
        if (onClick) onClick();
        n.close();
      };
    } catch (err) {
      console.warn("[ticket-notifications] Could not show a desktop notification:", err);
    }
  }

  function show(notifications) {
    const s = settings();
    const looking = document.hasFocus() ? activeTicketId() : null;
    const popups = [];
    for (const n of notifications) {
      const id = n.ticket.id;
      const text = describe(n.ticket, n.replies);
      pluginAPI.ui.notify({
        type: "ticket-reply-" + id,
        title: text.title,
        desc: text.body,
        action: { label: "Open ticket", onClick: function () { openTicket(id); } },
      });
      // No popup for the ticket you're looking at right now.
      if (looking !== id) popups.push({ id, text });
    }
    if (s.ticketNotifyDesktop === false || !popups.length) return;
    if (popups.length > MAX_POPUPS) {
      popup(describeSummary(notifications), "ticket-replies-summary", null);
      return;
    }
    for (const p of popups) {
      popup(p.text, "ticket-reply-" + p.id, function () { openTicket(p.id); });
    }
  }

  function report(result, checkedAt) {
    let message;
    if (result.error) message = result.error;
    else if (result.baseline) message = "Started watching. New replies from now on will be notified.";
    else message = "Checked " + result.tickets + " recently updated ticket" + (result.tickets === 1 ? "" : "s") + ".";
    pluginAPI.send(PLUGIN_ID, "status", {
      checkedAt,
      ok: !result.error,
      message,
      tickets: typeof result.tickets === "number" ? result.tickets : null,
      lastNotifiedAt,
    });
  }

  function sameState(a, b) {
    return JSON.stringify(a || null) === JSON.stringify(b || null);
  }

  async function run() {
    if (running) return;
    running = true;
    let next = intervalMs();
    try {
      if (Date.now() < pauseUntil) {
        next = pauseUntil - Date.now();
        return;
      }
      if (!stateLoaded) {
        state = await pluginAPI.invoke(PLUGIN_ID, "get-state", {});
        stateLoaded = true;
      }
      const result = await check({ invoke: pluginAPI.invoke, settings: settings(), state, now: Date.now });
      if (result.state && !sameState(result.state, state)) {
        state = result.state;
        await pluginAPI.invoke(PLUGIN_ID, "save-state", state);
      }
      if (result.notifications.length) {
        lastNotifiedAt = Date.now();
        show(result.notifications);
      }
      if (result.error && /\(429\)/.test(result.error)) {
        pauseUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
        next = RATE_LIMIT_PAUSE_MS;
      }
      report(result, Date.now());
    } catch (err) {
      console.error("[ticket-notifications] Check failed:", err);
      report({ error: "Check failed: " + (err && err.message ? err.message : String(err)) }, Date.now());
    } finally {
      running = false;
      schedule(next);
    }
  }

  // Re-check soon after the relevant settings change (a new agent, the API set up).
  const WATCHED = ["ticketNotifyAgentId", "ticketNotifyInterval", "ticketNotifyOtherAgents", "fsApiEnabled", "fsApiDomain", "fsApiKeySet"];
  let lastWatched = JSON.stringify(WATCHED.map(function (k) { return settings()[k]; }));
  pluginAPI.events.on("settings:changed", function (s) {
    const now = JSON.stringify(WATCHED.map(function (k) { return s ? s[k] : undefined; }));
    if (now === lastWatched) return;
    lastWatched = now;
    schedule(3000);
  });

  // First check shortly after start-up, once the window has settled.
  schedule(15000);
}());
