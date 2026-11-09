"use strict";

// Passkey (WebAuthn) support for pages in tabs.
//
// Chromium already handles navigator.credentials inside webviews: on Windows it
// hands the whole ceremony to Windows Hello (webauthn.dll), which covers the PC's
// own passkeys, security keys and phones (QR code). What Electron leaves out is the
// account chooser Chrome shows when a "sign in with a passkey" request (no username
// typed first) finds discoverable credentials on an authenticator Chromium talks to
// itself, such as a USB security key on macOS or Linux. Electron asks the app via
// the session's "select-webauthn-account" event, and with no listener the sign-in
// fails with NotAllowedError. This file supplies that chooser.

// Label for one account, as the site stored it when the passkey was made.
function accountLabel(account) {
  const name = account && account.name ? String(account.name) : "";
  const displayName = account && account.displayName ? String(account.displayName) : "";
  if (name && displayName && name !== displayName) return displayName + " (" + name + ")";
  return displayName || name || "Unnamed account";
}

// Picks one account. One account needs no question: the person has already
// touched their key or entered their PIN. Several get a native dialog with one
// button per account and Cancel. Resolves to a credentialId, or null to cancel.
async function chooseAccount(dialog, parentWindow, details) {
  const accounts = (details && Array.isArray(details.accounts)) ? details.accounts : [];
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0].credentialId;

  const buttons = accounts.map(accountLabel).concat("Cancel");
  const site = details.relyingPartyId ? String(details.relyingPartyId) : "this site";
  const options = {
    type: "question",
    title: "Choose a passkey",
    message: "Sign in to " + site + " with which account?",
    buttons: buttons,
    cancelId: accounts.length,
    defaultId: 0,
    noLink: true,
  };
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  const index = result ? result.response : accounts.length;
  return index >= 0 && index < accounts.length ? accounts[index].credentialId : null;
}

// Listens on a session for passkey account choices. getParentWindow returns the
// window the dialog belongs to (or null). The request stays pending until the
// callback runs, so it always runs exactly once, cancelling on any error.
function installPasskeyAccountChooser(session, dialog, getParentWindow) {
  session.on("select-webauthn-account", (_event, details, callback) => {
    let parent;
    try { parent = getParentWindow ? getParentWindow() : null; } catch { parent = null; }
    chooseAccount(dialog, parent, details)
      .catch((err) => {
        console.error("[Passkeys] Account chooser failed:", err);
        return null;
      })
      .then((credentialId) => {
        if (credentialId) callback(credentialId);
        else callback();
      });
  });
}

module.exports = { accountLabel, chooseAccount, installPasskeyAccountChooser };
