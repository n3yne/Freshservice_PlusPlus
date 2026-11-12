"use strict";

const qa = require("../plugins/quick-actions/renderer");
const qaMain = require("../plugins/quick-actions/main");
const fsApi = require("../plugins/freshservice/main");

// Placeholder only — never a real key.
const FAKE_KEY = "test-key-not-real";

const STATUSES = [
  { value: 2, label: "Open" }, { value: 3, label: "Pending" }, { value: 4, label: "Resolved" },
  { value: 5, label: "Closed" }, { value: 7, label: "Awaiting Vendor" },
];

describe("quick-actions renderer helpers", () => {
  test("diffChanges lists only what differs", () => {
    const t = { status: 2, priority: 1, groupId: null, agentId: 5 };
    expect(qa.diffChanges(t, { status: 2, priority: 3, groupId: null, agentId: null })).toEqual({ priority: 3, agentId: null });
    expect(qa.diffChanges(t, Object.assign({}, t))).toEqual({});
    expect(qa.diffChanges(null, t)).toEqual({});
  });

  test("parseChoice", () => {
    expect(qa.parseChoice("")).toBeNull();
    expect(qa.parseChoice("7")).toBe(7);
    expect(qa.parseChoice("x")).toBeNull();
  });

  test("resolved and pending statuses by label, else the standard numbers", () => {
    expect(qa.resolvedStatus([{ value: 9, label: "resolved" }])).toBe(9);
    expect(qa.resolvedStatus(STATUSES)).toBe(4);
    expect(qa.resolvedStatus([{ value: 4, label: "Done" }])).toBe(4);
    expect(qa.resolvedStatus([{ value: 2, label: "Open" }])).toBeNull();
    expect(qa.pendingStatus(STATUSES)).toBe(3);
  });

  test("describeChanges", () => {
    const o = { statuses: STATUSES, priorities: [{ value: 3, label: "High" }], agents: [{ id: 5, name: "Pat Lee" }], groups: [], me: 9 };
    expect(qa.describeChanges({ status: 2 }, { status: 4 }, o)).toBe("Status Open → Resolved");
    expect(qa.describeChanges({ priority: 1 }, { priority: 3, agentId: 5 }, o)).toBe("Priority Priority 1 → High, agent → Pat Lee");
    expect(qa.describeChanges({}, { agentId: 9 }, o)).toBe("Agent → you");
    expect(qa.describeChanges({}, { agentId: null, groupId: null }, o)).toBe("Group → none, agent → unassigned");
  });
});

describe("quick-actions settings", () => {
  test("validates booleans", () => {
    expect(qaMain.validateSettings(qaMain.defaultSettings)).toBe(true);
    expect(qaMain.validateSettings({ quickActionsReloadTab: "yes" })).toBe(false);
    expect(qaMain.validateSettings({ quickActionsConfirmResolve: false })).toBe(true);
  });
});

describe("freshservice quick action helpers", () => {
  test("fieldChoices reads arrays and maps, custom statuses included", () => {
    const out = fsApi.fieldChoices({ ticket_fields: [
      { name: "status", choices: [{ id: 2, value: "Open" }, { id: 7, value: "Awaiting Vendor" }, { id: "x", value: "Bad" }, { id: 8, value: "" }] },
      { name: "priority", choices: { 1: "Low", 4: ["Urgent", "x"] } },
    ] });
    expect(out.status).toEqual([{ value: 2, label: "Open" }, { value: 7, label: "Awaiting Vendor" }]);
    expect(out.priority).toEqual([{ value: 1, label: "Low" }, { value: 4, label: "Urgent" }]);
    expect(fsApi.fieldChoices(null)).toEqual({ status: [], priority: [] });
  });

  test("buildTicketUpdate checks values and maps names", () => {
    expect(fsApi.buildTicketUpdate({ status: 4, agentId: null, groupId: 12 })).toEqual({ body: { status: 4, responder_id: null, group_id: 12 } });
    expect(fsApi.buildTicketUpdate({ priority: 0 }).error).toBeTruthy();
    expect(fsApi.buildTicketUpdate({ agentId: "me" }).error).toBeTruthy();
    expect(fsApi.buildTicketUpdate({}).error).toMatch(/Nothing/);
  });

  test("formatTicketState", () => {
    expect(fsApi.formatTicketState({ id: 5, subject: "S", status: 2, priority: 1, responder_id: 9, group_id: null }))
      .toMatchObject({ id: 5, status: 2, priority: 1, agentId: 9, groupId: null });
    expect(fsApi.formatTicketState({})).toBeNull();
  });
});

describe("freshservice quick action handlers", () => {
  let handlers;
  let realFetch;
  const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });

  beforeEach(() => {
    realFetch = global.fetch;
    const settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com", fsApiKeyEncrypted: "enc:" + FAKE_KEY };
    handlers = {};
    fsApi.init({
      handle: (name, fn) => { handlers[name] = fn; },
      getSettings: () => settings,
      encryptCredential: (v) => "enc:" + v,
      decryptCredential: (v) => v.replace(/^enc:/, ""),
      registerSettingsTransformer: () => {},
      log: () => {},
    });
  });
  afterEach(() => { global.fetch = realFetch; });

  test("get-ticket-options lists choices, agents, groups and me, then caches", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/ticket_form_fields")) return jsonResponse({ ticket_fields: [{ name: "status", choices: [{ id: 2, value: "Open" }, { id: 7, value: "Awaiting Vendor" }] }] });
      if (url.includes("/agents/me")) return jsonResponse({ agent: { id: 9 } });
      if (url.includes("/agents?")) return jsonResponse({ agents: [{ id: 9, first_name: "Zed", email: "z@x.com" }, { id: 5, first_name: "Amy", email: "a@x.com" }] });
      if (url.includes("/groups?")) return jsonResponse({ groups: [{ id: 1, name: "Service Desk" }] });
      return jsonResponse({}, 404);
    });
    const res = await handlers["get-ticket-options"]({});
    expect(res.statuses.map((s) => s.value)).toEqual([2, 7]);
    expect(res.priorities.map((p) => p.label)).toEqual(["Low", "Medium", "High", "Urgent"]);
    expect(res.agents.map((a) => a.name)).toEqual(["Amy", "Zed"]);
    expect(res.groups).toEqual([{ id: 1, name: "Service Desk" }]);
    expect(res.me).toBe(9);
    global.fetch.mockClear();
    await handlers["get-ticket-options"]({});
    expect(global.fetch).not.toHaveBeenCalled();
    await handlers["get-ticket-options"]({ force: true });
    expect(global.fetch).toHaveBeenCalled();
  });

  test("update-ticket PUTs the change, resolving 'me'", async () => {
    global.fetch = jest.fn(async (url, init) => {
      if (url.includes("/agents/me")) return jsonResponse({ agent: { id: 9 } });
      if (url.endsWith("/tickets/42") && init.method === "PUT") {
        const body = JSON.parse(init.body);
        return jsonResponse({ ticket: { id: 42, status: body.status || 2, priority: 1, responder_id: body.responder_id } });
      }
      return jsonResponse({}, 404);
    });
    const res = await handlers["update-ticket"]({ ticketId: "42", host: "acme.freshservice.com", changes: { agentId: "me", status: 3 } });
    expect(res.ok).toBe(true);
    expect(res.ticket).toMatchObject({ id: 42, agentId: 9, status: 3 });
    const put = global.fetch.mock.calls.find((c) => c[1].method === "PUT");
    expect(JSON.parse(put[1].body)).toEqual({ status: 3, responder_id: 9 });
  });

  test("update-ticket refuses another host and reports validation errors", async () => {
    expect((await handlers["update-ticket"]({ ticketId: "42", host: "evil.example.com", changes: { status: 4 } })).skipped).toBe(true);
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, headers: { get: () => null },
      json: async () => ({ errors: [{ field: "category", message: "It should not be blank" }] }) }));
    const res = await handlers["update-ticket"]({ ticketId: "42", changes: { status: 4 } });
    expect(res.error).toMatch(/didn't accept the change/);
    expect(res.error).toMatch(/category: It should not be blank/);
  });

  test("get-ticket-state reads the ticket", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ ticket: { id: 42, subject: "VPN", status: 2, priority: 3, group_id: 1 } }));
    const res = await handlers["get-ticket-state"]({ ticketId: "42" });
    expect(res.ticket).toMatchObject({ id: 42, subject: "VPN", groupId: 1, agentId: null });
    expect((await handlers["get-ticket-state"]({ ticketId: "CHN-4" })).skipped).toBe(true);
  });
});
