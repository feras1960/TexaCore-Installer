'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fp = require('../src/function-patches');
const b = require('../src/bootstrap');

// A skeleton with the two anchors (the real function is much longer; the anchors are what the patch relies on)
const DEF = `CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_type      text := TG_ARGV[0];
  r           jsonb;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  -- Finite limit
  BEGIN
    r := public.check_plan_limits(NEW.tenant_id, v_type);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  RETURN NEW;
END;
$function$
`;

test('the patch inserts the declaration and the exemption exactly once, before the authoritative count', () => {
  const out = fp.patchEnforcePlanLimit(DEF);
  assert.ok(out.includes(fp.SENTINEL));
  assert.equal(out.split('v_cid       uuid;').length, 2);
  assert.ok(out.indexOf(fp.SENTINEL) < out.indexOf('r := public.check_plan_limits'));
  assert.ok(out.indexOf("IF v_type NOT IN ('companies', 'users')") > 0, 'companies and users are not exempt');
  assert.match(out, /c\.status = 'provisioning'/);
  assert.match(out, /created_source IN \('rsf_import', 'tcdb_restore', 'import'\)/);
  assert.match(out, /io\.status IN \('active', 'restoring'\)/);
  assert.match(out, /interval '3 days'/);
});

test('idempotent: a function that already carries the sentinel (baseline cut after the cloud change) is left exactly as it is', () => {
  const once = fp.patchEnforcePlanLimit(DEF);
  assert.equal(fp.patchEnforcePlanLimit(once), once);
});

test('anchors missing or ambiguous → null (skip, never guess)', () => {
  assert.equal(fp.patchEnforcePlanLimit(DEF.replace('r           jsonb;', 'r jsonb;')), null);
  assert.equal(fp.patchEnforcePlanLimit(DEF.replace('check_plan_limits(NEW.tenant_id', 'check_plan_limits( NEW.tenant_id')), null);
  assert.equal(fp.patchEnforcePlanLimit(DEF + DEF), null);
  assert.equal(fp.patchEnforcePlanLimit(null), null);
});

test('applyFunctionPatches records the installed md5; a second run reports "already" and changes nothing', async () => {
  let def = DEF; const executed = [];
  const pg = async (text, params) => {
    if (/pg_get_functiondef/.test(text)) return { rows: [{ def }] };
    if (/md5\(prosrc\)/.test(text)) return { rows: [{ md5: 'M-' + def.length }] };
    executed.push(text); def = text; return { rows: [] };
  };
  const r1 = await fp.applyFunctionPatches(pg);
  assert.deepEqual(Object.keys(r1.applied), ['public.enforce_plan_limit()']);
  assert.equal(executed.length, 1);
  const r2 = await fp.applyFunctionPatches(pg);
  assert.deepEqual(r2.already, ['public.enforce_plan_limit()']);
  assert.equal(executed.length, 1);
  def = DEF.replace('r           jsonb;', 'x');
  const r3 = await fp.applyFunctionPatches(pg);
  assert.equal(r3.skipped.length, 1);
});

test('verification accepts a patched function ONLY with the md5 recorded at patch time', () => {
  const inv = { 'public.enforce_plan_limit()': 'BASE', 'public.other()': 'o' };
  const rows = (m) => [{ sig: 'public.enforce_plan_limit()', md5: m }, { sig: 'public.other()', md5: 'o' }];
  assert.equal(b.compareFunctionInventory(inv, rows('BASE')).ok, true);
  assert.equal(b.compareFunctionInventory(inv, rows('PATCHED')).ok, false);
  assert.equal(b.compareFunctionInventory(inv, rows('PATCHED'), { 'public.enforce_plan_limit()': 'PATCHED' }).ok, true);
  assert.equal(b.compareFunctionInventory(inv, rows('TAMPERED'), { 'public.enforce_plan_limit()': 'PATCHED' }).ok, false);
  assert.equal(b.compareFunctionInventory(inv, [{ sig: 'public.enforce_plan_limit()', md5: 'BASE' }, { sig: 'public.other()', md5: 'x' }], { 'public.enforce_plan_limit()': 'BASE' }).ok, false);
});
