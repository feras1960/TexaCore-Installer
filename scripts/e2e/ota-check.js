#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// ota-check — the automatic update, end to end, on REAL packaged apps in the lab (isolated userData, ports 47391+, nothing from the real GitHub release).
//
//   node scripts/e2e/ota-check.js --workdir <empty dir> --old180 "<1.8.0 .app>" --rel <dir with the NEW release: latest-mac.yml + zip + dmg> \
//        [--client200 "<2.0.0 .app, to test 2.0.0 → 2.0.1-test>"] [--erp <ERP checkout: Playwright + ERP page>] [--hops a,tamper,b]
//
// How the real updater is exercised without touching the product's feed:
//   * the updater code under test is UNMODIFIED (the packaged mac-updater.js is byte-identical to the released one — checked). A packaged Electron app ignores NODE_OPTIONS=--require,
//     so the TEST COPY of the client gets a 3-line wrapper entry (ota-boot.js: load scripts/e2e/net-redirect-preload.js, then the app's own main) and an ad-hoc re-sign; that preload (outside the
//     product) sends github.com / objects.githubusercontent.com requests to scripts/e2e/mock-github.js (GitHub's real redirect chain, self-signed TLS) and REFUSES every other non-loopback destination;
//   * each app runs under macOS sandbox-exec (so Chromium's own process sandbox is switched off with --no-sandbox — it can not nest): no write/read of the real TexaCore user-data folders, no /Applications writes, no outbound :80/:443, and `/usr/bin/open`
//     (the installer script's relaunch) is denied — the swap, ad-hoc signing and cleanup run for real, the relaunch is then done by this script with the isolated environment.
//   hop a      1.8.0 (built from c05be42; only its admin port moved into the test block) → the release in --rel
//   hop tamper 1.8.0, the release's zip is served with one flipped byte → refused
//   hop b      2.0.0 (the client app) → "2.0.1-test" (the same app re-versioned, re-signed, re-zipped by this script), including the ERP page's own update pill
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync, spawnSync } = require('child_process');
const { PORTS, Results, portFree, request } = require('./lib');
const { createMockGithub } = require('./mock-github');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const OLD180 = path.resolve(arg('old180', ''));
const REL = path.resolve(arg('rel', ''));
const CLIENT200 = arg('client200', '') ? path.resolve(arg('client200')) : '';
const ERP = arg('erp', '');
const HOPS = arg('hops', 'a,tamper,b').split(',');
if (!arg('workdir') || !arg('old180') || !arg('rel')) { console.error('--workdir, --old180 and --rel are required'); process.exit(2); }
const MOCK_PORT = 47398; const CDP_PORT = 47397;
const HOME = os.homedir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = path.join(WORK, 'shots');

const sha512b64 = (f) => crypto.createHash('sha512').update(fs.readFileSync(f)).digest('base64');
const parseYml = (f) => {
  const t = fs.readFileSync(f, 'utf8');
  const files = [...t.matchAll(/-\s*url:\s*(\S+)\s+sha512:\s*(\S+)\s+size:\s*(\d+)/g)].map((m) => ({ url: m[1], sha512: m[2], size: Number(m[3]) }));
  return { version: (/^version:\s*(\S+)/m.exec(t) || [])[1], files, text: t };
};
async function until(fn, ms, what, step = 500) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out (${Math.round(ms / 1000)}s) waiting for ${what}`); await sleep(step); }
}

// ─── sandbox ───
function sandboxProfile() {
  const f = path.join(WORK, 'ota.sb');
  fs.writeFileSync(f, `(version 1)
(allow default)
; the relaunch the installer script does (/usr/bin/open) must not start an app outside this test
(deny process-exec (literal "/usr/bin/open"))
; the real app, its data and the Applications folder are off limits
(deny file-write* (subpath "/Applications"))
(deny file* (subpath "${HOME}/Library/Application Support/TexaCore ERP"))
(deny file* (subpath "${HOME}/Library/Application Support/texacore-installer"))
(deny file* (subpath "${HOME}/Library/Application Support/TexaCore"))
; nothing leaves the machine on the usual web ports
(deny network-outbound (remote tcp "*:443") (remote tcp "*:80") (remote tcp "*:8443") (remote tcp "*:8080"))
`);
  return f;
}

/** Test copy of a client app: a wrapper entry that installs the network redirect before the app's own main runs. The swap later replaces the WHOLE bundle with the release's. */
function wrapClient(appPath) {
  const res = path.join(appPath, 'Contents', 'Resources', 'app');
  const pj = path.join(res, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
  fs.writeFileSync(path.join(res, 'ota-boot.js'), `'use strict';\nrequire(process.env.OTA_PRELOAD);\nrequire('./${pkg.main}');\n`);
  pkg.main = 'ota-boot.js'; fs.writeFileSync(pj, JSON.stringify(pkg, null, 2));
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'ignore' });
}

function launch(appPath, { userData, env = {}, args = [], tag }) {
  const bin = path.join(appPath, 'Contents', 'MacOS', path.basename(appPath, '.app'));
  const log = fs.openSync(path.join(WORK, `app-${tag}.log`), 'a');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TEXACORE_|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)/.test(k)));
  const child = spawn('/usr/bin/sandbox-exec', ['-f', path.join(WORK, 'ota.sb'), bin, '--no-sandbox', `--user-data-dir=${userData}`, ...args], {
    stdio: ['ignore', log, log],
    env: { ...cleanEnv, OTA_PRELOAD: path.join(__dirname, 'net-redirect-preload.js'), OTA_MOCK_PORT: String(MOCK_PORT), OTA_NET_LOG: path.join(WORK, `net-${tag}.jsonl`), ...env },
  });
  const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
  return { child, exited, bin };
}
async function stop(app) {
  if (!app || app.child.exitCode !== null) return;
  app.child.kill('SIGTERM');
  const t = setTimeout(() => { try { app.child.kill('SIGKILL'); } catch { /* gone */ } }, 25000);
  await app.exited; clearTimeout(t);
  await sleep(1000);
}
const logOf = (userData) => { try { return fs.readFileSync(path.join(userData, 'logs', 'heartbeat.log'), 'utf8'); } catch { return ''; } };
const plistVersion = (appPath) => spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8' }).stdout.trim();
const pkgVersion = (appPath) => JSON.parse(fs.readFileSync(path.join(appPath, 'Contents', 'Resources', 'app', 'package.json'), 'utf8')).version;
const ditto = (from, to) => { execFileSync('/usr/bin/ditto', ['--noextattr', '--norsrc', from, to]); spawnSync('/usr/bin/xattr', ['-cr', to]); };

// the 1.8.0 installer window is driven over CDP (its renderer is the real UI the user sees)
async function cdpPage(timeoutMs = 60000) {
  const { chromium } = require(path.join(ERP || '', 'node_modules', 'playwright'));
  return until(async () => {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      for (const ctx of browser.contexts()) for (const pg of ctx.pages()) if (/index\.html/.test(pg.url())) return { browser, page: pg };
      await browser.close();
    } catch { /* not up yet */ }
    return null;
  }, timeoutMs, 'the installer window (CDP)', 1000);
}
const WIDGET = `(() => { const g = (id) => document.getElementById(id); const w = g('update-widget'); if (!w) return { present: false };
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  return { present: true, shown: vis(w), text: (g('update-text') || {}).textContent || '', mb: (g('update-mb') || {}).textContent || '', restartVisible: vis(g('update-restart-btn')),
    restartText: (g('update-restart-btn') || {}).textContent || '', laterText: (g('update-later-btn') || {}).textContent || '', lang: document.documentElement.lang }; })()`;

// ─── release payloads ───
function releaseFiles(dir) {
  const yml = path.join(dir, 'latest-mac.yml');
  const meta = parseYml(yml);
  const files = { 'latest-mac.yml': { path: yml } };
  for (const f of meta.files) files[f.url] = { path: path.join(dir, f.url) };
  return { meta, files };
}

/** "2.0.1-test": the 2.0.0 app, re-versioned (Info.plist + package.json), re-signed ad hoc, zipped the way electron-builder does, with a matching latest-mac.yml. */
function makeNextRelease(app200, outDir, version) {
  fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  const stage = path.join(outDir, 'stage'); fs.mkdirSync(stage);
  const app = path.join(stage, 'TexaCore ERP.app');
  ditto(app200, app);
  for (const k of ['CFBundleShortVersionString', 'CFBundleVersion']) execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${k} ${version}`, path.join(app, 'Contents', 'Info.plist')]);
  const pj = path.join(app, 'Contents', 'Resources', 'app', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf8')); pkg.version = version; fs.writeFileSync(pj, JSON.stringify(pkg, null, 2));
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
  const name = `TexaCore-ERP-${version}-arm64.zip`;
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, path.join(outDir, name)]);
  const z = path.join(outDir, name);
  fs.writeFileSync(path.join(outDir, 'latest-mac.yml'), `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512b64(z)}\n    size: ${fs.statSync(z).size}\npath: ${name}\nsha512: ${sha512b64(z)}\nreleaseDate: '${new Date().toISOString()}'\n`);
  fs.rmSync(stage, { recursive: true, force: true });
  return outDir;
}

const mockRows = (mock, since = 0) => mock.state.requests.slice(since).map((r) => `${r.status} ${r.host}${r.path.length > 70 ? r.path.slice(0, 70) + '…' : r.path}${r.bytes ? ` (${r.bytes} B${r.tampered ? ', TAMPERED' : ''})` : ''}`);

(async () => {
  const R = new Results();
  for (const p of [...Object.values(PORTS), MOCK_PORT, CDP_PORT]) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
  sandboxProfile();
  const evidence = {};
  let mock = null; let app = null;
  const releaseMeta = parseYml(path.join(REL, 'latest-mac.yml'));
  const zipEntry = releaseMeta.files.find((f) => f.url.endsWith('.zip'));
  try {
    // ════════ hop a: 1.8.0 → the release ════════
    if (HOPS.includes('a')) {
      const dir = path.join(WORK, 'hop-a'); fs.mkdirSync(dir, { recursive: true });
      const appPath = path.join(dir, 'TexaCore ERP.app'); const userData = path.join(dir, 'userdata');
      ditto(OLD180, appPath); wrapClient(appPath);
      const rel = releaseFiles(REL);
      mock = createMockGithub({ port: MOCK_PORT, releases: { [`v${releaseMeta.version}`]: { files: rel.files }, 'v1.8.0': { files: {} } }, latest: `v${releaseMeta.version}` });
      await mock.listen();
      let cdp = null; let seen = 0;
      app = launch(appPath, { userData, tag: 'a-old', args: [`--remote-debugging-port=${CDP_PORT}`] });
      await R.check(`A1 DETECTION: the unmodified 1.8.0 app (v${plistVersion(appPath)}) asks GitHub's "latest" release and finds v${releaseMeta.version}`, async () => {
        if (plistVersion(appPath) !== '1.8.0') throw new Error(`the client is ${plistVersion(appPath)}`);
        await until(() => /\[MacUpdater\] update available: v/.test(logOf(userData)), 90000, 'the update to be detected');
        const rows = mockRows(mock);
        const chain = rows.slice(0, 3);
        if (!/^302 github\.com\/feras1960\/TexaCore-Installer\/releases\/latest\/download\/latest-mac\.yml/.test(chain[0] || '') || !/^302 github\.com.*releases\/download\/v/.test(chain[1] || '') || !/^200 objects\.githubusercontent\.com/.test(chain[2] || '')) throw new Error(`unexpected request chain: ${chain.join(' | ')}`);
        const line = logOf(userData).split('\n').find((l) => /update available: v/.test(l));
        evidence.detectionLog = line;
        seen = mock.state.requests.length;
        return `feed chain: ${chain.join(' → ')}; app log: ${line.replace(/^\[[^\]]+\]\s*/, '').slice(0, 150)}`;
      });
      await R.check('A2 DOWNLOAD + sha512: the zip is fetched through GitHub\'s redirect chain, its sha512 (base64, from the yml) verified, then staged', async () => {
        await until(() => /staged v/.test(logOf(userData)), 180000, 'the update to be staged', 1000);
        const log = logOf(userData);
        if (!/sha512 verified/.test(log)) throw new Error('no "sha512 verified" in the app log');
        const zipReqs = mock.state.requests.filter((r) => (r.path.includes(zipEntry.url)) || (r.asset === zipEntry.url));
        const dl = mock.state.requests.find((r) => r.asset === zipEntry.url && r.status === 200);
        if (!dl || dl.bytes !== zipEntry.size) throw new Error(`download: ${JSON.stringify(dl)} (expected ${zipEntry.size} B)`);
        const st = JSON.parse(fs.readFileSync(path.join(userData, 'updates', 'staged.json'), 'utf8'));
        if (st.version !== releaseMeta.version || !fs.existsSync(st.appPath)) throw new Error(`staged.json ${JSON.stringify(st)}`);
        if (fs.existsSync(path.join(userData, 'updates', 'pending'))) throw new Error('the downloaded archive was not cleaned from pending/');
        if (pkgVersion(st.appPath) !== releaseMeta.version) throw new Error(`staged app is ${pkgVersion(st.appPath)}`);
        return `${zipReqs.length} requests for the zip (${zipReqs.map((r) => r.status).join(' → ')}, ${dl.bytes} B = the yml's size); sha512 ${zipEntry.sha512.slice(0, 16)}… verified; staged ${path.relative(userData, st.appPath)} (v${pkgVersion(st.appPath)}); archive removed`;
      });
      await R.check('A3 THE PROMPT: the installer window shows «Update v… is ready — installs on restart» with a «Restart now» button, and the local API (the ERP page\'s pill) says ready', async () => {
        cdp = await cdpPage();
        const w = await until(async () => { const x = await cdp.page.evaluate(WIDGET); return x.shown && x.restartVisible ? x : null; }, 30000, 'the widget to show the ready state');
        if (!w.text.includes(releaseMeta.version)) throw new Error(`widget text "${w.text}" does not name v${releaseMeta.version}`);
        await cdp.page.screenshot({ path: path.join(shots, 'a-1.8.0-update-ready.png') });
        const st = await request('GET', 'http://127.0.0.1:47396/api/update/status');   // 1.8.0's open local API (admin port moved into the test block)
        if (!st.json || st.json.state !== 'ready' || st.json.version !== releaseMeta.version) throw new Error(`/api/update/status ${st.text.slice(0, 120)}`);
        evidence.prompt = w;
        return `window (${w.lang}): "${w.text}" [${w.restartText}] [${w.laterText}] — screenshot shots/a-1.8.0-update-ready.png; GET /api/update/status → ${st.text}`;
      });
      await R.check('A4 RESTART TO INSTALL: pressing the button quits the app; the detached script waits for it, replaces the bundle, ad-hoc signs it, clears quarantine and tries to relaunch', async () => {
        await cdp.page.evaluate("document.getElementById('update-restart-btn').click()");
        try { await cdp.browser.close(); } catch { /* app is quitting */ }
        const ex = await Promise.race([app.exited, sleep(60000).then(() => null)]);
        if (!ex) throw new Error('the app did not quit after «Restart now»');
        const il = path.join(userData, 'logs', 'mac-update-install.log');
        await until(() => fs.existsSync(il) && /staging cleaned — done/.test(fs.readFileSync(il, 'utf8')), 120000, 'the installer script to finish', 1000);
        const text = fs.readFileSync(il, 'utf8');
        if (plistVersion(appPath) !== releaseMeta.version || pkgVersion(appPath) !== releaseMeta.version) throw new Error(`bundle is ${plistVersion(appPath)} / ${pkgVersion(appPath)}`);
        const cs = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' });
        if (cs.status !== 0) throw new Error(`codesign: ${cs.stderr.slice(0, 200)}`);
        const xa = spawnSync('/usr/bin/xattr', ['-r', appPath], { encoding: 'utf8' }).stdout;
        if (/com\.apple\.quarantine/.test(xa)) throw new Error('quarantine attribute still set');
        if (fs.existsSync(path.join(userData, 'updates'))) throw new Error('the staging folder was not cleaned');
        evidence.installLog = text.trim().split('\n').slice(-6);
        return `exit ${ex.code}; install log: ${text.trim().split('\n').map((l) => l.replace(/^\[[^\]]+\]\s*/, '')).filter((l) => !/^\s*$/.test(l)).slice(0, 6).join(' | ').slice(0, 330)}; bundle now ${plistVersion(appPath)} (package.json ${pkgVersion(appPath)}), codesign --verify --deep --strict OK, no quarantine, staging removed`;
      });
      // what the owner's machine would do next (open the new bundle) — done here with the isolated environment
      await R.check('A5 THE NEW APP STARTS: the swapped bundle launches as 2.0.0 on the SAME user-data folder; a pre-2.0 data folder is set aside whole (kept), not reused; the licence and account settings continue, the company list does not', async () => {
        const dd = path.join(userData, 'texacore-data');
        // what a 1.x install leaves behind (the old build never ran its services here): PostgreSQL 15 cluster, config with the licence, backups, a .tcdb
        fs.mkdirSync(path.join(dd, 'pgdata', 'base', '1'), { recursive: true }); fs.writeFileSync(path.join(dd, 'pgdata', 'PG_VERSION'), '15\n'); fs.writeFileSync(path.join(dd, 'pgdata', 'base', '1', '1259'), 'old cluster page');
        fs.writeFileSync(path.join(dd, 'config.json'), JSON.stringify({ licenseKey: 'TRL-2026-OLD-TRIAL', isTrial: true, storagePath: '/old/backups', companies: [{ name: 'Old Co', tcdbPath: '/old/backups/old.tcdb' }], port: 8080 }));
        fs.writeFileSync(path.join(dd, 'license.dat'), 'old-encrypted-licence'); fs.mkdirSync(path.join(dd, 'backups')); fs.writeFileSync(path.join(dd, 'backups', 'old.tcdb'), 'TCDB-old-backup-bytes');
        fs.writeFileSync(path.join(dd, 'secrets.json'), JSON.stringify({ legacy: true }));
        const before = fs.readdirSync(dd).sort();
        app = launch(appPath, { userData, tag: 'a-new', env: { TEXACORE_HEADLESS: '1', TEXACORE_PORT_BASE: '47391', TEXACORE_USER_DATA: userData, TEXACORE_STUB_TUNNEL: '1', TEXACORE_STUB_MDM: '1', TEXACORE_E2E_AUTOSTART: '1', TEXACORE_E2E_LICENSE: 'free', TEXACORE_UI_SMOKE: '1' } });
        await until(() => /E2E_READY/.test(fs.readFileSync(path.join(WORK, 'app-a-new.log'), 'utf8')), 180000, 'the 2.0.0 app to be ready', 1000);
        const ready = /E2E_READY (\{.*\})/.exec(fs.readFileSync(path.join(WORK, 'app-a-new.log'), 'utf8'));
        if (!ready || !JSON.parse(ready[1]).ok) throw new Error(`2.0.0 did not come up: ${ready && ready[1]}`);
        const sec = JSON.parse(fs.readFileSync(path.join(dd, 'secrets.json'), 'utf8'));
        const v = await request('GET', `http://127.0.0.1:${PORTS.admin}/api/ui-smoke`, { headers: { 'x-texacore-local-secret': sec.localApiSecret } });
        if (!v.json || v.json.version !== releaseMeta.version) throw new Error(`the running app reports ${v.json && v.json.version}`);
        const aside = fs.readdirSync(userData).filter((n) => /^texacore-data\.v18-backup-/.test(n));
        if (aside.length !== 1) throw new Error(`expected one set-aside folder, found ${aside.join(',')}`);
        const kept = fs.readdirSync(path.join(userData, aside[0])).sort();
        if (JSON.stringify(kept) !== JSON.stringify(before)) throw new Error(`the set-aside folder lost files: ${kept} vs ${before}`);
        if (fs.readFileSync(path.join(userData, aside[0], 'backups', 'old.tcdb'), 'utf8') !== 'TCDB-old-backup-bytes') throw new Error('the old backup file changed');
        const fresh = fs.readdirSync(dd).sort();
        // the account-level settings continue (licence, trial flag, cloud settings, port); the company list and backup locations do NOT (the auto-backup would overwrite the old .tcdb)
        const alog = fs.readFileSync(path.join(WORK, 'app-a-new.log'), 'utf8');
        const carried = (alog.match(/\[Bootstrap\] carried over from the old data dir: ([^\n]*)/) || [])[1] || '';
        if (!/licenseKey/.test(carried) || !/license\.dat/.test(carried)) throw new Error(`the licence was not carried over (log: "${carried}")`);
        const ncfg = JSON.parse(fs.readFileSync(path.join(dd, 'config.json'), 'utf8'));
        if (JSON.stringify(ncfg).includes('Old Co') || JSON.stringify(ncfg).includes('/old/backups')) throw new Error('the old company list / backup path leaked into the new config');
        if (fs.readFileSync(path.join(userData, aside[0], 'license.dat'), 'utf8') !== 'old-encrypted-licence') throw new Error('the old license.dat changed');
        evidence.dataAfter = { asideFolder: aside[0], keptEntries: kept, newEntries: fresh, carried };
        await stop(app);
        return `app reports v${v.json.version}; the whole old folder is kept as ${aside[0]} (${kept.join(', ')} — byte-identical); a NEW database was built in texacore-data (${fresh.join(', ')}); carried over: ${carried}; the old company list and backup paths are NOT carried over`;
      });
      await mock.close(); mock = null;
    }

    // ════════ tamper: a modified download is refused ════════
    if (HOPS.includes('tamper')) {
      const dir = path.join(WORK, 'hop-tamper'); fs.mkdirSync(dir, { recursive: true });
      const appPath = path.join(dir, 'TexaCore ERP.app'); const userData = path.join(dir, 'userdata');
      ditto(OLD180, appPath); wrapClient(appPath);
      const rel = releaseFiles(REL);
      for (const k of Object.keys(rel.files)) if (k.endsWith('.zip')) rel.files[k].tamper = true;
      mock = createMockGithub({ port: MOCK_PORT, releases: { [`v${releaseMeta.version}`]: { files: rel.files } }, latest: `v${releaseMeta.version}` });
      await mock.listen();
      app = launch(appPath, { userData, tag: 'tamper', args: [`--remote-debugging-port=${CDP_PORT}`] });
      await R.check('T1 TAMPERED FILE REFUSED: a zip with one flipped byte (same size) fails the sha512 check — deleted, not staged, never installed', async () => {
        await until(() => /sha512 mismatch/.test(logOf(userData)), 180000, 'the sha512 mismatch', 1000);
        const line = logOf(userData).split('\n').find((l) => /sha512 mismatch|download\/stage failed/.test(l));
        const dl = mock.state.requests.find((r) => r.asset === zipEntry.url && r.status === 200);
        if (!dl || !dl.tampered) throw new Error('the mock did not serve the tampered zip');
        if (fs.existsSync(path.join(userData, 'updates', 'staged.json'))) throw new Error('a staged.json exists');
        const pend = path.join(userData, 'updates', 'pending');
        if (fs.existsSync(pend) && fs.readdirSync(pend).length) throw new Error(`the bad archive is still in pending/: ${fs.readdirSync(pend)}`);
        const { browser, page } = await cdpPage();
        const w = await page.evaluate(WIDGET);
        await page.screenshot({ path: path.join(shots, 'tamper-after-refusal.png') });
        const st = await request('GET', 'http://127.0.0.1:47396/api/update/status');
        // the user quits normally: nothing may be installed
        await page.evaluate("document.getElementById('update-restart-btn') && window.texacore.installUpdate()").catch(() => {});
        try { await browser.close(); } catch { /* quitting */ }
        const ex = await Promise.race([app.exited, sleep(40000).then(() => null)]);
        await sleep(3000);
        if (plistVersion(appPath) !== '1.8.0') throw new Error(`the app was replaced: ${plistVersion(appPath)}`);
        if (fs.existsSync(path.join(userData, 'logs', 'mac-update-install.log'))) throw new Error('an installer script ran');
        evidence.tamper = { widget: w, status: st.json };
        return `app log: "${line.replace(/^\[[^\]]+\]\s*/, '').slice(0, 130)}"; no staged.json; pending/ empty; the app stayed v1.8.0 after a normal quit${ex ? '' : ' (killed)'}; what the user sees meanwhile: widget ${w.shown ? `shown "${w.text}"` : 'hidden'}, /api/update/status ${JSON.stringify(st.json)}`;
      });
      await stop(app); await mock.close(); mock = null;
    }

    // ════════ tamper2: the 2.0.0 client refuses a modified 2.0.1-test download AND stops saying "downloading" ════════
    if (HOPS.includes('tamper2')) {
      if (!CLIENT200) throw new Error('--client200 is required for hop tamper2');
      const dir = path.join(WORK, 'hop-tamper2'); fs.mkdirSync(dir, { recursive: true });
      const next = makeNextRelease(CLIENT200, path.join(dir, 'release-201'), '2.0.1-test');
      const appPath = path.join(dir, 'TexaCore ERP.app'); const userData = path.join(dir, 'userdata');
      ditto(CLIENT200, appPath); wrapClient(appPath);
      const rel = releaseFiles(next);
      for (const k of Object.keys(rel.files)) if (k.endsWith('.zip')) rel.files[k].tamper = true;
      mock = createMockGithub({ port: MOCK_PORT, releases: { 'v2.0.1-test': { files: rel.files } }, latest: 'v2.0.1-test' });
      await mock.listen();
      const env = { TEXACORE_HEADLESS: '1', TEXACORE_PORT_BASE: '47391', TEXACORE_USER_DATA: userData, TEXACORE_STUB_TUNNEL: '1', TEXACORE_STUB_MDM: '1', TEXACORE_E2E_AUTOSTART: '1', TEXACORE_E2E_LICENSE: 'free',
        TEXACORE_UPDATE_TEST: '1', TEXACORE_UI_SMOKE: '1', TEXACORE_SHOT_DIR: shots };
      app = launch(appPath, { userData, tag: 'tamper2', env });
      await R.check('T2 TAMPERED FILE REFUSED by 2.0.0, and the "downloading…" notice is withdrawn (installer window and the ERP page status both back to idle)', async () => {
        await until(() => /E2E_READY/.test(fs.readFileSync(path.join(WORK, 'app-tamper2.log'), 'utf8')), 240000, '2.0.0 to be ready', 1000);
        const secrets = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'secrets.json'), 'utf8'));
        const H = { 'x-texacore-local-secret': secrets.localApiSecret };
        await until(() => /sha512 mismatch/.test(logOf(userData)), 240000, 'the sha512 mismatch', 1000);
        await sleep(1500);
        if (fs.existsSync(path.join(userData, 'updates', 'staged.json'))) throw new Error('a staged.json exists');
        const u = await request('GET', `http://127.0.0.1:${PORTS.admin}/api/ui-update?shot=tamper2-after-refusal.png`, { headers: H });
        const st = await request('GET', `http://127.0.0.1:${PORTS.admin}/api/update/status`, { headers: H });
        if (!u.json || !u.json.ok) throw new Error(`ui-update ${u.text.slice(0, 200)}`);
        if (u.json.widget.shown) throw new Error(`the installer window still shows the widget: ${JSON.stringify(u.json.widget)}`);
        if (st.json.state !== 'idle') throw new Error(`update status is ${st.text}`);
        evidence.tamper2 = { widget: u.json.widget, status: st.json };
        return `sha512 mismatch logged; no staged.json; installer-window widget hidden; GET /api/update/status → ${st.text}`;
      });
      await stop(app); await mock.close(); mock = null;
    }

    // ════════ hop b: 2.0.0 → 2.0.1-test ════════
    if (HOPS.includes('b')) {
      if (!CLIENT200) throw new Error('--client200 is required for hop b');
      const dir = path.join(WORK, 'hop-b'); fs.mkdirSync(dir, { recursive: true });
      const next = makeNextRelease(CLIENT200, path.join(dir, 'release-201'), '2.0.1-test');
      const nextMeta = parseYml(path.join(next, 'latest-mac.yml'));
      const appPath = path.join(dir, 'TexaCore ERP.app'); const userData = path.join(dir, 'userdata');
      ditto(CLIENT200, appPath); wrapClient(appPath);
      const rel = releaseFiles(next);
      mock = createMockGithub({ port: MOCK_PORT, releases: { 'v2.0.1-test': { files: rel.files } }, latest: 'v2.0.1-test' });
      await mock.listen();
      const shotDir = shots;
      const env = { TEXACORE_HEADLESS: '1', TEXACORE_PORT_BASE: '47391', TEXACORE_USER_DATA: userData, TEXACORE_STUB_TUNNEL: '1', TEXACORE_STUB_MDM: '1', TEXACORE_E2E_AUTOSTART: '1', TEXACORE_E2E_LICENSE: 'free',
        TEXACORE_UPDATE_TEST: '1', TEXACORE_UI_SMOKE: '1', TEXACORE_SHOT_DIR: shotDir };
      app = launch(appPath, { userData, tag: 'b-client', env });
      let secrets = null; const dataDir = path.join(userData, 'texacore-data');
      const H = () => ({ 'x-texacore-local-secret': secrets.localApiSecret });
      await R.check('B1 DETECTION + DOWNLOAD: 2.0.0 (unmodified, real feed URLs) finds 2.0.1-test, downloads it, verifies sha512, stages it', async () => {
        await until(() => /E2E_READY/.test(fs.readFileSync(path.join(WORK, 'app-b-client.log'), 'utf8')), 240000, '2.0.0 to be ready', 1000);
        secrets = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8'));
        await until(() => /staged v/.test(logOf(userData)), 240000, 'the update to be staged', 1000);
        const log = logOf(userData);
        if (!/update available: v2\.0\.1-test/.test(log) || !/sha512 verified/.test(log)) throw new Error('detection / sha512 lines missing');
        const chain = mockRows(mock).slice(0, 3);
        if (!/^302 github\.com\/feras1960\/TexaCore-Installer\/releases\/latest\/download\/latest-mac\.yml/.test(chain[0] || '')) throw new Error(`feed request: ${chain[0]}`);
        const blocked = fs.existsSync(path.join(WORK, 'net-b-client.jsonl')) ? fs.readFileSync(path.join(WORK, 'net-b-client.jsonl'), 'utf8').split('\n').filter((l) => /BLOCKED/.test(l)).length : 0;
        return `feed ${chain[0]}; update available v2.0.1-test; sha512 verified; staged; ${blocked} non-mock outbound attempt(s) were refused by the harness (nothing reached the internet)`;
      });
      await R.check('B2 THE PROMPT in the installer window: «Update v2.0.1-test is ready — installs on restart» + «Restart now»', async () => {
        const u = await request('GET', `http://127.0.0.1:${PORTS.admin}/api/ui-update?shot=b-2.0.0-update-ready.png`, { headers: H() });
        if (!u.json || !u.json.ok) throw new Error(`ui-update ${u.text.slice(0, 200)}`);
        const w = u.json.widget;
        if (!w.shown || !w.restartVisible || !w.text.includes('2.0.1-test')) throw new Error(`widget ${JSON.stringify(w)}`);
        const st = await request('GET', `http://127.0.0.1:${PORTS.admin}/api/update/status`, { headers: H() });
        if (st.json.state !== 'ready' || st.json.version !== '2.0.1-test') throw new Error(`status ${st.text}`);
        // the same banner in Arabic (RTL) and English (LTR) — through the real renderer's language switch (a screenshot of the window each)
        const banners = {};
        for (const lang of ['ar', 'en']) {
          const e = await request('POST', `http://127.0.0.1:${PORTS.admin}/api/ui-eval`, { headers: H(), body: { size: [900, 640], wait: 500, shot: `b-update-banner-${lang}.png`,
            js: `(() => { const s = document.getElementById('lang-select'); s.value = '${lang}'; onLangChange(); window.scrollTo(0, 0); const w = document.getElementById('update-widget');
              return { text: document.getElementById('update-text').textContent, restart: document.getElementById('update-restart-btn').textContent, later: document.getElementById('update-later-btn').textContent,
                dir: document.documentElement.dir, ready: w.classList.contains('ready'), shown: getComputedStyle(w).display !== 'none' }; })()` } });
          if (!e.json || !e.json.ok) throw new Error(`ui-eval ${e.text.slice(0, 200)}`);
          const b = e.json.result;
          if (!b.shown || !b.ready || !b.text.includes('2.0.1-test') || !b.restart) throw new Error(`banner (${lang}) ${JSON.stringify(b)}`);
          banners[lang] = b;
        }
        evidence.banners = banners;
        return `"${w.text}" [${w.restartText}] [${w.laterText}] (lang ${w.lang}); AR (${banners.ar.dir}): "${banners.ar.text}" [${banners.ar.restart}]; EN (${banners.en.dir}): "${banners.en.text}" [${banners.en.restart}]; screenshots shots/b-update-banner-{ar,en}.png; GET /api/update/status → ${st.text}`;
      });
      if (ERP) {
        await R.check('B3 THE PROMPT in the ERP page (what a subscriber sees in the browser): the header pill «Update v2.0.1-test ready» + «Restart to install» (two-click confirm)', async () => {
          const cc = await request('POST', `http://127.0.0.1:${PORTS.admin}/api/create-local-company`, { headers: H(), body: { companyName: 'OTA Co', adminEmail: 'owner@ota.test', adminPassword: 'OtaPass#2026', localCurrency: 'UAH', mainCurrency: 'USD', country: 'UA', storagePath: path.join(dir, 'tcdb'), dbFileName: 'ota' } });
          if (!cc.json || !cc.json.success) throw new Error(`company: ${cc.text.slice(0, 160)}`);
          const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));
          const browser = await chromium.launch({ channel: 'chrome', headless: true });
          try {
            const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
            await page.goto(`http://127.0.0.1:${PORTS.ui}/login?c=${String(cc.json.companyId).split('-')[0]}`, { waitUntil: 'networkidle', timeout: 90000 });
            await page.fill('input[type="text"]', 'owner@ota.test'); await page.fill('input[type="password"]', 'OtaPass#2026');
            await page.locator('button[type="submit"]').first().click();
            await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
            const pill = page.locator('button:has(svg.lucide-rotate-cw)').first();
            await pill.waitFor({ state: 'visible', timeout: 90000 });
            const container = pill.locator('xpath=..');
            const text = (await container.innerText()).replace(/\s+/g, ' ').trim();
            await page.screenshot({ path: path.join(shots, 'b-erp-page-update-pill.png') });
            if (!/2\.0\.1-test/.test(text) && !/2\.0\.1-test/.test(await container.innerHTML())) throw new Error(`pill text "${text}"`);
            await pill.click(); const armed = (await pill.innerText()).trim();           // 1st click arms (the button turns into «Confirm restart?»)
            await pill.click();                                                          // 2nd click POSTs /api/update/install
            evidence.erpPill = { text, afterFirstClick: armed };
            return `header pill: "${text}"; after the 1st click: "${armed}"; the 2nd click requested the install (screenshot shots/b-erp-page-update-pill.png)`;
          } finally { await browser.close(); }
        });
      } else {
        await R.check('B3 THE PROMPT in the ERP page', async () => { throw new Error('skipped: --erp (Playwright) not given'); });
      }
      await R.check('B4 RESTART TO INSTALL: the app quits, the detached script swaps the bundle (ad-hoc signed, no quarantine) — 2.0.0 becomes 2.0.1-test', async () => {
        if (!ERP) { const c = await request('POST', `http://127.0.0.1:${PORTS.admin}/api/update/install`, { headers: H() }); if (!c.json || !c.json.success) throw new Error(`install request ${c.text}`); }
        const ex = await Promise.race([app.exited, sleep(90000).then(() => null)]);
        if (!ex) throw new Error('the app did not quit');
        const il = path.join(userData, 'logs', 'mac-update-install.log');
        await until(() => fs.existsSync(il) && /staging cleaned — done/.test(fs.readFileSync(il, 'utf8')), 120000, 'the installer script', 1000);
        if (plistVersion(appPath) !== '2.0.1-test' || pkgVersion(appPath) !== '2.0.1-test') throw new Error(`bundle is ${plistVersion(appPath)} / ${pkgVersion(appPath)}`);
        const cs = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' });
        if (cs.status !== 0) throw new Error(`codesign: ${cs.stderr.slice(0, 160)}`);
        if (/com\.apple\.quarantine/.test(spawnSync('/usr/bin/xattr', ['-r', appPath], { encoding: 'utf8' }).stdout)) throw new Error('quarantine set');
        const text = fs.readFileSync(il, 'utf8').trim().split('\n').map((l) => l.replace(/^\[[^\]]+\]\s*/, '')).filter(Boolean);
        return `exit ${ex.code}; install log: ${text.slice(0, 6).join(' | ').slice(0, 300)}; bundle now ${plistVersion(appPath)}, codesign OK, staging removed`;
      });
      await R.check('B5 THE NEW APP STARTS with the data it had: same secrets, same database, the company is still there', async () => {
        await sleep(2000);
        const log2 = path.join(WORK, 'app-b-new.log');
        app = launch(appPath, { userData, tag: 'b-new', env: { ...env, TEXACORE_UPDATE_TEST: '0' } });
        await until(() => fs.existsSync(log2) && /E2E_READY/.test(fs.readFileSync(log2, 'utf8')), 240000, 'the updated app to be ready', 1000);
        const sec2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8'));
        if (sec2.jwtSecret !== secrets.jwtSecret || sec2.dbPassword !== secrets.dbPassword) throw new Error('secrets changed across the update');
        const v = await request('GET', `http://127.0.0.1:${PORTS.admin}/api/ui-smoke`, { headers: { 'x-texacore-local-secret': sec2.localApiSecret } });
        if (!v.json || v.json.version !== '2.0.1-test') throw new Error(`running version ${v.json && v.json.version}`);
        const comp = await request('GET', `http://127.0.0.1:${PORTS.admin}/api/companies`, { headers: { 'x-texacore-local-secret': sec2.localApiSecret } });
        if (!comp.json || !comp.json.companies || !comp.json.companies.some((c) => c.name === 'OTA Co')) throw new Error(`companies ${comp.text.slice(0, 120)}`);
        const aside = fs.readdirSync(userData).filter((n) => /v18-backup|interrupted/.test(n) || /v18-backup|interrupted/.test(n));
        const asideInData = fs.readdirSync(dataDir).filter((n) => /interrupted|v18/.test(n));
        if (aside.length || asideInData.length) throw new Error(`something was set aside: ${aside} ${asideInData}`);
        await stop(app);
        return `running v${v.json.version}; the same JWT secret / database password; company "OTA Co" still listed; nothing set aside or rebuilt (a finished 2.0 install is reused as it is)`;
      });
      await mock.close(); mock = null;
    }
  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 });
    console.log(`  FAIL  harness — ${e.message}`);
  } finally {
    await stop(app).catch(() => {}); if (mock) await mock.close().catch(() => {});
  }
  fs.writeFileSync(path.join(WORK, 'ota-results.json'), JSON.stringify({ at: new Date().toISOString(), summary: R.summary(), rel: { version: releaseMeta.version, files: releaseMeta.files }, evidence, rows: R.rows }, null, 2));
  console.log(`\nota-check: ${R.summary()}  →  ${path.join(WORK, 'ota-results.json')}`);
  process.exit(R.failed.length ? 1 : 0);
})();
