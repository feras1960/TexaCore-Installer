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
//   (T3 contacts Cloudflare's public edge with the fake token — that is what cloudflared does; nothing of TexaCore's is contacted)
//
//   node scripts/e2e/tunnel-check.js --workdir <empty dir> --app <packaged .app>
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
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

async function runCase(name, { token, extraEnv = {}, work }, body) {
  const userData = path.join(work, 'userdata');
  const dd = path.join(userData, 'texacore-data');
  fs.mkdirSync(dd, { recursive: true });
  fs.writeFileSync(path.join(dd, 'config.json'), JSON.stringify({ enableCloud: true, subdomain: 'e2e-fake-tunnel', tunnelToken: token }));
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

(async () => {
  const R = new Results();
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
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
