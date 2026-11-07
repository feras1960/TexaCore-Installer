#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// check-rpc-coverage — does the pinned baseline contain every database function the ERP bundle being shipped CALLS?
//
//   node scripts/check-rpc-coverage.js --erp <ERP checkout> [--strict]
//
// Scans the ERP's src for `.rpc('name'` and compares with the public functions in baseline/production_baseline.inventory.json. A name the
// ERP calls but the baseline lacks means the baseline was cut BEFORE the migration that adds it was applied to production (a stale cut):
// the feature behind it returns 404 on a local install. Exit 1 only with --strict. The fix is always the same: re-cut the baseline
// (docs/RELEASE_2.0.md), `--update-pin`, rebuild.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function ermRpcNames(srcDir) {
  const names = new Set();
  const consts = new Map();    // 2.0.7: `export const CONSUME_RPC = 'fn_pending_action_consume'` then `.rpc(CONSUME_RPC, ...)` - the name is a constant
  const constCalls = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
        const text = fs.readFileSync(f, 'utf8');
        for (const m of text.matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) names.add(m[1]);
        for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([a-zA-Z0-9_]+)['"]/g)) consts.set(m[1], m[2]);
        for (const m of text.matchAll(/\.rpc\(\s*([A-Z][A-Z0-9_]*)\s*[,)]/g)) constCalls.add(m[1]);
      }
    }
  };
  walk(srcDir);
  for (const c of constCalls) if (consts.has(c)) names.add(consts.get(c));
  return names;
}

function baselineFunctions() {
  const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'production_baseline.inventory.json'), 'utf8'));
  const out = new Set();
  for (const k of Object.keys(inv.functions_md5 || {})) { const m = /^public\.([a-zA-Z0-9_]+)\(/.exec(k); if (m) out.add(m[1]); }
  // 2.0.2: the functions the shipped incremental migrations add
  try {
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'migrations', 'migrations.json'), 'utf8'));
    for (const k of Object.keys((man.inventoryAfter && man.inventoryAfter.functions) || {})) { const m = /^public\.([a-zA-Z0-9_]+)\(/.exec(k); if (m) out.add(m[1]); }
  } catch { /* no migrations shipped */ }
  return out;
}

/** @returns {{ called:number, missing:string[] }} */
function coverage(erp) {
  const called = ermRpcNames(path.join(erp, 'src'));
  const have = baselineFunctions();
  return { called: called.size, missing: [...called].filter((n) => !have.has(n)).sort() };
}

module.exports = { coverage };
if (require.main === module) {
  const i = process.argv.indexOf('--erp');
  const erp = i >= 0 ? process.argv[i + 1] : process.env.TEXACORE_ERP_DIR;
  if (!erp) { console.error('--erp <ERP checkout> is required'); process.exit(2); }
  const r = coverage(path.resolve(erp));
  if (!r.missing.length) { console.log(`rpc coverage OK: all ${r.called} RPCs the ERP calls exist in the baseline`); process.exit(0); }
  console.warn(`rpc coverage: ${r.missing.length} of ${r.called} RPCs the ERP calls are NOT in the baseline (stale cut?):\n  ${r.missing.join('\n  ')}`);
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}
