'use strict';
// ════════════════════════════════════════════════════════════════
// local-invite-route — POST /local-api/invite-user: the ERP's «إضافة مستخدم» on a LOCAL install.  (2.0.5 RC2)
//
// The cloud ERP adds a user through a Supabase edge function (invite-user) plus fn_membership_invite_multi. A local install has no edge functions and no
// e-mail, so the UI server (the one every client of a local install talks to: this computer, the office network, the public tunnel - same origin) answers
// the same call itself. It is the same trust model as /portal-api/*: NOT part of the local-only admin API, no admin secret, no CORS; what authorises a call is
// the caller's OWN signed-in GoTrue session, and the database's own guards decide whether that person may do it (see provisioning.inviteLocalUserAsCaller).
//
//   POST /local-api/invite-user
//     Content-Type: application/json                      (else 415)
//     Authorization: Bearer <the caller's GoTrue access_token>
//     { email, full_name, phone?, employee_id?, items:[{ company_id, role_ids:[uuid..] }], note? }          (<= 16 KB, else 413)
//   200 { success:true, data:{ user_id, email, is_new, one_time_password (only when is_new, once), created, skipped:[{company_id,reason}],
//                              request_ids:[], accepted, companies:[{ company_id, company_name, login_code }] } }
//   4xx/5xx { success:false, code, reason?, error, current?, max?, retry_after_sec? }
//     code: BAD_REQUEST 400 (415 json_required, 413 too_large) | AUTH_REQUIRED 401 | NOT_ALLOWED 403 | ROLE_NOT_GRANTABLE 403 | CROSS_ORIGIN 403 |
//           PLAN_LIMIT_EXCEEDED 403 | RATE_LIMITED 429 (+ Retry-After) | SERVICES_DOWN 503 | INVITE_FAILED 409 (a known refusal: already_member,
//           foreign_tenant_account, membership_removed, email_exists ...) or 500
//
// Never: a CORS header, the service key / admin secret / local API secret, a token or the one-time password in a log line. Responses are `no-store`.
// ════════════════════════════════════════════════════════════════
const portalSession = require('./portal-session');

const MAX_BODY_BYTES = 16 * 1024;
const ROUTE = '/local-api/invite-user';
const KNOWN_REFUSALS = new Set(['already_member', 'foreign_tenant_account', 'membership_removed', 'email_exists', 'employee_not_found', 'employee_linked']);

/** At most `max` hits per `key` in any `windowMs`. In-memory, injectable clock; a refused hit is not counted again. */
function createRateLimiter({ max, windowMs, now = Date.now, maxKeys = 5000 }) {
  const hits = new Map();   // key → [timestamps (ms)]
  function prune(t) {
    for (const [k, arr] of hits) {
      while (arr.length && arr[0] <= t - windowMs) arr.shift();
      if (!arr.length) hits.delete(k);
    }
  }
  return {
    /** @returns {{ ok: boolean, retryAfterSec?: number }} */
    take(key) {
      const t = now();
      const k = String(key);
      let arr = hits.get(k);
      if (arr) while (arr.length && arr[0] <= t - windowMs) arr.shift();
      if (arr && arr.length >= max) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000)) };
      if (!arr) {
        if (hits.size >= maxKeys) prune(t);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        arr = [];
        hits.set(k, arr);
      }
      arr.push(t);
      return { ok: true };
    },
    size() { return hits.size; },
  };
}

function send(res, status, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(data), ...extra,
  });
  res.end(data);
}

function readJsonBody(req, limit) {
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

/** A refusal word the database itself gave (already_member, foreign_tenant_account ...) is a 409; our own internal failures are not. */
function isServerRefusal(reason) {
  const r = String(reason || '');
  return KNOWN_REFUSALS.has(r) || (/^[a-z0-9_]+$/.test(r) && !['error', 'refused', 'account_create_failed', 'jwt'].includes(r));
}

/** The HTTP status of a failure object. */
function statusFor(f) {
  switch (f && f.code) {
    case 'BAD_REQUEST': return 400;
    case 'AUTH_REQUIRED': return 401;
    case 'NOT_ALLOWED': case 'ROLE_NOT_GRANTABLE': case 'CROSS_ORIGIN': case 'PLAN_LIMIT_EXCEEDED': return 403;
    case 'RATE_LIMITED': return 429;
    case 'SERVICES_DOWN': return 503;
    case 'INVITE_FAILED': return isServerRefusal(f.reason) ? 409 : 500;
    default: return 500;
  }
}

/** Only the documented fields of a failure ever leave this process. */
function publicFailure(f) {
  const out = { success: false, code: String(f.code || 'INVITE_FAILED'), error: String(f.error || 'the invitation failed') };
  if (f.reason) out.reason = String(f.reason);
  if (f.company_id) out.company_id = String(f.company_id);
  if (f.current !== undefined && f.current !== null) out.current = f.current;
  if (f.max !== undefined && f.max !== null) out.max = f.max;
  if (f.retry_after_sec) out.retry_after_sec = f.retry_after_sec;
  return out;
}

/** The address of the client for the burst limiter: the peer, or - when the peer is the local tunnel connector - the address the tunnel reports. */
function clientAddress(req) {
  const peer = String((req.socket && req.socket.remoteAddress) || '');
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  return (loopback && cf && cf.length <= 64) ? `cf:${cf}` : (peer || 'unknown');
}

/**
 * @param {object} o
 * @param {() => object|null} o.getDeps        provisioning deps of the RUNNING services (null/throw = the services are down → 503)
 * @param {(deps, input) => Promise<object>} o.invite          provisioning.inviteLocalUserAsCaller
 * @param {(deps, token) => Promise<object>} o.authenticate    provisioning.authenticateCaller
 * @param {() => number} [o.now]
 * @param {(msg: string) => void} [o.log]       never receives a token or a password
 * @param {{userMax?:number,userWindowMs?:number,addrMax?:number,addrWindowMs?:number}} [o.limits]
 */
function createLocalInviteRoutes({ getDeps, invite, authenticate, now = Date.now, log = () => {}, limits = {} }) {
  const perUser = createRateLimiter({ max: limits.userMax || 10, windowMs: limits.userWindowMs || 10 * 60 * 1000, now });      // 10 invitations / 10 min / signed-in user
  const perAddr = createRateLimiter({ max: limits.addrMax || 20, windowMs: limits.addrWindowMs || 60 * 1000, now });           // a small burst per client address, also for bad tokens

  async function handle(req, res) {
    const path = String(req.url || '').split('?')[0];
    if (!path.startsWith('/local-api/')) return false;
    try {
      if (portalSession.isCrossOrigin(req)) { send(res, 403, { success: false, code: 'CROSS_ORIGIN', error: 'cross-site requests are refused' }); return true; }
      if (path !== ROUTE) { send(res, 404, { success: false, code: 'BAD_REQUEST', reason: 'not_found', error: 'unknown route' }); return true; }
      if (req.method !== 'POST') { send(res, 405, { success: false, code: 'BAD_REQUEST', reason: 'method_not_allowed', error: 'POST only' }, { Allow: 'POST' }); return true; }
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { send(res, 415, { success: false, code: 'BAD_REQUEST', reason: 'json_required', error: 'Content-Type must be application/json' }); return true; }

      const addr = perAddr.take(clientAddress(req));
      if (!addr.ok) { send(res, 429, publicFailure({ code: 'RATE_LIMITED', error: 'too many requests, try again shortly', retry_after_sec: addr.retryAfterSec }), { 'Retry-After': String(addr.retryAfterSec) }); return true; }

      let body;
      try { body = await readJsonBody(req, MAX_BODY_BYTES); } catch (e) {
        if (e && e.status === 413) { send(res, 413, { success: false, code: 'BAD_REQUEST', reason: 'too_large', error: 'the request is too large' }); return true; }
        send(res, 400, { success: false, code: 'BAD_REQUEST', reason: 'bad_json', error: 'the body is not valid JSON' }); return true;
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { success: false, code: 'BAD_REQUEST', reason: 'bad_json', error: 'the body must be a JSON object' }); return true; }

      const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || '').trim());
      if (!m) { send(res, 401, publicFailure({ code: 'AUTH_REQUIRED', error: 'sign in first' })); return true; }
      const token = m[1];

      let deps = null;
      try { deps = getDeps(); } catch { deps = null; }
      if (!deps) { send(res, 503, publicFailure({ code: 'SERVICES_DOWN', error: 'the services are not running' })); return true; }

      // who is calling (GoTrue vouches for the token) - then the per-user budget, before any database work
      const caller = await authenticate(deps, token);
      if (!caller || !caller.ok) { const f = { code: (caller && caller.code) || 'AUTH_REQUIRED', error: (caller && caller.error) || 'sign in first' }; send(res, statusFor(f), publicFailure(f)); return true; }
      const mine = perUser.take(caller.id);
      if (!mine.ok) { send(res, 429, publicFailure({ code: 'RATE_LIMITED', error: 'too many invitations, try again later', retry_after_sec: mine.retryAfterSec }), { 'Retry-After': String(mine.retryAfterSec) }); return true; }

      const result = await invite(deps, { ...body, callerToken: token, caller });
      if (result && result.success) { send(res, 200, { success: true, data: result.data }); return true; }
      const f = result || { code: 'INVITE_FAILED', error: 'the invitation failed' };
      send(res, statusFor(f), publicFailure(f));
      return true;
    } catch (e) {
      log(`[Invite] ${req.method} ${ROUTE} failed: ${(e && e.code) || 'error'}`);   // (no message: it may carry whatever a driver echoes)
      if (!res.headersSent) send(res, 500, { success: false, code: 'INVITE_FAILED', reason: 'error', error: 'the invitation failed' });
      return true;
    }
  }
  return { handle, limiters: { perUser, perAddr } };
}

module.exports = { createLocalInviteRoutes, createRateLimiter, statusFor, publicFailure, clientAddress, ROUTE, MAX_BODY_BYTES };
