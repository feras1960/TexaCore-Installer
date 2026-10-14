'use strict';
// ════════════════════════════════════════════════════════════════
// tunnel-route — does the PUBLIC link really reach THIS machine?
//
// The field bug (2.0.1, 2026-10-14): the launcher said «connected» while https://<name>.texacore.ai answered Cloudflare error 1033. The connector was healthy
// (cloudflared registered 4 connections for 7 hours) — but the tunnel it belonged to was not the one the hostname routes to (a token carried over from 1.x, a name
// that is no longer bound to this licence). «Connected» only ever meant "cloudflared registered a connection"; it never proved the route.
//
// This module is the proof:
//   * SERVER side: GET /__texacore/tunnel-probe/<nonce> on the UI server (the port the tunnel ingress points to) answers `texacore-probe:<nonce>:<bootId>` — nothing else,
//     no secret, no data; bootId is random per process.
//   * CLIENT side: after cloudflared registers a connection the main process fetches https://<subdomain>.texacore.ai/__texacore/tunnel-probe/<fresh nonce>. Only a body that
//     carries OUR nonce AND OUR bootId proves the link reaches this very process. RouteVerifier is the state machine around it (injected fetch / sleep / timers: unit-tested):
//         verifying   attempts at 0, 5, 10, 20, 30, 45, 60, 75, 90 s (DNS propagation after a fresh registration)
//         verified    the body matched — re-checked every 30 minutes and after the network came back
//         mismatch    Cloudflare 530 / error 1033 (the link does not reach this computer), or something else answers (wrong target)
//         unverified  nothing conclusive: timeout / DNS / offline / 502-504 — «cannot verify», never mislabelled as a mismatch
//   * deriveStatus() turns (connector state + route verdict + name-taken + repairing) into what the launcher shows.
//   * repairOutcome() maps a register-subdomain answer to a launcher outcome (taken / device / rate_limited / cloudflare / network / …).
//
// Pure apart from defaultProbe / handleProbeRequest (sockets). No secrets anywhere in here.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const PROBE_PREFIX = '/__texacore/tunnel-probe/';
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SCHEDULE_MS = [0, 5000, 10000, 20000, 30000, 45000, 60000, 75000, 90000];   // ~90 s of retries for DNS propagation
const QUICK_MS = [0, 5000, 15000];                                                   // a re-check that fails is confirmed before the state flips
const RECHECK_MS = 30 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8000;

const newBootId = () => crypto.randomBytes(8).toString('hex');
const newNonce = () => crypto.randomBytes(12).toString('hex');
const probeBody = (nonce, bootId) => `texacore-probe:${nonce}:${bootId}`;

// ─── server side ───────────────────────────────────────────────
/** The answer for a request URL, or null when it is not the probe path. Reveals nothing but the nonce the caller sent and this process's bootId. */
function answerProbe(url, bootId) {
  const p = String(url || '').split('?')[0];
  if (!p.startsWith(PROBE_PREFIX)) return null;
  const nonce = p.slice(PROBE_PREFIX.length);
  if (!NONCE_RE.test(nonce)) return { status: 404, body: 'not found' };
  return { status: 200, body: probeBody(nonce, bootId) };
}

/** Express / http handler: true when the request was the probe (and has been answered). GET only; no auth, no cookies, no data. */
function handleProbeRequest(req, res, bootId) {
  if (req.method !== 'GET') return false;
  const a = answerProbe(req.url, bootId);
  if (!a) return false;
  res.writeHead(a.status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' });
  res.end(a.body);
  return true;
}

// ─── client side ───────────────────────────────────────────────
const CF_ERROR_RE = /(?:error code:?\s*|error\s+)(1\d{3})\b/i;

/**
 * One probe answer → a verdict.
 * @param {{status?:number, body?:string, error?:{code?:string, timedOut?:boolean, message?:string}}} res
 * @returns {{verdict:'match'|'mismatch'|'unverified', reason:string|null, http:number|null, cfError:number|null}}
 */
function classifyProbe(res, nonce, bootId) {
  if (!res || res.error) {
    const e = (res && res.error) || {};
    const code = String(e.code || '');
    const reason = e.timedOut || code === 'ETIMEDOUT' || code === 'ECONNABORTED' ? 'timeout'
      : /^(ENOTFOUND|EAI_AGAIN|ENODATA)$/.test(code) ? 'dns'
        : /^(CERT_|ERR_TLS|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code) ? 'tls' : 'network';
    return { verdict: 'unverified', reason, http: null, cfError: null };
  }
  const status = Number(res.status) || 0;
  const body = String(res.body || '').trim();
  if (status === 200) {
    if (body === probeBody(nonce, bootId)) return { verdict: 'match', reason: null, http: 200, cfError: null };
    return { verdict: 'mismatch', reason: 'wrong_target', http: 200, cfError: null };       // a TexaCore with another bootId, or some other server
  }
  const cf = CF_ERROR_RE.exec(body);
  if (status === 530 || (cf && status >= 500)) return { verdict: 'mismatch', reason: 'no_route', http: status, cfError: cf ? Number(cf[1]) : null };   // Cloudflare 1033 & co: the link reaches no tunnel of this machine
  if (status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 524) || status >= 500) return { verdict: 'unverified', reason: 'edge_http', http: status, cfError: cf ? Number(cf[1]) : null };
  return { verdict: 'mismatch', reason: 'wrong_target', http: status, cfError: null };      // 404 / 403 / redirects: not our server (it would have answered the probe)
}

/** The real probe: GET the URL with a hard timeout; the body is capped (Cloudflare's error page is a few KB). Never throws. */
function defaultProbe(url, { timeoutMs = PROBE_TIMEOUT_MS, userAgent = 'TexaCore-Installer tunnel-probe' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(hard); resolve(v); } };
    let req;
    const hard = setTimeout(() => { try { req && req.destroy(); } catch { /* gone */ } done({ error: { code: 'ETIMEDOUT', timedOut: true, message: 'timeout' } }); }, timeoutMs);
    try {
      const u = new URL(url);
      const lib = u.protocol === 'http:' ? http : https;
      req = lib.get({ hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, agent: false, timeout: timeoutMs,
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache', Accept: 'text/plain', 'User-Agent': userAgent } }, (res) => {
        const chunks = []; let n = 0;
        res.on('data', (c) => { if (n < 4096) { chunks.push(c); n += c.length; } });
        res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 4096) }));
        res.on('error', (e) => done({ error: { code: e.code, message: e.message } }));
      });
      req.on('timeout', () => { try { req.destroy(); } catch { /* gone */ } done({ error: { code: 'ETIMEDOUT', timedOut: true, message: 'timeout' } }); });
      req.on('error', (e) => done({ error: { code: e.code, message: e.message } }));
    } catch (e) { done({ error: { code: e.code || 'EINVAL', message: e.message } }); }
  });
}

/**
 * The state machine. States: idle | verifying | verified | mismatch | unverified.
 * Inject `probe(nonce) → {status, body} | {error}`, `sleep(ms)`, `setTimer/clearTimer` (the 30-minute re-check), `now()`.
 */
class RouteVerifier {
  constructor({ probe, bootId, nonce = newNonce, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), setTimer = setTimeout, clearTimer = clearTimeout,
    schedule = SCHEDULE_MS, quick = QUICK_MS, recheckMs = RECHECK_MS, onVerdict = null, onChange = null } = {}) {
    Object.assign(this, { _probe: probe, bootId, _nonce: nonce, _now: now, _sleep: sleep, _setTimer: setTimer, _clearTimer: clearTimer, _schedule: schedule, _quick: quick, _recheckMs: recheckMs,
      _onVerdict: onVerdict, _onChange: onChange });
    this._gen = 0; this._timer = null; this._running = false;
    this._reset();
  }

  _reset() {
    this.state = 'idle'; this.reason = null; this.http = null; this.cfError = null;
    this.attempts = 0; this.lastCheckedAt = 0; this.verifiedAt = 0; this.nextCheckAt = 0; this.cycles = 0;
  }
  _set(patch) { Object.assign(this, patch); if (this._onChange) { try { this._onChange(this.snapshot()); } catch { /* a listener must not break the machine */ } } }

  snapshot() {
    return { state: this.state, reason: this.reason, http: this.http, cfError: this.cfError, attempts: this.attempts, lastCheckedAt: this.lastCheckedAt, verifiedAt: this.verifiedAt, nextCheckAt: this.nextCheckAt };
  }

  /** The connector registered a connection: start proving the route (once; a no-op while a cycle runs or a verdict stands). Returns the cycle's promise. */
  begin() {
    if (this.state !== 'idle') return Promise.resolve(this.snapshot());
    this.cycles = 0;
    return this._cycle(this._schedule, 'start');
  }

  /** The connector is gone / the tunnel was stopped or replaced. */
  stop() {
    this._gen++;
    if (this._timer) { this._clearTimer(this._timer); this._timer = null; }
    this._running = false;
    const was = this.state;
    this._reset();
    if (was !== 'idle' && this._onChange) { try { this._onChange(this.snapshot()); } catch { /* ignore */ } }
  }

  /** A fresh proof is wanted (the network came back, the 30-minute timer, the user asked). A failing re-check is confirmed over a short window before the state flips. */
  recheck(reason = 'manual') {
    if (this.state === 'idle' || this._running) return Promise.resolve(this.snapshot());
    return this._cycle(this._quick, `recheck:${reason}`);
  }

  async _cycle(schedule, kind) {
    const gen = ++this._gen;
    this._running = true;
    if (this._timer) { this._clearTimer(this._timer); this._timer = null; }
    const first = kind === 'start';
    if (first) this._set({ state: 'verifying', reason: null, http: null, cfError: null, attempts: 0 });
    let last = null; let prev = 0; let n = 0;
    for (const at of schedule) {
      if (at > prev) await this._sleep(at - prev);
      prev = at;
      if (gen !== this._gen) return this.snapshot();
      const nonce = this._nonce();
      let res;
      try { res = await this._probe(nonce); } catch (e) { res = { error: { code: e && e.code, message: e && e.message } }; }
      if (gen !== this._gen) return this.snapshot();
      last = classifyProbe(res, nonce, this.bootId);
      n++;
      this.attempts += 1; this.lastCheckedAt = this._now();
      if (last.verdict === 'match') {
        this._running = false; this.cycles++;
        this._set({ state: 'verified', reason: null, http: 200, cfError: null, verifiedAt: this._now() });
        this._arm();
        if (this._onVerdict) { try { this._onVerdict({ ...this.snapshot(), kind }); } catch { /* ignore */ } }
        return this.snapshot();
      }
    }
    this._running = false; this.cycles++;
    this._set({ state: last && last.verdict === 'mismatch' ? 'mismatch' : 'unverified', reason: last ? last.reason : 'timeout', http: last ? last.http : null, cfError: last ? last.cfError : null });
    this._arm();
    if (this._onVerdict) { try { this._onVerdict({ ...this.snapshot(), kind }); } catch { /* ignore */ } }
    return this.snapshot();
  }

  _arm() {
    if (this._timer) this._clearTimer(this._timer);
    this.nextCheckAt = this._now() + this._recheckMs;
    const gen = this._gen;
    this._timer = this._setTimer(() => { this._timer = null; if (gen === this._gen) this.recheck('timer'); }, this._recheckMs);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  }
}

// ─── what the launcher shows ───────────────────────────────────
/**
 * @param {object} mon      TunnelMonitor.snapshot() — off / starting / connected / error (+ reason)
 * @param {object} route    RouteVerifier.snapshot()
 * @param {{nameTaken?:object|null, repairing?:boolean}} extra
 * @returns {{state:string, reason:string|null, detail:string}}  state ∈ off|starting|connected|error|connected_unverified|route_mismatch|name_taken
 */
function deriveStatus(mon, route, { nameTaken = null, repairing = false } = {}) {
  if (repairing) return { state: 'starting', reason: 'repairing', detail: '' };
  if (nameTaken && mon.state !== 'off') return { state: 'name_taken', reason: nameTaken.reason || 'taken', detail: '' };
  if (mon.state !== 'connected') return { state: mon.state, reason: mon.reason, detail: mon.detail };
  switch (route && route.state) {
    case 'verified': return { state: 'connected', reason: null, detail: '' };
    case 'mismatch': return { state: 'route_mismatch', reason: route.reason || 'no_route', detail: `HTTP ${route.http || '?'}${route.cfError ? ` / Cloudflare ${route.cfError}` : ''}` };
    case 'unverified': return { state: 'connected_unverified', reason: route.reason || 'timeout', detail: route.http ? `HTTP ${route.http}` : '' };
    default: return { state: 'starting', reason: 'verifying_route', detail: '' };
  }
}

// ─── the repair: register-subdomain answers → outcomes ─────────
/**
 * @param {{status?:number, body?:any, error?:object}} r  the register-subdomain answer: an HTTP status + parsed JSON body, or a network error
 * @returns {{outcome:string, code:string|null, retryAfterSec?:number, reason?:string}}
 *   registered | taken | device_proof | hardware_mismatch | rate_limited | cloudflare_error | invalid_name | license | network
 */
function repairOutcome(r) {
  if (!r || r.error || r.body === undefined || r.body === null || typeof r.body !== 'object') return { outcome: 'network', code: null };
  const b = r.body;
  if (b.success && b.tunnel_token) return { outcome: 'registered', code: null };
  const code = String(b.code || '');
  switch (code) {
    case 'SUBDOMAIN_TAKEN': return { outcome: 'taken', code, reason: b.reason === 'quarantined' ? 'quarantined' : 'taken' };
    case 'DEVICE_PROOF_REQUIRED': return { outcome: 'device_proof', code };
    case 'HARDWARE_MISMATCH': case 'HARDWARE_REQUIRED': return { outcome: 'hardware_mismatch', code };
    case 'RATE_LIMITED': return { outcome: 'rate_limited', code, retryAfterSec: Math.max(1, Math.min(86400, Number(b.retry_after_seconds) || Number(r.retryAfter) || 3600)) };
    case 'CLOUDFLARE_ERROR': return { outcome: 'cloudflare_error', code };
    case 'INVALID_SUBDOMAIN': return { outcome: 'invalid_name', code };
    case 'NOT_FOUND': case 'INACTIVE': case 'EXPIRED': case 'BAD_REQUEST': return { outcome: 'license', code };
    default: return { outcome: (Number(r.status) >= 500 || !code) ? 'network' : 'license', code: code || null };
  }
}

/** Harness only (isolated runs): a JSON override of the timings, so an end-to-end check does not wait 90 seconds. */
function parseTimingOverride(text) {
  try {
    const o = JSON.parse(text);
    const out = {};
    if (Array.isArray(o.schedule) && o.schedule.every((x) => Number.isFinite(x) && x >= 0)) out.schedule = o.schedule.map(Number);
    if (Array.isArray(o.quick) && o.quick.every((x) => Number.isFinite(x) && x >= 0)) out.quick = o.quick.map(Number);
    if (Number.isFinite(o.recheckMs) && o.recheckMs >= 100) out.recheckMs = Number(o.recheckMs);
    if (Number.isFinite(o.timeoutMs) && o.timeoutMs >= 100) out.timeoutMs = Number(o.timeoutMs);
    return out;
  } catch { return {}; }
}

module.exports = {
  PROBE_PREFIX, NONCE_RE, SCHEDULE_MS, QUICK_MS, RECHECK_MS, PROBE_TIMEOUT_MS,
  newBootId, newNonce, probeBody, answerProbe, handleProbeRequest, classifyProbe, defaultProbe, RouteVerifier, deriveStatus, repairOutcome, parseTimingOverride,
};
