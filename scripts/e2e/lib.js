'use strict';
// Shared helpers for the release launch check (scripts/e2e/launch-check.js).
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PORT_BASE = 47391;
const PORTS = { pg: PORT_BASE, postgrest: PORT_BASE + 1, gotrue: PORT_BASE + 2, api: PORT_BASE + 3, ui: PORT_BASE + 4, admin: PORT_BASE + 5 };

// The superuser password of the install under test (secrets.json → dbPassword): every connection to PostgreSQL authenticates (scram-sha-256).
let _pgPassword = '';
function setPgPassword(p) { _pgPassword = p || ''; }
function pgOptions(extra = {}) { return { host: '127.0.0.1', port: PORT_BASE, database: 'postgres', user: 'postgres', password: _pgPassword, ...extra }; }

class Results {
  constructor() { this.rows = []; this.warnings = []; }
  async check(name, fn) {
    const t0 = Date.now();
    try {
      const evidence = await fn();
      this.rows.push({ name, ok: true, evidence: evidence === undefined ? '' : String(evidence), ms: Date.now() - t0 });
      console.log(`  PASS  ${name}${evidence !== undefined && evidence !== '' ? `  — ${evidence}` : ''}`);
    } catch (e) {
      this.rows.push({ name, ok: false, evidence: e.message, ms: Date.now() - t0 });
      console.log(`  FAIL  ${name}  — ${e.message}`);
    }
  }
  get failed() { return this.rows.filter((r) => !r.ok); }
  summary() { return `${this.rows.length - this.failed.length}/${this.rows.length} checks passed`; }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

/** Small JSON/text HTTP client: returns { status, headers, text, json }. */
function request(method, url, { headers = {}, body, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout,
      headers: { ...(payload && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}), ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout: ${method} ${url}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Start the installer headless in dev mode; resolves { child, ready } once E2E_READY is printed. */
function startApp({ userData, license = 'free', logFile, appBinary = '', extraEnv = {} }) {
  fs.mkdirSync(userData, { recursive: true });
  const out = fs.openSync(logFile, 'a');
  // appBinary = the PACKAGED app's executable (…/TexaCore ERP.app/Contents/MacOS/TexaCore ERP); otherwise Electron dev mode on this checkout
  const child = spawn(appBinary || path.join(ROOT, 'node_modules', '.bin', 'electron'), appBinary ? [] : ['.'], {
    cwd: appBinary ? path.dirname(appBinary) : ROOT, stdio: ['ignore', out, out], detached: false,
    env: {
      ...process.env,
      TEXACORE_HEADLESS: '1', TEXACORE_PORT_BASE: String(PORT_BASE), TEXACORE_USER_DATA: userData,
      TEXACORE_TCDB_DIR: path.join(path.dirname(userData), 'restore-tcdb'), TEXACORE_STUB_TUNNEL: '1', TEXACORE_STUB_MDM: '1', TEXACORE_E2E_AUTOSTART: '1', TEXACORE_E2E_LICENSE: license, ...extraEnv,
    },
  });
  const ready = new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      let text = '';
      try { text = fs.readFileSync(logFile, 'utf8'); } catch { /* not yet */ }
      const m = /E2E_READY (\{.*\})/.exec(text);
      if (m) { clearInterval(iv); const j = JSON.parse(m[1]); j.ok ? resolve(j) : reject(new Error(`app failed to start: ${j.error}`)); }
      else if (child.exitCode !== null) { clearInterval(iv); reject(new Error(`electron exited early (code ${child.exitCode})`)); }
      else if (Date.now() - t0 > 300000) { clearInterval(iv); reject(new Error('timed out waiting for E2E_READY')); }
    }, 1000);
  });
  return { child, ready };
}

async function stopApp(child, userData) {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => { const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } r(); }, 25000); child.once('exit', () => { clearTimeout(t); r(); }); });
  }
  // the app's before-quit stops PG; make sure of it (only OUR data dir, only if a postmaster.pid is left)
  const pgdata = path.join(userData, 'texacore-data', 'pgdata');
  if (fs.existsSync(path.join(pgdata, 'postmaster.pid'))) {
    const pgCtl = path.join(ROOT, 'bin', 'macos-arm64', 'pg', 'bin', 'pg_ctl');
    try { require('child_process').execFileSync(pgCtl, ['stop', '-D', pgdata, '-m', 'fast', '-w', '-t', '20'], { stdio: 'ignore' }); } catch { /* best effort */ }
  }
}

module.exports = { ROOT, PORTS, PORT_BASE, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions };
