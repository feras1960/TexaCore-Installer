#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// tunnel-check — Cloud Access with the REAL bundled cloudflared and a FAKE token (the launch checks stub the tunnel everywhere else).
// 2.0.0 shipped no cloudflared on macOS: the public link answered Cloudflare error 1033 while the launcher said «connected». This proves, on the PACKAGED app
// (isolated userData + port block; no TexaCore cloud call: the saved token is reused, DNS verification is skipped):
//
//   T1  the bundled binary is used (path inside the app) and RUNS; a MALFORMED token → the process exits (255) and the launcher says ERROR (token invalid), never «connected»
//   T2  the tunnel events are in the app log (start, version, exit code, reason) and the token is in NO log file
//   T3  a well-formed token the edge REFUSES: the real process runs, its command line carries no token, the state goes starting → error (token refused), never connected,
//       the window shows the error + the redacted detail; turning cloud access OFF stops the process
//   T4  a connector that cannot run (a stand-in file without the execute bit) → error binary_unrunnable, shown in the window
//   T5  no cloudflared is left behind after the app stops
//   — 2.0.2: «connected» means the PUBLIC LINK reaches this process (the field bug: connected for hours while the name answered Cloudflare 1033). A stand-in cloudflared REGISTERS
//     connections; a mock «edge» (TEXACORE_TUNNEL_PROBE_BASE) answers like Cloudflare does for a name that routes to nobody (530 / error 1033) or proxies to the app's web server with the
//     headers the tunnel adds; a mock register-subdomain (TEXACORE_REGISTER_URL) answers every code. NOTHING real is contacted: no register-subdomain, no Cloudflare.
//   T6  the connector is healthy but the link does not route: state never «connected» — route_mismatch (1033/530) → the automatic once-per-start repair is told SUBDOMAIN_TAKEN → name_taken;
//       the launcher says so in words, offers «إصلاح الرابط» and the subdomain field; no repair loop
//   T7  the repair button: re-registers with the REAL hardware id, saves the token (0600), restarts the connector with it, proves the route → «connected»
//   T8  the probe over the tunnel (Cf-* headers): `texacore-probe:<nonce>:<bootId>` and nothing else; /api/* and /config.js stay closed to it
//   T9  another target answers → route_mismatch (wrong_target); a hanging edge → connected_unverified (cannot verify, NOT a mismatch); recovery → connected
//   T10 every register-subdomain refusal (DEVICE_PROOF_REQUIRED, HARDWARE_MISMATCH, CLOUDFLARE_ERROR, RATE_LIMITED) has its own message, one call, no loop; RATE_LIMITED throttles the button
//   (T3 contacts Cloudflare's public edge with the fake token — that is what cloudflared does; nothing of TexaCore's is contacted)
//
//   node scripts/e2e/tunnel-check.js --workdir <empty dir> --app <packaged .app>
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { PORTS, Results, portFree, request, startApp, stopApp } = require('./lib');
const pin = require('../lib/cloudflared-pin');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '');
if (!arg('workdir')) { console.error('--workdir is required (and --app <packaged .app>; without it the check runs the dev checkout)'); process.exit(2); }
const appPath = APP ? path.resolve(APP) : path.join(__dirname, '..', '..');
const binary = APP ? path.join(appPath, 'Contents', 'MacOS', path.basename(appPath, '.app')) : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAKE_WELL_FORMED = Buffer.from(JSON.stringify({ a: '0123456789abcdef0123456789abcdef', t: '11111111-2222-3333-4444-555555555555', s: 'c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0' })).toString('base64');
const MALFORMED = 'this-is-not-a-tunnel-token-0123456789';

const children = (ppid) => {
  const out = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n');
  return out.map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], cmd: m[3] })).filter((p) => p.ppid === ppid);
};
const allProcs = () => spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], cmd: m[3] }));
// only THIS run's connectors (the app under test): another TexaCore on the machine may legitimately run its own
const allCloudflared = () => allProcs().filter((p) => /(^|\/)cloudflared( |$)/.test(p.cmd) && p.cmd.startsWith(appPath)).map((p) => `${p.pid} ${p.cmd}`);

async function runCase(name, { token, extraEnv = {}, work, subdomain = 'e2e-fake-tunnel' }, body) {
  const userData = path.join(work, 'userdata');
  const dd = path.join(userData, 'texacore-data');
  fs.mkdirSync(dd, { recursive: true });
  fs.writeFileSync(path.join(dd, 'config.json'), JSON.stringify({ enableCloud: true, subdomain, tunnelToken: token }));
  const logFile = path.join(work, 'app.log');
  const shots = path.join(work, 'shots'); fs.mkdirSync(shots, { recursive: true });
  const { child, ready } = startApp({ userData, logFile, appBinary: binary, extraEnv: { TEXACORE_STUB_TUNNEL: '0', TEXACORE_TUNNEL_SKIP_DNS: '1', TEXACORE_UI_SMOKE: '1', TEXACORE_SHOT_DIR: shots, ...extraEnv } });
  child.on('error', () => {});
  try {
    await ready;
    const secrets = JSON.parse(fs.readFileSync(path.join(dd, 'secrets.json'), 'utf8'));
    const H = { 'x-texacore-local-secret': secrets.localApiSecret };
    const ev = async (b) => { const r = await request('POST', `http://127.0.0.1:${PORTS.admin}/api/ui-eval`, { headers: H, body: b }); if (!r.json || !r.json.ok) throw new Error(`ui-eval: ${r.text.slice(0, 300)}`); return r.json; };
    const js = async (code) => (await ev({ js: code })).result;
    await ev({ size: [900, 1500] });
    const logPath = path.join(dd, '..', 'logs', 'heartbeat.log');
    const readHb = () => { try { return fs.readFileSync(logPath, 'utf8'); } catch { return ''; } };
    const tunnel = () => js(`texacore.getState().then((s) => s.tunnel)`);
    const until = async (fn, ms, what) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(400); } };
    return await body({ child, userData, dd, ev, js, tunnel, until, readHb, logFile, shots });
  } finally {
    await stopApp(child, userData);
  }
}

// ─── 2.0.2: the public-link proof, against mocks (never the real register-subdomain / Cloudflare) ───
const EDGE_PORT = 47398; const REG_PORT = 47399;
const CF_1033 = '<!DOCTYPE html><html><head><title>Cloudflare Tunnel error | e2e-route.texacore.ai | Cloudflare</title></head><body><h1>Error 1033</h1><p>Argo Tunnel error</p></body></html>';
const FAKE_NEW_TOKEN = Buffer.from(JSON.stringify({ a: 'fedcba9876543210fedcba9876543210', t: '99999999-2222-3333-4444-555555555555', s: 'bmV3c2VjcmV0bmV3c2VjcmV0bmV3c2VjcmV0' })).toString('base64');
function startMocks() {
  const w = { edgeMode: 'no_route', regMode: 'taken', edgeHits: [], regHits: [], pending: new Set(), lastProxied: '' };
  const edge = http.createServer((req, res) => {
    w.edgeHits.push({ url: req.url, mode: w.edgeMode, at: Date.now() });
    if (!req.url.startsWith('/__texacore/tunnel-probe/')) { res.writeHead(404); return res.end('nf'); }
    if (w.edgeMode === 'no_route') { res.writeHead(530, { 'Content-Type': 'text/html' }); return res.end(CF_1033); }      // Cloudflare's answer for a name that routes to no tunnel of ours
    if (w.edgeMode === 'hang') { w.pending.add(res); req.on('close', () => w.pending.delete(res)); return; }
    // the request as the tunnel delivers it to the app's web server (Cloudflare adds Cf-*, Cdn-Loop, X-Forwarded-*)
    const up = http.request({ host: '127.0.0.1', port: PORTS.ui, path: req.url, method: 'GET', agent: false,
      headers: { Host: 'e2e-route.texacore.ai', 'Cf-Ray': '8f00-FRA', 'Cf-Connecting-Ip': '203.0.113.9', 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https', 'Cdn-Loop': 'cloudflare' } }, (r) => {
      let b = ''; r.on('data', (c) => { b += c; });
      r.on('end', () => { w.lastProxied = b; if (w.edgeMode === 'wrong_boot') b = b.replace(/:[0-9a-f]{16}$/, ':0000000000000000'); res.writeHead(r.statusCode, { 'Content-Type': 'text/plain' }); res.end(b); });
    });
    up.on('error', () => { res.writeHead(502); res.end('bad gateway'); }); up.end();
  });
  const reg = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(b); } catch { /* none */ }
      w.regHits.push({ body, mode: w.regMode, at: Date.now() });
      const send = (st, o, h = {}) => { res.writeHead(st, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
      switch (w.regMode) {
        case 'taken': return send(409, { success: false, code: 'SUBDOMAIN_TAKEN', error: 'This subdomain is already taken' });
        case 'device': return send(403, { success: false, code: 'DEVICE_PROOF_REQUIRED', error: 'x' });
        case 'hw': return send(403, { success: false, code: 'HARDWARE_MISMATCH', error: 'x' });
        case 'cf': return send(502, { success: false, code: 'CLOUDFLARE_ERROR', error: 'x' });
        case 'rate': return send(429, { success: false, code: 'RATE_LIMITED', error: 'x', scope: 'license', retry_after_seconds: 120 }, { 'Retry-After': '120' });
        case 'ok': w.edgeMode = 'proxy'; return send(200, { success: true, tunnel_token: FAKE_NEW_TOKEN, url: 'https://e2e-route.texacore.ai' });     // the name now routes to the NEW tunnel
        default: return send(500, { success: false, code: 'SERVER_ERROR' });
      }
    });
  });
  return Promise.all([new Promise((r) => edge.listen(EDGE_PORT, '127.0.0.1', r)), new Promise((r) => reg.listen(REG_PORT, '127.0.0.1', r))]).then(() => ({
    w, close: () => { for (const x of w.pending) { try { x.destroy(); } catch { /* gone */ } } edge.close(); reg.close(); if (edge.closeAllConnections) edge.closeAllConnections(); if (reg.closeAllConnections) reg.closeAllConnections(); },
  }));
}
const routeEnv = (rec) => ({
  TEXACORE_CLOUDFLARED_BIN: path.join(__dirname, 'fake-cloudflared-connected.js'), FAKE_CF_OUT: rec,
  TEXACORE_TUNNEL_PROBE_BASE: `http://127.0.0.1:${EDGE_PORT}`, TEXACORE_REGISTER_URL: `http://127.0.0.1:${REG_PORT}/register`,
  TEXACORE_TUNNEL_PROBE_TIMING: JSON.stringify({ schedule: [0, 300, 600, 900], quick: [0, 300], recheckMs: 4000, timeoutMs: 1500, repairWaitMs: 25000 }),
});
const WIN = `(() => { const g = (id) => document.getElementById(id);
  const cs = (id) => { const e = g(id); return e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' ? 'block' : 'none'; };    // REALLY visible: an element inside a hidden ancestor has no client rects
  return { status: g('tunnel-status').textContent.trim(), state: g('tunnel-status').dataset.tunnelState, route: g('tunnel-route-msg').textContent.trim(), repair: g('tunnel-repair-msg').textContent.trim(),
    box: cs('tunnel-fix-box'), button: cs('btn-fix-link'), repairShown: cs('tunnel-repair-msg'), setup: cs('cloud-setup'), active: cs('cloud-active') }; })()`;

(async () => {
  const R = new Results();
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  for (const p of [...Object.values(PORTS), EDGE_PORT, REG_PORT]) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  if (allCloudflared().length) { console.error('a cloudflared is already running — stop it first:\n' + allCloudflared().join('\n')); process.exit(2); }
  const evidence = {};
  const bundled = APP ? path.join(appPath, 'Contents', 'Resources', 'bin', 'cloudflared', 'cloudflared') : pin.mac.repoPath;

  // ── A: a malformed token ──
  const wA = path.join(WORK, 'A-malformed');
  await runCase('A', { token: MALFORMED, work: wA }, async (c) => {
    await R.check('T1 the bundled cloudflared (inside the app) is used and runs; a MALFORMED token ends the process and the launcher says ERROR — never «connected»', async () => {
      if (!fs.existsSync(bundled)) throw new Error('the packaged app has no bin/cloudflared/cloudflared');
      const snap = await c.until(async () => { const t = await c.tunnel(); return t && t.state === 'error' ? t : null; }, 60000, 'the error state');
      if (snap.reason !== 'token_invalid') throw new Error(`reason ${snap.reason} (${snap.detail})`);
      if (snap.everConnected) throw new Error('it claims to have connected');
      await c.js(`document.getElementById('tunnel-status').scrollIntoView({ block: 'center' })`);
      await sleep(5500);                                                            // the window polls the state (1.5 s while not connected)
      const w = await c.js(`({ icon: (document.querySelector('#tunnel-status use') || { getAttribute: () => '' }).getAttribute('href'), text: document.getElementById('tunnel-status').textContent, state: document.getElementById('tunnel-status').dataset.tunnelState, detail: document.getElementById('tunnel-detail').textContent })`);
      await c.ev({ shot: 'T1-malformed-token.png', wait: 300 });
      if (!/^error:token_invalid$/.test(w.state) || w.icon !== '#i-circle-x' || !w.text.trim()) throw new Error(`window shows ${JSON.stringify(w)}`);
      const log = c.readHb();
      if (!log.includes(`cloudflared ${pin.version} (${bundled})`)) throw new Error('the app log does not show the bundled binary being started');
      evidence.malformed = { snap, window: w };
      return `bundled ${pin.version} started from ${path.relative(appPath, bundled)}; state error:token_invalid (exit ${snap.exitCode}); the window shows "${w.text}" — not connected`;
    });
    await R.check('T2 the tunnel events are in the app log (start, version, exit code, reason) and the token is in NO log file', async () => {
      const log = c.readHb();
      for (const re of [/\[Tunnel\] starting Cloudflare tunnel for e2e-fake-tunnel\.texacore\.ai — cloudflared /, /\[cloudflared\] Provided Tunnel token is not valid/, /\[Tunnel\] cloudflared exited — code 255/]) {
        if (!re.test(log)) throw new Error(`log lacks ${re}`);
      }
      const hits = [];
      const scan = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (f.name !== 'pgdata') scan(p); } else if (/\.(log|json|txt)$/.test(f.name) || f.name === 'config.json') { if (fs.readFileSync(p, 'utf8').includes(MALFORMED) && f.name !== 'config.json') hits.push(p); } } };
      scan(path.join(c.dd, '..'));
      if (fs.readFileSync(c.logFile, 'utf8').includes(MALFORMED)) hits.push(c.logFile);
      if (hits.length) throw new Error(`the token appears in: ${hits.join(', ')}`);
      return 'start / version / exit code 255 / «Provided Tunnel token is not valid» are in heartbeat.log; the token is in no log (config.json holds it by design, 0600)';
    });
  });

  // ── B: a well-formed token the edge refuses (real process) ──
  const wB = path.join(WORK, 'B-refused');
  await runCase('B', { token: FAKE_WELL_FORMED, work: wB }, async (c) => {
    let cfPid = null;
    await R.check('T3 a token the edge REFUSES: the real process runs with no token on its command line, the state goes starting → error (refused), never connected, and switching cloud access off stops it', async () => {
      const seen = new Set();
      const snap = await c.until(async () => {
        const t = await c.tunnel(); if (t) seen.add(t.state);
        const kids = (APP ? children(c.child.pid) : allProcs()).filter((p) => /(^|\/)cloudflared( |$)/.test(p.cmd));
        if (kids.length && !cfPid) { cfPid = kids[0].pid; evidence.cfCmd = kids[0].cmd; }
        return t && t.state === 'error' ? t : null;
      }, 90000, 'the refusal');
      if (snap.reason !== 'token_rejected') throw new Error(`reason ${snap.reason}: ${snap.detail}`);
      if (seen.has('connected') || snap.everConnected) throw new Error('it claims to have connected');
      if (!cfPid) throw new Error('never saw the cloudflared process as a child of the app');
      if (evidence.cfCmd.includes(FAKE_WELL_FORMED) || /--token/.test(evidence.cfCmd)) throw new Error(`the token is on the command line: ${evidence.cfCmd}`);
      if (!evidence.cfCmd.includes(bundled)) throw new Error(`the process is not the bundled binary: ${evidence.cfCmd}`);
      await sleep(5500);
      const w = await c.js(`({ icon: (document.querySelector('#tunnel-status use') || { getAttribute: () => '' }).getAttribute('href'), text: document.getElementById('tunnel-status').textContent, state: document.getElementById('tunnel-status').dataset.tunnelState, detail: document.getElementById('tunnel-detail').textContent })`);
      await c.ev({ shot: 'T3-token-refused-en.png', wait: 300 });
      if (w.state !== 'error:token_rejected' || w.icon === '#i-circle-check') throw new Error(`window shows ${JSON.stringify(w)}`);
      if (w.detail.includes(FAKE_WELL_FORMED)) throw new Error('the detail line shows the token');
      // the same in Arabic
      await c.js(`(() => { const s = document.getElementById('lang-select'); s.value = 'ar'; onLangChange(); })()`); await sleep(700);
      await c.ev({ shot: 'T3-token-refused-ar.png', wait: 300 });
      // switching cloud access off stops the process
      await c.js(`texacore.setCloudAccess(false)`); await sleep(3500);
      let alive = true; try { process.kill(cfPid, 0); } catch { alive = false; }
      const after = await c.tunnel();
      if (alive) throw new Error('cloudflared is still running after cloud access was switched off');
      if (after.state !== 'off') throw new Error(`state after off: ${after.state}`);
      evidence.refused = { states: [...seen], reason: snap.reason, window: w, cmd: evidence.cfCmd };
      return `states seen: ${[...seen].join(' → ')}; error:token_refused with "${snap.detail.slice(0, 80)}…"; command line "${evidence.cfCmd.replace(appPath, '<app>')}" (no token); the window shows "${w.text}"; after «off» the process is gone and the state is off`;
    });
  });

  // ── C: a connector that cannot run ──
  const wC = path.join(WORK, 'C-unrunnable');
  const standIn = path.join(wC, 'not-executable-cloudflared'); fs.mkdirSync(wC, { recursive: true }); fs.writeFileSync(standIn, '#!/bin/sh\necho nope\n'); fs.chmodSync(standIn, 0o644);
  await runCase('C', { token: FAKE_WELL_FORMED, work: wC, extraEnv: { TEXACORE_CLOUDFLARED_BIN: standIn } }, async (c) => {
    await R.check('T4 a connector that cannot run → error binary_unrunnable, shown in the window (not «connected»)', async () => {
      const snap = await c.until(async () => { const t = await c.tunnel(); return t && t.state === 'error' ? t : null; }, 60000, 'the error state');
      if (snap.reason !== 'binary_unrunnable') throw new Error(`reason ${snap.reason}`);
      await sleep(5500);
      const w = await c.js(`({ icon: (document.querySelector('#tunnel-status use') || { getAttribute: () => '' }).getAttribute('href'), text: document.getElementById('tunnel-status').textContent, state: document.getElementById('tunnel-status').dataset.tunnelState })`);
      await c.ev({ shot: 'T4-binary-unrunnable.png', wait: 300 });
      if (w.state !== 'error:binary_unrunnable' || w.icon === '#i-circle-check') throw new Error(`window shows ${JSON.stringify(w)}`);
      if (!/\[Tunnel\] ❌ cloudflared cannot run/.test(c.readHb())) throw new Error('not in the app log');
      return `state error:binary_unrunnable; window "${w.text}"; logged`;
    });
  });

  // ── D: the connector is healthy, the PUBLIC LINK does not route (the 2.0.1 field bug) ──
  const mocks = await startMocks();
  const recD = path.join(WORK, 'D-route', 'fake-cloudflared.json');
  fs.mkdirSync(path.dirname(recD), { recursive: true });
  const NAME = 'e2e-route';
  try {
    await runCase('D', { token: FAKE_WELL_FORMED, work: path.join(WORK, 'D-route'), subdomain: NAME, extraEnv: routeEnv(recD) }, async (c) => {
      const seen = new Set(); const sawConnected = () => seen.has('connected');
      const poll = async () => { const t = await c.tunnel(); if (t) seen.add(t.state); return t; };
      let tnD = null;
      await R.check('T6 the connector is healthy but the link does not route: never «connected» — route_mismatch (Cloudflare 530 / 1033), then the automatic once-per-start repair is told SUBDOMAIN_TAKEN → name_taken, in words, with «إصلاح الرابط» and the subdomain field; no repair loop', async () => {
        tnD = await c.until(async () => { const t = await poll(); return t && t.state === 'name_taken' ? t : null; }, 90000, 'name_taken');
        if (sawConnected()) throw new Error(`«connected» was shown (states: ${[...seen].join(' → ')})`);
        if (tnD.connector !== 'connected') throw new Error(`the connector should be healthy (registered), it is ${tnD.connector}`);
        if (tnD.route.state !== 'mismatch' || tnD.route.http !== 530 || tnD.route.cfError !== 1033) throw new Error(`route ${JSON.stringify(tnD.route)}`);
        if (!tnD.repair || tnD.repair.outcome !== 'taken' || tnD.repair.trigger !== 'auto') throw new Error(`repair ${JSON.stringify(tnD.repair)}`);
        await sleep(3500);
        if (mocks.w.regHits.length !== 1) throw new Error(`register-subdomain was called ${mocks.w.regHits.length} times (the automatic repair runs ONCE per start, no loop)`);
        await c.js(`document.getElementById('tunnel-status').scrollIntoView({ block: 'center' })`); await sleep(5600);
        const en = await c.js(WIN);
        if (en.state !== 'name_taken:taken' || !/reserved for a previous licence/.test(en.route) || en.button === 'none' || en.setup === 'none') throw new Error(`window (en) ${JSON.stringify(en)}`);
        await c.ev({ shot: 'T6-name-taken-en.png', wait: 300 });
        await c.js(`(() => { const s = document.getElementById('lang-select'); s.value = 'ar'; onLangChange(); })()`); await sleep(5600);
        const ar = await c.js(WIN);
        if (!/محجوز لترخيص سابق/.test(ar.route) || ar.status === en.status) throw new Error(`window (ar) ${JSON.stringify(ar)}`);
        await c.ev({ shot: 'T6-name-taken-ar.png', wait: 300 });
        for (const lang of ['ru', 'uk']) { await c.js(`(() => { const s = document.getElementById('lang-select'); s.value = '${lang}'; onLangChange(); })()`); await sleep(5600); const w = await c.js(WIN); if (!w.route || /^cloud\./.test(w.route) || w.route === en.route) throw new Error(`window (${lang}) ${JSON.stringify(w)}`); }
        await c.js(`(() => { const s = document.getElementById('lang-select'); s.value = 'en'; onLangChange(); })()`);
        evidence.nameTaken = { states: [...seen], route: tnD.route, repair: tnD.repair, en, ar };
        return `states: ${[...seen].join(' → ')} (connector registered ${tnD.connector}); route mismatch HTTP ${tnD.route.http} / Cloudflare ${tnD.route.cfError}; auto repair → ${tnD.repair.outcome}; 1 register call after 3.5 s more; window "${en.status}" + "${en.route}" (button + subdomain field visible); ar/ru/uk texts differ`;
      });

      await R.check('T7 «إصلاح الرابط»: re-registers with the REAL hardware id (never the hostname), saves the new token (0600), restarts the connector with it, proves the route → «connected»', async () => {
        mocks.w.regMode = 'ok';
        const before = mocks.w.regHits.length;
        const res = await c.js(`texacore.repairTunnelLink()`);
        if (!res || res.outcome !== 'fixed' || !res.success) throw new Error(`repair → ${JSON.stringify(res).slice(0, 300)}`);
        const hit = mocks.w.regHits[before];
        if (!hit || mocks.w.regHits.length !== before + 1) throw new Error('the repair did not make exactly one register call');
        const body = hit.body;
        if (body.subdomain !== NAME || !body.machineId || body.machineId === os.hostname() || body.hostname !== os.hostname() || !body.licenseKey) throw new Error(`register body ${JSON.stringify(body)}`);
        const cfgPath = path.join(c.dd, 'config.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (cfg.tunnelToken !== FAKE_NEW_TOKEN || cfg.enableCloud !== true) throw new Error('the new token was not saved');
        if ((fs.statSync(cfgPath).mode & 0o777) !== 0o600) throw new Error(`config.json mode ${(fs.statSync(cfgPath).mode & 0o777).toString(8)}`);
        const runs = JSON.parse(fs.readFileSync(recD, 'utf8')).runs;
        const last = runs[runs.length - 1];
        if (last.tunnelToken !== FAKE_NEW_TOKEN || last.argv.join(' ').includes(FAKE_NEW_TOKEN) || runs.length < 2) throw new Error(`connector runs ${JSON.stringify(runs.map((r) => [r.tunnelToken === FAKE_NEW_TOKEN, r.argv]))}`);
        const t = await c.until(async () => { const x = await poll(); return x && x.state === 'connected' ? x : null; }, 30000, 'connected');
        if (t.nameTaken || t.repair.outcome !== 'fixed') throw new Error(`status ${JSON.stringify({ r: t.repair, n: t.nameTaken })}`);
        await sleep(5600);
        const w = await c.js(WIN);
        if (w.state !== 'connected' || w.button !== 'none') throw new Error(`window ${JSON.stringify(w)}`);
        await c.ev({ shot: 'T7-repaired-connected-en.png', wait: 300 });
        evidence.repaired = { body: { ...body, licenseKey: '<kept>' }, runs: runs.length, window: w };
        return `outcome fixed; register body machineId ${String(body.machineId).slice(0, 8)}… (hostname ${os.hostname()} not used); token saved (0600); connector restarted ${runs.length}x, last with the new token in its environment only; state «connected» after the probe matched; window "${w.status}"`;
      });

      await R.check('T8 the probe over the tunnel (Cf-* headers, forged public Host): `texacore-probe:<nonce>:<bootId>` and NOTHING else; /api/* and /config.js stay closed to the tunnel', async () => {
        const hdr = { Host: 'e2e-route.texacore.ai', 'Cf-Ray': '8f00-FRA', 'Cf-Connecting-Ip': '203.0.113.9', 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https', 'Cdn-Loop': 'cloudflare' };
        const get = (p) => request('GET', `http://127.0.0.1:${PORTS.ui}${p}`, { headers: hdr });
        const ok = await get('/__texacore/tunnel-probe/abcdef0123456789');
        if (ok.status !== 200 || !/^texacore-probe:abcdef0123456789:[0-9a-f]{16}$/.test(ok.text) || ok.headers['set-cookie'] || !/no-store/.test(ok.headers['cache-control'] || '')) throw new Error(`probe → ${ok.status} ${ok.text.slice(0, 120)} ${JSON.stringify(ok.headers).slice(0, 200)}`);
        const bad = await get('/__texacore/tunnel-probe/x');
        if (bad.status !== 404 || bad.text !== 'not found') throw new Error(`bad nonce → ${bad.status} ${bad.text.slice(0, 80)}`);
        const hits = mocks.w.regHits.length;
        const fix = await get('/api/tunnel-fix');
        if (fix.status !== 403 || mocks.w.regHits.length !== hits) throw new Error(`/api/tunnel-fix over the tunnel → ${fix.status} (register calls ${mocks.w.regHits.length - hits})`);
        const cfg = await get('/config.js');
        if (/localApiSecret\s*:\s*"[0-9a-f]{16,}"/.test(cfg.text)) throw new Error('config.js hands the admin secret to the tunnel');
        const again = await get('/__texacore/tunnel-probe/abcdef0123456789');
        if (again.text !== ok.text) throw new Error('the bootId changed between two probes of one process');
        return `probe 200 "${ok.text.slice(0, 20)}…${ok.text.slice(-17)}" (no cookie, no-store); bad nonce 404; /api/tunnel-fix 403 over the tunnel (no register call); config.js without the admin secret; same bootId twice`;
      });

      await R.check('T9 another target answers → route_mismatch (wrong_target); a hanging edge → connected_unverified (cannot verify — NOT a mismatch, no repair button); the way back → connected', async () => {
        const phase = async (mode, want, ms) => { mocks.w.edgeMode = mode; const seenIn = new Set(); const t = await c.until(async () => { const x = await poll(); if (x) seenIn.add(x.state); return x && x.state === want ? x : null; }, ms, `${want} (edge ${mode})`); return { t, seenIn }; };
        const a = await phase('wrong_boot', 'route_mismatch', 40000);
        if (a.t.reason !== 'wrong_target') throw new Error(`reason ${a.t.reason}`);
        await sleep(5600); const wa = await c.js(WIN);
        if (wa.state !== 'route_mismatch:wrong_target' || wa.button === 'none') throw new Error(`window ${JSON.stringify(wa)}`);
        await c.ev({ shot: 'T9-route-mismatch-en.png', wait: 300 });
        const b = await phase('hang', 'connected_unverified', 60000);
        if (b.t.reason !== 'timeout' || b.t.route.state !== 'unverified' || b.t.route.http !== null) throw new Error(`hang → ${b.t.reason} / route ${JSON.stringify(b.t.route)} (a timeout is «cannot verify», never a mismatch)`);
        await sleep(5600); const wb = await c.js(WIN);
        if (wb.state !== 'connected_unverified:timeout' || wb.button !== 'none') throw new Error(`window ${JSON.stringify(wb)}`);
        await c.ev({ shot: 'T9-connected-unverified-en.png', wait: 300 });
        const d = await phase('proxy', 'connected', 60000);
        if (d.t.route.state !== 'verified') throw new Error('connected without a verified route');
        return 'wrong bootId → route_mismatch/wrong_target (button shown); edge hangs → connected_unverified/timeout (no button, never route_mismatch); edge answers again → connected (verified)';
      });
    });
  } finally { /* the mocks stay up for the refusal cases below */ }

  // ── E: every refusal of register-subdomain, each in its own run (the automatic repair makes the single call) ──
  const refusals = [
    ['device', 'device_proof', /bound to a device and this computer's identity was not accepted/],
    ['hw', 'hardware_mismatch', /bound to another computer/],
    ['cf', 'cloudflare_error', /Cloudflare could not create the link/],
    ['rate', 'rate_limited', /try again in 2 minute/],
  ];
  await R.check('T10 every register-subdomain refusal has its own message in the launcher, exactly one call and no loop (DEVICE_PROOF_REQUIRED, HARDWARE_MISMATCH, CLOUDFLARE_ERROR, RATE_LIMITED); the button stays; RATE_LIMITED throttles it', async () => {
    const out = [];
    for (const [mode, outcome, re] of refusals) {
      mocks.w.edgeMode = 'no_route'; mocks.w.regMode = mode; mocks.w.regHits.length = 0;
      await runCase(`E-${mode}`, { token: FAKE_WELL_FORMED, work: path.join(WORK, `E-${mode}`), subdomain: NAME, extraEnv: routeEnv(path.join(WORK, `E-${mode}`, 'fake-cloudflared.json')) }, async (c) => {
        fs.mkdirSync(path.join(WORK, `E-${mode}`), { recursive: true });
        const t = await c.until(async () => { const x = await c.tunnel(); return x && x.repair && x.repair.outcome ? x : null; }, 90000, `the ${mode} outcome`);
        if (t.repair.outcome !== outcome || t.state !== 'route_mismatch') throw new Error(`${mode}: ${JSON.stringify({ s: t.state, r: t.repair })}`);
        await sleep(3500);
        if (mocks.w.regHits.length !== 1) throw new Error(`${mode}: ${mocks.w.regHits.length} register calls`);
        await c.js(`document.getElementById('tunnel-status').scrollIntoView({ block: 'center' })`); await sleep(5600);
        const w = await c.js(WIN);
        if (!re.test(w.repair) || w.button === 'none' || w.state !== 'route_mismatch:no_route') throw new Error(`${mode}: window ${JSON.stringify(w)}`);
        await c.ev({ shot: `T10-${mode}-en.png`, wait: 300 });
        let note = '';
        if (mode === 'rate') {
          await c.js(`repairTunnelLink()`); await sleep(1500);
          if (mocks.w.regHits.length !== 1) throw new Error(`rate: the button called register-subdomain again inside the Retry-After window (${mocks.w.regHits.length})`);
          const after = await c.tunnel();
          if (!(after.repair.retryAfterSec > 60 && after.repair.retryAfterSec <= 120) || !after.repair.throttled) throw new Error(`rate: ${JSON.stringify(after.repair)}`);
          note = ` (a click inside the window: no call, "${(await c.js(WIN)).repair}")`;
        }
        out.push(`${mode} → ${outcome}: "${w.repair.slice(0, 70)}…"${note}`);
      });
    }
    return out.join(' | ');
  });
  mocks.close();

  await R.check('T5 no cloudflared is left behind after the app stopped', async () => {
    await sleep(2500);
    const left = allCloudflared();
    if (left.length) throw new Error(`still running: ${left.join(' | ')}`);
    return 'none running';
  });

  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), app: APP, summary: R.summary(), rows: R.rows, evidence }, null, 2));
  console.log(`\ntunnel-check: ${R.summary()}  →  ${WORK}/results.json`);
  process.exit(R.failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
