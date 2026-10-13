'use strict';
// ════════════════════════════════════════════════════════════════
// mock-github — a local imitation of the parts of GitHub the installer's updaters use, with GitHub's REAL redirect chain:
//
//   github.com/<owner>/<repo>/releases/latest/download/<file>            302 → github.com/<owner>/<repo>/releases/download/<tag>/<file>
//   github.com/<owner>/<repo>/releases/download/<tag>/<file>             302 → objects.githubusercontent.com/github-production-release-asset-2e65be/<id>/<uuid>?<signed query>
//   objects.githubusercontent.com/github-production-release-asset-…/…    200 file bytes (Content-Length, Content-Type: application/octet-stream)
//
// HTTPS with a throw-away self-signed certificate (the test redirects github.com / objects.githubusercontent.com here from OUTSIDE the app —
// scripts/e2e/net-redirect-preload.js). Never reachable from the network: it listens on 127.0.0.1 only.
// A release is { tag, files: { '<asset name>': { path, tamper? } } }; `tamper: true` flips one byte in the middle of that asset when serving it
// (its published sha512 then no longer matches). `latest` names the tag that /releases/latest/download resolves to.
// ════════════════════════════════════════════════════════════════
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const OWNER_REPO = '/feras1960/TexaCore-Installer';

function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockgh-'));
  const key = path.join(dir, 'k.pem'); const crt = path.join(dir, 'c.pem');
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=github.com',
    '-addext', 'subjectAltName=DNS:github.com,DNS:objects.githubusercontent.com,DNS:release-assets.githubusercontent.com,IP:127.0.0.1'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`openssl: ${r.stderr}`);
  const out = { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

function createMockGithub({ port, releases = {}, latest = null, throttleBytesPerSec = 0 } = {}) {
  const state = { releases, latest, requests: [], uuids: new Map() };
  const tls = selfSigned();
  const server = https.createServer(tls, (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const u = new URL(req.url, `https://${host}`);
    const rec = { t: new Date().toISOString(), host, method: req.method, path: u.pathname, status: 0, bytes: 0, ua: req.headers['user-agent'] || '' };
    const done = (status, extra = {}) => { rec.status = status; Object.assign(rec, extra); state.requests.push(rec); };
    const redirect = (to) => { res.writeHead(302, { Location: to, 'Content-Length': 0 }); res.end(); done(302, { location: to }); };

    if (host === 'github.com') {
      let m = new RegExp(`^${OWNER_REPO}/releases/latest/download/(.+)$`).exec(u.pathname);
      if (m) {
        if (!state.latest || !state.releases[state.latest]) { res.writeHead(404); res.end('Not Found'); return done(404); }
        return redirect(`https://github.com${OWNER_REPO}/releases/download/${state.latest}/${m[1]}`);
      }
      m = new RegExp(`^${OWNER_REPO}/releases/download/([^/]+)/(.+)$`).exec(u.pathname);
      if (m) {
        const rel = state.releases[decodeURIComponent(m[1])];
        const name = decodeURIComponent(m[2]);
        if (!rel || !rel.files[name]) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found'); return done(404, { asset: name }); }
        const id = crypto.randomBytes(16).toString('hex');
        state.uuids.set(id, { tag: decodeURIComponent(m[1]), name });
        const q = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=MOCK%2F20261013%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261013T000000Z&X-Amz-Expires=300&X-Amz-Signature=${crypto.randomBytes(32).toString('hex')}&response-content-disposition=attachment%3B%20filename%3D${encodeURIComponent(name)}&response-content-type=application%2Foctet-stream`;
        return redirect(`https://objects.githubusercontent.com/github-production-release-asset-2e65be/1000001/${id}?${q}`);
      }
      res.writeHead(404); res.end('Not Found'); return done(404);
    }
    if (host === 'objects.githubusercontent.com' || host === 'release-assets.githubusercontent.com') {
      const m = /^\/github-production-release-asset-2e65be\/\d+\/([0-9a-f]{32})$/.exec(u.pathname);
      const hit = m && state.uuids.get(m[1]);
      if (!hit) { res.writeHead(403, { 'Content-Type': 'application/xml' }); res.end('<Error><Code>AccessDenied</Code></Error>'); return done(403); }
      const spec = state.releases[hit.tag].files[hit.name];
      let buf = fs.readFileSync(spec.path);
      if (spec.tamper) { buf = Buffer.from(buf); buf[Math.floor(buf.length / 2)] ^= 0x01; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename=${hit.name}` });
      if (!throttleBytesPerSec) { res.end(buf); return done(200, { asset: hit.name, bytes: buf.length, tampered: !!spec.tamper }); }
      let off = 0; const chunk = Math.max(65536, Math.floor(throttleBytesPerSec / 10));
      const tick = () => { if (off >= buf.length) { res.end(); return done(200, { asset: hit.name, bytes: buf.length, tampered: !!spec.tamper }); } res.write(buf.subarray(off, off + chunk)); off += chunk; setTimeout(tick, 100); };
      return tick();
    }
    res.writeHead(404); res.end('unknown host'); done(404);
  });
  return {
    state,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }),
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections && server.closeAllConnections(); }),
    setLatest: (tag) => { state.latest = tag; },
    setRelease: (tag, rel) => { state.releases[tag] = rel; },
  };
}

module.exports = { createMockGithub, OWNER_REPO };
