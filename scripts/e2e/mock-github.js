'use strict';
// ════════════════════════════════════════════════════════════════
// mock-github — a local imitation of the parts of GitHub the installer's updaters use, with GitHub's REAL redirect chain:
//
//   github.com/<owner>/<repo>/releases/latest/download/<file>            302 → github.com/<owner>/<repo>/releases/download/<tag>/<file>
//   github.com/<owner>/<repo>/releases/download/<tag>/<file>             302 → objects.githubusercontent.com/github-production-release-asset-2e65be/<id>/<uuid>?<signed query>
//   objects.githubusercontent.com/github-production-release-asset-…/…    200 / 206 file bytes (Content-Length, ETag, Last-Modified, Accept-Ranges: bytes)
//
// Two modes:
//   default   HTTPS with a throw-away self-signed certificate; the test redirects github.com / objects.githubusercontent.com here from OUTSIDE the app
//             (scripts/e2e/net-redirect-preload.js). Never reachable from the network: it listens on 127.0.0.1 only.
//   plain     { plain: true }: plain HTTP on 127.0.0.1, same chain with absolute Locations on its own address (the CDN is /cdn/<id>) — for in-process unit
//             tests of the updater (test/update-resume.test.js) that need no openssl and no redirect shim.
//
// A release is { tag, files: { '<asset name>': spec } }. spec:
//   path            local file served as the asset
//   tamper          true: flip one byte in the middle of the asset on EVERY request (its published sha512 then never matches)
//   corruptTimes    n: flip that byte only in the first n responses that deliver it (a flaky CDN node; the retry is clean)
//   ignoreRange     true: no Range support at all (Accept-Ranges absent, 200 with the whole file whatever the client asks)
//   faults          [{ at: 0.4, kind: 'drop' }, { at: 0.8, kind: 'drop' }, { at: 0.5, kind: 'stall', ms }]  each fires ONCE, in the first response that reaches the
//                   offset  at × size: 'drop' destroys the socket mid-body; 'stall' stops sending bytes without closing (for ms, default 120 s)
//   bytesPerSec     slow the asset down (chunks of 64 KB paced to this rate) — to catch the client mid-download
//   httpFail        { code: 503, times: 2 }  answer the first `times` data requests with that status
//   etag / lastModified   override the validators (default: derived from the file)
// `latest` names the tag that /releases/latest/download resolves to. `throttleBytesPerSec` (option) is the old global pacing and still works.
// ════════════════════════════════════════════════════════════════
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const OWNER_REPO = '/feras1960/TexaCore-Installer';
const CHUNK = 64 * 1024;

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

function createMockGithub({ port = 0, releases = {}, latest = null, throttleBytesPerSec = 0, plain = false } = {}) {
  const state = { releases, latest, requests: [], uuids: new Map(), faultsFired: new Set(), corrupted: new Map(), failed: new Map(), bufs: new Map() };
  const tls = plain ? null : selfSigned();
  const bufOf = (p) => { let b = state.bufs.get(p); if (!b) { b = fs.readFileSync(p); state.bufs.set(p, b); } return b; };

  /** Serve one asset response (200 / 206 / 416), with the faults of its spec. Resolves when the response is over. */
  async function serveAsset(req, res, hit, spec, rec, done) {
    const key = `${hit.tag}/${hit.name}`;
    rec.asset = hit.name;
    // HTTP failure injection
    if (spec.httpFail) {
      const n = state.failed.get(key) || 0;
      if (n < (spec.httpFail.times || 1)) { state.failed.set(key, n + 1); res.writeHead(spec.httpFail.code || 503, { 'Content-Length': 0 }); res.end(); return done(spec.httpFail.code || 503, { asset: hit.name }); }
    }
    const buf = bufOf(spec.path);
    const total = buf.length;
    const st = fs.statSync(spec.path);
    const etag = spec.etag || `"${crypto.createHash('sha1').update(`${total}:${st.mtimeMs}:${spec.path}`).digest('hex')}"`;
    const lastModified = spec.lastModified || new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString();
    let start = 0; let end = total - 1; let status = 200;
    rec.range = req.headers.range || null; rec.ifRange = req.headers['if-range'] || null;
    const m = !spec.ignoreRange && req.headers.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null;
    if (m) {
      const ifRange = req.headers['if-range'];
      if (!ifRange || ifRange === etag || ifRange === lastModified) {
        const s = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]);
        const e = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), total - 1) : total - 1;
        if (s >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Content-Length': 0 }); res.end(); return done(416, { asset: hit.name, start: s }); }
        start = s; end = e; status = 206;
      }
    }
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, 'Content-Disposition': `attachment; filename=${hit.name}`, ETag: etag, 'Last-Modified': lastModified };
    if (!spec.ignoreRange) headers['Accept-Ranges'] = 'bytes';
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    res.writeHead(status, headers);
    rec.start = start; rec.end = end;

    // the next fault this response reaches
    let fault = null;
    (spec.faults || []).forEach((f, i) => {
      const id = `${key}#${i}`;
      if (fault || state.faultsFired.has(id)) return;
      const off = Math.floor(f.at * total);
      if (off <= start) { state.faultsFired.add(id); return; }          // the client is already past it
      if (off <= end + 1) fault = { ...f, off, id };                      // consumed only when it really fires (a client that goes away earlier — a pause — leaves it for the next response)
    });
    const flipAt = Math.floor(total / 2);
    const flips = () => {
      if (spec.tamper) return true;
      const used = state.corrupted.get(key) || 0;
      if ((spec.corruptTimes || 0) > used) { state.corrupted.set(key, used + 1); return true; }
      return false;
    };
    const bps = spec.bytesPerSec || throttleBytesPerSec || 0;
    let closed = false;
    res.on('close', () => { closed = true; });

    let pos = start; let sent = 0; let flipped = false;
    const stopAt = fault ? fault.off : end + 1;
    while (pos < stopAt && !closed) {
      let chunk = buf.subarray(pos, Math.min(pos + CHUNK, stopAt));
      if (!flipped && flipAt >= pos && flipAt < pos + chunk.length && flips()) {
        chunk = Buffer.from(chunk); chunk[flipAt - pos] ^= 0x01; rec.tampered = true; flipped = true;
      }
      const ok = res.write(chunk);
      pos += chunk.length; sent += chunk.length;
      if (!ok) await new Promise((r) => { const t = setTimeout(r, 2000); res.once('drain', () => { clearTimeout(t); r(); }); });
      if (bps) await new Promise((r) => setTimeout(r, Math.max(1, Math.round((chunk.length / bps) * 1000))));
    }
    if (fault && pos >= stopAt && !closed) {
      state.faultsFired.add(fault.id);
      rec.fault = fault.kind;
      // let everything written so far reach the client first: a destroy() with bytes still queued would drop them and make the offsets of a test fuzzy
      for (let i = 0; i < 200 && res.socket && res.socket.writableLength > 0; i++) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 25));
      if (fault.kind === 'stall') {
        await new Promise((r) => { const t = setTimeout(r, fault.ms || 120000); res.once('close', () => { clearTimeout(t); r(); }); });
      }
      try { req.socket.destroy(); } catch { /* gone */ }
      return done(status, { asset: hit.name, bytes: sent, faulted: fault.kind });
    }
    if (closed) return done(status, { asset: hit.name, bytes: sent, aborted: true });
    res.end();
    return done(status, { asset: hit.name, bytes: sent, tampered: !!rec.tampered });
  }

  const handler = (req, res) => {
    const hostHeader = String(req.headers.host || '');
    const u = new URL(req.url, `http://${hostHeader || 'github.com'}`);
    const cdnPath = plain ? /^\/cdn\/([0-9a-f]{32})$/ : /^\/github-production-release-asset-2e65be\/\d+\/([0-9a-f]{32})$/;
    const host = plain ? (cdnPath.test(u.pathname) ? 'objects.githubusercontent.com' : 'github.com') : hostHeader.split(':')[0];
    const ghBase = plain ? `http://${hostHeader}` : 'https://github.com';
    const rec = { t: new Date().toISOString(), host, method: req.method, path: u.pathname, status: 0, bytes: 0, ua: req.headers['user-agent'] || '' };
    let finished = false;
    const done = (status, extra = {}) => { if (finished) return; finished = true; rec.status = status; Object.assign(rec, extra); };
    state.requests.push(rec);
    const redirect = (to) => { res.writeHead(302, { Location: to, 'Content-Length': 0 }); res.end(); done(302, { location: to }); };

    if (host === 'github.com') {
      let m = new RegExp(`^${OWNER_REPO}/releases/latest/download/(.+)$`).exec(u.pathname);
      if (m) {
        if (!state.latest || !state.releases[state.latest]) { res.writeHead(404); res.end('Not Found'); return done(404); }
        return redirect(`${ghBase}${OWNER_REPO}/releases/download/${state.latest}/${m[1]}`);
      }
      m = new RegExp(`^${OWNER_REPO}/releases/download/([^/]+)/(.+)$`).exec(u.pathname);
      if (m) {
        const rel = state.releases[decodeURIComponent(m[1])];
        const name = decodeURIComponent(m[2]);
        if (!rel || !rel.files[name]) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found'); return done(404, { asset: name }); }
        const id = crypto.randomBytes(16).toString('hex');
        state.uuids.set(id, { tag: decodeURIComponent(m[1]), name });
        const q = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=MOCK%2F20261013%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261013T000000Z&X-Amz-Expires=300&X-Amz-Signature=${crypto.randomBytes(32).toString('hex')}&response-content-disposition=attachment%3B%20filename%3D${encodeURIComponent(name)}&response-content-type=application%2Foctet-stream`;
        return redirect(plain ? `${ghBase}/cdn/${id}?${q}` : `https://objects.githubusercontent.com/github-production-release-asset-2e65be/1000001/${id}?${q}`);
      }
      res.writeHead(404); res.end('Not Found'); return done(404);
    }
    if (host === 'objects.githubusercontent.com' || host === 'release-assets.githubusercontent.com') {
      const m = cdnPath.exec(u.pathname);
      const hit = m && state.uuids.get(m[1]);
      if (!hit) { res.writeHead(403, { 'Content-Type': 'application/xml' }); res.end('<Error><Code>AccessDenied</Code></Error>'); return done(403); }
      const spec = state.releases[hit.tag].files[hit.name];
      serveAsset(req, res, hit, spec, rec, done).catch(() => { try { req.socket.destroy(); } catch { /* gone */ } done(rec.status || 500); });
      return undefined;
    }
    res.writeHead(404); res.end('unknown host'); done(404);
  };
  const server = plain ? http.createServer(handler) : https.createServer(tls, handler);
  return {
    state,
    server,
    get port() { return server.address() && server.address().port; },
    get base() { return `http://127.0.0.1:${server.address().port}`; },
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }),
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections && server.closeAllConnections(); }),
    setLatest: (tag) => { state.latest = tag; },
    setRelease: (tag, rel) => { state.releases[tag] = rel; },
    /** the requests that carried (or tried to carry) asset bytes — not the redirect hops, not the feed file (or only those of `name`) */
    dataRequests: (name) => state.requests.filter((r) => r.asset && r.status !== 302 && r.status !== 404 && (name ? r.asset === name : !/\.ya?ml$/.test(r.asset))),
    resetFaults: () => { state.faultsFired.clear(); state.corrupted.clear(); state.failed.clear(); },
  };
}

module.exports = { createMockGithub, OWNER_REPO };
