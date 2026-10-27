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

test('2.0.5 final ships the 67 migrations production received after the 2026-10-13T13:21Z cut that matter locally, in PRODUCTION\'s apply order: the 19 of 2.0.4 first (unchanged), then 20270220x/y (applied 13-15 Oct, no function in common with the 19), then 17-10 to 23-10 as BOARD records them (the 16:40 batch of 20-10 is 19a, b, c, 23a-h; 26d before 26c; RC2 adds the 23-10 applies 238a, 237b, 237d, 237e in the order production applied them - the data-only seed for the two deleted companies is NOT shipped; the final adds the 26-10 applies 239a and 240b and the 27-10 applies 240c-240j); 20270210l is production-only data and 20270217b is a catalogue-data migration - neither is shipped', () => {
  assert.deepEqual(pin.migrations.slice(0, 19).map((x) => x.name.replace(/^2027021[01]([a-z]).*/, '$1')), ['i', 'j', 'k', 'q', 'm', 'n', 'o', 'p', 's', 't', 'r', 'u', 'v', 'x', 'a', 'y', 'b', 'c', 'd']);
  assert.deepEqual(pin.migrations.slice(19).map((x) => x.name), [
    "20270220x_ecom_smoke_fixes",
    "20270220y_ecom_single_erp_customer",
    "20270213a_exchange_setup_create_only",
    "20270214a_serial_readers_company_scope",
    "20270215x_sales_owner_stock_policy",
    "20270217a_specialized_modules_core",
    "20270217c_licence_specialized_choice",
    "20270217d_stock_base_not_fabric",
    "20270217e_default_choice_from_first_company",
    "20270218a_posting_capability_gate",
    "20270218b_voucher_create_capability",
    "20270221a_crm_opportunity_plan_limit",
    "20270221b_legal_documents_acceptances",
    "20270219a_return_draft_writers",
    "20270219b_return_tables_closed_purchase_guards",
    "20270219c_return_cancel_door_ecom_cap",
    "20270223a_workflow_guards_stage_delete_post",
    "20270223b_quantity_receipt_rpc",
    "20270223c_client_write_guards",
    "20270223d_sales_delivery_dead_ends",
    "20270223e_payment_limits_and_sales_paid_currency",
    "20270223f_partial_goods_receipt_clear_refusal",
    "20270223g_reverse_sales_delivery",
    "20270223h_workflow_guards_residuals",
    "20270227a_crm_ai_summaries_switch",
    "20270226a_delivery_note_draft_doors",
    "20270226b_delivery_note_line_facts",
    "20270226d_delivery_note_number_allocator_hardening",
    "20270226c_goods_receipt_draft_doors",
    "20270233a_mfg_receipt_known_value",
    "20270233b_mfg_component_cost_known",
    "20270236a_receive_quantity_stock_base_cost",
    "20270237a_new_company_seeds",
    "20270237c_chart_template_currency_box_names",
    "20270238a_safeupdate_where_true",
    "20270237b_journal_entry_number_allocator",
    "20270237d_system_journal_numbers",
    "20270237e_revoke_create_container_journal_entry",
    "20270239a_no_posting_to_group_or_summary_accounts",
    "20270240b_tenant_suspend_cuts_sessions",
    "20270240c_contract_reference_fields",
    "20270240d_default_currency_removal_guard",
    "20270240e_legal_acceptance_hardening",
    "20270240f_dashboard_activity_entry_name",
    "20270240g_dashboard_ar_aging",
    "20270240h_direct_sale_serials",
    "20270240i_direct_sale_return_basis",
    "20270240j_users_screen_roles"
]);
  assert.deepEqual(pin.migrations.map((x) => x.order), Array.from({ length: 67 }, (_, i) => i + 1));
  assert.ok(!pin.migrations.some((x) => /20270210l|20270217b/.test(x.name)));
  // the first 19 are exactly what 2.0.4 shipped (same names, same sha256): the upgrade from 2.0.4 applies ONLY the 34 after them
  assert.equal(require('crypto').createHash('sha256').update(JSON.stringify(pin.migrations.slice(0, 19).map((x) => [x.name, x.sha256]))).digest('hex'), '85744a0afb4dc0c7000a047e212257d8ae47158cd6736f431f4175b0a7ae137c', 'the first 19 entries (name + sha256) are byte-for-byte what 2.0.4 pinned');
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
  assert.equal(r.inventory.catalogDelta.tables, 13, 'the runner\'s own bookkeeping table + the 12 tables the 67 migrations add (RC2: + journal_number_counters of 20270237b)');
  for (const sig of Object.keys(r.inventory.functions)) assert.match(sig, /^(public|licensing)\.[a-z_0-9]+\(.*\)$/, sig);   // 2.0.5: a licensing-schema trigger function is replaced too (the inventory schemas: public, licensing, newpost, tomgenerators)
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
    // 20270226b seeds ONE system print template under a fixed, hand-made id (date-shaped, not a tenant, company or user id); nothing else may carry a uuid literal
    const literals = (sql.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/gi) || []).filter((x) => x.toLowerCase() !== "'20270226-0000-4000-8000-000000000026'");
    assert.deepEqual(literals, [], `${e.file}: a uuid literal`);
  }
});
