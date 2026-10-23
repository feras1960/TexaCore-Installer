#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// ota-resume-check — the RESUMABLE automatic download, end to end, in the real app (this checkout, run by Electron in an isolated userData + the 47391+ port block,
// under sandbox-exec like ota-check.js; nothing from the real GitHub release; the real updater code, unmodified: only the stall / backoff timings are shortened through
// TEXACORE_UPDATE_TUNING, which the app honours in isolated harness runs only).
//
//   node scripts/e2e/ota-resume-check.js --workdir <empty dir> [--app "<packaged TexaCore ERP.app>"]
//     --app  run the PACKAGED, obfuscated app (a test copy of it: ota-boot.js wrapper that installs the network redirect, ad-hoc re-signed) instead of this checkout under Electron
//
// The mock GitHub (scripts/e2e/mock-github.js, GitHub's real redirect chain, Range / If-Range / ETag) serves a REAL zip of a small fake "TexaCore ERP.app" (56 MB of random
// payload, paced at 2 MB/s; the release is published only once the app is ready, and the app looks again every 5 s) as release 2.0.2-test, and cuts the connection at 60 % of the file.
//   R1  the download starts by itself; the launcher's progress widget shows it; its REAL Pause button pauses: the request is cut, the partial is kept (shots of the paused state)
//   R2  nothing touches the network while paused (4 s watched); the pause is persisted (control.json) and the partial + sidecar are on disk
//   R3  the app is KILLED (SIGKILL: a crash, no clean quit) and started again: it comes back PAUSED (API + window), the partial is kept, still no network traffic
//   R4  Resume (the local API, as the ERP page would) continues with Range at the byte where it stopped; the server cuts it at 60 %: the status says waiting-retry with the countdown and
//       the reason (shots of downloading and waiting); the REAL «Retry now» button retries at once (well before the 20 s backoff); the rest arrives with Range; the sha512 verifies; the update is staged (real ditto)
//   R5  the staged app's payload is byte-identical to the release's (the three pieces of the download were joined without a gap or a duplicate); the archive and sidecar are cleaned up;
//       the status the ERP page reads (GET /api/update/status) is the original shape: state ready, version, percent 100
//   R6  the request log: three data requests, the 2nd and 3rd are 206 Range requests that start exactly at what the client had written, never a byte of the saved part fetched again
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync, spawnSync } = require('child_process');
const { PORTS, ROOT, Results, portFree, request } = require('./lib');
const { createMockGithub } = require('./mock-github');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
if (!arg('workdir')) { console.error('--workdir <dir> is required'); process.exit(2); }
const WORK = path.resolve(arg('workdir'));
const MOCK_PORT = 47398;
const HOME = os.homedir();
const MB = 1048576;
const APP = arg('app', '') ? path.resolve(arg('app')) : '';
// the fake release must be NEWER than the app under test ("2.0.2-test" is older than 2.0.2 in semver): next patch of the running version + "-test"
const RUNNING_VERSION = APP ? JSON.parse(fs.readFileSync(path.join(APP, 'Contents', 'Resources', 'app', 'package.json'), 'utf8')).version : require('../../package.json').version;
const VERSION = (() => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(RUNNING_VERSION); return `${m[1]}.${m[2]}.${Number(m[3]) + 1}-test`; })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha512b64 = (f) => crypto.createHash('sha512').update(fs.readFileSync(f)).digest('base64');
const shots = path.join(WORK, 'shots');
async function until(fn, ms, what, step = 300) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out (${Math.round(ms / 1000)}s) waiting for ${what}`); await sleep(step); }
}

function sandboxProfile() {
  const f = path.join(WORK, 'ota.sb');
  fs.writeFileSync(f, `(version 1)
(allow default)
(deny process-exec (literal "/usr/bin/open"))
(deny file-write* (subpath "/Applications"))
(deny file* (subpath "${HOME}/Library/Application Support/TexaCore ERP"))
(deny file* (subpath "${HOME}/Library/Application Support/texacore-installer"))
(deny file* (subpath "${HOME}/Library/Application Support/TexaCore"))
(deny network-outbound (remote tcp "*:443") (remote tcp "*:80") (remote tcp "*:8443") (remote tcp "*:8080"))
`);
  return f;
}

/** A real zip of a small fake app: Info.plist + package.json carrying the version, and a big incompressible payload. */
function makeRelease(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  const app = path.join(dir, 'stage', 'TexaCore ERP.app');
  fs.mkdirSync(path.join(app, 'Contents', 'Resources', 'app'), { recursive: true }); fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${VERSION}</string></dict></plist>\n`);
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'app', 'package.json'), JSON.stringify({ name: 'texacore-installer', version: VERSION }));
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'TexaCore ERP'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const payload = path.join(app, 'Contents', 'Resources', 'payload.bin');
  fs.writeFileSync(payload, crypto.randomBytes(56 * MB));
  const name = `TexaCore-ERP-${VERSION}-arm64.zip`;
  const zip = path.join(dir, name);
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const sha = sha512b64(zip); const size = fs.statSync(zip).size;
  const yml = path.join(dir, 'latest-mac.yml');
  fs.writeFileSync(yml, `version: ${VERSION}\nfiles:\n  - url: ${name}\n    sha512: ${sha}\n    size: ${size}\npath: ${name}\nsha512: ${sha}\nreleaseDate: '${new Date().toISOString()}'\n`);
  return { zip, name, sha, size, yml, payloadSha: sha512b64(payload) };
}

/** --app: a test copy of the packaged app with a wrapper entry that installs the network redirect before the app's own main runs (as ota-check.js does), ad-hoc re-signed. */
function prepareAppCopy() {
  const copy = path.join(WORK, 'app-under-test', path.basename(APP));
  fs.rmSync(path.dirname(copy), { recursive: true, force: true }); fs.mkdirSync(path.dirname(copy), { recursive: true });
  execFileSync('/usr/bin/ditto', ['--noextattr', '--norsrc', APP, copy]); spawnSync('/usr/bin/xattr', ['-cr', copy]);
  const res = path.join(copy, 'Contents', 'Resources', 'app'); const pj = path.join(res, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
  fs.writeFileSync(path.join(res, 'ota-boot.js'), `'use strict';\nrequire(process.env.OTA_PRELOAD);\nrequire('./${pkg.main}');\n`);
  pkg.main = 'ota-boot.js'; fs.writeFileSync(pj, JSON.stringify(pkg, null, 2));
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', copy], { stdio: 'ignore' });
  return copy;
}
let APP_COPY = '';
function launch(userData, tag, extraEnv = {}) {
  const log = fs.openSync(path.join(WORK, `app-${tag}.log`), 'a');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TEXACORE_|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)/.test(k)));
  const preload = path.join(__dirname, 'net-redirect-preload.js');
  const harnessEnv = { OTA_PRELOAD: preload, OTA_MOCK_PORT: String(MOCK_PORT), OTA_NET_LOG: path.join(WORK, `net-${tag}.jsonl`),
    TEXACORE_HEADLESS: '1', TEXACORE_PORT_BASE: '47391', TEXACORE_USER_DATA: userData, TEXACORE_STUB_TUNNEL: '1', TEXACORE_STUB_MDM: '1', TEXACORE_E2E_AUTOSTART: '1',
    TEXACORE_E2E_LICENSE: 'free', TEXACORE_UPDATE_TEST: '1', TEXACORE_UI_SMOKE: '1', TEXACORE_SHOT_DIR: shots, ...extraEnv };
  let child;
  if (APP) {
    const bin = path.join(APP_COPY, 'Contents', 'MacOS', path.basename(APP_COPY, '.app'));
    child = spawn('/usr/bin/sandbox-exec', ['-f', path.join(WORK, 'ota.sb'), bin, '--no-sandbox', `--user-data-dir=${userData}`], { stdio: ['ignore', log, log], env: { ...cleanEnv, ...harnessEnv } });
  } else {
    const bin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
    child = spawn('/usr/bin/sandbox-exec', ['-f', path.join(WORK, 'ota.sb'), bin, ROOT, '--no-sandbox', `--user-data-dir=${userData}`], { stdio: ['ignore', log, log], cwd: ROOT,
      env: { ...cleanEnv, NODE_OPTIONS: `--require ${preload}`, ...harnessEnv } });
  }
  child.exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
  return child;
}
const appLog = (tag) => { try { return fs.readFileSync(path.join(WORK, `app-${tag}.log`), 'utf8'); } catch { return ''; } };
const hbLog = (userData) => { try { return fs.readFileSync(path.join(userData, 'logs', 'heartbeat.log'), 'utf8'); } catch { return ''; } };

(async () => {
  const R = new Results();
  for (const p of [...Object.values(PORTS), MOCK_PORT]) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
  sandboxProfile();
  if (APP) APP_COPY = prepareAppCopy();
  const rel = makeRelease(path.join(WORK, 'release'));
  const userData = path.join(WORK, 'userdata');
  const upd = path.join(userData, 'updates');
  const mock = createMockGithub({ port: MOCK_PORT, latest: null, releases: { [`v${VERSION}`]: { files: {
    'latest-mac.yml': { path: rel.yml },
    [rel.name]: { path: rel.zip, bytesPerSec: 2 * MB, faults: [{ at: 0.6, kind: 'drop' }] },
  } } } });
  await mock.listen();
  const tuning = JSON.stringify({ engine: { stallMs: 3000, backoffMs: [20000, 20000, 20000], jitter: 0, progressEveryMs: 200, networkUpDebounceMs: 0 }, checkInitialDelayMs: 2000, checkIntervalMs: 5000 });
  const evidence = {};
  let app = null; let secrets = null;
  const H = () => ({ 'x-texacore-local-secret': secrets.localApiSecret });
  const API = (p) => `http://127.0.0.1:${PORTS.admin}${p}`;
  const status = async () => (await request('GET', API('/api/update/status'), { headers: H() })).json;
  const evalUi = async (body) => { const r = await request('POST', API('/api/ui-eval'), { headers: H(), body }); if (!r.json || !r.json.ok) throw new Error(`ui-eval ${r.text.slice(0, 200)}`); return r.json.result; };
  const WIDGET = `(() => { const g = (id) => document.getElementById(id); const w = g('update-widget'); const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    return { shown: vis(w), cls: w.className, text: g('update-text').textContent, mb: g('update-mb').textContent, detail: g('update-detail').textContent, bar: g('update-progress-bar').style.width,
      pause: vis(g('update-pause-btn')) ? g('update-pause-btn').textContent.trim() : null, retry: vis(g('update-retry-btn')) ? g('update-retry-btn').textContent.trim() : null, restart: vis(g('update-restart-btn')), lang: document.documentElement.lang }; })()`;
  /** the widget in ar and en, one screenshot each (the real renderer's language switch) */
  const shotBoth = async (name) => {
    const out = {};
    for (const lang of ['ar', 'en']) {
      out[lang] = await evalUi({ size: [900, 700], wait: 250, shot: `resume-${name}-${lang}.png`,
        js: `(() => { const s = document.getElementById('lang-select'); s.value = '${lang}'; onLangChange(); window.scrollTo(0, 0); document.getElementById('update-widget').scrollIntoView({ block: 'center' }); return (${WIDGET}); })()` });
    }
    await evalUi({ js: `(() => { const s = document.getElementById('lang-select'); s.value = 'en'; onLangChange(); })()` });
    return out;
  };
  const dataReqs = () => mock.dataRequests(rel.name);
  const waitReady = async (tag) => {
    await until(() => /E2E_READY/.test(appLog(tag)), 240000, 'the app to be ready', 1000);
    const ready = /E2E_READY (\{.*\})/.exec(appLog(tag));
    if (!ready || !JSON.parse(ready[1]).ok) throw new Error(`the app did not come up: ${ready && ready[1]}`);
    secrets = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'secrets.json'), 'utf8'));
  };
  // a crash: the app is killed without a clean quit. Its services (PostgreSQL, PostgREST, GoTrue …) are separate processes that outlive it, so — like a reboot — everything that
// belongs to THIS run (its command lines name the isolated userData folder) is killed too, and the port block is awaited free.
const killHard = async (child) => {
  child.kill('SIGKILL'); await child.exited;
  spawnSync('/usr/bin/pkill', ['-9', '-f', userData]);
  for (const port of Object.values(PORTS)) {                         // PostgREST / GoTrue do not carry the folder in their command line: whatever still listens in the isolated port block is ours
    const pids = spawnSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ } }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) { let busy = false; for (const p of Object.values(PORTS)) if (!(await portFree(p))) busy = true; if (!busy) break; await sleep(500); }
  await sleep(1000);
};
  try {
    // ════════ launch 1 ════════
    app = launch(userData, 'one', { TEXACORE_UPDATE_TUNING: tuning });
    await waitReady('one');

    await R.check('R1 the download starts by itself and the progress widget shows it (MB, percent, speed); the REAL Pause button pauses it and the partial is kept', async () => {
      mock.setLatest(`v${VERSION}`);                                   // the release appears; the app's next look at the feed (every 5 s here) starts the download
      const st = await until(async () => { const s = await status(); return s && s.phase === 'downloading' && s.bytesDone > 6 * MB ? s : null; }, 120000, 'bytes to flow', 300);
      const wd = await evalUi({ js: WIDGET });                         // what the window shows while it downloads (no resize / screenshot yet: the pause must come well before the server's cut at 60 %)
      if (!wd.shown || !/%/.test(wd.mb) || !wd.pause) throw new Error(`widget ${JSON.stringify(wd)}`);
      await evalUi({ js: `document.getElementById('update-pause-btn').click()` });
      const p = await until(async () => { const s = await status(); return s && s.phase === 'paused' ? s : null; }, 20000, 'phase paused', 200);
      if (!p.paused || p.state !== 'downloading') throw new Error(`status ${JSON.stringify(p)}`);
      const w = await evalUi({ js: WIDGET });
      const shotsP = await shotBoth('paused');
      evidence.r1 = { downloading: wd, paused: shotsP.en };
      const part = path.join(upd, 'pending', `${rel.name}.part`);
      const kept = fs.statSync(part).size;
      if (!(kept > 6 * MB && kept < 0.45 * rel.size)) throw new Error(`partial ${kept}`);
      return `downloading ${st.bytesDone} B at ${Math.round(st.speedBps / MB * 10) / 10} MB/s (widget EN "${wd.text}" / ${wd.mb}); the REAL Pause button clicked → status ${p.phase}/paused=${p.paused}; widget "${w.text}" [${w.pause}]; ${kept} B kept in ${rel.name}.part`;
    });

    await R.check('R2 nothing touches the network while paused (4 s watched); the pause is persisted and the partial + sidecar are on disk', async () => {
      const n = mock.state.requests.length; const bytes = fs.statSync(path.join(upd, 'pending', `${rel.name}.part`)).size;
      await sleep(4000);
      if (mock.state.requests.length !== n) throw new Error(`${mock.state.requests.length - n} request(s) while paused`);
      if (fs.statSync(path.join(upd, 'pending', `${rel.name}.part`)).size !== bytes) throw new Error('the partial changed while paused');
      const ctl = JSON.parse(fs.readFileSync(path.join(upd, 'control.json'), 'utf8'));
      const side = JSON.parse(fs.readFileSync(path.join(upd, 'pending', 'pending.json'), 'utf8'));
      if (!ctl.paused || side.expectedSha512 !== rel.sha || side.bytes !== bytes) throw new Error(`control ${JSON.stringify(ctl)} sidecar ${JSON.stringify(side)}`);
      evidence.r2 = { requestsWhilePaused: 0, sidecar: side };
      return `0 requests in 4 s; control.json paused; sidecar v${side.version} expects ${side.expectedSize} B, ${side.bytes} B durable, ETag ${side.etag}, tagged URL ${side.pinnedUrl ? 'remembered' : 'none'}`;
    });

    // ════════ the crash ════════
    const keptBefore = fs.statSync(path.join(upd, 'pending', `${rel.name}.part`)).size;
    const reqBeforeKill = mock.state.requests.length;
    await killHard(app);

    await R.check('R3 after a KILL (crash) and a restart the app comes back PAUSED — API and window — with the partial kept, and still touches nothing', async () => {
      if (!fs.existsSync(path.join(upd, 'pending', `${rel.name}.part`)) || fs.statSync(path.join(upd, 'pending', `${rel.name}.part`)).size !== keptBefore) throw new Error('the partial did not survive the kill');
      app = launch(userData, 'two', { TEXACORE_UPDATE_TUNING: tuning });
      await waitReady('two');
      const s = await until(async () => { const x = await status(); return x && x.phase === 'paused' ? x : null; }, 30000, 'paused after the restart', 300);
      const w = await until(async () => { const x = await evalUi({ js: WIDGET }); return x.shown ? x : null; }, 30000, 'the widget after the restart', 300);
      await sleep(5000);                                               // the 2 s startup feed check would have fired by now — a paused download must not even look at the feed
      if (mock.state.requests.length !== reqBeforeKill) throw new Error(`${mock.state.requests.length - reqBeforeKill} request(s) after the restart while paused`);
      if (!/paused|متوقف|приостановлена|призупинено/i.test(w.text) || !w.pause) throw new Error(`widget ${JSON.stringify(w)}`);
      const log = hbLog(userData);
      if (!new RegExp(`keeping the pending download of v${VERSION.replace(/[.+-]/g, '\\$&')}`).test(log)) throw new Error('cleanupIfStale did not report keeping the partial');
      evidence.r3 = { status: s, widget: w };
      return `status ${s.phase} (paused=${s.paused}, ${s.bytesDone}/${s.bytesTotal} B), widget "${w.text}" [${w.pause}], app log "keeping the pending download…", 0 requests since the kill`;
    });

    await R.check('R4 Resume (local API) continues with Range where it stopped; the cut at 60 % shows waiting-retry with the countdown and reason; the REAL «Retry now» retries at once; it finishes, verifies and stages', async () => {
      const r = await request('POST', API('/api/update/resume'), { headers: H() });
      if (!r.json || !r.json.success) throw new Error(`resume ${r.text}`);
      await until(() => dataReqs().length >= 2, 60000, 'the Range request', 300);
      const second = dataReqs()[1];
      if (second.range !== `bytes=${keptBefore}-`) throw new Error(`resume range ${second.range}, the partial was ${keptBefore} B`);
      await until(async () => { const x = await status(); return x && x.phase === 'downloading' && x.bytesDone > keptBefore + 3 * MB ? x : null; }, 30000, 'bytes after the resume', 300);
      const shotsD = await shotBoth('downloading');
      if (!shotsD.ar.shown || !shotsD.en.shown || !/%/.test(shotsD.en.mb) || !shotsD.en.pause) throw new Error(`widget ${JSON.stringify(shotsD.en)}`);
      // the server cuts at 60 % → waiting-retry with a 6 s backoff
      const wr = await until(async () => { const s = await status(); return s && s.phase === 'waiting-retry' ? s : null; }, 60000, 'waiting-retry after the cut', 200);
      if (wr.errorCode !== 'network' || !(wr.nextRetryInSec >= 1 && wr.nextRetryInSec <= 20)) throw new Error(`status ${JSON.stringify(wr)}`);
      const shotsW = await shotBoth('waiting-retry');
      if (!shotsW.en.retry || !shotsW.en.pause || !shotsW.ar.shown) throw new Error(`widget ${JSON.stringify(shotsW.en)}`);
      const before = dataReqs().length; const t0 = Date.now();
      await evalUi({ js: `document.getElementById('update-retry-btn').click()` });
      await until(() => dataReqs().length > before, 5000, 'an immediate retry', 100);
      const retryAfter = Date.now() - t0;
      if (retryAfter > 3500) throw new Error(`the retry took ${retryAfter} ms (backoff was 20 s)`);
      await until(async () => { const s = await status(); return s && s.state === 'ready' ? s : null; }, 120000, 'ready', 500);
      const shotsR = await shotBoth('ready');
      if (!shotsR.en.restart) throw new Error(`ready widget ${JSON.stringify(shotsR.en)}`);
      const st = await status();
      evidence.r4 = { waiting: wr, ready: st, widgets: { downloading: shotsD.en, waiting: shotsW.en, ready: shotsR.en } };
      return `resumed with "${second.range}"; cut → ${wr.phase} (${wr.errorCode}, retry in ${wr.nextRetryInSec}s, "${wr.lastError}"); widget EN "${shotsW.en.text}" [${shotsW.en.pause}] [${shotsW.en.retry}]; «Retry now» → new request after ${retryAfter} ms; ready: ${JSON.stringify({ state: st.state, version: st.version, percent: st.percent })}`;
    });

    await R.check('R5 the staged app is byte-identical to the release (three pieces joined with no gap and no duplicate); the sha512 line is logged; the archive and sidecar are cleaned up; the ERP page\'s status keeps its original shape', async () => {
      const log = hbLog(userData);
      if (!/sha512 verified/.test(log) || !new RegExp(`staged v${VERSION.replace(/[.+-]/g, '\\$&')}`).test(log)) throw new Error('log lines missing');
      const st = JSON.parse(fs.readFileSync(path.join(upd, 'staged.json'), 'utf8'));
      const payload = path.join(st.appPath, 'Contents', 'Resources', 'payload.bin');
      if (sha512b64(payload) !== rel.payloadSha) throw new Error('the staged payload differs from the release');
      if (fs.existsSync(path.join(upd, 'pending'))) throw new Error('pending/ was not cleaned');
      const s = await status();
      if (s.state !== 'ready' || s.version !== VERSION || s.percent !== 100 || s.phase !== 'ready') throw new Error(`status ${JSON.stringify(s)}`);
      const keys = ['state', 'version', 'percent', 'transferredMB', 'totalMB'];
      for (const k of keys) if (!(k in s)) throw new Error(`the original field ${k} is missing from /api/update/status`);
      return `payload sha512 ${rel.payloadSha.slice(0, 16)}… identical; staged ${path.relative(userData, st.appPath)}; pending/ gone; /api/update/status → ${JSON.stringify({ state: s.state, version: s.version, percent: s.percent, phase: s.phase })}`;
    });

    await R.check('R6 the request log: 3 data requests — the 2nd and 3rd are 206 Range requests that start exactly at what the client had written; the saved part was never fetched again', async () => {
      const d = dataReqs();
      if (d.length !== 3) throw new Error(`${d.length} data requests: ${JSON.stringify(d.map((x) => [x.status, x.range, x.bytes]))}`);
      const s1 = Number(/\d+/.exec(d[1].range)[0]); const s2 = Number(/\d+/.exec(d[2].range)[0]);
      if (d[0].range || d[1].status !== 206 || d[2].status !== 206) throw new Error(`statuses ${d.map((x) => x.status)}`);
      if (s1 !== keptBefore) throw new Error(`2nd range ${s1} vs the kept ${keptBefore}`);
      if (s2 + d[2].bytes !== rel.size) throw new Error(`the last piece ends at ${s2 + d[2].bytes}, file is ${rel.size}`);
      if (!(s2 > s1 && s2 <= s1 + d[1].bytes && s1 + d[1].bytes - s2 < 1 * MB)) throw new Error(`3rd range ${s2}`);
      const blocked = fs.existsSync(path.join(WORK, 'net-two.jsonl')) ? fs.readFileSync(path.join(WORK, 'net-two.jsonl'), 'utf8').split('\n').filter((l) => /BLOCKED/.test(l)).length : 0;
      return `requests: ${d.map((x) => `${x.status} ${x.range || 'full'} (${x.bytes} B${x.faulted ? ', cut' : ''})`).join(' → ')}; ${blocked} non-mock outbound attempt(s) refused by the harness`;
    });
  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 });
    console.log(`  FAIL  harness — ${e.message}`);
  } finally {
    if (app && app.exitCode === null) { app.kill('SIGTERM'); await Promise.race([app.exited, sleep(30000)]); if (app.exitCode === null) app.kill('SIGKILL'); }
    await mock.close().catch(() => {});
  }
  fs.writeFileSync(path.join(WORK, 'resume-results.json'), JSON.stringify({ at: new Date().toISOString(), summary: R.summary(), release: { version: VERSION, size: rel.size, sha512: rel.sha }, evidence, rows: R.rows }, null, 2));
  console.log(`\nota-resume-check: ${R.summary()}  →  ${path.join(WORK, 'resume-results.json')}  (shots: ${shots})`);
  process.exit(R.failed.length ? 1 : 0);
})();
