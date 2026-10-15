'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('../scripts/lib/migrations-manifest');
const { checkManifest } = M;
const { mkdtemp, sha } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'baseline');
const pinSha = JSON.parse(fs.readFileSync(path.join(BASE, 'BASELINE_PIN.json'), 'utf8')).files['production_baseline.sql'].sha256;
const pin = M.loadMigrationsPin(BASE);
// ./migrations is BUILD OUTPUT (scripts/sync-migrations.js, fetched from the private ERP repo): the tests that read it run where it has been generated and are skipped on a bare checkout
const generated = fs.existsSync(path.join(ROOT, 'migrations', 'migrations.json'));
const manifestOf = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'migrations', 'migrations.json'), 'utf8'));

// ── the committed side: the PIN (names, order, sha256, sizes - no SQL) ──
test('baseline/MIGRATIONS_PIN.json exists, is valid and tied to the PINNED baseline (a re-cut baseline without a regenerated pin fails here)', () => {
  assert.ok(pin, 'baseline/MIGRATIONS_PIN.json is missing');
  assert.deepEqual(M.checkPin(pin, pinSha), []);
  assert.equal(pin.baselineSha256, pinSha);
});

test('2.0.3 ships the 16 migrations production received after the 2026-10-13T13:21Z cut that matter locally, in PRODUCTION\'s apply order (s and t before r and u; v; then x, 20270211a, y - NOT alphabetical: y was applied after 11a); 20270210l is production-only data and is NOT shipped', () => {
  assert.deepEqual(pin.migrations.map((x) => x.name.replace(/^2027021[01]([a-z]).*/, '$1')), ['i', 'j', 'k', 'q', 'm', 'n', 'o', 'p', 's', 't', 'r', 'u', 'v', 'x', 'a', 'y']);
  assert.deepEqual(pin.migrations.map((x) => x.name.slice(0, 9)), ['20270210i', '20270210j', '20270210k', '20270210q', '20270210m', '20270210n', '20270210o', '20270210p', '20270210s', '20270210t', '20270210r', '20270210u', '20270210v', '20270210x', '20270211a', '20270210y']);
  assert.deepEqual(pin.migrations.map((x) => x.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.ok(!pin.migrations.some((x) => /20270210l/.test(x.name)));
});

test('the pin holds names, order, sha256 and sizes ONLY: no SQL, no tenant id, no function body (the repo is public)', () => {
  const text = fs.readFileSync(path.join(BASE, M.PIN_FILE), 'utf8');
  assert.deepEqual(Object.keys(pin).sort(), ['baselineSha256', 'erpCommit', 'inventory', 'migrations', 'note', 'schema']);
  for (const e of pin.migrations) assert.deepEqual(Object.keys(e).sort(), ['bytes', 'file', 'name', 'order', 'sha256']);
  assert.deepEqual(Object.keys(pin.inventory).sort(), ['bytes', 'file', 'sha256']);
  assert.doesNotMatch(text, /\b(CREATE|ALTER|INSERT|SELECT|BEGIN|COMMIT)\b/);
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test('NOTHING of the migrations is tracked by git (the installer repo is PUBLIC, the ERP repo is private): no migrations/ file, no 2027xxxx .sql, only the pin; ./migrations is ignored', { skip: !fs.existsSync(path.join(ROOT, '.git')) }, () => {
  let tracked;
  try { tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean); } catch { return; }     // no git available
  assert.deepEqual(tracked.filter((f) => /^migrations\//.test(f)), [], 'migrations/ is build output');
  assert.deepEqual(tracked.filter((f) => /(^|\/)2027\d{4}[a-z]?_.*\.sql$/i.test(f)), []);
  assert.deepEqual(tracked.filter((f) => /^baseline\//.test(f)).sort(), ['baseline/BASELINE_PIN.json', `baseline/${M.PIN_FILE}`]);
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^migrations\/$/m);
  assert.doesNotMatch(gi, /^!\/?migrations/m, 'no re-include of migrations/');
});

// ── the checks themselves ──
function tree(mutate) {
  const d = mkdtemp('mf-');
  const sql = Buffer.from('BEGIN;\nSELECT 1;\nCOMMIT;\n');
  fs.writeFileSync(path.join(d, 'a.sql'), sql);
  const man = { baselineSha256: 'pin', migrations: [{ name: 'a', file: 'a.sql', sha256: sha(sql) }] };
  mutate && mutate(d, man);
  fs.writeFileSync(path.join(d, 'migrations.json'), JSON.stringify(man));
  return d;
}
test('checkManifest: ok; wrong baseline; edited file; missing file; unlisted .sql; 1.x manifest without baselineSha256', () => {
  assert.deepEqual(checkManifest(tree(), 'pin').problems, []);
  assert.match(checkManifest(tree(), 'other').problems.join(), /pinned baseline is other/);
  assert.match(checkManifest(tree((d) => fs.writeFileSync(path.join(d, 'a.sql'), 'BEGIN;\nDROP TABLE x;\nCOMMIT;')), 'pin').problems.join(), /differs from the manifest's sha256/);
  assert.match(checkManifest(tree((d) => fs.rmSync(path.join(d, 'a.sql'))), 'pin').problems.join(), /listed but missing/);
  assert.match(checkManifest(tree((d) => fs.writeFileSync(path.join(d, 'extra.sql'), 'x')), 'pin').problems.join(), /extra\.sql is in the migrations folder but not in migrations\.json/);
  assert.match(checkManifest(tree((d, m) => { delete m.baselineSha256; }), 'pin').problems.join(), /no baselineSha256/);
  assert.match(checkManifest(tree((d, m) => { m.migrations[0].file = '../evil.sql'; }), 'pin').problems.join(), /bad manifest entry/);
});

test('checkPin / checkAgainstPin / buildManifest: a bad pin, a manifest that is not the pin (name, order, sha256, baseline) are all reported', () => {
  const hex = (c) => c.repeat(64);
  const good = { schema: 1, baselineSha256: 'b', erpCommit: 'c', migrations: [{ order: 1, name: 'a', file: 'a.sql', sha256: hex('1'), bytes: 5 }, { order: 2, name: 'b', file: 'b.sql', sha256: hex('2'), bytes: 6 }], inventory: { file: M.INVENTORY_FILE, sha256: hex('3'), bytes: 9 } };
  assert.deepEqual(M.checkPin(good, 'b'), []);
  assert.match(M.checkPin(good, 'other').join(), /pinned baseline is other/);
  assert.match(M.checkPin({ ...good, migrations: [{ ...good.migrations[0], order: 2 }] }, 'b').join(), /order 2, expected 1/);
  assert.match(M.checkPin({ ...good, migrations: [{ ...good.migrations[0], file: '../x.sql', name: '../x' }] }, 'b').join(), /bad pin entry/);
  assert.match(M.checkPin({ ...good, migrations: [good.migrations[0], good.migrations[0]] }, 'b').join(), /pinned twice/);
  assert.match(M.checkPin({ ...good, inventory: undefined }, 'b').join(), /no inventory sha256/);
  assert.deepEqual(M.checkPin({ ...good, migrations: [], inventory: undefined }, 'b'), [], 'an empty list (after a baseline re-cut) needs no inventory');
  const inv = { catalogDelta: {}, functions: {}, removed: [] };
  const man = M.buildManifest(good, inv);
  assert.deepEqual(M.checkAgainstPin(man, good), []);
  assert.match(M.checkAgainstPin({ ...man, baselineSha256: 'z' }, good).join(), /baselineSha256/);
  assert.match(M.checkAgainstPin({ ...man, migrations: man.migrations.slice().reverse() }, good).join(), /not the pin's/);
  assert.match(M.checkAgainstPin({ ...man, migrations: [{ ...man.migrations[0], sha256: hex('9') }, man.migrations[1]] }, good).join(), /not the pin's/);
  assert.match(M.checkAgainstPin({ ...man, inventoryAfter: undefined }, good).join(), /no inventoryAfter/);
});

const { applyMigrationInventory } = require('../src/bootstrap');
test('applyMigrationInventory: baseline + the manifest\'s measured delta (counts and function md5s); unchanged without inventoryAfter', () => {
  const inv = { catalog_totals: { tables: 757, functions: 2240, triggers: 778, policies: 100 }, functions_md5: { 'public.a()': 'old', 'public.gone()': 'x' }, main: { rls_enabled: 700 } };
  assert.equal(applyMigrationInventory(inv, null).inv, inv);
  assert.equal(applyMigrationInventory(inv, { migrations: [] }).inv, inv);
  const r = applyMigrationInventory(inv, { inventoryAfter: { catalogDelta: { tables: 1, functions: 2, triggers: 529, rlsTables: 1 }, functions: { 'public.a()': 'new', 'public.b(uuid)': 'b' }, removed: ['public.gone()'] } });
  assert.deepEqual(r.inv.catalog_totals, { tables: 758, functions: 2242, triggers: 1307, policies: 100 });
  assert.deepEqual(r.inv.functions_md5, { 'public.a()': 'new', 'public.b(uuid)': 'b' });
  assert.equal(r.rlsDelta, 1);
  assert.equal(inv.catalog_totals.tables, 757, 'the input is not mutated');
});

// ── the private/generated side: run where baseline/ and ./migrations have been synced ──
const haveInventory = fs.existsSync(path.join(BASE, M.INVENTORY_FILE));
test('the measured inventory delta (baseline/migrations.inventory.json, private) is exactly what the pin names, and is well-formed', { skip: !haveInventory }, () => {
  const r = M.checkInventory(BASE, pin);
  assert.deepEqual(r.problems, []);
  assert.ok(r.inventory.catalogDelta && r.inventory.functions);
  assert.ok(Object.keys(r.inventory.functions).length > 50);
  assert.equal(r.inventory.catalogDelta.tables, 1, 'the only new table is the runner\'s own bookkeeping table');
  for (const sig of Object.keys(r.inventory.functions)) assert.match(sig, /^public\.[a-z_0-9]+\(.*\)$/, sig);
});

test('the generated ./migrations is exactly the pin (names, order, sha256, sizes, baseline) and carries the pinned inventory', { skip: !generated || !haveInventory }, () => {
  const r = checkManifest(path.join(ROOT, 'migrations'), pinSha);
  assert.deepEqual(r.problems, []);
  assert.equal(r.files.length, r.manifest.migrations.length);
  assert.deepEqual(M.checkAgainstPin(r.manifest, pin), []);
  assert.deepEqual(r.manifest.inventoryAfter, M.checkInventory(BASE, pin).inventory);
});

test('every generated migration is ONE transaction (BEGIN … COMMIT), so a failed file leaves nothing behind, and carries no psql meta-command or baseline DDL of its own', { skip: !generated }, () => {
  for (const e of manifestOf().migrations) {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', e.file), 'utf8');
    assert.match(sql, /^BEGIN;\s*$/m, `${e.file}: no BEGIN;`);
    assert.match(sql, /^COMMIT;\s*$/m, `${e.file}: no COMMIT;`);
    assert.doesNotMatch(sql, /^\\(?!restrict|unrestrict)[a-z]/im, `${e.file}: a psql meta-command`);
    const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');   // comments may mention them
    assert.doesNotMatch(code, /DROP SCHEMA|DROP DATABASE|session_replication_role/i, `${e.file}: a statement a local install must never run`);
  }
});

test('no shipped migration names a production tenant: no uuid literal in any of them (20270210l, which named 16, is not shipped)', { skip: !generated }, () => {
  for (const e of manifestOf().migrations) {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', e.file), 'utf8');
    assert.doesNotMatch(sql, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i, `${e.file}: a uuid literal`);
  }
});
