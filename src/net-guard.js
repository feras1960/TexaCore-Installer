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
//   3. it was not forwarded from somewhere else — cloudflared (the tunnel) connects from 127.0.0.1 and, if the tunnel's
//      origin settings override the Host header, would pass 1 and 2; Cloudflare ALWAYS adds Cf-* headers (Cf-Ray,
//      Cf-Connecting-IP …) and Cdn-Loop, and any reverse proxy names the real client in X-Forwarded-For / Forwarded / X-Real-IP.
//      So a request is "forwarded from elsewhere" when it carries a Cloudflare header, OR a forwarding header that names an address
//      which is neither loopback nor one of this machine's own addresses (or cannot be read as an address at all), OR an
//      X-Forwarded-Host that is not loopback. A header that merely says "a proxy touched this" (Via, X-Forwarded-Proto/-Port,
//      or a forwarding header naming only 127.0.0.1) is what a LOCAL program on this machine — a security product's HTTP scanner,
//      a debugging proxy — adds to its own browser's traffic: it does not make the request remote.
//
// Rule 2 accepts a peer that is one of THIS machine's own addresses too (Windows lets a local program that is bound to the LAN
// address connect to 127.0.0.1 and be seen from that LAN address): nobody else can have our address as their TCP peer.
// ════════════════════════════════════════════════════════════════
const os = require('os');

const HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const PROXY_HEADER_RE = /^(x-forwarded-|cf-|x-real-ip$|forwarded$|true-client-ip$|cdn-loop$|x-original-forwarded)/i;

function isLoopbackHost(hostHeader) {
  return HOST_RE.test(String(hostHeader || '').trim());
}

/**
 * One spelling of a socket address: lower-case, no brackets / zone id (`fe80::1%en0`), IPv4-mapped IPv6 (`::ffff:127.0.0.1`, `::ffff:7f00:1`) as dotted IPv4,
 * every spelling of the IPv6 loopback (`0:0:0:0:0:0:0:1`, `::0001`) as `::1`. Anything else is returned as it came (lower-cased).
 */
function normalizeAddress(addr) {
  let a = String(addr == null ? '' : addr).trim().toLowerCase();
  if (a.startsWith('[') && a.includes(']')) a = a.slice(1, a.indexOf(']'));
  const z = a.indexOf('%'); if (z >= 0) a = a.slice(0, z);
  let m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (m) return m[1];
  m = /^(?:0{1,4}:){5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a) || /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (m) { const hi = parseInt(m[1], 16); const lo = parseInt(m[2], 16); return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; }
  if (/^(?:0{1,4}:){7}0{0,3}1$/.test(a) || /^::0{0,3}1$/.test(a)) return '::1';
  return a;
}

function isLoopbackAddress(addr) {
  const a = normalizeAddress(addr);
  return a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

// This machine's own interface addresses (cached for a few seconds: interfaces come and go with Wi-Fi / VPN).
let _ownCache = { at: 0, set: new Set() };
function ownAddresses(now = Date.now()) {
  if (now - _ownCache.at < 5000) return _ownCache.set;
  const set = new Set();
  try {
    for (const list of Object.values(os.networkInterfaces() || {})) for (const i of list || []) if (i && i.address) set.add(normalizeAddress(i.address));
  } catch { /* none */ }
  _ownCache = { at: now, set };
  return set;
}

/** Is this address one of THIS machine's own (a local program connecting from the machine's LAN address)? Loopback counts. */
function isThisMachineAddress(addr, own = ownAddresses()) {
  if (isLoopbackAddress(addr)) return true;
  const a = normalizeAddress(addr);
  return !!a && own.has(a);
}

function isLoopbackOrigin(origin) {
  return ORIGIN_RE.test(String(origin || '').trim());
}

/** Does the request carry ANY proxy / CDN header at all? (informational — the decision uses `forwardedFromElsewhere`) */
function hasProxyHeaders(headers) {
  return Object.keys(headers || {}).some((k) => PROXY_HEADER_RE.test(k));
}

/** The names (never the values) of the proxy-ish headers a request carries — for the log line that says why the admin bits were withheld. */
function proxyHeaderNames(headers) {
  return Object.keys(headers || {}).filter((k) => PROXY_HEADER_RE.test(k) || /^(via|x-client-ip|x-forwarded)/i.test(k)).map((k) => k.toLowerCase()).sort();
}

const CLOUDFLARE_HEADER_RE = /^(cf-|cdn-loop$|x-cf-)/i;
const FORWARDING_ADDRESS_HEADERS = ['x-forwarded-for', 'x-real-ip', 'true-client-ip', 'x-client-ip', 'x-original-forwarded-for', 'forwarded'];

/** The addresses a forwarding header names (`1.2.3.4, 10.0.0.1`, `for="[2001:db8::1]:4711";proto=http`), or null when it cannot be read as addresses. */
function addressesIn(name, value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value == null ? '' : value);
  const parts = name === 'forwarded'
    ? raw.split(/[,;]/).map((x) => x.trim()).filter((x) => /^for\s*=/i.test(x)).map((x) => x.replace(/^for\s*=\s*/i, ''))
    : raw.split(',').map((x) => x.trim());
  if (!parts.length || parts.some((x) => !x)) return null;
  const out = [];
  for (let p of parts) {
    p = p.replace(/^"(.*)"$/, '$1');
    let m = /^\[([^\]]+)\](?::\d+)?$/.exec(p);               // [v6]:port
    if (m) p = m[1];
    else if ((m = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(p))) p = m[1];   // v4:port
    if (!/^[0-9a-f:.%]+$/i.test(p) || !/[.:]/.test(p)) return null;   // not an address (unknown, _hidden, a host name …)
    out.push(p);
  }
  return out;
}

/**
 * Was this request forwarded from somewhere else (the tunnel, a reverse proxy, a CDN)? `reasons` says why (log text; no header values).
 * See the header comment: Cloudflare headers, or a forwarding header naming a foreign / unreadable address, or a foreign X-Forwarded-Host.
 */
function forwardedFromElsewhere(headers, own = ownAddresses()) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[k.toLowerCase()] = v;
  const reasons = [];
  const cf = Object.keys(h).filter((k) => CLOUDFLARE_HEADER_RE.test(k));
  if (cf.length) reasons.push(`cloudflare-header(${cf.sort().join(',')})`);
  for (const name of FORWARDING_ADDRESS_HEADERS) {
    if (h[name] === undefined) continue;
    const addrs = addressesIn(name, h[name]);
    if (addrs === null) reasons.push(`${name}:unreadable`);
    else if (addrs.some((a) => !isThisMachineAddress(a, own))) reasons.push(`${name}:foreign-address`);
  }
  if (h['x-forwarded-host'] !== undefined) {
    const hosts = String(Array.isArray(h['x-forwarded-host']) ? h['x-forwarded-host'].join(',') : h['x-forwarded-host']).split(',').map((x) => x.trim());
    if (hosts.some((x) => !isLoopbackHost(x))) reasons.push('x-forwarded-host:foreign-host');
  }
  return { forwarded: reasons.length > 0, reasons };
}

/**
 * The decision AND its reasons: `{ local, reasons[] }` (reasons empty when local). Reasons are short codes — never header values.
 * Request from a program/browser on THIS machine browsing to this machine by loopback name (see the header comment).
 */
function classifyRequest(req) {
  if (!req) return { local: false, reasons: ['no-request'] };
  const h = req.headers || {};
  const reasons = [];
  if (!isLoopbackHost(h.host)) reasons.push('host-not-loopback');
  const peer = req.socket && req.socket.remoteAddress;
  if (!peer) reasons.push('no-peer-address');
  else if (!isThisMachineAddress(peer)) reasons.push('peer-not-this-machine');
  const f = forwardedFromElsewhere(h);
  reasons.push(...f.reasons);
  return { local: reasons.length === 0, reasons };
}

/** Request from a program/browser on THIS machine browsing to this machine by loopback name (see the header comment). */
function isLocalRequest(req) {
  return classifyRequest(req).local;
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

/**
 * (2.0.4, security S5) Does this request carry a same-origin signal? A browser loading its own page's script says Sec-Fetch-Site: same-origin (or none for a
 * typed address); a browser too old for Fetch Metadata sends the page's URL as Referer. A bare client (curl, another program) sends neither and is NOT same-origin:
 * "no header" proves nothing. `headers` = req.headers (lower-cased names), `host` = the Host the request was made to.
 */
function hasSameOriginSignal(headers, host) {
  const site = String((headers && headers['sec-fetch-site']) || '');
  const origin = String((headers && headers['origin']) || '');
  if (site === 'same-origin' || site === 'none') return true;
  if (site || origin) return false;
  try {
    const ref = headers && headers['referer'];
    return !!ref && new URL(String(ref)).host.toLowerCase() === String(host || '').toLowerCase();
  } catch { return false; }
}

module.exports = {
  hasSameOriginSignal,
  isLoopbackHost,
  isLoopbackAddress,
  normalizeAddress,
  isThisMachineAddress,
  classifyRequest,
  forwardedFromElsewhere,
  proxyHeaderNames,
  isLoopbackOrigin,
  hasProxyHeaders,
  isLocalRequest,
  corsHeadersFor,
  applyCors,
  stripCorsHeaders,
  safeUploadName,
  CORS_ALLOW_HEADERS,
};
