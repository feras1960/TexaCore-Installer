'use strict';
// ════════════════════════════════════════════════════════════════
// net-redirect-preload — loaded into a test run of an Electron app with NODE_OPTIONS=--require <this file>. It lives OUTSIDE the product: the app under test keeps its
// real, unmodified feed URLs (https://github.com/feras1960/TexaCore-Installer/releases/latest/download/…).
//   * requests to github.com / *.githubusercontent.com made through Node's http(s) are sent to the local mock (127.0.0.1:$OTA_MOCK_PORT) with the original Host header;
//   * EVERY other non-loopback destination is refused (the app can not reach production, a test can not leak);
//   * each decision is appended to $OTA_NET_LOG (JSON lines).
// ════════════════════════════════════════════════════════════════
const http = require('http');
const https = require('https');
const fs = require('fs');

const MOCK = Number(process.env.OTA_MOCK_PORT || 0);
const LOG = process.env.OTA_NET_LOG || '';
const MAP = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const LOOP = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const log = (o) => { if (LOG) { try { fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...o }) + '\n'); } catch { /* */ } } };

function normalise(args) {
  let url = null; let options = {}; let cb;
  const rest = [...args];
  if (typeof rest[0] === 'string' || rest[0] instanceof URL) { url = new URL(String(rest.shift())); }
  if (rest[0] && typeof rest[0] === 'object') options = rest.shift();
  if (typeof rest[0] === 'function') cb = rest.shift();
  const o = { ...options };
  if (url) { o.protocol = o.protocol || url.protocol; o.hostname = o.hostname || url.hostname; o.port = o.port || url.port || undefined; o.path = o.path || (url.pathname + url.search); }
  o.hostname = o.hostname || (o.host ? String(o.host).split(':')[0] : 'localhost');
  return { o, cb };
}

function patch(mod, name, scheme) {
  const orig = mod.request;
  const wrapped = function (...args) {
    const { o, cb } = normalise(args);
    const host = String(o.hostname).toLowerCase();
    if (LOOP.has(host)) return orig.call(mod, o, cb);
    if (MAP.has(host) && MOCK) {
      log({ via: name, decision: 'mock', host, path: o.path });
      return https.request({ ...o, protocol: 'https:', hostname: '127.0.0.1', host: '127.0.0.1', port: MOCK, servername: host, rejectUnauthorized: false, agent: false,
        headers: { ...(o.headers || {}), Host: host } }, cb);
    }
    log({ via: name, decision: 'BLOCKED', host, path: o.path });
    return orig.call(mod, { ...o, protocol: scheme, hostname: '127.0.0.1', host: '127.0.0.1', port: 1, agent: false }, cb);   // connection refused: nothing leaves the machine
  };
  mod.request = wrapped;
  mod.get = function (...args) { const r = wrapped.apply(this, args); r.end(); return r; };
}
patch(https, 'https', 'https:');
patch(http, 'http', 'http:');
log({ event: 'preload-active', mockPort: MOCK });
