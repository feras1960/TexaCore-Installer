#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// lab-180-migrations — a LAB helper for the "restore a 1.x .tcdb into 2.0" check (scripts/e2e/legacy-tcdb-check.js).
//
// The installer repo ignores `migrations/` ("synced from main repo"), so a checkout of v1.8.0 (c05be42) has only the 138 installer-side files of the
// 333 its manifest lists; the rest were copied from the ERP repo's supabase/migrations at release time. To run a 1.8.0 build and get the schema a
// real 1.8.0 customer had, this restores the missing files from the ERP git history: for each manifest entry that is not on disk, the version of
// supabase/migrations/<file> that was current at the 1.8.0 build date (the last commit touching it before that date; if that commit deleted it, the version before).
//
//   node scripts/e2e/lab-180-migrations.js --lab <1.8.0 checkout> --erp-repo <ERP git repo> [--before 2026-08-14T22:29:37+03:00]
// It only ever writes into <lab>/migrations (a lab checkout) — never the product tree, never a database.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const LAB = path.resolve(arg('lab', ''));
const ERP = path.resolve(arg('erp-repo', ''));
const BEFORE = arg('before', '2026-08-14T22:29:37+03:00');
if (!arg('lab') || !arg('erp-repo')) { console.error('--lab and --erp-repo are required'); process.exit(2); }
const git = (args) => execFileSync('git', ['-C', ERP, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const dir = path.join(LAB, 'migrations');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'migrations.json'), 'utf8')).migrations;
const have = new Set(fs.readdirSync(dir));
const missing = manifest.map((m) => m.file).filter((f) => !have.has(f));
let restored = 0; const notFound = []; const laterOnes = [];
for (const f of missing) {
  const rel = `supabase/migrations/${f}`;
  let sha = '';
  // case-insensitive file systems: the manifest may spell the name with different case than git does
  let name = f;
  let out = git(['log', `--before=${BEFORE}`, '--all', '-1', '--format=%H', '--', rel]).trim();
  if (!out) {
    const alt = git(['ls-tree', '-r', '--name-only', 'HEAD', 'supabase/migrations/']).split('\n').find((p) => p.toLowerCase() === rel.toLowerCase());
    if (alt) { name = path.basename(alt); out = git(['log', `--before=${BEFORE}`, '--all', '-1', '--format=%H', '--', alt]).trim(); }
  }
  sha = out;
  let later = false;
  if (!sha) {   // not in the ERP before the build date: the EARLIEST version in the history is the closest approximation (reported as "later")
    const all = git(['log', '--all', '--format=%H', '--', rel]).trim().split('\n').filter(Boolean);
    if (all.length) { sha = all[all.length - 1]; later = true; }
  }
  if (!sha) { notFound.push(f); continue; }
  const p = `supabase/migrations/${name}`;
  let text;
  try { text = git(['show', `${sha}:${p}`]); } catch { try { text = git(['show', `${sha}^:${p}`]); } catch { notFound.push(f); continue; } }
  fs.writeFileSync(path.join(dir, f), text);
  restored++;
  if (later) { laterOnes.push(f); }
}
console.log(`manifest ${manifest.length}; on disk before ${manifest.length - missing.length}; restored from the ERP history ${restored}${laterOnes.length ? ` (a later version, not the 1.8.0-era one: ${laterOnes.join(', ')})` : ''}; not found ${notFound.length}${notFound.length ? ': ' + notFound.join(', ') : ''}`);
process.exit(0);
