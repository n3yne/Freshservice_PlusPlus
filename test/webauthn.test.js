"use strict";

const { EventEmitter } = require("events");
const { accountLabel, chooseAccount, installPasskeyAccountChooser } = require("../webauthn");

const A = { credentialId: "aaa", name: "sean@example.com", displayName: "Sean" };
const B = { credentialId: "bbb", name: "admin@example.com" };

function fakeDialog(response) {
  return { showMessageBox: jest.fn(async () => ({ response })) };
}

function flush() {
  return new Promise((r) => setImmediate(r));
}

describe("accountLabel", () => {
  test("combines display name and name", () => {
    expect(accountLabel(A)).toBe("Sean (sean@example.com)");
  });
  test("falls back to whichever is set", () => {
    expect(accountLabel(B)).toBe("admin@example.com");
    expect(accountLabel({ credentialId: "x" })).toBe("Unnamed account");
  });
});

describe("chooseAccount", () => {
  test("one account is picked without asking", async () => {
    const dialog = fakeDialog(0);
    await expect(chooseAccount(dialog, null, { accounts: [A] })).resolves.toBe("aaa");
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  test("no accounts cancels", async () => {
    await expect(chooseAccount(fakeDialog(0), null, { accounts: [] })).resolves.toBeNull();
  });

  test("several accounts ask, with Cancel last", async () => {
    const dialog = fakeDialog(1);
    const win = {};
    const id = await chooseAccount(dialog, win, { relyingPartyId: "login.microsoft.com", accounts: [A, B] });
    expect(id).toBe("bbb");
    const [parent, opts] = dialog.showMessageBox.mock.calls[0];
    expect(parent).toBe(win);
    expect(opts.buttons).toEqual(["Sean (sean@example.com)", "admin@example.com", "Cancel"]);
    expect(opts.cancelId).toBe(2);
    expect(opts.message).toContain("login.microsoft.com");
  });

  test("Cancel returns null", async () => {
    await expect(chooseAccount(fakeDialog(2), null, { accounts: [A, B] })).resolves.toBeNull();
  });
});

describe("installPasskeyAccountChooser", () => {
  test("answers the session event with the chosen credential", async () => {
    const session = new EventEmitter();
    installPasskeyAccountChooser(session, fakeDialog(0), () => null);
    const callback = jest.fn();
    session.emit("select-webauthn-account", {}, { accounts: [A, B] }, callback);
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("aaa");
  });

  test("cancels exactly once when the dialog fails", async () => {
    const session = new EventEmitter();
    const dialog = { showMessageBox: jest.fn(async () => { throw new Error("boom"); }) };
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    installPasskeyAccountChooser(session, dialog, () => { throw new Error("no window"); });
    const callback = jest.fn();
    session.emit("select-webauthn-account", {}, { accounts: [A, B] }, callback);
    await flush();
    spy.mockRestore();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
  });
});
