#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// windows-smoke — drives the INSTALLED, PUBLISHED desktop build on a hosted Windows runner (.github/workflows/windows-smoke.yml).
// It is the Windows counterpart of the Mac launch-check (scripts/e2e/launch-check.js, 101/101 on the packaged app): the same harness
// switches, the same local APIs, the same company / document cycle, run against the real installed exe.
//
//   node scripts/e2e/windows-smoke.js harness   --exe <installed exe> --app-dir <…/resources/app> --work <dir> --out <dir> [--playwright-dir <dir>]
//   node scripts/e2e/windows-smoke.js real      --exe … --app-dir … --out <dir> --net-blocked true|false
//   node scripts/e2e/windows-smoke.js collect   --out <dir> --user-data <dir> [--user-data <dir> …]
//   node scripts/e2e/windows-smoke.js summarize --out <dir>
//
// harness  The installed exe in the launch-check harness mode (its own userData + port block, headless, no cloud): first run, health checks,
//          the free-plan company, the document cycle (material, customer, opening stock, posted sales invoice, receipt voucher → paid),
//          export / restore, a real browser login, a graceful quit, a relaunch and proof that everything persisted.
// real     The exe launched the way a user launches it (no harness switches, default ports, %APPDATA% data): the window opens, «Start Free»
//          is clicked in the real window, the services come up on the default ports, a company is created. Run with the app's outbound
//          network blocked by the firewall (the workflow proves the block works first) so no licence is ever registered online.
//
// Public repository: no SQL beyond a handful of read-only health SELECTs, no production ids, no secrets. Test values only.
// Every per-install secret is masked in the Actions log (::add-mask::) and scrubbed from every file that is uploaded.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cp = require('child_process');
const { createRequire } = require('module');
const { Results, request } = require('./lib');

const argv = process.argv.slice(2);
const CMD = argv[0] || '';
const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const args = (n) => argv.reduce((a, v, i) => (v === `--${n}` && argv[i + 1] !== undefined ? a.concat(argv[i + 1]) : a), []);
const OUT = path.resolve(arg('out', 'smoke-out'));
const IS_WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0All = Date.now();

// test values only — a throw-away install on a throw-away runner
const OWNER = { email: 'owner@smoke.test', password: 'SmokePass#2026' };
const COMPANY = { name: 'شركة الفحص التجريبية', file: 'شركة-الفحص', currency: 'SYP', main: 'USD', country: 'SY' };

const secretValues = new Set([OWNER.password]);      // scrubbed from every uploaded file (a test value, but there is no reason to publish it)
function mask(v) {
  if (!v || typeof v !== 'string' || v.length < 6) return;
  if (!secretValues.has(v) && process.env.GITHUB_ACTIONS) process.stdout.write(`::add-mask::${v}\n`);     // the Actions log hides it from here on
  secretValues.add(v);
}
function loadSecrets(userData) {
  const s = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'secrets.json'), 'utf8'));
  for (const v of Object.values(s)) if (typeof v === 'string') mask(v);
  return s;
}

// ─── the app's own node_modules give us pg + ws (no npm install of the whole project) ───
function appRequire(appDir) { return createRequire(path.join(appDir, 'package.json')); }

// ─── processes ───
function listProcs() {
  try {
    if (IS_WIN) {
      const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress -Depth 2'], { encoding: 'utf8', maxBuffer: 128 << 20, timeout: 60000 });
      const j = JSON.parse(out || '[]');
      return (Array.isArray(j) ? j : [j]).map((p) => ({ pid: p.ProcessId, name: p.Name || '', exe: p.ExecutablePath || '', cmd: p.CommandLine || '' }));
    }
    const out = cp.execFileSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 128 << 20 });
    return out.split('\n').filter(Boolean).map((l) => { const m = /^\s*(\d+)\s+(.*)$/.exec(l); const first = (m[2] || '').split(' --')[0]; return { pid: Number(m[1]), name: path.basename(first), exe: first, cmd: m[2] || '' }; });
  } catch (e) { return []; }
}
const lower = (s) => String(s || '').toLowerCase();
/** processes of THIS install: executables under the install root, or a command line naming the run's data folder */
function installProcs(installRoot, dataRoots) {
  const root = lower(installRoot); const roots = dataRoots.filter(Boolean).map(lower);
  return listProcs().filter((p) => p.pid !== process.pid && ((p.exe && lower(p.exe).startsWith(root)) || roots.some((d) => lower(p.cmd).includes(d))));
}
function killTree(pid) {
  try { if (IS_WIN) cp.execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
function waitExit(child, ms) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    child.once('exit', () => { clearTimeout(t); resolve(true); });
  });
}
const portOpen = (port, host = '127.0.0.1', ms = 2500) => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: ms });
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.on('timeout', () => { s.destroy(); resolve(false); });
});

// ─── Node inspector (--inspect) and Chromium DevTools (--remote-debugging-port): a graceful quit and a real click, both from outside ───
async function cdp(port, kind, expression, { awaitPromise = false, timeout = 20000, method = 'Runtime.evaluate', params = null } = {}) {
  const list = await request('GET', `http://127.0.0.1:${port}/json/list`, { timeout: 8000 });
  const targets = Array.isArray(list.json) ? list.json : [];
  const target = kind === 'page' ? targets.find((t) => t.type === 'page') : targets[0];
  if (!target || !target.webSocketDebuggerUrl) throw new Error(`no ${kind} target on ${port}`);
  const WebSocket = cdp.WebSocket;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.terminate(); } catch { /* */ } resolve({ timedOut: true }); }, timeout);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params: params || { expression, returnByValue: true, awaitPromise } })));
    ws.on('message', (m) => { let j; try { j = JSON.parse(String(m)); } catch { return; } if (j.id === 1) { clearTimeout(timer); try { ws.close(); } catch { /* */ } resolve(j.result || j.error || j); } });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('close', () => { clearTimeout(timer); resolve({ closed: true }); });
  });
}

/** Ask the running app to quit the way its tray's «Quit» does (app.quit → before-quit → final backup → services stopped), then wait for the exit. */
async function gracefulQuit(h) {
  const t0 = Date.now(); let how = 'app.quit() through the Node inspector';
  try { await cdp(h.inspectPort, 'node', "process.mainModule.require('electron').app.quit()", { timeout: 10000 }); }
  catch (e) { how = `inspector unavailable (${e.message})`; }
  let exited = await waitExit(h.child, 120000);
  let graceful = exited;
  if (!exited) { how += ' → did not exit in 120 s, killed'; killTree(h.child.pid); exited = await waitExit(h.child, 30000); }
  return { ms: Date.now() - t0, how, graceful, exitCode: h.child.exitCode };
}

// ─── launching the app ───
function launch({ exe, env, extraArgs, logFile }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const child = cp.spawn(exe, extraArgs, { cwd: path.dirname(exe), stdio: ['ignore', out, out], env, windowsHide: false });
  child.once('error', (e) => fs.appendFileSync(logFile, `\nspawn error: ${e.message}\n`));
  return child;
}
function readFrom(file, offset) { try { const b = fs.readFileSync(file); return b.subarray(Math.min(offset, b.length)).toString('utf8'); } catch { return ''; } }
/** E2E_READY is printed to stdout and written to the app's own heartbeat.log: take whichever shows up (a GUI exe may not have a stdout on Windows). */
async function waitReady({ child, logFile, hbFile, hbOffset, timeoutMs }) {
  const t0 = Date.now();
  for (;;) {
    const text = readFrom(logFile, 0) + '\n' + readFrom(hbFile, hbOffset);
    const m = /E2E_READY (\{.*\})/.exec(text);
    if (m) { const j = JSON.parse(m[1]); return { ...j, ms: Date.now() - t0, log: text }; }
    if (child.exitCode !== null) throw new Error(`the app exited early (code ${child.exitCode}) before it was ready`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`no E2E_READY after ${Math.round(timeoutMs / 1000)} s`);
    await sleep(1000);
  }
}

// ─── multipart for the restore route (as launch-check does it) ───
function multipart(file, filename, fields0 = {}) {
  const fields = { confirmReplaceAll: 'true', ...fields0 };
  const b = '----winsmoke' + crypto.randomBytes(6).toString('hex'); const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
  return { ct: `multipart/form-data; boundary=${b}`, body: Buffer.concat(parts) };
}
function rawPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', agent: false, headers: { ...headers, 'Content-Length': body.length } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* */ } resolve({ status: res.statusCode, json, text: buf.toString('utf8').slice(0, 400) }); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

/** Open a .tcdb with the INSTALLED app's own BackupManager and measure the line endings of the SQL inside (counts only - no SQL leaves this function). */
async function analyzeTcdb(appDir, file, dataDir) {
  const BM = appRequire(appDir)(path.join(appDir, 'src', 'backup-manager.js'));
  const bm = new BM({ pgBinDir: path.join(appDir, '..', 'bin', 'pg', 'bin'), dbPassword: 'x', dataDir });
  const parsed = bm._parseTcdbFile(fs.readFileSync(file));
  const sql = await bm._decompress(bm._decryptParsed(parsed, '').data);
  let crlf = 0; let lf = 0;
  for (let i = 0; i < sql.length; i++) if (sql[i] === 10) { if (i > 0 && sql[i - 1] === 13) crlf += 1; else lf += 1; }
  const lines = sql.toString('latin1').split('\n'); let inCopy = false; let copyBlocks = 0; let blocksWithData = 0; let crlfBlocks = 0; let blockData = 0; let blockCr = 0;
  for (const raw of lines) {
    const l = raw.replace(/\r$/, '');
    if (!inCopy) { if (/^COPY .* FROM stdin;$/.test(l)) { inCopy = true; copyBlocks += 1; blockData = 0; blockCr = 0; } continue; }
    if (l === '\\.') { inCopy = false; if (blockData) { blocksWithData += 1; if (blockCr) crlfBlocks += 1; } continue; }
    blockData += 1; if (raw.endsWith('\r')) blockCr += 1;
  }
  return { bytes: sql.length, crlf, lf, copyBlocks, blocksWithData, crlfBlocks };
}

/** Results are written after EVERY check (a cancelled / timed-out step still leaves its evidence) and a watchdog stops the phase at its time budget. */
function guardPhase(name, R, extra, minutes, cleanup) {
  const orig = R.check.bind(R);
  R.check = async (n, fn) => { await orig(n, fn); try { writeResults(name, R, typeof extra === 'function' ? extra() : extra); } catch { /* best effort */ } };
  const timer = setTimeout(() => {
    R.rows.push({ name: `${name} time budget`, ok: false, evidence: `the phase used its ${minutes}-minute budget and was stopped; the results above are what it had finished`, ms: 0 });
    try { writeResults(name, R, typeof extra === 'function' ? extra() : extra); } catch { /* */ }
    try { cleanup(); } catch { /* */ }
    console.log(`  FAIL  ${name} — time budget of ${minutes} minutes used`);
    process.exit(1);
  }, minutes * 60 * 1000);
  return () => clearTimeout(timer);
}
/** Kill whatever an earlier phase left running from this install (and say so). */
function sweepLeftovers(R, installRoot, label) {
  const left = installProcs(installRoot, []);
  if (!left.length) return;
  warn(R, `${label}: processes left behind by the previous phase`, `${[...new Set(left.map((p) => p.name))].join(', ')} (${left.length}) were still running from this install and were killed before this phase started`);
  for (const p of left) killTree(p.pid);
}

function writeResults(name, R, extra = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = R.rows.map((r) => ({ name: r.name, ok: r.ok, skipped: !!r.skipped, warn: !!r.warn, evidence: String(r.evidence || '').slice(0, 900), ms: r.ms }));
  fs.writeFileSync(path.join(OUT, `results-${name}.json`), JSON.stringify({ at: new Date().toISOString(), summary: R.summary(), seconds: Math.round((Date.now() - t0All) / 1000), rows, ...extra }, null, 2));
}
/** A real finding that does not stop the run: it is listed as WARN in the summary (the product still did its job on this OS). */
function warn(R, name, evidence) { R.rows.push({ name, ok: true, warn: true, evidence, ms: 0 }); console.log(`  WARN  ${name} — ${evidence}`); }
function skip(R, name, why) { R.rows.push({ name, ok: true, skipped: true, evidence: why, ms: 0 }); console.log(`  SKIP  ${name} — ${why}`); }

// ═════════════════════════════════════════════════════════════════════════════════════════
//  HARNESS PHASE
// ═════════════════════════════════════════════════════════════════════════════════════════
async function harness() {
  const EXE = path.resolve(arg('exe')); const APP_DIR = path.resolve(arg('app-dir'));
  const WORK = path.resolve(arg('work')); const BASE = Number(arg('port-base', '47391'));
  const PW_DIR = arg('playwright-dir', ''); const WANT_VERSION = arg('version', '2.0.6'); const WANT_MIGRATIONS = Number(arg('migrations', '111'));
  const INSPECT = Number(arg('inspect-port', '9339'));
  const INSTALL_ROOT = path.resolve(APP_DIR, '..', '..');
  const req = appRequire(APP_DIR); const { Client } = req('pg'); cdp.WebSocket = req('ws');
  const P = { pg: BASE, postgrest: BASE + 1, gotrue: BASE + 2, api: BASE + 3, ui: BASE + 4, admin: BASE + 5 };
  const UI = `http://127.0.0.1:${P.ui}`; const API = `http://127.0.0.1:${P.api}`; const ADMIN = `http://127.0.0.1:${P.admin}`;
  const R = new Results();
  const S = {};      // state across checks
  let handle = null;
  guardPhase('harness', R, () => ({ userData: path.join(WORK, arg('user-data-name', 'userdata')), firstMs: S.firstMs, processes: S.procNames, platform: `${process.platform} ${os.release()}` }), Number(arg('budget-min', '15')),
    () => { if (handle && handle.child) killTree(handle.child.pid); for (const p of installProcs(INSTALL_ROOT, [path.join(WORK, 'userdata')])) killTree(p.pid); });
  sweepLeftovers(R, INSTALL_ROOT, 'harness');
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  const userData = path.join(WORK, arg('user-data-name', 'userdata')); const dataDir = path.join(userData, 'texacore-data');
  const hbFile = path.join(userData, 'logs', 'heartbeat.log');
  console.log(`windows-smoke harness: exe=${EXE}\n  work=${WORK}  ports ${BASE}-${BASE + 5}  platform=${process.platform}`);
  for (const p of Object.values(P)) if (await portOpen(p)) { console.error(`port ${p} is already in use`); process.exit(2); }

  let secrets = null; let pgPassword = '';
  const pg = async (sql, params = []) => { const c = new Client({ host: '127.0.0.1', port: P.pg, database: 'postgres', user: 'postgres', password: pgPassword }); await c.connect(); try { return await c.query(sql, params); } finally { await c.end(); } };
  const H = () => ({ 'x-texacore-local-secret': secrets.localApiSecret });
  const admin = (m, p, b) => request(m, `${ADMIN}${p}`, { headers: H(), body: b });
  let launchNo = 0;

  const start = async (label) => {
    launchNo += 1;
    const logFile = path.join(WORK, `app-${launchNo}.log`);
    const hbOffset = fs.existsSync(hbFile) ? fs.statSync(hbFile).size : 0;
    const env = { ...process.env, TEXACORE_HEADLESS: '1', TEXACORE_PORT_BASE: String(BASE), TEXACORE_USER_DATA: userData, TEXACORE_TCDB_DIR: path.join(WORK, 'restore-tcdb'),
      TEXACORE_STUB_TUNNEL: '1', TEXACORE_STUB_MDM: '1', TEXACORE_E2E_AUTOSTART: '1', TEXACORE_E2E_LICENSE: 'free', TEXACORE_UI_SMOKE: '1' };
    const t0 = Date.now();
    const child = launch({ exe: EXE, env, extraArgs: [`--inspect=127.0.0.1:${INSPECT}`], logFile });
    handle = { child, inspectPort: INSPECT, logFile };
    const ready = await waitReady({ child, logFile, hbFile, hbOffset, timeoutMs: 20 * 60 * 1000 });
    if (!ready.ok) throw new Error(`the app reported a failed start: ${ready.error}`);
    return { ...ready, wallMs: Date.now() - t0, label };
  };

  try {
    // ── 1. first run ──
    let first = null;
    await R.check('H1 first launch of the installed exe: initdb → baseline → migrations → services up (E2E_READY)', async () => {
      first = await start('first');
      secrets = loadSecrets(userData); pgPassword = secrets.dbPassword;
      const startAll = /\[E2E\] startAll → (\{.*\})/.exec(first.log); const sa = startAll ? JSON.parse(startAll[1]) : {};
      S.firstMs = first.ms;
      return `ready in ${Math.round(first.ms / 1000)} s; ports ${first.ports.pg}-${first.ports.admin}; startAll ${JSON.stringify({ success: sa.success, firstRun: sa.firstRun })}`;
    });
    if (!first) throw new Error('the app did not start: nothing else can be checked');

    await R.check('H2 bootstrap marker is ready; the data folder holds the cluster, logs and secrets', async () => {
      const m = JSON.parse(fs.readFileSync(path.join(dataDir, 'bootstrap.json'), 'utf8'));
      if (m.status !== 'ready') throw new Error(`bootstrap status ${m.status}`);
      for (const f of ['pgdata', 'logs', 'secrets.json']) if (!fs.existsSync(path.join(dataDir, f))) throw new Error(`missing ${f}`);
      return `status ${m.status}, baseline cut ${m.baselineCut}, sha ${String(m.baselineSha256).slice(0, 12)}…`;
    });
    await R.check('H3 PostgreSQL 17.6 (Windows build), ICU en-US collation, UTC, UTF8', async () => {
      const r = (await pg(`SELECT current_setting('server_version') v, current_setting('TimeZone') tz, d.datlocprovider p, d.datlocale l, pg_encoding_to_char(d.encoding) e, current_setting('port') port
                             FROM pg_database d WHERE d.datname='postgres'`)).rows[0];
      if (!r.v.startsWith('17.6')) throw new Error(`server ${r.v}`);
      if (r.p !== 'i' || r.l !== 'en-US') throw new Error(`collation provider ${r.p} / ${r.l}`);
      if (r.tz !== 'UTC' || r.e !== 'UTF8') throw new Error(`tz ${r.tz} enc ${r.e}`);
      return `${r.v} provider=${r.p} locale=${r.l} tz=${r.tz} ${r.e}`;
    });
    await R.check(`H4 schema migrations: ${WANT_MIGRATIONS} applied, 0 failed`, async () => {
      const r = (await pg(`SELECT count(*)::int n, count(*) FILTER (WHERE name LIKE '%\\_\\_FAILED')::int failed FROM public._texacore_migrations`)).rows[0];
      if (r.failed !== 0) throw new Error(`${r.failed} migration(s) marked __FAILED`);
      if (r.n !== WANT_MIGRATIONS) throw new Error(`${r.n} migrations recorded, expected ${WANT_MIGRATIONS}`);
      return `${r.n} applied, ${r.failed} __FAILED`;
    });
    await R.check('H5 database authentication: SCRAM for everyone (no password / a wrong password refused), pg_hba has no trust rule, PostgreSQL listens on 127.0.0.1 only', async () => {
      const attempt = async (opts) => { const c = new Client({ host: '127.0.0.1', port: P.pg, database: 'postgres', user: 'postgres', connectionTimeoutMillis: 8000, ...opts }); c.on('error', () => {}); try { await c.connect(); await c.query('SELECT 1'); return 'accepted'; } catch (e) { return 'refused'; } finally { try { await c.end(); } catch { /* */ } } };
      const none = await attempt({ password: undefined }); const wrong = await attempt({ password: 'definitely-wrong' }); const right = await attempt({ password: pgPassword });
      if (none !== 'refused' || wrong !== 'refused' || right !== 'accepted') throw new Error(`no password → ${none}; wrong → ${wrong}; right → ${right}`);
      const hba = fs.readFileSync(path.join(dataDir, 'pgdata', 'pg_hba.conf'), 'utf8').split('\n').filter((l) => l.trim() && !/^\s*#/.test(l));
      if (!hba.length || hba.some((l) => /\btrust\b/.test(l) || !/scram-sha-256\s*$/.test(l))) throw new Error(`pg_hba.conf rules: ${hba.join(' | ')}`);
      const s = (await pg(`SELECT current_setting('listen_addresses') la, current_setting('password_encryption') pe`)).rows[0];
      if (s.la !== '127.0.0.1' || s.pe !== 'scram-sha-256') throw new Error(`settings ${JSON.stringify(s)}`);
      return `none/wrong refused, right accepted; ${hba.length} pg_hba rules all scram-sha-256; listen_addresses ${s.la}`;
    });
    await R.check('H6 admin API: /api/ping open; everything else needs the install secret (none → 401, wrong → 401, right → 200)', async () => {
      const ping = await request('GET', `${ADMIN}/api/ping`); if (ping.status !== 200) throw new Error(`ping ${ping.status}`);
      const none = await request('GET', `${ADMIN}/api/companies`); const wrong = await request('GET', `${ADMIN}/api/companies`, { headers: { 'x-texacore-local-secret': 'nope' } }); const ok = await admin('GET', '/api/companies');
      if (none.status !== 401 || wrong.status !== 401 || ok.status !== 200) throw new Error(`companies: ${none.status}/${wrong.status}/${ok.status}`);
      return 'ping 200; companies 401 / 401 / 200';
    });
    await R.check(`H7 local UI root responds 200 and serves the ${WANT_VERSION} web bundle (every referenced asset 200 and not HTML, local fonts)`, async () => {
      const idx = await request('GET', `${UI}/`); if (idx.status !== 200) throw new Error(`/ → ${idx.status}`);
      if (!new RegExp(`name="texacore-app-version" content="${WANT_VERSION.replace(/\./g, '\\.')}"`).test(idx.text)) throw new Error(`index.html lacks the ${WANT_VERSION} stamp`);
      if (/fonts\.(googleapis|gstatic)\.com/.test(idx.text)) throw new Error('index.html loads Google Fonts');
      const refs = [...idx.text.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|woff2))"/g)].map((m) => m[1]); let n = 0;
      for (const ref of refs) { const r = await request('GET', `${UI}${ref}`); const ct = String(r.headers['content-type'] || ''); if (r.status !== 200 || /text\/html/.test(ct)) throw new Error(`${ref} → ${r.status} ${ct}`); n += 1; }
      const fonts = await request('GET', `${UI}/fonts/fonts.css`); const w2 = /url\(\.\/([^)]+\.woff2)\)/.exec(fonts.text);
      const font = w2 ? await request('GET', `${UI}/fonts/${w2[1]}`) : { status: 0, headers: {} };
      if (fonts.status !== 200 || font.status !== 200) throw new Error('local fonts not served');
      return `/ 200 (${idx.text.length} bytes), ${n} referenced assets ok, fonts.css + ${w2[1]}`;
    });
    await R.check('H8 /config.js: the page gets the anon key and the admin secret only on a same-origin request; never the service key / JWT / database password', async () => {
      const same = await request('GET', `${UI}/config.js`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }); const cross = await request('GET', `${UI}/config.js`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
      if (!same.text.includes(secrets.anonKey) || !same.text.includes(secrets.localApiSecret)) throw new Error('same-origin config.js lacks the anon key / secret');
      if (cross.text.includes(secrets.localApiSecret)) throw new Error('a cross-site request received the admin secret');
      for (const t of [same.text, cross.text]) if (t.includes(secrets.serviceKey) || t.includes(secrets.jwtSecret) || t.includes(secrets.dbPassword)) throw new Error('config.js leaks a server secret');
      if (!same.text.includes(`appVersion: "${WANT_VERSION}"`)) throw new Error(`appVersion is not ${WANT_VERSION}`);
      return `appVersion ${WANT_VERSION}; secret only same-origin`;
    });
    await R.check('H9 the installer window works on this OS (hidden window: preload bridge, IPC, renderer, i18n against the live services)', async () => {
      const r = await admin('GET', '/api/ui-smoke'); if (r.status !== 200 || !r.json || !r.json.ok) throw new Error(`ui-smoke → ${r.status} ${r.text.slice(0, 300)}`);
      const u = r.json; if (u.version !== WANT_VERSION) throw new Error(`window reports version ${u.version}`);
      if (!(u.bridgeKeys >= 20)) throw new Error(`preload bridge exposes only ${u.bridgeKeys} functions`);
      return `window v${u.version}: ${u.bridgeKeys} bridge functions, state + secret over IPC, i18n ${u.i18n ? u.i18n.length : 0}`;
    });

    // ── 2. the free-plan company (the path the wizard takes) ──
    const storage = path.join(WORK, 'company files');
    await R.check(`H10 create a company on the free plan (${COMPANY.country}, ${COMPANY.currency} + ${COMPANY.main}, Arabic name and Arabic file name, a folder with a space): success, owner session, company file written`, async () => {
      const r = await admin('POST', '/api/create-local-company', { companyName: COMPANY.name, adminEmail: OWNER.email, adminPassword: OWNER.password, localCurrency: COMPANY.currency, mainCurrency: COMPANY.main, country: COMPANY.country, storagePath: storage, dbFileName: COMPANY.file });
      if (!r.json || !r.json.success) throw new Error(`failed: ${r.text.slice(0, 300)}`);
      S.A = r.json; if (!S.A.companyId || !S.A.accessToken) throw new Error('response lacks companyId / session'); mask(S.A.accessToken); mask(S.A.refreshToken);
      const f = S.A.tcdbPath || S.A.plannedTcdbPath;
      let written = '';
      for (let i = 0; i < 60 && f; i++) { if (fs.existsSync(f) && fs.readFileSync(f).subarray(0, 4).toString('latin1') === 'TCDB') { written = f; break; } await sleep(1000); }
      if (!written) throw new Error(`no .tcdb company file appeared at ${f}`);
      S.liveFile = written;
      return `company ${S.A.companyId.slice(0, 8)}…; file «${path.basename(written)}» (${fs.statSync(written).size} bytes, TCDB magic)`;
    });
    if (!S.A) throw new Error('no company: the cycle cannot run');
    const CO = S.A.companyId; const TENANT = S.A.tenantId;
    let token = S.A.accessToken;
    const signIn = async () => { const r = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: secrets.anonKey }, body: { email: OWNER.email, password: OWNER.password } }); if (r.status !== 200 || !r.json.access_token) throw new Error(`owner sign-in → ${r.status} ${r.text.slice(0, 160)}`); mask(r.json.access_token); token = r.json.access_token; return r.json; };
    const auth = () => ({ apikey: secrets.anonKey, Authorization: `Bearer ${token}` });
    const rest = (m, p, b, prefer = 'return=representation') => request(m, `${API}/rest/v1/${p}`, { headers: { ...auth(), Prefer: prefer }, body: b });
    const rpc = (n, b) => request('POST', `${API}/rest/v1/rpc/${n}`, { headers: auth(), body: b });
    const must = (r, what, ok = [200, 201]) => { if (!ok.includes(r.status)) throw new Error(`${what} → ${r.status} ${r.text.slice(0, 260)}`); return r.json; };

    await R.check('H11 the owner signs in through GoTrue and sees exactly his company; the plan is Free / active with the core modules on', async () => {
      await signIn();
      const cos = must(await rest('GET', 'companies?select=id,name_ar,tenant_id'), 'companies');
      if (cos.length !== 1 || cos[0].id !== CO) throw new Error(`the owner sees ${cos.length} companies`);
      const plan = (await pg(`SELECT sp.code, ts.status, (SELECT count(*)::int FROM tenant_modules tm WHERE tm.tenant_id=ts.tenant_id AND tm.is_active) mods,
                                     (SELECT array_agg(module_code ORDER BY module_code) FROM tenant_modules tm WHERE tm.tenant_id=ts.tenant_id AND tm.is_active AND tm.module_code IN ('accounting','sales','inventory','purchases','fabric')) core
                                FROM tenant_subscriptions ts JOIN subscription_plans sp ON sp.id=ts.plan_id WHERE ts.tenant_id=$1`, [TENANT])).rows[0];
      if (!plan || plan.code !== 'free' || plan.status !== 'active') throw new Error(`plan ${JSON.stringify(plan)}`);
      if ((plan.core || []).length < 5) throw new Error(`core modules on: ${(plan.core || []).join(',')}`);
      return `1 company visible; plan ${plan.code}/${plan.status}, ${plan.mods} modules (core: ${plan.core.join(', ')})`;
    });
    await R.check('H12 free plan limits are enforced: a second company for the same owner is refused (PLAN_LIMIT_EXCEEDED)', async () => {
      const r = await admin('POST', '/api/create-local-company', { companyName: 'Second', adminEmail: OWNER.email, adminPassword: OWNER.password, localCurrency: 'USD', mainCurrency: 'USD', country: 'US', storagePath: storage, dbFileName: 'second', callerAccessToken: token });
      if (!r.json || r.json.success !== false || !/PLAN_LIMIT_EXCEEDED/.test(r.text)) throw new Error(`expected a plan-limit refusal, got ${r.text.slice(0, 260)}`);
      const n = (await pg('SELECT count(*)::int n FROM public.companies WHERE tenant_id=$1', [TENANT])).rows[0].n; if (n !== 1) throw new Error(`${n} companies after the refusal`);
      return 'refused with PLAN_LIMIT_EXCEEDED, still 1 company';
    });

    // ── 3. the document cycle (all through the owner's REST session: RLS, triggers and the posting RPCs of the real schema) ──
    const ccy = (await pg('SELECT public.fx_company_currency($1) AS c', [CO])).rows[0].c;
    await R.check('H13 master data as the owner: a material (Arabic name, standard / loose stock) and a customer with its party account', async () => {
      const mat = must(await rest('POST', 'fabric_materials', { tenant_id: TENANT, company_id: CO, code: 'SMK-M-001', name_ar: 'مادة الفحص ١٢٣', selling_price: 100, unit: 'piece', material_type: 'standard', is_roll_tracked: false, track_serial: false }), 'material')[0];
      const cust = must(await rest('POST', 'customers', { tenant_id: TENANT, company_id: CO, code: 'SMK-C-001', name_ar: 'زبون الفحص' }), 'customer')[0];
      const parent = must(await rest('GET', `chart_of_accounts?company_id=eq.${CO}&account_code=eq.1132&select=id,account_type_id`), 'receivables account')[0];
      if (!parent) throw new Error('the company chart has no receivables account 1132');
      const party = must(await rest('POST', 'chart_of_accounts', { tenant_id: TENANT, company_id: CO, account_code: '1132-SMK001', name_ar: 'زبون الفحص', is_group: false, is_detail: true, account_type_id: parent.account_type_id, parent_id: parent.id, is_party_account: true, party_type: 'customer', party_id: cust.id, currency: ccy }), 'party account')[0];
      must(await rest('PATCH', `customers?id=eq.${cust.id}`, { receivable_account_id: party.id }), 'link the party account');
      const wh = must(await rest('GET', 'warehouses?select=id,code&limit=5'), 'warehouses'); if (wh.length !== 1) throw new Error(`${wh.length} warehouses on a fresh free company`);
      Object.assign(S, { mat: mat.id, cust: cust.id, party: party.id, wh: wh[0].id });
      const back = must(await rest('GET', `fabric_materials?id=eq.${mat.id}&select=name_ar`), 'reread')[0];
      if (back.name_ar !== 'مادة الفحص ١٢٣') throw new Error(`Arabic name stored as «${back.name_ar}»`);
      return `material, customer, party account ${'1132-SMK001'} in ${ccy}, 1 warehouse; the Arabic name round-trips byte for byte`;
    });
    await R.check('H14 opening stock through post_opening_stock (50 @ 60): one posted balanced entry, one movement, stock 50', async () => {
      const acc = must(await rest('GET', `chart_of_accounts?company_id=eq.${CO}&account_code=eq.35&select=id`), 'opening-balance account')[0];
      must(await rest('PATCH', `company_accounting_settings?company_id=eq.${CO}`, { default_opening_balance_account_id: acc.id }), 'accounting setting');
      const r = must(await rpc('post_opening_stock', { p_company_id: CO, p_warehouse_id: S.wh, p_lines: [{ item_id: S.mat, quantity: 50, unit_cost: 60 }], p_request_key: 'smoke-opening-1', p_date: null, p_notes: 'smoke' }), 'post_opening_stock');
      if (!r.success || Number(r.total) !== 3000) throw new Error(`post_opening_stock → ${JSON.stringify(r).slice(0, 240)}`);
      const lines = must(await rest('GET', `journal_entry_lines?entry_id=eq.${r.journal_entry_id}&select=debit,credit`), 'entry lines');
      const dr = lines.reduce((x, l) => x + Number(l.debit), 0); const cr = lines.reduce((x, l) => x + Number(l.credit), 0);
      if (dr !== 3000 || cr !== 3000) throw new Error(`entry Dr ${dr} / Cr ${cr}`);
      const st = must(await rest('GET', `inventory_stock?material_id=eq.${S.mat}&select=quantity_on_hand,average_cost`), 'stock')[0];
      if (Number(st.quantity_on_hand) !== 50 || Number(st.average_cost) !== 60) throw new Error(`stock ${JSON.stringify(st)}`);
      return `entry Dr ${dr} / Cr ${cr}; stock 50 @ 60`;
    });
    await R.check('H15 a sales invoice is created and POSTED through create_and_post_direct_sale (3 @ 100): SI number, stage posted, balanced entry with cost of sales 180, stock 47', async () => {
      const r = must(await rpc('create_and_post_direct_sale', { p_header: { company_id: CO, tenant_id: TENANT, customer_id: S.cust, warehouse_id: S.wh, stock_warehouse_id: S.wh, currency: ccy, payment_terms_days: 0 },
        p_lines: [{ material_id: S.mat, quantity: 3, unit: 'piece', unit_price: 100, tax_rate: 0, warehouse_id: S.wh }], p_rolls: [], p_idempotency_key: crypto.randomUUID() }), 'create_and_post_direct_sale');
      S.invoice = r.invoice_id || (r.posting && r.posting.invoice_id); if (!S.invoice) throw new Error(`no invoice id in ${JSON.stringify(r).slice(0, 240)}`);
      const inv = must(await rest('GET', `sales_transactions?id=eq.${S.invoice}&select=stage,is_posted,invoice_no,total_amount,paid_amount,balance,journal_entry_id,customer_id`), 'invoice')[0];
      if (inv.stage !== 'posted' || inv.is_posted !== true || Number(inv.total_amount) !== 300 || Number(inv.paid_amount) !== 0 || Number(inv.balance) !== 300 || !/^SI-\d{4}-\d+$/.test(inv.invoice_no) || inv.customer_id !== S.cust) throw new Error(`invoice ${JSON.stringify(inv)}`);
      const lines = must(await rest('GET', `journal_entry_lines?entry_id=eq.${inv.journal_entry_id}&select=debit,credit,description`), 'invoice entry');
      const dr = lines.reduce((x, l) => x + Number(l.debit), 0); const cr = lines.reduce((x, l) => x + Number(l.credit), 0);
      if (dr !== cr || dr < 300) throw new Error(`invoice entry Dr ${dr} / Cr ${cr}`);
      const cogs = lines.filter((l) => /تكلفة مبيعات/.test(l.description || '') && Number(l.debit) > 0).reduce((x, l) => x + Number(l.debit), 0);
      if (cogs !== 180) throw new Error(`cost of sales ${cogs}, expected 180`);
      const st = must(await rest('GET', `inventory_stock?material_id=eq.${S.mat}&select=quantity_on_hand`), 'stock')[0]; if (Number(st.quantity_on_hand) !== 47) throw new Error(`stock ${st.quantity_on_hand}, expected 47`);
      S.invoiceNo = inv.invoice_no; S.invoiceEntry = inv.journal_entry_id;
      return `${inv.invoice_no} posted, total 300, entry Dr ${dr} / Cr ${cr}, cost of sales ${cogs}, stock 47`;
    });
    await R.check('H16 a receipt voucher linked to the invoice (cash Dr / customer Cr, posted) pays it in full: stage paid, paid 300, balance 0, one active allocation, no payment_receipts row', async () => {
      const cash = must(await rest('GET', `chart_of_accounts?company_id=eq.${CO}&account_code=eq.1111&select=id`), 'cash account')[0]; if (!cash) throw new Error('no cash account 1111');
      const before = (await pg('SELECT count(*)::int n FROM public.journal_entries WHERE company_id=$1', [CO])).rows[0].n;
      const r = must(await rpc('save_journal_entry_draft', { p_payload: { company_id: CO, entry_date: new Date().toISOString().slice(0, 10), entry_type: 'receipt', description: 'سند قبض فحص', currency: ccy, exchange_rate: 1, post: true, request_key: `smoke-rv-${crypto.randomUUID()}`, fund_account_id: cash.id,
        lines: [{ account_id: cash.id, debit: 300, credit: 0, currency: ccy, exchange_rate: 1, is_fund_line: true }, { account_id: S.party, debit: 0, credit: 300, currency: ccy, exchange_rate: 1, reference_type: 'invoice', reference_id: S.invoice }] } }), 'receipt voucher');
      if (r.success !== true || r.is_posted !== true) throw new Error(`voucher ${JSON.stringify(r).slice(0, 200)}`);
      const inv = must(await rest('GET', `sales_transactions?id=eq.${S.invoice}&select=stage,paid_amount,balance`), 'invoice')[0];
      if (inv.stage !== 'paid' || Number(inv.paid_amount) !== 300 || Number(inv.balance) !== 0) throw new Error(`invoice after the receipt ${JSON.stringify(inv)}`);
      const alloc = (await pg(`SELECT status, amount::float8 a FROM public.voucher_invoice_allocations WHERE sales_transaction_id=$1`, [S.invoice])).rows;
      if (JSON.stringify(alloc) !== JSON.stringify([{ status: 'active', a: 300 }])) throw new Error(`allocations ${JSON.stringify(alloc)}`);
      const rc = (await pg('SELECT count(*)::int n FROM public.payment_receipts WHERE sales_transaction_id=$1', [S.invoice])).rows[0].n; if (rc !== 0) throw new Error(`${rc} payment_receipts rows`);
      const after = (await pg('SELECT count(*)::int n FROM public.journal_entries WHERE company_id=$1', [CO])).rows[0].n; if (after !== before + 1) throw new Error(`entries ${before} → ${after}`);
      S.voucherEntry = r.entry_id;
      return `${S.invoiceNo}: stage ${inv.stage}, paid ${inv.paid_amount}, balance ${inv.balance}; one allocation 300; exactly one new entry`;
    });
    await R.check('H17 the books balance: every posted entry has Dr = Cr and the trial balance nets to zero', async () => {
      const bad = (await pg(`SELECT count(*)::int n FROM (SELECT l.entry_id FROM public.journal_entry_lines l JOIN public.journal_entries e ON e.id=l.entry_id WHERE e.company_id=$1 AND e.is_posted GROUP BY l.entry_id HAVING sum(l.debit) <> sum(l.credit)) x`, [CO])).rows[0].n;
      const tot = (await pg(`SELECT count(*)::int entries, coalesce(sum(l.debit),0)::float8 dr, coalesce(sum(l.credit),0)::float8 cr FROM public.journal_entry_lines l JOIN public.journal_entries e ON e.id=l.entry_id WHERE e.company_id=$1 AND e.is_posted`, [CO])).rows[0];
      if (bad !== 0 || tot.dr !== tot.cr) throw new Error(`${bad} unbalanced entries; Dr ${tot.dr} / Cr ${tot.cr}`);
      S.totals = tot; return `${tot.entries} posted lines, ${bad} unbalanced entries; total Dr ${tot.dr} = Cr ${tot.cr}`;
    });

    // ── 5. exposure on this machine ──
    await R.check('H20 listeners: PostgreSQL, PostgREST, GoTrue and the admin API refuse connections on the machine\'s LAN address; the web UI answers there and its /config.js carries no admin secret', async () => {
      const lan = require('../../src/lan-address').pickLanAddress(os.networkInterfaces());
      if (!lan || lan === '127.0.0.1') return 'skipped: this machine has no LAN address';
      const seen = [];
      for (const [name, port] of [['postgres', P.pg], ['postgrest', P.postgrest], ['gotrue', P.gotrue], ['admin API', P.admin]]) { if (await portOpen(port, lan)) throw new Error(`${name} (${port}) accepts connections on ${lan}`); if (!(await portOpen(port))) throw new Error(`${name} (${port}) is not listening on 127.0.0.1`); seen.push(name); }
      if (!(await portOpen(P.ui, lan))) throw new Error(`the web UI does not answer on ${lan}:${P.ui}`);
      const login = await request('GET', `http://${lan}:${P.ui}/login?c=${CO.split('-')[0]}`); if (login.status !== 200) throw new Error(`employee link → ${login.status}`);
      const cfg = await request('GET', `http://${lan}:${P.ui}/config.js`); if (cfg.text.includes(secrets.localApiSecret)) throw new Error('config.js over the LAN address carries the admin secret');
      const adm = await request('GET', `http://${lan}:${P.ui}/api/companies`, { headers: H() }); if (adm.status < 400) throw new Error(`the admin API answered ${adm.status} on the LAN address`);
      return `LAN address ${lan.replace(/\.\d+$/, '.x')}: ${seen.join(', ')} loopback-only; UI + employee link 200; /config.js without secret; /api/companies ${adm.status}`;
    });
    await R.check('H21 no secret appears on any process command line (JWT secret, the three database passwords, service key, admin secret)', async () => {
      const procs = listProcs(); const named = { jwtSecret: secrets.jwtSecret, dbPassword: secrets.dbPassword, authenticatorPassword: secrets.authenticatorPassword, authAdminPassword: secrets.authAdminPassword, serviceKey: secrets.serviceKey, localApiSecret: secrets.localApiSecret };
      const leaks = Object.entries(named).filter(([, v]) => v && procs.some((p) => p.cmd.includes(v))).map(([k]) => k);
      if (leaks.length) throw new Error(`on a command line: ${leaks.join(', ')}`);
      const mine = installProcs(INSTALL_ROOT, [userData]); S.procNames = [...new Set(mine.map((p) => p.name))].sort();
      return `${procs.length} process command lines searched (${mine.length} belong to this install: ${S.procNames.join(', ')}): none contains any of the 6 secrets`;
    });

    // ── the licence is bound to a hardware id; the app asks `wmic` for it, and wmic is gone from Windows 11 24H2 / Server 2025 ──
    try {
      const lic = JSON.parse(fs.readFileSync(path.join(dataDir, 'license.dat'), 'utf8'));
      const fallback = crypto.createHash('sha256').update(`FALLBACK-${os.hostname()}-${process.arch}`).digest('hex').slice(0, 16);
      const wmic = IS_WIN ? cp.spawnSync('where', ['wmic'], { encoding: 'utf8' }).status === 0 : true;
      const log = readFrom(path.join(WORK, 'app-1.log'), 0);
      if (lic.hw === fallback) warn(R, 'H21b hardware id of the licence', `FINDING: wmic.exe is ${wmic ? 'present' : 'NOT present'} on this Windows build and the licence is bound to the FALLBACK id (hostname + arch), not to the machine: ${/'wmic' is not recognized/.test(log) ? '«\'wmic\' is not recognized» is in the app log; ' : ''}renaming the PC would invalidate the cached licence (the app, license-guard.getHardwareId, shells out to wmic; the same tool is used for the disk and OS-edition telemetry)`);
      else R.rows.push({ name: 'H21b hardware id of the licence', ok: true, evidence: `the licence is bound to the machine id (not the hostname fallback); wmic ${wmic ? 'present' : 'absent'}`, ms: 0 });
    } catch (e) { warn(R, 'H21b hardware id of the licence', `could not read license.dat: ${e.message}`); }

    // ── 6. a real browser on the served page ──
    if (PW_DIR) {
      await R.check('H22 real browser (Chrome on this runner): the login page loads, the owner signs in through the real form and reaches the dashboard; Arabic fonts load', async () => {
        const out = cp.spawnSync(process.execPath, [path.join(__dirname, 'browser-login.cjs'), '--erp', PW_DIR, '--ui', UI, '--email', OWNER.email, '--password', OWNER.password, '--code', CO.split('-')[0], '--shots', path.join(OUT, 'shots')], { encoding: 'utf8', timeout: 240000 });
        if (out.status !== 0) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-700));
        return out.stdout.trim().split('\n').slice(-1)[0].replace(/\(screenshots:.*\)/, '').slice(0, 400);
      });
    } else skip(R, 'H22 real browser login', 'no --playwright-dir given');

    // ── 7. quit, relaunch, persistence ──
    const snapshot = async () => {
      await signIn();
      const mat = must(await rest('GET', `fabric_materials?id=eq.${S.mat}&select=name_ar,code`), 'material')[0]; const cust = must(await rest('GET', `customers?id=eq.${S.cust}&select=name_ar`), 'customer')[0];
      const inv = must(await rest('GET', `sales_transactions?id=eq.${S.invoice}&select=stage,invoice_no,total_amount,paid_amount,balance`), 'invoice')[0];
      const st = must(await rest('GET', `inventory_stock?material_id=eq.${S.mat}&select=quantity_on_hand`), 'stock')[0];
      const tot = (await pg(`SELECT count(*)::int n, coalesce(sum(l.debit),0)::float8 dr FROM public.journal_entry_lines l JOIN public.journal_entries e ON e.id=l.entry_id WHERE e.company_id=$1 AND e.is_posted`, [CO])).rows[0];
      const mig = (await pg(`SELECT count(*)::int n, count(*) FILTER (WHERE name LIKE '%\\_\\_FAILED')::int f FROM public._texacore_migrations`)).rows[0];
      return { mat: mat.name_ar, cust: cust.name_ar, inv: `${inv.invoice_no}/${inv.stage}/${inv.total_amount}/${inv.paid_amount}/${inv.balance}`, stock: Number(st.quantity_on_hand), lines: tot.n, dr: tot.dr, mig: `${mig.n}/${mig.f}` };
    };
    const before = await snapshot().catch((e) => { throw new Error(`snapshot before quit: ${e.message}`); });

    let quit1 = null;
    await R.check('H23 quit gracefully (the tray\'s «Quit» path: final backup, services stopped): the process exits, no postgres / postgrest / gotrue is left, the ports are closed, postmaster.pid is gone', async () => {
      quit1 = await gracefulQuit(handle);
      if (!quit1.graceful) throw new Error(`the app did not exit by itself (${quit1.how})`);
      await sleep(2500);
      const left = installProcs(INSTALL_ROOT, [userData]).filter((p) => p.pid !== handle.child.pid);
      const open = []; for (const [n, p] of Object.entries(P)) if (await portOpen(p)) open.push(`${n}:${p}`);
      const pidFile = fs.existsSync(path.join(dataDir, 'pgdata', 'postmaster.pid'));
      if (left.length || open.length || pidFile) throw new Error(`left behind: processes [${left.map((p) => p.name).join(', ')}], open ports [${open.join(', ')}], postmaster.pid ${pidFile}`);
      return `exit code ${quit1.exitCode} in ${Math.round(quit1.ms / 1000)} s (${quit1.how}); nothing left running`;
    });
    if (!quit1 || !quit1.graceful) { killTree(handle.child.pid); for (const p of installProcs(INSTALL_ROOT, [userData])) killTree(p.pid); await sleep(3000); }

    const waitRest = async () => {       // the gateway answers 502 for an instant after a restart: wait for PostgREST behind it, and say how long it took
      const t0 = Date.now();
      for (;;) { const r = await request('GET', `${API}/rest/v1/`, { headers: { apikey: secrets.anonKey }, timeout: 5000 }).catch(() => ({ status: 0 })); if (r.status === 200) return Date.now() - t0; if (Date.now() - t0 > 90000) throw new Error(`the REST gateway still answers ${r.status} 90 s after the app said it was ready`); await sleep(500); }
    };
    let second = null;
    await R.check('H24 relaunch the same installation: it starts WITHOUT rebuilding (no first run), in a fraction of the first start', async () => {
      second = await start('second');
      const sa = /\[E2E\] startAll → (\{.*\})/.exec(second.log); const j = sa ? JSON.parse(sa[1]) : {};
      if (j.success !== true) throw new Error(`startAll ${JSON.stringify(j)}`);
      if (j.firstRun === true) throw new Error('the second start was treated as a first run (rebuilt the database)');
      if (second.ms > first.ms) throw new Error(`the second start (${second.ms} ms) took longer than the first (${first.ms} ms)`);
      secrets = loadSecrets(userData); const restMs = await waitRest();
      return `second start ${Math.round(second.ms / 1000)} s vs first ${Math.round(first.ms / 1000)} s; firstRun ${j.firstRun}; REST gateway answered ${(restMs / 1000).toFixed(1)} s after the app reported ready`;
    });
    await R.check('H25 everything persisted across the restart: material and customer (Arabic, byte for byte), the invoice (still paid), the stock, every journal line, 111 migrations / 0 failed; the owner can sign in again', async () => {
      const after = await snapshot();
      for (const k of Object.keys(before)) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) throw new Error(`${k}: before ${JSON.stringify(before[k])} → after ${JSON.stringify(after[k])}`);
      const list = await admin('GET', '/api/companies'); if (!list.json || !list.json.success || !list.json.companies.some((c) => c.id === CO && c.name === COMPANY.name)) throw new Error(`companies after restart: ${list.text.slice(0, 200)}`);
      if (!fs.existsSync(S.liveFile)) throw new Error('the company file disappeared');
      return `identical: invoice ${after.inv}, stock ${after.stock}, ${after.lines} journal lines (Dr ${after.dr}), migrations ${after.mig}; company file still on disk`;
    });
    await R.check('H26 the system still works after the restart: a SECOND sale (2 @ 100) is posted and a partial receipt (50) leaves the invoice posted with balance 150', async () => {
      const r = must(await rpc('create_and_post_direct_sale', { p_header: { company_id: CO, tenant_id: TENANT, customer_id: S.cust, warehouse_id: S.wh, stock_warehouse_id: S.wh, currency: ccy, payment_terms_days: 0 },
        p_lines: [{ material_id: S.mat, quantity: 2, unit: 'piece', unit_price: 100, tax_rate: 0, warehouse_id: S.wh }], p_rolls: [], p_idempotency_key: crypto.randomUUID() }), 'second sale');
      const id = r.invoice_id || (r.posting && r.posting.invoice_id); const cash = must(await rest('GET', `chart_of_accounts?company_id=eq.${CO}&account_code=eq.1111&select=id`), 'cash')[0];
      must(await rpc('save_journal_entry_draft', { p_payload: { company_id: CO, entry_date: new Date().toISOString().slice(0, 10), entry_type: 'receipt', description: 'سند قبض جزئي', currency: ccy, exchange_rate: 1, post: true, request_key: `smoke-rv2-${crypto.randomUUID()}`, fund_account_id: cash.id,
        lines: [{ account_id: cash.id, debit: 50, credit: 0, currency: ccy, exchange_rate: 1, is_fund_line: true }, { account_id: S.party, debit: 0, credit: 50, currency: ccy, exchange_rate: 1, reference_type: 'invoice', reference_id: id }] } }), 'partial receipt');
      const inv = must(await rest('GET', `sales_transactions?id=eq.${id}&select=stage,paid_amount,balance,invoice_no`), 'invoice')[0];
      if (inv.stage !== 'posted' || Number(inv.paid_amount) !== 50 || Number(inv.balance) !== 150) throw new Error(`invoice ${JSON.stringify(inv)}`);
      const st = must(await rest('GET', `inventory_stock?material_id=eq.${S.mat}&select=quantity_on_hand`), 'stock')[0]; if (Number(st.quantity_on_hand) !== 45) throw new Error(`stock ${st.quantity_on_hand}`);
      return `${inv.invoice_no}: total 200, paid 50, balance 150, stage ${inv.stage}; stock 45`;
    });
    // ── 4. backup / export / restore (kept for last: a restore replaces the whole database) ──
    await R.check('H28 export a company file (.tcdb) from the app: lands in the company folder, TCDB magic, a second export gets «(2)», nothing half-written', async () => {
      const info = await admin('GET', '/api/backup-export-info'); if (!info.json || !info.json.success || !info.json.ready) throw new Error(`info ${info.text.slice(0, 200)}`);
      const a = await admin('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'TexaCore-smoke-export' });
      if (!a.json || !a.json.success || a.json.encrypted !== false) throw new Error(`export → ${a.text.slice(0, 250)}`);
      const b = await admin('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'TexaCore-smoke-export' });
      if (!b.json || !b.json.success || !/\(2\)\.tcdb$/.test(b.json.path)) throw new Error(`second export → ${b.text.slice(0, 250)}`);
      const bytes = fs.readFileSync(a.json.path); if (bytes.subarray(0, 4).toString('latin1') !== 'TCDB' || bytes.length < 10000) throw new Error(`not a .tcdb (${bytes.length} bytes)`);
      if (fs.readdirSync(path.dirname(a.json.path)).some((f) => f.endsWith('.tmp'))) throw new Error('a temp file was left behind');
      S.exportFile = a.json.path; return `${path.basename(a.json.path)} ${bytes.length} bytes (TCDB), then ${path.basename(b.json.path)}; platform ${info.json.platform}`;
    });
    await R.check('H29 the exported file is a clean dump: one line-ending style throughout (what pg_dump writes on this OS), consistent inside every COPY block', async () => {
      const a = await analyzeTcdb(APP_DIR, S.exportFile, dataDir);
      S.dump = a;
      const evidence = `${(a.bytes / 1e6).toFixed(1)} MB of SQL; line endings: ${a.crlf} CRLF / ${a.lf} LF-only; ${a.copyBlocks} COPY blocks, ${a.blocksWithData} with data, ${a.crlfBlocks} of them with CRLF data lines`;
      if (a.crlf > 0 && a.lf > 0) throw new Error(`mixed line endings — ${evidence}`);
      return evidence;
    });
    await R.check('H30 restore that export through the app (psql on Windows): success, and the company, the invoices (paid) and the entries are all still there', async () => {
      const count = async () => (await pg(`SELECT (SELECT count(*) FROM public.companies)::int c, (SELECT count(*) FROM public.journal_entries)::int je, (SELECT count(*) FROM public.sales_transactions)::int st, (SELECT count(*) FROM auth.users)::int u`)).rows[0];
      const c0 = await count(); const m = multipart(fs.readFileSync(S.exportFile), path.basename(S.exportFile));
      const tR = Date.now(); const r = await rawPost(`${UI}/api/restore-tcdb`, { ...H(), 'Content-Type': m.ct }, m.body); S.restoreSecs = Math.round((Date.now() - tR) / 1000);
      const log = readFrom(handle.logFile, 0);
      const errs = (/(\d+) restore COPY errors/.exec(log) || [])[1]; const firstErr = (/psql:[^\n]*?: ERROR:\s*([^\n]*)/.exec(log) || [])[1];
      const c1 = await count(); S.c0 = c0;
      const said = `the app answered ${r.status} ${r.json && r.json.success ? '«success»' : r.text.slice(0, 120)} after ${S.restoreSecs} s`;
      let safety = 0; try { safety = fs.readdirSync(path.join(dataDir, 'backups', 'pre-open')).filter((f) => f.endsWith('.tcdb')).length; } catch { /* none */ }
      if (errs || JSON.stringify(c0) !== JSON.stringify(c1)) S.restoreFailed = true;
      if (errs) throw new Error(`${said}, but the restore logged ${errs} COPY errors (first: «${String(firstErr).trim()}»); rows ${JSON.stringify(c0)} → ${JSON.stringify(c1)}${S.dump ? `; the dump has ${S.dump.crlf} CRLF line endings, ${S.dump.crlfBlocks} COPY blocks with CRLF data` : ''}; the app's pre-restore safety copies in backups/pre-open: ${safety}`);
      if (r.status !== 200 || !r.json || !r.json.success) throw new Error(`restore → ${r.status} ${r.text}`);
      if (JSON.stringify(c0) !== JSON.stringify(c1)) throw new Error(`rows changed ${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
      await signIn();
      const inv = must(await rest('GET', `sales_transactions?id=eq.${S.invoice}&select=stage,paid_amount,invoice_no`), 'invoice after restore')[0];
      if (!inv || inv.stage !== 'paid' || Number(inv.paid_amount) !== 300 || inv.invoice_no !== S.invoiceNo) throw new Error(`invoice after the restore ${JSON.stringify(inv)}`);
      return `restored in ${S.restoreSecs} s; rows ${JSON.stringify(c1)} unchanged; ${inv.invoice_no} still paid 300`;
    });

    let quit2 = null;
    await R.check('H32 diagnosis: the SAME dump with its CRLF line endings turned into LF (what a Mac / Linux dump has) is restored by the same app without a single COPY error, and the rows come back', async () => {
      if (!S.restoreFailed) return 'not needed: the plain restore above already worked';
      const BM = appRequire(APP_DIR)(path.join(APP_DIR, 'src', 'backup-manager.js'));
      const bm = new BM({ pgBinDir: path.join(APP_DIR, '..', 'bin', 'pg', 'bin'), dbPassword: 'x', dataDir });
      const sql = await bm._decompress(bm._decryptParsed(bm._parseTcdbFile(fs.readFileSync(S.exportFile)), '').data);
      const lf = Buffer.from(sql.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
      const gz = await bm._compress(lf); const file = bm._buildTcdbFile(bm._encrypt(gz, 'smoke-passphrase-1'), lf.length, gz.length);
      const m = multipart(file, 'lf-normalised.tcdb', { passphrase: 'smoke-passphrase-1' });
      const before = fs.readFileSync(handle.logFile, 'utf8').length;
      const tR = Date.now(); const r = await rawPost(`${UI}/api/restore-tcdb`, { ...H(), 'Content-Type': m.ct }, m.body); const secs = Math.round((Date.now() - tR) / 1000);
      const log = fs.readFileSync(handle.logFile, 'utf8').slice(before); const errs = (/(\d+) restore COPY errors/.exec(log) || [])[1];
      const c1 = (await pg(`SELECT (SELECT count(*) FROM public.companies)::int c, (SELECT count(*) FROM public.journal_entries)::int je, (SELECT count(*) FROM public.sales_transactions)::int st, (SELECT count(*) FROM auth.users)::int u`)).rows[0];
      if (r.status !== 200 || !r.json || !r.json.success || errs || JSON.stringify(c1) !== JSON.stringify(S.c0)) throw new Error(`the LF copy did not restore cleanly: ${r.status} ${errs ? errs + ' COPY errors' : ''} rows ${JSON.stringify(c1)} (expected ${JSON.stringify(S.c0)})`);
      return `restored in ${secs} s with 0 COPY errors; rows back to ${JSON.stringify(c1)} - the only difference is the line endings (${S.dump.crlf} CRLF -> LF): the restore script is built with LF terminators, the Windows dump has CRLF`;
    });
    await R.check('H31 final graceful quit: exits by itself, nothing left running', async () => {
      quit2 = await gracefulQuit(handle); if (!quit2.graceful) throw new Error(`the app did not exit by itself (${quit2.how})`);
      await sleep(2500);
      const left = installProcs(INSTALL_ROOT, [userData]); if (left.length) throw new Error(`left running: ${left.map((p) => p.name).join(', ')}`);
      return `exit code ${quit2.exitCode} in ${Math.round(quit2.ms / 1000)} s`;
    });
  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 }); console.log(`  FAIL  harness — ${e.message}`);
  } finally {
    if (handle && handle.child.exitCode === null) { killTree(handle.child.pid); await sleep(1500); }
    for (const p of installProcs(INSTALL_ROOT, [userData])) killTree(p.pid);
  }
  writeResults('harness', R, { userData, firstMs: S.firstMs, processes: S.procNames, platform: `${process.platform} ${os.release()}` });
  console.log(`\nwindows-smoke harness: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
//  REAL LAUNCH PHASE
// ═════════════════════════════════════════════════════════════════════════════════════════
function findUserData() {
  const roots = IS_WIN ? [process.env.APPDATA] : [path.join(os.homedir(), 'Library', 'Application Support'), path.join(os.homedir(), '.config')];
  for (const root of roots.filter(Boolean)) {
    for (const name of ['TexaCore ERP', 'texacore-installer']) { const d = path.join(root, name); if (fs.existsSync(path.join(d, 'texacore-data')) || fs.existsSync(path.join(d, 'logs'))) return d; }
  }
  return '';
}
async function real() {
  const EXE = path.resolve(arg('exe')); const APP_DIR = path.resolve(arg('app-dir')); const NET_BLOCKED = arg('net-blocked', 'false') === 'true';
  const WANT_VERSION = arg('version', '2.0.6'); const INSTALL_ROOT = path.resolve(APP_DIR, '..', '..');
  const req = appRequire(APP_DIR); cdp.WebSocket = req('ws');
  const INSPECT = 9229; const DEBUG = 9222; const UI = 'http://127.0.0.1:8080'; const ADMIN = 'http://127.0.0.1:1960'; const API = 'http://127.0.0.1:54321';
  const R = new Results(); const S = {}; let handle = null; let userData = '';
  guardPhase('real', R, () => ({ userData: findUserData(), netBlocked: NET_BLOCKED, realMs: S.realMs }), Number(arg('budget-min', '6.5')),
    () => { if (handle && handle.child) killTree(handle.child.pid); for (const p of installProcs(INSTALL_ROOT, [findUserData() || 'texacore-data'])) killTree(p.pid); });
  sweepLeftovers(R, INSTALL_ROOT, 'real');
  console.log(`windows-smoke real: exe=${EXE} outbound network ${NET_BLOCKED ? 'BLOCKED by the firewall (verified)' : 'NOT blocked'}`);
  for (const p of [8080, 1960, 54322, 3000, 9999, 54321]) if (await portOpen(p)) { console.error(`default port ${p} is already in use on this machine`); process.exit(2); }
  const logFile = path.join(OUT, 'real-app.log'); fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('TEXACORE_')) delete env[k];
  try {
    await R.check('R1 launch the installed exe the way a user does (no harness switches): the process stays up and the app window opens', async () => {
      const child = launch({ exe: EXE, env, extraArgs: [`--inspect=127.0.0.1:${INSPECT}`, `--remote-debugging-port=${DEBUG}`], logFile });
      handle = { child, inspectPort: INSPECT };
      let page = null;
      for (let i = 0; i < 90 && !page; i++) {
        if (child.exitCode !== null) throw new Error(`the app exited with code ${child.exitCode} right after the launch`);
        try { const l = await request('GET', `http://127.0.0.1:${DEBUG}/json/list`, { timeout: 4000 }); page = (l.json || []).find((t) => t.type === 'page'); } catch { /* not yet */ }
        if (!page) await sleep(1000);
      }
      if (!page) throw new Error('no window (page target) after 90 s');
      await sleep(4000);
      if (child.exitCode !== null) throw new Error(`the app exited with code ${child.exitCode} after opening its window`);
      userData = findUserData();
      S.title = page.title; return `window «${page.title}» (${String(page.url).replace(/^.*[\\/]/, '')}); pid ${child.pid} alive; data folder ${userData ? path.basename(userData) : 'not yet created'}`;
    });
    if (!handle) throw new Error('no launch');
    const shot = async (name) => { try { const r = await cdp(DEBUG, 'page', '', { method: 'Page.captureScreenshot', params: { format: 'png' } }); if (r && r.data) { fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true }); fs.writeFileSync(path.join(OUT, 'shots', name), Buffer.from(r.data, 'base64')); } } catch { /* evidence only */ } };
    await R.check('R2 the first-run screen is in the real window: the «Start Free» button is there and visible; the footer shows the version', async () => {
      let st = null;
      for (let i = 0; i < 30; i++) { st = (await cdp(DEBUG, 'page', "(() => { const b = document.getElementById('btn-free'); return { has: !!b, visible: !!(b && b.offsetParent), text: b ? b.textContent.trim() : '', body: document.body ? document.body.innerText.slice(0, 4000) : '' }; })()")).result; if (st && st.value && st.value.has) break; await sleep(1000); }
      const v = st && st.value; if (!v || !v.has) throw new Error('no #btn-free in the window');
      await shot('real-1-first-run.png');
      if (!v.body.includes(WANT_VERSION)) throw new Error(`the window text does not show ${WANT_VERSION}`);
      return `button «${v.text}» visible=${v.visible}; the window shows ${WANT_VERSION}`;
    });
    const logs = () => { const d = findUserData(); return d ? readFrom(path.join(d, 'logs', 'heartbeat.log'), 0) : ''; };
    await R.check('R3 heartbeat.log is written by the real launch (version, data folder) and has no uncaught exception', async () => {
      userData = findUserData(); if (!userData) throw new Error('no data folder under %APPDATA%');
      const t = logs(); if (!/TexaCore started/.test(t)) throw new Error('heartbeat.log lacks the start line');
      if (!t.includes(`Version: ${WANT_VERSION}`)) throw new Error(`no «Version: ${WANT_VERSION}» line`); if (/Uncaught exception/i.test(t)) throw new Error('uncaught exception logged');
      return `${path.basename(userData)}\\logs\\heartbeat.log ${t.length} bytes; ${(t.match(/Version:\s*([\d.]+)/) || [])[0] || ''}`;
    });
    if (!NET_BLOCKED) {
      skip(R, 'R4 click «Start Free» in the real window and wait for the services', 'the outbound-network block could not be verified on this runner; the real Start Free would register a licence online, so it was not clicked');
    } else {
      let ready = false;
      await R.check('R4 click «Start Free» in the real window (offline: outbound blocked): the first run builds the database and the services come up on the default ports', async () => {
        const t0 = Date.now(); await cdp(DEBUG, 'page', "document.getElementById('btn-free').click()");
        for (;;) {
          if (handle.child.exitCode !== null) throw new Error(`the app exited (code ${handle.child.exitCode}) during the first run`);
          const ping = await request('GET', `${ADMIN}/api/ping`, { timeout: 4000 }).catch(() => ({ status: 0 })); const ui = await request('GET', `${UI}/`, { timeout: 4000 }).catch(() => ({ status: 0 }));
          if (ping.status === 200 && ui.status === 200) break;
          if (Date.now() - t0 > 14 * 60 * 1000) throw new Error('services not up after 14 minutes');
          await sleep(3000);
        }
        ready = true; S.realMs = Date.now() - t0; await sleep(2000); await shot('real-2-running.png');
        const t = logs(); const free = (t.match(/Free activated[^\n]*/) || [''])[0].replace(/^.*Free activated/, 'Free activated');
        return `admin API + UI (http://127.0.0.1:8080) up ${Math.round(S.realMs / 1000)} s after the click; log: ${free || 'no «Free activated» line'}`;
      });
      if (ready) {
        userData = findUserData(); const secrets = loadSecrets(userData); const H = { 'x-texacore-local-secret': secrets.localApiSecret };
        let A = null;
        await R.check('R5 the default ports are the documented ones and the UI serves the app (/ 200, config.js carries the right version)', async () => {
          const cfg = await request('GET', `${UI}/config.js`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }); if (!cfg.text.includes(`appVersion: "${WANT_VERSION}"`)) throw new Error(`config.js appVersion is not ${WANT_VERSION}`);
          const open = []; for (const p of [8080, 1960, 54322, 3000, 9999, 54321]) open.push(`${p}:${(await portOpen(p)) ? 'up' : 'DOWN'}`); if (open.some((x) => x.endsWith('DOWN'))) throw new Error(open.join(' '));
          return open.join(' ');
        });
        await R.check('R6 create a company through the app\'s admin API on the default port (what the wizard calls) and sign in as its owner', async () => {
          const r = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: { companyName: COMPANY.name, adminEmail: OWNER.email, adminPassword: OWNER.password, localCurrency: COMPANY.currency, mainCurrency: COMPANY.main, country: COMPANY.country, storagePath: path.join(os.homedir(), 'TexaCore'), dbFileName: COMPANY.file } });
          if (!r.json || !r.json.success) throw new Error(`failed: ${r.text.slice(0, 300)}`); A = r.json; mask(A.accessToken); mask(A.refreshToken);
          const t = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: secrets.anonKey }, body: { email: OWNER.email, password: OWNER.password } }); if (t.status !== 200) throw new Error(`sign-in ${t.status}`);
          mask(t.json.access_token); const cos = await request('GET', `${API}/rest/v1/companies?select=id`, { headers: { apikey: secrets.anonKey, Authorization: `Bearer ${t.json.access_token}` } });
          if (cos.status !== 200 || cos.json.length !== 1 || cos.json[0].id !== A.companyId) throw new Error(`companies ${cos.status} ${cos.text.slice(0, 120)}`);
          const f = A.tcdbPath || A.plannedTcdbPath; return `company ${A.companyId.slice(0, 8)}…; sign-in 200; sees 1 company; file «${f ? path.basename(f) : '?'}»`;
        });
      }
    }
    await R.check('R8 quit gracefully: the process exits, nothing of this install is left running, the default ports are closed', async () => {
      const q = await gracefulQuit(handle); if (!q.graceful) throw new Error(`did not exit by itself (${q.how})`);
      await sleep(2500);
      const left = installProcs(INSTALL_ROOT, [findUserData() || 'texacore-data']); const open = []; for (const p of [8080, 1960, 54322, 3000, 9999, 54321]) if (await portOpen(p)) open.push(p);
      if (left.length || open.length) throw new Error(`left: processes [${left.map((p) => p.name).join(', ')}] ports [${open.join(', ')}]`);
      return `exit code ${q.exitCode} in ${Math.round(q.ms / 1000)} s`;
    });
  } catch (e) {
    R.rows.push({ name: 'real', ok: false, evidence: e.stack || e.message, ms: 0 }); console.log(`  FAIL  real — ${e.message}`);
  } finally {
    if (handle && handle.child.exitCode === null) { killTree(handle.child.pid); await sleep(1500); }
    for (const p of installProcs(INSTALL_ROOT, [findUserData() || 'texacore-data'])) killTree(p.pid);
  }
  writeResults('real', R, { userData: findUserData(), netBlocked: NET_BLOCKED, realMs: S.realMs });
  console.log(`\nwindows-smoke real: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
//  PHASE 3: the data folder under an Arabic folder name (a Windows account named in Arabic on a PC whose system code page is not Arabic)
// ═════════════════════════════════════════════════════════════════════════════════════════
async function unicode() {
  const EXE = path.resolve(arg('exe')); const APP_DIR = path.resolve(arg('app-dir')); const BASE = Number(arg('port-base', '47491'));
  const ROOT_DIR = arg('root', IS_WIN ? 'C:\\' : os.tmpdir()); const INSTALL_ROOT = path.resolve(APP_DIR, '..', '..');
  const req = appRequire(APP_DIR); cdp.WebSocket = req('ws');
  const R = new Results();
  const arabic = '\u0628\u064a\u0627\u0646\u0627\u062a \u0641\u062d\u0635';     // «بيانات فحص»
  const work = path.join(ROOT_DIR, arabic); const userData = path.join(work, 'userdata'); const hbFile = path.join(userData, 'logs', 'heartbeat.log');
  let child = null;
  guardPhase('unicode', R, { userData }, Number(arg('budget-min', '4')), () => { if (child) killTree(child.pid); for (const p of installProcs(INSTALL_ROOT, [work])) killTree(p.pid); });
  sweepLeftovers(R, INSTALL_ROOT, 'unicode');
  fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  try {
    const logFile = path.join(OUT, 'unicode-app.log'); fs.mkdirSync(OUT, { recursive: true });
    const env = { ...process.env, TEXACORE_HEADLESS: '1', TEXACORE_PORT_BASE: String(BASE), TEXACORE_USER_DATA: userData, TEXACORE_TCDB_DIR: path.join(work, 'restore'), TEXACORE_STUB_TUNNEL: '1', TEXACORE_STUB_MDM: '1', TEXACORE_E2E_AUTOSTART: '1', TEXACORE_E2E_LICENSE: 'free' };
    child = launch({ exe: EXE, env, extraArgs: [], logFile });
    let ready = null; let failure = '';
    try { ready = await waitReady({ child, logFile, hbFile, hbOffset: 0, timeoutMs: 6 * 60 * 1000 }); } catch (e) { failure = e.message; }
    const text = readFrom(logFile, 0);
    if (ready && ready.ok) R.rows.push({ name: 'U3 the app starts with its data folder under an Arabic folder name (first run: initdb, baseline, migrations)', ok: true, evidence: `ready in ${Math.round(ready.ms / 1000)} s with the data folder «${arabic}\\userdata»; this PC's ANSI code page can represent the folder name`, ms: 0 });
    else {
      const err = (ready && ready.error) || failure; const why = (/could not create directory[^\n]*/.exec(text) || /initdb[^\n]*error[^\n]*/.exec(text) || [''])[0].slice(0, 300);
      warn(R, 'U3 the app starts with its data folder under an Arabic folder name (first run: initdb, baseline, migrations)', `the first run FAILED: ${String(err).slice(0, 300)} ${why ? '| ' + why : ''} - PostgreSQL's initdb receives its -D path in the system ANSI code page (here Windows-1252, en-US), which cannot hold Arabic letters; on an Arabic Windows (code page 1256) the same folder name is representable. Affects an English-language Windows whose account / folder name is Arabic. NOT reproducible-proof for Arabic Windows (hosted runners are en-US).`);
    }
  } catch (e) { R.rows.push({ name: 'unicode', ok: false, evidence: e.stack || e.message, ms: 0 }); }
  finally {
    if (child && child.exitCode === null) { killTree(child.pid); await sleep(1500); }
    for (const p of installProcs(INSTALL_ROOT, [work])) killTree(p.pid);
  }
  writeResults('unicode', R, { userData });
  console.log(`\nwindows-smoke unicode: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
//  LOG COLLECTION (redacted) and SUMMARY
// ═════════════════════════════════════════════════════════════════════════════════════════
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const CLOUD_HOST_RE = /\b[a-z0-9]{18,24}\.supabase\.co\b/g;      // the app prints its cloud project's host in its presence log: a production id, not for a public artifact
function redact(text) {
  let t = String(text).replace(JWT_RE, '[jwt]').replace(CLOUD_HOST_RE, '[cloud-host].supabase.co').replace(/apikey=eyJ[^\s&"']*/g, 'apikey=[redacted]');
  for (const v of [...secretValues].sort((a, b) => b.length - a.length)) if (v && v.length >= 6) t = t.split(v).join('[secret]');
  return t.replace(/(x-texacore-local-secret["':\s=]+)[A-Za-z0-9_\-]{12,}/gi, '$1[secret]');
}
function collect() {
  const dest = path.join(OUT, 'logs'); fs.mkdirSync(dest, { recursive: true });
  const dirs = args('user-data').filter((d) => d && fs.existsSync(d));
  for (const d of dirs) { try { loadSecrets(d); } catch { /* none */ } }
  const wanted = (rel) => /\.(log|json|txt|yml)$/i.test(rel) && !/secrets|config\.json|license|\.enc$|pgdata/i.test(rel);
  let n = 0;
  dirs.forEach((d, i) => {
    const tag = `userdata-${i + 1}`; const tree = [];
    const walk = (dir, depth) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name); const rel = path.relative(d, f);
        if (/(^|[\\/])pgdata([\\/]|$)/.test(rel) && rel.split(/[\\/]/).length > 2) continue;
        if (e.isDirectory()) { tree.push(`${rel}\\`); if (depth < 4 && !/Cache|GPUCache|Code Cache|blob_storage|Local Storage|Session Storage|Network|Partitions/i.test(e.name)) walk(f, depth + 1); }
        else {
          const st = fs.statSync(f); tree.push(`${rel}  ${st.size}`);
          if (depth <= 2 && wanted(rel) && st.size < 20e6) { const buf = fs.readFileSync(f); const tail = buf.length > 400000 ? buf.subarray(buf.length - 400000) : buf; const outFile = path.join(dest, tag, rel); fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, redact(tail.toString('utf8'))); n += 1; }
        }
      }
    };
    try { walk(d, 0); } catch { /* best effort */ }
    fs.writeFileSync(path.join(dest, `${tag}-tree.txt`), redact(tree.join('\n')));
  });
  for (const f of fs.readdirSync(OUT).filter((x) => /^app-.*\.log$|^real-app\.log$/.test(x))) { fs.writeFileSync(path.join(dest, f), redact(fs.readFileSync(path.join(OUT, f), 'utf8'))); fs.rmSync(path.join(OUT, f)); n += 1; }
  // the harness keeps its app-N.log beside the work folder
  for (const d of dirs) { const wd = path.dirname(d); for (const f of fs.readdirSync(wd).filter((x) => /^app-.*\.log$/.test(x))) { fs.writeFileSync(path.join(dest, `${path.basename(wd)}-${f}`), redact(fs.readFileSync(path.join(wd, f), 'utf8'))); n += 1; } }
  // final scan: nothing uploaded may hold a secret
  const hits = []; const scan = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) scan(f); else if (/\.(log|json|txt|md|yml)$/i.test(f)) { const t = fs.readFileSync(f, 'utf8'); if (JWT_RE.test(t) || CLOUD_HOST_RE.test(t) || [...secretValues].some((v) => v.length >= 6 && t.includes(v))) hits.push(f); JWT_RE.lastIndex = 0; CLOUD_HOST_RE.lastIndex = 0; } } };
  scan(OUT);
  for (const f of hits) fs.rmSync(f, { force: true });
  fs.writeFileSync(path.join(OUT, 'secret-scan.json'), JSON.stringify({ filesCopied: n, secretsKnown: secretValues.size, filesRemovedForSecrets: hits.map((h) => path.relative(OUT, h)) }, null, 2));
  console.log(`collected ${n} redacted log files; secret scan: ${hits.length} file(s) removed`);
  process.exit(hits.length ? 1 : 0);
}

function summarize() {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return null; } };
  const install = read('install.json') || { checks: [] }; const h = read('results-harness.json'); const r = read('results-real.json'); const un = read('uninstall.json'); const scan = read('secret-scan.json');
  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const rows = []; const add = (group, list) => (list || []).forEach((c) => rows.push({ group, ...c }));
  const u3 = read('results-unicode.json');
  add('install', install.checks); add('harness', h && h.rows); add('real launch', r && r.rows); add('arabic folder', u3 && u3.rows); add('uninstall', un && un.checks);
  if (scan) rows.push({ group: 'artifact', name: 'A1 no secret in any uploaded file', ok: scan.filesRemovedForSecrets.length === 0, evidence: `${scan.filesCopied} redacted log files; ${scan.secretsKnown} per-install secret values scrubbed; ${scan.filesRemovedForSecrets.length} files removed` });
  const bad = rows.filter((x) => !x.ok); const skipped = rows.filter((x) => x.skipped); const warned = rows.filter((x) => x.warn);
  const md = [];
  md.push(`## Windows smoke test — published TexaCore ERP ${install.version || ''} installer`, '');
  md.push(`**${bad.length ? 'FAIL' : 'PASS'}** — ${rows.length - bad.length - skipped.length - warned.length} passed, ${bad.length} failed, ${warned.length} warnings (findings that did not stop the run), ${skipped.length} skipped (of ${rows.length}).`, '');
  if (warned.length) { md.push('**Findings (WARN):**', ''); warned.forEach((x) => md.push(`- ${esc(x.name)}: ${esc(x.evidence).slice(0, 700)}`)); md.push(''); }
  const f = install.facts || {};
  md.push(`Runner: ${esc(f.os)}; culture ${esc(f.culture)}; installer ${esc(install.sizeMB)} MB, sha256 ${esc(String(install.sha256 || '').slice(0, 16))}…; installed in ${esc(install.installSeconds)} s to \`${esc(install.installDir)}\`; first launch ready in ${h && h.firstMs ? Math.round(h.firstMs / 1000) + ' s' : 'n/a'}.`, '');
  md.push('| # | Group | Step | Result | Evidence |', '|---|---|---|---|---|');
  rows.forEach((x, i) => md.push(`| ${i + 1} | ${x.group} | ${esc(x.name).slice(0, 190)} | ${x.skipped ? 'SKIP' : x.warn ? '**WARN**' : x.ok ? 'PASS' : '**FAIL**'} | ${esc(x.evidence).slice(0, 420)} |`));
  fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ verdict: bad.length ? 'FAIL' : 'PASS', passed: rows.length - bad.length - skipped.length - warned.length, failed: bad.length, warnings: warned.length, skipped: skipped.length, total: rows.length, failedSteps: bad.map((x) => x.name), warnedSteps: warned.map((x) => x.name), install: { version: install.version, installSeconds: install.installSeconds, installDir: install.installDir, sizeMB: install.sizeMB, facts: install.facts }, harnessFirstStartSeconds: h && h.firstMs ? Math.round(h.firstMs / 1000) : null, realStartSeconds: r && r.realMs ? Math.round(r.realMs / 1000) : null }, null, 2));
  console.log(md.join('\n'));
  process.exit(bad.length ? 1 : 0);
}

(async () => {
  if (CMD === 'harness') return harness();
  if (CMD === 'real') return real();
  if (CMD === 'unicode') return unicode();
  if (CMD === 'collect') return collect();
  if (CMD === 'summarize') return summarize();
  console.error('usage: windows-smoke.js harness|real|collect|summarize …'); process.exit(2);
})().catch((e) => { console.error(e); process.exit(1); });
