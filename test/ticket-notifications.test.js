"use strict";

const tn = require("../plugins/ticket-notifications/renderer");
const tnMain = require("../plugins/ticket-notifications/main");

const AGENT = 9001;
const REQUESTER = 555;
const NOW = Date.parse("2026-11-11T15:00:00Z");
const MIN = 60 * 1000;

const SETTINGS = {
  ticketNotifyAgentId: AGENT,
  ticketNotifyOtherAgents: true,
  fsApiEnabled: true,
  fsApiDomain: "acme.freshservice.com",
  fsApiKeySet: true,
};

function iso(ms) {
  return new Date(ms).toISOString();
}

function ticket(id, updatedMs, extra) {
  return Object.assign({ id, subject: "Ticket " + id, requesterId: REQUESTER, updatedAt: iso(updatedMs) }, extra);
}

function conv(id, createdMs, extra) {
  return Object.assign({ id, userId: REQUESTER, incoming: true, private: false, fromEmail: "pat@example.com", createdAt: iso(createdMs), snippet: "Any update?" }, extra);
}

// invoke stub: tickets for filter-tickets, conversations by ticket ID.
function makeInvoke({ tickets = [], conversations = {}, filterError, convErrors = {} }) {
  const calls = [];
  const invoke = jest.fn(async (pluginId, action, data) => {
    calls.push({ pluginId, action, data });
    if (action === "filter-tickets") return filterError ? { error: filterError } : { tickets, total: tickets.length };
    if (action === "get-conversations") {
      if (convErrors[data.ticketId]) return { error: convErrors[data.ticketId] };
      return { ticketId: String(data.ticketId), conversations: conversations[data.ticketId] || [] };
    }
    throw new Error("unexpected " + action);
  });
  invoke.calls = calls;
  return invoke;
}

describe("ticket-notifications check", () => {
  const lastCheck = NOW - 2 * MIN;
  const state = { agentId: AGENT, lastCheck, seen: [] };

  test("asks for the agent's tickets updated since the day before the look-back", async () => {
    const invoke = makeInvoke({});
    await tn.check({ invoke, settings: SETTINGS, state, now: () => NOW });
    expect(invoke.calls[0].pluginId).toBe("freshservice");
    expect(invoke.calls[0].data.query).toBe("agent_id:9001 AND updated_at:>'2026-11-10'");
  });

  test("notifies a new requester reply and remembers it so it isn't repeated", async () => {
    const invoke = makeInvoke({
      tickets: [ticket(1, NOW - MIN), ticket(2, NOW - 5 * 60 * MIN)],
      conversations: { 1: [conv(10, NOW - 3 * 60 * MIN), conv(11, NOW - MIN)] },
    });
    const res = await tn.check({ invoke, settings: SETTINGS, state, now: () => NOW });
    expect(res.notifications).toHaveLength(1);
    expect(res.notifications[0].ticket.id).toBe(1);
    expect(res.notifications[0].replies.map((c) => c.id)).toEqual([11]);
    // Ticket 2 wasn't updated since the last check, so its conversations aren't read.
    expect(invoke.calls.filter((c) => c.action === "get-conversations").map((c) => c.data.ticketId)).toEqual([1]);
    expect(res.state).toEqual({ agentId: AGENT, lastCheck: NOW, seen: [11] });

    const again = await tn.check({ invoke, settings: SETTINGS, state: res.state, now: () => NOW + 2 * MIN });
    expect(again.notifications).toHaveLength(0);
  });

  test("skips your own replies, and other agents' entries when that option is off", async () => {
    const conversations = {
      1: [
        conv(20, NOW - MIN, { userId: AGENT, incoming: false }),
        conv(21, NOW - MIN, { userId: 777, incoming: false, private: true }),
      ],
    };
    const tickets = [ticket(1, NOW - MIN)];
    const on = await tn.check({ invoke: makeInvoke({ tickets, conversations }), settings: SETTINGS, state, now: () => NOW });
    expect(on.notifications[0].replies.map((c) => c.id)).toEqual([21]);

    const off = await tn.check({
      invoke: makeInvoke({ tickets, conversations }),
      settings: Object.assign({}, SETTINGS, { ticketNotifyOtherAgents: false }),
      state,
      now: () => NOW,
    });
    expect(off.notifications).toHaveLength(0);
    expect(off.state.seen).toEqual([20, 21]);
  });

  test("the first check for an agent only records the time", async () => {
    const invoke = makeInvoke({});
    const res = await tn.check({ invoke, settings: SETTINGS, state: null, now: () => NOW });
    expect(res.baseline).toBe(true);
    expect(res.state).toEqual({ agentId: AGENT, lastCheck: NOW, seen: [] });
    expect(invoke).not.toHaveBeenCalled();

    const otherAgent = await tn.check({ invoke, settings: SETTINGS, state: { agentId: 1, lastCheck: NOW - MIN, seen: [] }, now: () => NOW });
    expect(otherAgent.baseline).toBe(true);
  });

  test("doesn't run until the agent and the Freshservice API are set up", async () => {
    const invoke = makeInvoke({});
    const noAgent = await tn.check({ invoke, settings: Object.assign({}, SETTINGS, { ticketNotifyAgentId: 0 }), state, now: () => NOW });
    expect(noAgent.skipped).toBe(true);
    expect(noAgent.error).toMatch(/Ticket Notifications/);
    const noKey = await tn.check({ invoke, settings: Object.assign({}, SETTINGS, { fsApiKeySet: false }), state, now: () => NOW });
    expect(noKey.error).toMatch(/Settings → Freshservice/);
    expect(invoke).not.toHaveBeenCalled();
  });

  test("keeps the last check time when something fails, so the next check covers it", async () => {
    const filterFail = await tn.check({ invoke: makeInvoke({ filterError: "Freshservice API error 500." }), settings: SETTINGS, state, now: () => NOW });
    expect(filterFail.error).toMatch(/500/);
    expect(filterFail.state).toBe(state);

    const convFail = await tn.check({
      invoke: makeInvoke({
        tickets: [ticket(1, NOW - MIN), ticket(2, NOW - MIN)],
        conversations: { 2: [conv(30, NOW - MIN)] },
        convErrors: { 1: "Freshservice API error 502." },
      }),
      settings: SETTINGS,
      state,
      now: () => NOW,
    });
    expect(convFail.notifications.map((n) => n.ticket.id)).toEqual([2]);
    expect(convFail.state.lastCheck).toBe(lastCheck);
    expect(convFail.state.seen).toEqual([30]);
  });

  test("reads at most 25 tickets a check, oldest first, and carries on from there", async () => {
    const tickets = [];
    for (let i = 1; i <= 30; i++) tickets.push(ticket(i, lastCheck + i * 1000));
    const invoke = makeInvoke({ tickets: tickets.slice().reverse() });
    const res = await tn.check({ invoke, settings: SETTINGS, state, now: () => NOW });
    const read = invoke.calls.filter((c) => c.action === "get-conversations").map((c) => c.data.ticketId);
    expect(read).toHaveLength(25);
    expect(read[0]).toBe(1);
    expect(res.state.lastCheck).toBe(lastCheck + 25 * 1000);
  });

  test("looks back at most three days after a long break", async () => {
    const invoke = makeInvoke({});
    const old = { agentId: AGENT, lastCheck: NOW - 10 * 24 * 60 * MIN, seen: [] };
    await tn.check({ invoke, settings: SETTINGS, state: old, now: () => NOW });
    expect(invoke.calls[0].data.query).toBe("agent_id:9001 AND updated_at:>'2026-11-07'");
  });
});

describe("ticket-notifications describe", () => {
  const t = { id: 42, subject: "Printer offline", requesterId: REQUESTER };

  test("names the kind of entry and quotes it", () => {
    expect(tn.describe(t, [conv(1, NOW)])).toEqual({
      title: "New reply on #42",
      body: "Printer offline\npat@example.com: Any update?",
    });
    expect(tn.describe(t, [conv(1, NOW, { userId: 7, incoming: false, private: true, fromEmail: "" })]).title)
      .toBe("New private note on #42");
    expect(tn.describe(t, [conv(1, NOW, { userId: 7, incoming: false, fromEmail: "" })]).body)
      .toBe("Printer offline\nAnother agent: Any update?");
    expect(tn.describe(t, [conv(1, NOW), conv(2, NOW)]).title).toBe("2 new updates on #42");
  });

  test("summarises many tickets in one popup", () => {
    const list = [1, 2, 3, 4, 5, 6].map((id) => ({ ticket: { id, subject: "S" + id }, replies: [] }));
    const s = tn.describeSummary(list);
    expect(s.title).toBe("6 of your tickets have new replies");
    expect(s.body.split("\n")).toEqual(["#1 S1", "#2 S2", "#3 S3", "#4 S4", "#5 S5", "and 1 more"]);
  });

  test("links to the ticket on the configured domain", () => {
    expect(tn.ticketUrl("acme.freshservice.com", 42)).toBe("https://acme.freshservice.com/a/tickets/42");
  });
});

describe("ticket-notifications main", () => {
  test("validates settings", () => {
    const v = tnMain.validateSettings;
    expect(v(tnMain.defaultSettings)).toBe(true);
    expect(v({})).toBe(true);
    expect(v({ ticketNotifyAgentId: 123 })).toBe(true);
    expect(v({ ticketNotifyAgentId: -1 })).toBe(false);
    expect(v({ ticketNotifyAgentId: "123" })).toBe(false);
    expect(v({ ticketNotifyInterval: 3 })).toBe(false);
    expect(v({ ticketNotifyInterval: 5 })).toBe(true);
    expect(v({ ticketNotifyDesktop: "yes" })).toBe(false);
    expect(v({ ticketNotifyAgentName: "x".repeat(201) })).toBe(false);
  });

  test("cleanState keeps only well-formed state and caps the seen list", () => {
    expect(tnMain.cleanState(null)).toBeNull();
    expect(tnMain.cleanState({ agentId: "1", lastCheck: NOW })).toBeNull();
    const seen = Array.from({ length: 1200 }, (_, i) => i + 1).concat(["x", -3]);
    const clean = tnMain.cleanState({ agentId: 5, lastCheck: NOW, seen, extra: true });
    expect(Object.keys(clean)).toEqual(["agentId", "lastCheck", "seen"]);
    expect(clean.seen).toHaveLength(1000);
    expect(clean.seen[clean.seen.length - 1]).toBe(1200);
  });

  test("saves and reloads state through its handlers", async () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tn-test-"));
    const handlers = {};
    tnMain.init({
      handle: (name, fn) => { handlers[name] = fn; },
      onMessage: (name, fn) => { handlers["msg:" + name] = fn; },
      getDataPath: () => dir,
      log: () => {},
    });
    expect(await handlers["get-state"]()).toBeNull();
    expect((await handlers["save-state"]({ agentId: 0 })).error).toBeTruthy();
    expect(await handlers["save-state"]({ agentId: 5, lastCheck: NOW, seen: [1, 2] })).toEqual({ ok: true });
    expect(await handlers["get-state"]()).toEqual({ agentId: 5, lastCheck: NOW, seen: [1, 2] });
    handlers["msg:status"]({ checkedAt: NOW, ok: true, message: "Checked 2 recently updated tickets.", tickets: 2 });
    expect((await handlers["get-status"]()).tickets).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
