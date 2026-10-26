"use strict";

// Microsoft 365 Copilot provider: Entra ID sign-in (authorization code + PKCE,
// public client) and the Microsoft 365 Copilot Chat API on Microsoft Graph.
//
// Requirements (see README → AI Assistant Setup):
//   - Each user needs a Microsoft 365 Copilot add-on license.
//   - An Entra app registration (public client) with the "Mobile and desktop
//     applications" redirect URI below, and admin consent for COPILOT_SCOPES.
//
// The refresh token is encrypted with the OS keychain (safeStorage) and kept in
// the plugin's data folder, never in settings.json. If encryption is
// unavailable it is held in memory only, so the user signs in each launch.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { fetchWithTimeout } = require("./http");

const REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const GRAPH = "https://graph.microsoft.com";
const AUTH_PARTITION = "persist:fspp-m365-auth";
const TOKEN_TIMEOUT_MS = 30000;
// Copilot grounds each answer in the user's Microsoft 365 data and can be slow.
const CHAT_TIMEOUT_MS = 120000;

// The Chat API requires all seven Graph read permissions, even for prompts that
// don't touch that data. openid/profile give us the account name; offline_access
// gives us a refresh token.
const COPILOT_SCOPES = [
  "https://graph.microsoft.com/Sites.Read.All",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/People.Read.All",
  "https://graph.microsoft.com/OnlineMeetingTranscript.Read.All",
  "https://graph.microsoft.com/Chat.Read",
  "https://graph.microsoft.com/ChannelMessage.Read.All",
  "https://graph.microsoft.com/ExternalItem.Read.All",
  "openid",
  "profile",
  "offline_access",
].join(" ");

const TENANT_PATTERN = /^[a-zA-Z0-9.-]{1,100}$/;
const CLIENT_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Reads the signed-in account name from the ID token. The token comes straight
// from the Entra token endpoint over TLS, so it is decoded, not verified.
function accountFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf-8"));
    return payload.preferred_username || payload.upn || payload.name || "";
  } catch {
    return "";
  }
}

// Copilot answers carry entity tags (<Person>Jane</Person>) and citation markers
// ([^1^]) meant for its own UI; strip them so the text drops cleanly into a note.
function cleanCopilotText(text) {
  return (text || "")
    .replace(/\[\^\d+\^\]/g, "")
    .replace(/<\/?[A-Z][A-Za-z]*>/g, "")
    .trim();
}

function createM365Client(api) {
  let tokenFile = null;
  let memory = null; // { tenant, clientId, refreshToken, account, accessToken, expiresAt }

  function getTokenFile() {
    if (!tokenFile) tokenFile = path.join(api.getDataPath(), "m365-token.dat");
    return tokenFile;
  }

  function loadStored() {
    if (memory) return memory;
    try {
      const encrypted = fs.readFileSync(getTokenFile(), "utf-8");
      const json = api.decryptCredential(encrypted);
      if (json) memory = JSON.parse(json);
    } catch { /* no stored sign-in */ }
    return memory;
  }

  function persist() {
    const { tenant, clientId, refreshToken, account } = memory;
    const encrypted = api.encryptCredential(JSON.stringify({ tenant, clientId, refreshToken, account }));
    if (!encrypted) {
      api.log("safeStorage unavailable — Microsoft 365 sign-in kept in memory only");
      return;
    }
    try {
      fs.writeFileSync(getTokenFile(), encrypted, "utf-8");
    } catch (err) {
      api.log("Could not save Microsoft 365 sign-in:", err.message);
    }
  }

  function clearStored() {
    memory = null;
    try { fs.unlinkSync(getTokenFile()); } catch { /* already gone */ }
  }

  function validateConfig(tenant, clientId) {
    if (!tenant || !TENANT_PATTERN.test(tenant)) {
      throw new Error("Enter your Directory (tenant) ID or domain in Settings → AI Features.");
    }
    if (!clientId || !CLIENT_ID_PATTERN.test(clientId)) {
      throw new Error("Enter the Application (client) ID of your Entra app registration in Settings → AI Features.");
    }
  }

  async function requestToken(tenant, params) {
    const resp = await fetchWithTimeout(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    }, TOKEN_TIMEOUT_MS, "Microsoft sign-in");
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.access_token) {
      const detail = json.error_description || json.error || `HTTP ${resp.status}`;
      throw new Error("Microsoft sign-in failed: " + String(detail).split("\r\n")[0].substring(0, 200));
    }
    return json;
  }

  function storeTokens(tenant, clientId, json) {
    memory = {
      tenant,
      clientId,
      refreshToken: json.refresh_token || (memory && memory.refreshToken) || "",
      account: accountFromIdToken(json.id_token || "") || (memory && memory.account) || "",
      accessToken: json.access_token,
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    };
    persist();
  }

  // Opens a Microsoft sign-in window and resolves with the authorization code.
  function promptForCode(tenant, clientId, challenge, state) {
    const electron = require("electron");
    const authUrl =
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        response_mode: "query",
        redirect_uri: REDIRECT_URI,
        scope: COPILOT_SCOPES,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        prompt: "select_account",
      }).toString();

    return new Promise((resolve, reject) => {
      const parent = electron.BrowserWindow.getFocusedWindow() || undefined;
      const win = new electron.BrowserWindow({
        width: 520,
        height: 700,
        parent,
        title: "Sign in to Microsoft 365",
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          partition: AUTH_PARTITION,
        },
      });
      let settled = false;

      function finish(err, code) {
        if (settled) return;
        settled = true;
        if (!win.isDestroyed()) win.close();
        if (err) reject(err); else resolve(code);
      }

      function onUrl(event, url) {
        if (!url.startsWith(REDIRECT_URI)) return;
        if (event && event.preventDefault) event.preventDefault();
        const params = new URL(url).searchParams;
        if (params.get("state") !== state) return finish(new Error("Microsoft sign-in failed: state mismatch"));
        if (params.get("error")) {
          const detail = params.get("error_description") || params.get("error");
          return finish(new Error("Microsoft sign-in failed: " + detail.split("\r\n")[0].substring(0, 200)));
        }
        const code = params.get("code");
        if (!code) return finish(new Error("Microsoft sign-in failed: no authorization code returned"));
        finish(null, code);
      }

      win.webContents.on("will-redirect", onUrl);
      win.webContents.on("will-navigate", onUrl);
      win.webContents.on("did-navigate", onUrl);
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.on("closed", () => finish(new Error("Sign-in cancelled")));
      win.loadURL(authUrl).catch(() => { /* redirect to nativeclient aborts the load — handled above */ });
    });
  }

  async function signIn(tenant, clientId) {
    validateConfig(tenant, clientId);
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));
    const code = await promptForCode(tenant, clientId, challenge, state);
    const json = await requestToken(tenant, {
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      scope: COPILOT_SCOPES,
    });
    storeTokens(tenant, clientId, json);
    return { account: memory.account };
  }

  // Forgets the stored token and the sign-in window's Microsoft session cookies,
  // so the next sign-in has to authenticate again.
  async function signOut() {
    clearStored();
    try {
      const { session } = require("electron");
      if (session) await session.fromPartition(AUTH_PARTITION).clearStorageData();
    } catch (err) {
      api.log("Could not clear Microsoft sign-in session:", err.message);
    }
  }

  // Returns the signed-in account for the given configuration, or null. A sign-in
  // made with a different tenant or client ID doesn't count.
  function status(tenant, clientId) {
    const stored = loadStored();
    if (!stored || !stored.refreshToken) return null;
    if (stored.tenant !== tenant || stored.clientId !== clientId) return null;
    return { account: stored.account || "" };
  }

  async function getAccessToken(tenant, clientId, forceRefresh) {
    validateConfig(tenant, clientId);
    const stored = loadStored();
    if (!stored || stored.tenant !== tenant || stored.clientId !== clientId || !stored.refreshToken) {
      throw new Error("Not signed in to Microsoft 365. Click Sign in under Settings → AI Features.");
    }
    if (!forceRefresh && stored.accessToken && stored.expiresAt > Date.now() + 60000) return stored.accessToken;
    let json;
    try {
      json = await requestToken(tenant, {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        scope: COPILOT_SCOPES,
      });
    } catch (err) {
      throw new Error(err.message + " — sign in again under Settings → AI Features.", { cause: err });
    }
    storeTokens(tenant, clientId, json);
    return memory.accessToken;
  }

  async function graphPost(token, urlPath, body) {
    const resp = await fetchWithTimeout(GRAPH + urlPath, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, CHAT_TIMEOUT_MS, "Microsoft 365 Copilot");
    if (resp.status === 401) {
      const err = new Error("Microsoft 365 Copilot error 401: access token rejected");
      err.unauthorized = true;
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let detail = text;
      try { detail = JSON.parse(text).error.message || text; } catch { /* not JSON */ }
      const hint = resp.status === 403
        ? " (check that you have a Microsoft 365 Copilot license and the app has admin consent)"
        : "";
      throw new Error(`Microsoft 365 Copilot error ${resp.status}${detail ? ": " + String(detail).substring(0, 200) : ""}${hint}`);
    }
    return resp.json();
  }

  // Sends one prompt in a fresh conversation and returns Copilot's reply text.
  // Web grounding is turned off so answers come from the prompt and the user's
  // own Microsoft 365 data only.
  async function chat(prompt, tenant, clientId) {
    try {
      return await chatOnce(prompt, await getAccessToken(tenant, clientId));
    } catch (err) {
      // The cached access token can be revoked before it expires; refresh once and retry.
      if (!err.unauthorized) throw err;
      return chatOnce(prompt, await getAccessToken(tenant, clientId, true));
    }
  }

  async function chatOnce(prompt, token) {
    const conversation = await graphPost(token, "/beta/copilot/conversations", {});
    if (!conversation || !conversation.id) throw new Error("Microsoft 365 Copilot did not return a conversation");
    const result = await graphPost(token, `/beta/copilot/conversations/${encodeURIComponent(conversation.id)}/chat`, {
      message: { text: prompt },
      locationHint: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" },
      contextualResources: { webContext: { isWebEnabled: false } },
    });
    const messages = Array.isArray(result && result.messages) ? result.messages : [];
    const reply = messages.length > 1 ? messages[messages.length - 1] : null;
    const text = cleanCopilotText(reply && reply.text);
    if (!text) throw new Error("Microsoft 365 Copilot returned an empty reply. Try again.");
    return text;
  }

  return { signIn, signOut, status, chat };
}

module.exports = { createM365Client, cleanCopilotText, TENANT_PATTERN, CLIENT_ID_PATTERN };
