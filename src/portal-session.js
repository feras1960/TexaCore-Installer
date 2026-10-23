'use strict';
// ════════════════════════════════════════════════════════════════
// portal-session — the admin-portal («بوابة الإدارة») session, held by the SERVER.
//
// WHY: the launcher's company list (`GET /api/companies`) is part of the installer's admin API, which is for THIS computer only (net-guard.js: loopback
// Host + loopback peer + no proxy headers; every call also needs the per-install secret). A page opened from the office network or through the public tunnel is
// refused (403) - deliberately: an anonymous visitor must never see which companies this computer holds. But the portal already asks a manager for the portal
// password (verified in the database by public.verify_admin_password, which locks after 5 wrong guesses), and the browser then showed an EMPTY list: the password
// was checked in the page and the server never learned about it. Now the server learns:
//
//   POST /portal-api/login      {password}  → the SAME database check; right → a session (HttpOnly cookie), wrong → 401, nothing else changes
//   GET  /portal-api/companies              → id + name of every company, ONLY with a valid session; otherwise 401 and no list at all
//   POST /portal-api/logout                 → ends the session
//
// The session is a random 256-bit token kept in this process's memory (only its SHA-256 is stored), valid for 30 minutes, gone when the program restarts and
// whenever the portal password changes. It authorises nothing but the read-only company list: not the admin API, not the admin secret, not a company's data
// (every company still needs its own sign-in). It is bound to THIS install by construction (a token exists only in this process) and to this browser by an
// HttpOnly, SameSite=Strict cookie scoped to /portal-api (Secure when the request came in over https).
//
// net-guard is untouched: `/api/*` stays local-only for the office network and for the tunnel, and nothing here consults or relaxes loopback / Host / proxy
// checks. LAN PCs: no admin secret is ever sent to them (/config.js withholds it), `/api/*` answers 403, so they use exactly this portal flow (same password, same
// session) - and a PC that opens its company's own link (`/login?c=<code>`) needs no list at all.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const COOKIE_NAME = 'tx_portal';
const COOKIE_PATH = '/portal-api';
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 20;
const MAX_BODY_BYTES = 2048;
const MAX_PASSWORD_LENGTH = 256;

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

/** In-memory sessions: token → expiry, stored by the token's SHA-256 (a memory dump does not hand out usable tokens). */
function createPortalSessions({ now = Date.now, ttlMs = SESSION_TTL_MS, random = () => crypto.randomBytes(32), max = MAX_SESSIONS } = {}) {
  const sessions = new Map();     // sha256(token) → expiresAt (ms)
  function prune() {
    const t = now();
    for (const [k, exp] of sessions) if (exp <= t) sessions.delete(k);
    while (sessions.size >= max) sessions.delete(sessions.keys().next().value);   // the oldest goes first (Map keeps insertion order)
  }
  return {
    ttlMs,
    create() {
      prune();
      const token = random().toString('base64url');
      sessions.set(sha256(token), now() + ttlMs);
      return { token, maxAgeSec: Math.floor(ttlMs / 1000) };
    },
    isValid(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 128) return false;
      const k = sha256(token);
      const exp = sessions.get(k);
      if (!exp) return false;
      if (exp <= now()) { sessions.delete(k); return false; }
      return true;
    },
    revoke(token) { if (typeof token === 'string') sessions.delete(sha256(token)); },
    clear() { sessions.clear(); },
    size() { return sessions.size; },
  };
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https' || !!(req.socket && req.socket.encrypted);
}

function sessionCookie(token, maxAgeSec, secure) {
  return `${COOKIE_NAME}=${token}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

function send(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data), ...extraHeaders });
  res.end(data);
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); try { req.destroy(); } catch { /* gone */ } return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', (e) => reject(Object.assign(e, { status: 400 })));
  });
}

/**
 * Same-origin only: no CORS header is ever sent, so a browser blocks a cross-origin JSON POST by itself; on top of that a request a browser marks as anything but
 * same-origin / direct navigation (cross-site, or just same-SITE like another subdomain) is refused. A client that sends no Fetch-Metadata at all (an old browser,
 * curl) is held to the Origin header instead, when it sends one. (2.0.5 RC2: shared by /portal-api/* and /local-api/*.)
 */
function isCrossOrigin(req) {
  const sfs = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sfs) return sfs !== 'same-origin' && sfs !== 'none';
  const origin = String(req.headers.origin || '');
  if (!origin) return false;
  if (origin === 'null') return true;
  try { return new URL(origin).host !== String(req.headers.host || ''); } catch { return true; }
}

/**
 * The route handler: `handle(req, res)` answers `/portal-api/*` and resolves true, or resolves false for any other path (the caller goes on).
 * @param {object} o
 * @param {ReturnType<typeof createPortalSessions>} o.sessions
 * @param {(password: string) => Promise<boolean>} o.verifyPassword  the database check (public.verify_admin_password) - throttled and locked by the database itself
 * @param {() => Promise<Array<{id: string, name: string}>>} o.listCompanies
 * @param {(msg: string) => void} [o.log]  never receives a password or a token
 */
function createPortalRoutes({ sessions, verifyPassword, listCompanies, log = () => {} }) {
  // same-origin only: see isCrossOrigin() (shared with the local invite route)
  const crossOrigin = isCrossOrigin;
  const tokenOf = (req) => readCookie(req.headers.cookie, COOKIE_NAME);

  async function handle(req, res) {
    const path = String(req.url || '').split('?')[0];
    if (!path.startsWith('/portal-api/')) return false;
    try {
      if (crossOrigin(req)) { send(res, 403, { success: false, code: 'CROSS_ORIGIN' }); return true; }

      if (req.method === 'POST' && path === '/portal-api/login') {
        if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { send(res, 415, { success: false, code: 'JSON_REQUIRED' }); return true; }
        const body = await readJsonBody(req);
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password || password.length > MAX_PASSWORD_LENGTH) { send(res, 401, { success: false, code: 'BAD_PASSWORD' }); return true; }
        let ok = false;
        try { ok = (await verifyPassword(password)) === true; }
        catch (e) { log(`[Portal] password check unavailable: ${e && e.message}`); send(res, 503, { success: false, code: 'UNAVAILABLE' }); return true; }
        if (!ok) { send(res, 401, { success: false, code: 'BAD_PASSWORD' }); return true; }   // wrong, locked out or not set: the page cannot tell, nor can a guesser
        const s = sessions.create();
        log('[Portal] a portal session was opened');
        send(res, 200, { success: true, expiresInSec: s.maxAgeSec }, { 'Set-Cookie': sessionCookie(s.token, s.maxAgeSec, isHttps(req)) });
        return true;
      }

      if (req.method === 'GET' && path === '/portal-api/companies') {
        if (!sessions.isValid(tokenOf(req))) { send(res, 401, { success: false, code: 'PORTAL_AUTH_REQUIRED' }); return true; }   // no list for anybody else, not even a count
        const rows = await listCompanies();
        send(res, 200, { success: true, companies: (rows || []).map((c) => ({ id: String(c.id), name: String(c.name == null ? '' : c.name) })) });   // id + name only
        return true;
      }

      if (req.method === 'POST' && path === '/portal-api/logout') {
        sessions.revoke(tokenOf(req));
        send(res, 200, { success: true }, { 'Set-Cookie': sessionCookie('', 0, isHttps(req)) });
        return true;
      }

      send(res, 404, { success: false, code: 'NOT_FOUND' });
      return true;
    } catch (e) {
      if (e && (e.status === 413 || e.status === 400)) { send(res, e.status, { success: false, code: e.status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST' }); return true; }
      log(`[Portal] ${req.method} ${path} failed: ${e && e.message}`);
      send(res, 500, { success: false, code: 'ERROR' });
      return true;
    }
  }
  return { handle };
}

module.exports = { createPortalSessions, createPortalRoutes, isCrossOrigin, readCookie, sessionCookie, COOKIE_NAME, COOKIE_PATH, SESSION_TTL_MS };
