#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// prepare-pg-win — PostgreSQL 17.6 for Windows x64 (the official EnterpriseDB binaries zip) → bin/windows-x64/pg.
//
//   node scripts/prepare-pg-win.js <postgresql-17.6-1-windows-x64-binaries.zip>
//
// Download (owner, ~315 MB):  https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip
// Keeps bin/ (server, initdb, pg_ctl, psql, pg_dump, pg_restore + every DLL they need), lib/ and share/; drops pgAdmin,
// StackBuilder (the wx*.dll), docs, headers and symbols. Writes bin/windows-x64/pg/PG_BUNDLE_VERSION (the build refuses a
// bundle that is not 17.x — scripts/prebuild-checks.js).
//
// NOTE: written on macOS without the zip; the Windows launch path (initdb --locale=en-US, pg_ctl start) is untested.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'bin', 'windows-x64', 'pg');
const KEEP_EXE = new Set(['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'psql.exe', 'pg_dump.exe', 'pg_dumpall.exe', 'pg_restore.exe', 'pg_isready.exe']);

function main() {
  const zip = process.argv[2];
  if (!zip || !fs.existsSync(zip)) { console.error('usage: node scripts/prepare-pg-win.js <postgresql-17.6-1-windows-x64-binaries.zip>'); process.exit(2); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgwin-'));
  try {
    console.log(`  extracting ${path.basename(zip)} …`);
    execFileSync('unzip', ['-q', zip, '-d', tmp], { stdio: 'inherit' });
    const root = fs.existsSync(path.join(tmp, 'pgsql')) ? path.join(tmp, 'pgsql') : tmp;
    for (const need of ['bin/postgres.exe', 'bin/initdb.exe', 'share']) {
      if (!fs.existsSync(path.join(root, need))) throw new Error(`not an EDB PostgreSQL binaries zip: ${need} missing`);
    }
    const exe = fs.readFileSync(path.join(root, 'bin', 'postgres.exe'));
    const m = /PostgreSQL (\d+\.\d+)[,\s]/.exec(exe.toString('latin1'));
    if (!m || !m[1].startsWith('17.')) throw new Error(`postgres.exe reports PostgreSQL ${m ? m[1] : '?'}, expected 17.x`);

    fs.rmSync(DEST, { recursive: true, force: true });
    fs.mkdirSync(path.join(DEST, 'bin'), { recursive: true });
    for (const f of fs.readdirSync(path.join(root, 'bin'))) {
      const lower = f.toLowerCase();
      if (lower.endsWith('.exe') && !KEEP_EXE.has(lower)) continue;       // pg_basebackup, pgbench, … not used
      if (/^wx.*\.dll$/.test(lower)) continue;                            // StackBuilder's GUI toolkit
      fs.copyFileSync(path.join(root, 'bin', f), path.join(DEST, 'bin', f));
    }
    for (const dir of ['lib', 'share']) fs.cpSync(path.join(root, dir), path.join(DEST, dir), { recursive: true });
    fs.writeFileSync(path.join(DEST, 'PG_BUNDLE_VERSION'), `${m[1]}\n`);
    const size = execFileSync('du', ['-sh', DEST], { encoding: 'utf8' }).split('\t')[0];
    console.log(`  OK: PostgreSQL ${m[1]} → ${path.relative(ROOT, DEST)} (${size})`);
  } catch (e) {
    console.error(`prepare-pg-win failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main();
