'use strict';
// ════════════════════════════════════════════════════════════════
// cloud-client — the installer's tiny HTTP client for the TexaCore cloud's PUBLIC endpoints (anon key: the plan catalogue and the
// licence-state RPC). One place decides WHERE "the cloud" is, so a release check can point a packaged app at a mock without ever
// touching production:
//
//   prod  — the real project (default)
//   mock  — TEXACORE_CLOUD_MOCK_URL=http://127.0.0.1:<port>, honoured ONLY in an isolated harness run (harnessOk) and ONLY for a
//           loopback http URL — an ordinary install ignores the variable completely
//   off   — a headless harness run with no mock: every cloud call fails fast (the "network is blocked" case)
// ════════════════════════════════════════════════════════════════
const http = require('http');
const https = require('https');

const MOCK_RE = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

/** { kind: 'prod' | 'mock' | 'off', ... } for this process. Pure: the caller passes the environment. */
function resolveTarget({ harnessOk = false, headless = false, env = {}, prod }) {
  const mock = String(env.TEXACORE_CLOUD_MOCK_URL || '');
  if (harnessOk && mock) {
    if (!MOCK_RE.test(mock)) return { kind: 'off', reason: 'TEXACORE_CLOUD_MOCK_URL must be http://127.0.0.1:<port>' };
    const u = new URL(mock);
    return { kind: 'mock', protocol: 'http:', hostname: u.hostname, port: Number(u.port), basePath: '' };
  }
  if (harnessOk && headless) return { kind: 'off', reason: 'headless harness run without a mock cloud' };
  return { kind: 'prod', protocol: 'https:', hostname: prod.hostname, port: 443, basePath: '' };
}

/** Raw request → { status, text }. Rejects on network errors/timeouts (callers treat that as "offline"). */
function request(target, { method = 'GET', path, headers = {}, body, timeout = 10000 }) {
  return new Promise((resolve, reject) => {
    if (!target || target.kind === 'off') { reject(new Error('cloud unreachable (disabled)')); return; }
    const mod = target.protocol === 'http:' ? http : https;
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = mod.request({
      hostname: target.hostname, port: target.port, method, path: target.basePath + path, timeout,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { resolveTarget, request, MOCK_RE };
