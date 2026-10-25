'use strict';
/**
 * Microsoft -> Xbox Live -> XSTS -> Minecraft services login using the OAuth 2.0 device-code flow:
 * the user signs in on microsoft.com in their browser, the launcher never sees a password.
 * Requires an Azure app registration (public client) that Mojang has approved - see README.
 */
const fsp = require('node:fs/promises');
const { sleep, withRetry, readJson, LauncherError } = require('./util');

const SCOPE = 'XboxLive.signin offline_access';
// Xbox services require this header on both the user-token and the XSTS request.
const XBL_HEADERS = { 'x-xbl-contract-version': '1' };
const XERR = {
  2148916227: 'This Xbox account has been banned or suspended, so Xbox login is not possible.',
  2148916233: 'This Microsoft account has no Xbox profile yet. Sign in once at minecraft.net to create one.',
  2148916235: 'Xbox Live is not available in your country/region.',
  2148916236: 'This account needs adult verification on the Xbox page.',
  2148916237: 'This account needs adult verification on the Xbox page.',
  2148916238: 'This is a child account. An adult must add it to a Microsoft family first.',
};

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  let json = {};
  try { json = await res.json(); } catch { /* keep empty */ }
  return { res, json };
}

async function postJson(url, body, headers = {}) {
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    let json = {};
    try { json = await res.json(); } catch { /* keep empty */ }
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    return { res, json };
  }, { label: `POST ${url}` });
}

function requireClientId(clientId) {
  if (!clientId) throw new LauncherError('No Azure client ID set. Open Settings > Account and enter your application (client) ID.', 'NO_CLIENT_ID');
}

async function startDeviceLogin(ctx, clientId) {
  requireClientId(clientId);
  const { res, json } = await postForm(ctx.endpoints.msDevice, { client_id: clientId, scope: SCOPE });
  if (!res.ok) {
    throw new LauncherError(`Microsoft rejected the client ID: ${json.error_description || json.error || res.status}`, 'LOGIN_FAILED');
  }
  return json; // { device_code, user_code, verification_uri, expires_in, interval, message }
}

async function pollDeviceLogin(ctx, clientId, dc, { signal } = {}) {
  let interval = (dc.interval || 5) * 1000;
  const deadline = Date.now() + (dc.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw new LauncherError('Login cancelled.', 'CANCELLED');
    await sleep(interval);
    if (signal && signal.aborted) throw new LauncherError('Login cancelled.', 'CANCELLED');
    const { json } = await postForm(ctx.endpoints.msToken, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dc.device_code,
    });
    if (json.access_token) return json;
    if (json.error === 'authorization_pending') continue;
    if (json.error === 'slow_down') { interval += 5000; continue; }
    if (json.error === 'authorization_declined') throw new LauncherError('Login was declined.', 'LOGIN_FAILED');
    if (json.error === 'expired_token') break;
    throw new LauncherError(`Login failed: ${json.error_description || json.error || 'unknown error'}`, 'LOGIN_FAILED');
  }
  throw new LauncherError('The login code expired. Please try again.', 'LOGIN_EXPIRED');
}

async function refreshMsToken(ctx, clientId, refreshToken) {
  requireClientId(clientId);
  const { json } = await postForm(ctx.endpoints.msToken, {
    grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope: SCOPE,
  });
  if (!json.access_token) throw new LauncherError('Your login has expired. Please sign in again.', 'LOGIN_EXPIRED');
  return json;
}

/** Builds a readable message from an Xbox error response. Only the numeric XErr code and HTTP status are
 *  included - never tokens, tickets or the raw response body. */
function xboxFailure(step, { res, json }) {
  const code = json && Number(json.XErr);
  if (code && XERR[code]) return XERR[code];
  const parts = [`HTTP ${res.status}`];
  if (code) parts.push(`Xbox error ${code}`);
  return `${step} failed (${parts.join(', ')}). Please try again; if it keeps happening, check your account at xbox.com.`;
}

async function minecraftSession(ctx, msAccessToken) {
  const xbl = await postJson(ctx.endpoints.xblAuth, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  }, XBL_HEADERS);
  const uhs = xbl.json && xbl.json.DisplayClaims && xbl.json.DisplayClaims.xui && xbl.json.DisplayClaims.xui[0]
    && xbl.json.DisplayClaims.xui[0].uhs;
  if (!xbl.json.Token || !uhs) {
    throw new LauncherError(xboxFailure('Xbox Live sign-in', xbl), 'LOGIN_FAILED');
  }

  const xsts = await postJson(ctx.endpoints.xstsAuth, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.json.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  }, XBL_HEADERS);
  if (!xsts.json.Token) {
    throw new LauncherError(xboxFailure('Xbox authorisation', xsts), 'LOGIN_FAILED');
  }

  const mc = await postJson(ctx.endpoints.mcLogin, { identityToken: `XBL3.0 x=${uhs};${xsts.json.Token}` });
  if (!mc.json.access_token) {
    if (mc.res.status === 403) {
      throw new LauncherError('Minecraft refused this app (HTTP 403). Your Azure app has not been approved by Mojang yet. Apply at https://aka.ms/mce-reviewappid and try again once it is approved.', 'APP_NOT_APPROVED');
    }
    throw new LauncherError(`Minecraft services rejected the login (HTTP ${mc.res.status}).`, 'LOGIN_FAILED');
  }
  const bearer = { Authorization: `Bearer ${mc.json.access_token}` };

  const ent = await fetch(ctx.endpoints.mcEntitlements, { headers: bearer }).then((r) => r.json()).catch(() => ({}));
  const owns = (ent.items || []).some((i) => i.name === 'product_minecraft' || i.name === 'game_minecraft');

  const profRes = await fetch(ctx.endpoints.mcProfile, { headers: bearer });
  let profile = null;
  if (profRes.ok) profile = await profRes.json();
  return {
    mcToken: mc.json.access_token,
    mcExpiresAt: Date.now() + (mc.json.expires_in || 86400) * 1000,
    owns: owns || !!profile, // a profile only exists for accounts with the Java licence
    uuid: profile && profile.id, name: profile && profile.name,
    skin: profile && profile.skins && profile.skins[0] && profile.skins[0].url,
    xuid: uhs,
  };
}

/** Encrypted single-account store. `secure` = { encrypt(string)->Buffer, decrypt(Buffer)->string }. */
function createAccountStore(ctx, secure) {
  let cache;
  const api = {
    async load() {
      if (cache !== undefined) return cache;
      try { cache = JSON.parse(secure.decrypt(await fsp.readFile(ctx.paths.accounts))); } catch { cache = null; }
      return cache;
    },
    async save(acc) {
      cache = acc;
      if (!acc) { await fsp.rm(ctx.paths.accounts, { force: true }); return; }
      await fsp.writeFile(ctx.paths.accounts, secure.encrypt(JSON.stringify(acc)));
    },
  };
  return api;
}

function publicAccount(acc) {
  if (!acc) return null;
  return { name: acc.name, uuid: acc.uuid, owns: acc.owns, skin: acc.skin || null };
}

function createAuth(ctx, secure, getClientId) {
  const store = createAccountStore(ctx, secure);
  let abort = null;

  async function finish(msTokens, clientId) {
    const s = await minecraftSession(ctx, msTokens.access_token);
    if (!s.owns || !s.name) {
      throw new LauncherError('This Microsoft account does not own Minecraft: Java Edition.', 'NO_LICENCE');
    }
    const acc = {
      uuid: s.uuid, name: s.name, owns: true, skin: s.skin, xuid: s.xuid, clientId,
      msRefresh: msTokens.refresh_token, mcToken: s.mcToken, mcExpiresAt: s.mcExpiresAt,
    };
    await store.save(acc);
    return publicAccount(acc);
  }

  return {
    getAccount: async () => publicAccount(await store.load()),
    /** Step 1: returns what to show the user. Step 2 is awaited via .done */
    async login(onCode) {
      const clientId = getClientId();
      const dc = await startDeviceLogin(ctx, clientId);
      onCode({ userCode: dc.user_code, url: dc.verification_uri, expiresIn: dc.expires_in });
      abort = new AbortController();
      try {
        const tokens = await pollDeviceLogin(ctx, clientId, dc, { signal: abort.signal });
        return await finish(tokens, clientId);
      } finally { abort = null; }
    },
    cancelLogin() { if (abort) abort.abort(); },
    async logout() { await store.save(null); },
    /** Returns a session usable for launching; refreshes tokens when needed. */
    async session() {
      const acc = await store.load();
      if (!acc) throw new LauncherError('Please sign in with your Microsoft account first.', 'NOT_SIGNED_IN');
      if (!acc.owns) throw new LauncherError('This account does not own Minecraft: Java Edition.', 'NO_LICENCE');
      if (acc.mcExpiresAt - Date.now() < 5 * 60 * 1000) {
        const clientId = getClientId() || acc.clientId;
        const ms = await refreshMsToken(ctx, clientId, acc.msRefresh);
        const s = await minecraftSession(ctx, ms.access_token);
        if (!s.owns) throw new LauncherError('This account no longer owns Minecraft: Java Edition.', 'NO_LICENCE');
        Object.assign(acc, { mcToken: s.mcToken, mcExpiresAt: s.mcExpiresAt, msRefresh: ms.refresh_token || acc.msRefresh, name: s.name || acc.name, uuid: s.uuid || acc.uuid, skin: s.skin });
        await store.save(acc);
      }
      return { name: acc.name, uuid: acc.uuid, accessToken: acc.mcToken, xuid: acc.xuid, clientId: acc.clientId };
    },
  };
}

module.exports = { XBL_HEADERS, xboxFailure, createAuth, startDeviceLogin, pollDeviceLogin, minecraftSession, publicAccount };
