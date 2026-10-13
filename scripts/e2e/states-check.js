#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// states-check — live proof of the data-dir policy on the real build (the unit tests cover the logic; this runs the app):
//   A. an INTERRUPTED first run (killed mid-baseline) is recognised as such — not as legacy_v18 — set aside, and rebuilt cleanly
//   B. a 1.x (PostgreSQL 15) data dir is moved aside WHOLE (config, backups and cluster intact), never reused, a fresh install is built
//   C. a finished install restarts without rebuilding (firstRun=false) and keeps its data
//   D. an UNFINISHED PostgreSQL-17 dir that still carries an old config (company list, backup paths) is sanitised — the auto-backup
//      must never overwrite the old .tcdb — and the original config is kept
//
//   node scripts/e2e/states-check.js --workdir <empty dir> [--app <packaged .app>]
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, PORTS, Results, portFree, startApp, stopApp } = require('./lib');
const bootstrap = require('../../src/bootstrap');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '');
if (!arg('workdir')) { console.error('--workdir <dir> is required'); process.exit(2); }
const binary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
const pgCtl = path.join(ROOT, 'bin', 'macos-arm64', 'pg', 'bin', 'pg_ctl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(100); }
}

(async () => {
  const R = new Results();
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  const readLog = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

  // ── A. interrupted first run ──
  const uA = path.join(WORK, 'A', 'userdata');
  const dA = path.join(uA, 'texacore-data');
  await R.check('A. a first run killed mid-baseline is classified interrupted_first_run (NOT legacy_v18)', async () => {
    const { child } = startApp({ userData: uA, logFile: path.join(WORK, 'A1.log'), appBinary: binary });
    child.on('error', () => {});
    await waitFor(() => { const m = bootstrap.readMarker(dA); return m && m.status === 'schema_loading'; }, 120000, 'schema_loading');
    child.kill('SIGKILL');                                                    // the app dies without any cleanup…
    await sleep(500);
    try { execFileSync(pgCtl, ['stop', '-D', path.join(dA, 'pgdata'), '-m', 'immediate', '-w'], { stdio: 'ignore' }); } catch { /* may already be down */ }   // …and PostgreSQL is cut off
    const d = bootstrap.detect(dA);
    if (d.state !== 'interrupted_first_run') throw new Error(`detect() says ${d.state} (${d.reason})`);
    return `detect → ${d.state} (${d.reason})`;
  });
  await R.check('A. restart: the half-built cluster is set aside (kept), a clean install is built', async () => {
    const { child, ready } = startApp({ userData: uA, logFile: path.join(WORK, 'A2.log'), appBinary: binary });
    try {
      const r = await ready;
      const log = readLog(path.join(WORK, 'A2.log'));
      if (!/interrupted first run/.test(log)) throw new Error('log does not mention the interrupted first run');
      if (!/"firstRun":true/.test(log)) throw new Error('not a first run');
      const aside = fs.readdirSync(dA).filter((n) => n.startsWith('pgdata.interrupted-'));
      if (aside.length !== 1) throw new Error(`set-aside dirs: ${aside.join(',') || 'none'}`);
      if (bootstrap.readMarker(dA).status !== 'ready') throw new Error('not ready');
      return `set aside ${aside[0]}; ready (ports ${r.ports.pg}-${r.ports.admin})`;
    } finally { await stopApp(child, uA); }
  });
  await R.check('C. a finished install restarts WITHOUT rebuilding, and keeps its data', async () => {
    const marker0 = bootstrap.readMarker(dA);
    const { child, ready } = startApp({ userData: uA, logFile: path.join(WORK, 'A3.log'), appBinary: binary });
    try {
      await ready;
      const log = readLog(path.join(WORK, 'A3.log'));
      if (!/"firstRun":false/.test(log)) throw new Error('rebuilt instead of restarting');
      const m = bootstrap.readMarker(dA);
      if (m.readyAt !== marker0.readyAt) throw new Error('marker was rewritten');
      return 'firstRun=false, marker untouched';
    } finally { await stopApp(child, uA); }
  });

  // ── B. a 1.x data dir ──
  const uB = path.join(WORK, 'B', 'userdata');
  const dB = path.join(uB, 'texacore-data');
  await R.check('B. a 1.x (PostgreSQL 15) data dir is moved aside whole and a fresh install is built', async () => {
    fs.mkdirSync(path.join(dB, 'pgdata'), { recursive: true });
    fs.writeFileSync(path.join(dB, 'pgdata', 'PG_VERSION'), '15\n');
    fs.writeFileSync(path.join(dB, 'pgdata', 'postgresql.conf'), '# 1.x cluster\n');
    fs.writeFileSync(path.join(dB, 'config.json'), JSON.stringify({ licenseKey: 'LEGACY-KEY-1', isTrial: true, subdomain: 'legacyco', storagePath: path.join(dB, 'backups'),
      companies: [{ name: 'Legacy Co', tcdbPath: path.join(dB, 'backups', 'old.tcdb') }] }));
    fs.writeFileSync(path.join(dB, 'license.dat'), 'legacy-licence-blob');
    fs.writeFileSync(path.join(dB, 'secrets.json'), JSON.stringify({ legacy: true, jwtSecret: 'texacore-jwt-secret-at-least-32-characters-long' }));
    fs.mkdirSync(path.join(dB, 'backups'));
    fs.writeFileSync(path.join(dB, 'backups', 'old.tcdb'), 'precious');
    const { child, ready } = startApp({ userData: uB, logFile: path.join(WORK, 'B.log'), appBinary: binary });
    try {
      await ready;
      const asides = fs.readdirSync(uB).filter((n) => n.startsWith('texacore-data.v18-backup-'));
      if (asides.length !== 1) throw new Error(`v18-backup dirs: ${asides.join(',') || 'none'}`);
      const moved = path.join(uB, asides[0]);
      if (fs.readFileSync(path.join(moved, 'pgdata', 'PG_VERSION'), 'utf8').trim() !== '15') throw new Error('old cluster not intact');
      if (fs.readFileSync(path.join(moved, 'backups', 'old.tcdb'), 'utf8') !== 'precious') throw new Error('old backups not intact');
      if (JSON.parse(fs.readFileSync(path.join(moved, 'config.json'), 'utf8')).licenseKey !== 'LEGACY-KEY-1') throw new Error('old config not intact');
      const fresh = bootstrap.readMarker(dB);
      if (!fresh || fresh.status !== 'ready') throw new Error('fresh install is not ready');
      const sec = JSON.parse(fs.readFileSync(path.join(dB, 'secrets.json'), 'utf8'));
      if (sec.jwtSecret === 'texacore-jwt-secret-at-least-32-characters-long' || sec.legacy) throw new Error('the fresh install reuses the legacy secrets');
      if (fs.readFileSync(path.join(dB, 'pgdata', 'PG_VERSION'), 'utf8').trim() !== '17') throw new Error('fresh cluster is not PG 17');
      // what the NEW install carries over: the licence and cloud settings — never the company list or a backup location.
      // (The harness mints its own free licence right after the move, so the licence VALUE is proven by the unit tests and the log line;
      // here: the bootstrap log says what was carried, a carried field the harness does not touch (subdomain) is present, nothing company-related leaked.)
      const blog = readLog(path.join(WORK, 'B.log'));
      const carriedLine = (blog.match(/\[Bootstrap\] carried over from the old data dir: ([^\n]*)/) || [])[1] || '';
      for (const k of ['licenseKey', 'isTrial', 'subdomain', 'license.dat']) if (!carriedLine.includes(k)) throw new Error(`carry-over log line lacks ${k}: "${carriedLine}"`);
      const cfg = JSON.parse(fs.readFileSync(path.join(dB, 'config.json'), 'utf8'));
      if (cfg.subdomain !== 'legacyco') throw new Error(`subdomain not carried over: ${JSON.stringify(Object.keys(cfg))}`);
      if (JSON.stringify(cfg).includes('Legacy Co') || JSON.stringify(cfg).includes('old.tcdb')) throw new Error('the old company list / backup path leaked into the new config');
      if (fs.readFileSync(path.join(moved, 'backups', 'old.tcdb'), 'utf8') !== 'precious') throw new Error('old backup changed while the new install ran');
      if (fs.readFileSync(path.join(moved, 'license.dat'), 'utf8') !== 'legacy-licence-blob') throw new Error('the old license.dat changed or vanished');
      return `old dir kept as ${asides[0]} (cluster, config, backups intact); fresh PG 17 install with new secrets; carry-over logged (${carriedLine}); no company list`;
    } finally { await stopApp(child, uB); }
  });

  // ── D. unfinished PG17 dir with an old config ──
  const uD = path.join(WORK, 'D', 'userdata');
  const dD = path.join(uD, 'texacore-data');
  const oldBk = path.join(WORK, 'D', 'old-backups');
  await R.check('D. an unfinished PG17 dir with an old config: company list removed, the old .tcdb is never overwritten, the original config is kept', async () => {
    fs.mkdirSync(oldBk, { recursive: true });
    fs.writeFileSync(path.join(oldBk, 'old.tcdb'), 'precious-D');
    fs.mkdirSync(path.join(dD, 'pgdata'), { recursive: true });
    fs.writeFileSync(path.join(dD, 'pgdata', 'PG_VERSION'), '17\n');
    fs.writeFileSync(path.join(dD, 'pgdata', 'postgresql.conf'), '# half-built\n');
    const oldCfg = { licenseKey: 'LEGACY-KEY-D', isTrial: true, subdomain: 'legacyD', storagePath: oldBk, currentDbPath: path.join(oldBk, 'old.tcdb'), companies: [{ name: 'Old D Co', tcdbPath: path.join(oldBk, 'old.tcdb') }] };
    fs.writeFileSync(path.join(dD, 'config.json'), JSON.stringify(oldCfg));
    const d0 = bootstrap.detect(dD);
    if (d0.state !== 'interrupted_first_run') throw new Error(`detect() says ${d0.state}`);
    const { child, ready } = startApp({ userData: uD, logFile: path.join(WORK, 'D.log'), appBinary: binary });
    try {
      await ready;
      await sleep(4000);                                                       // the backup-on-startup job has run by now
      if (fs.readFileSync(path.join(oldBk, 'old.tcdb'), 'utf8') !== 'precious-D') throw new Error('the old .tcdb was overwritten by the new install');
      const cfg = JSON.parse(fs.readFileSync(path.join(dD, 'config.json'), 'utf8'));
      if (cfg.subdomain !== 'legacyD') throw new Error('account settings lost (subdomain)');   // the harness re-mints the licence itself; unit tests cover the licence value
      if (JSON.stringify(cfg).includes('Old D Co') || JSON.stringify(cfg).includes(oldBk)) throw new Error('the old company list / backup path survived in config.json');
      const copies = fs.readdirSync(dD).filter((n) => n.startsWith('config.json.pre-2.0-'));
      if (copies.length !== 1) throw new Error(`pre-2.0 config copies: ${copies.length}`);
      if (JSON.parse(fs.readFileSync(path.join(dD, copies[0]), 'utf8')).companies[0].name !== 'Old D Co') throw new Error('the kept copy is not the original');
      if (bootstrap.readMarker(dD).status !== 'ready') throw new Error('not ready');
      return `old .tcdb untouched; config sanitised; original kept as ${copies[0]}`;
    } finally { await stopApp(child, uD); }
  });

  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), app: APP || 'electron dev mode', summary: R.summary(), rows: R.rows }, null, 2));
  console.log(`\nstates-check: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
