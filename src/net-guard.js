'use strict';
// ════════════════════════════════════════════════════════════════
// Network guards shared by the installer's local servers.
//
// The ERP front-end server listens on 0.0.0.0 so that other PCs in the office can open the ERP in a browser. That
// makes it reachable from the LAN (and, through the tunnel, from the internet) — but the installer's ADMIN surface
// (per-install secret in /config.js, the /api/* admin proxy) is for THIS machine only. "Is this the local machine?" must
// therefore be decided by a strict allow-list — never by "it is not a .texacore.ai host", which is what 1.x/early 2.0 did
// (a LAN IP is neither cloud nor loopback, and a curl sends no Origin).
//
// A request is LOCAL only when ALL of these hold:
//   1. its Host header is exactly localhost / 127.0.0.1 / [::1] (any port) — a browser on this machine browsing to the
//      LAN address, or a DNS-rebinding page, sends something else;
//   2. the TCP peer is a loopback address — a LAN client that forges `Host: 127.0.0.1` still connects from its LAN IP;
//   3. it carries no reverse-proxy / CDN header — cloudflared (the tunnel) connects from 127.0.0.1 and, if the tunnel's
//      origin settings override the Host header, would pass 1 and 2; Cloudflare always adds Cf-* / X-Forwarded-* headers.
// ════════════════════════════════════════════════════════════════

const HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const PROXY_HEADER_RE = /^(x-forwarded-|cf-|x-real-ip$|forwarded$|true-client-ip$|cdn-loop$|x-original-forwarded)/i;

function isLoopbackHost(hostHeader) {
  return HOST_RE.test(String(hostHeader || '').trim());
}

function isLoopbackAddress(addr) {
  const a = String(addr || '');
  return a === '::1' || a === '127.0.0.1' || /^127\.\d+\.\d+\.\d+$/.test(a) || /^::ffff:127\.\d+\.\d+\.\d+$/i.test(a);
}

function isLoopbackOrigin(origin) {
  return ORIGIN_RE.test(String(origin || '').trim());
}

function hasProxyHeaders(headers) {
  return Object.keys(headers || {}).some((k) => PROXY_HEADER_RE.test(k));
}

/** Request from a program/browser on THIS machine browsing to this machine by loopback name (see the header comment). */
function isLocalRequest(req) {
  if (!req) return false;
  const h = req.headers || {};
  return isLoopbackHost(h.host)
    && isLoopbackAddress(req.socket && req.socket.remoteAddress)
    && !hasProxyHeaders(h);
}

// ─── CORS ────────────────────────────────────────────────────────
// Never `*`. A foreign website open in the owner's browser must not be able to read the local servers' responses, so the
// only origins reflected are loopback ones (the ERP page opened on this machine, dev tooling). Same-origin calls (every
// remote/LAN browser goes through the /_supabase proxy of the page it loaded) need no CORS at all.
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, apikey, x-client-info, Accept, Range, X-Upsert, Prefer, x-supabase-api-version, accept-profile, content-profile';
const CORS_EXPOSE_HEADERS = 'Content-Range, X-Total-Count';

/** Headers to add for this request ({} when the Origin is absent or not loopback). */
function corsHeadersFor(req, { methods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS', allowHeaders = CORS_ALLOW_HEADERS } = {}) {
  const origin = String((req && req.headers && req.headers.origin) || '');
  const out = { Vary: 'Origin' };
  if (!isLoopbackOrigin(origin)) return out;
  out['Access-Control-Allow-Origin'] = origin;
  out['Access-Control-Allow-Methods'] = methods;
  out['Access-Control-Allow-Headers'] = allowHeaders;
  out['Access-Control-Expose-Headers'] = CORS_EXPOSE_HEADERS;
  return out;
}

function applyCors(req, res, opts) {
  const h = corsHeadersFor(req, opts);
  for (const k of Object.keys(h)) res.setHeader(k, h[k]);
}

/** A copy of an upstream response's headers with every upstream CORS header dropped (ours are applied instead). */
function stripCorsHeaders(headers) {
  const out = {};
  for (const k of Object.keys(headers || {})) {
    if (!/^access-control-/i.test(k)) out[k] = headers[k];
  }
  return out;
}

// ─── Upload file names ───────────────────────────────────────────
/**
 * A multipart `filename` is attacker-controlled. Returns a safe base name (never a path) or null when it cannot be one:
 * path separators / `..` / NUL / control characters / a leading dot are refused outright (not "cleaned"), so
 * `../../x`, `..\\x`, `C:\\x`, `a/b.tcdb` all fail instead of silently turning into something else.
 */
function safeUploadName(name, { ext = null, maxLen = 120 } = {}) {
  if (typeof name !== 'string') return null;
  const n = name;
  if (!n || n.length > maxLen || n !== n.trim()) return null;
  if (/[\\/\0:*?"<>|]/.test(n)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(n)) return null;
  if (n === '.' || n === '..' || n.startsWith('.') || n.includes('..')) return null;
  if (ext && !n.toLowerCase().endsWith(ext.toLowerCase())) return null;
  if (n.endsWith('.') || n.endsWith(' ')) return null;     // Windows trims these — would alias another name
  return n;
}

module.exports = {
  isLoopbackHost,
  isLoopbackAddress,
  isLoopbackOrigin,
  hasProxyHeaders,
  isLocalRequest,
  corsHeadersFor,
  applyCors,
  stripCorsHeaders,
  safeUploadName,
  CORS_ALLOW_HEADERS,
};
