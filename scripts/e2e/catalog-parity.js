'use strict';
// Desktop data parity (G3): the GLOBAL rows of every catalog the desktop reads, counted on a desktop database and compared with production's counts (g3-expected.json: counts only, measured read-only
// from production). "global" = tenant_id AND company_id NULL (both columns), else the one that exists, else the whole table - the same definition the measurement used.
const fs = require('fs');
const path = require('path');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(__dirname, 'g3-expected.json'), 'utf8'));

/** pg(sql, params) -> { rows }. Returns { counts, differences[] } for the catalogs of g3-expected.json (or only `only`). */
async function catalogParity(pg, only = null) {
  const names = Object.keys(EXPECTED.tables).filter((t) => !only || only.includes(t));
  const counts = {}; const diff = [];
  for (const t of names) {
    const cols = (await pg(`SELECT attname FROM pg_attribute WHERE attrelid = to_regclass($1) AND attnum > 0 AND NOT attisdropped`, [`public.${t}`])).rows.map((r) => r.attname);
    if (!cols.length) { counts[t] = null; diff.push(`${t}: table absent (production ${EXPECTED.tables[t].prod})`); continue; }
    const hasT = cols.includes('tenant_id'); const hasC = cols.includes('company_id');
    const where = hasT && hasC ? 'tenant_id IS NULL AND company_id IS NULL' : hasT ? 'tenant_id IS NULL' : hasC ? 'company_id IS NULL' : 'true';
    const n = (await pg(`SELECT count(*)::int AS n FROM public."${t}" WHERE ${where}`)).rows[0].n;
    counts[t] = n;
    if (n !== EXPECTED.tables[t].desktop) diff.push(`${t}: desktop ${n}, expected ${EXPECTED.tables[t].desktop} (production ${EXPECTED.tables[t].prod})`);
  }
  return { counts, differences: diff, tables: names.length, measuredAt: EXPECTED.measuredAt };
}
// 20270240l (E2E BUG-11): the three material capabilities and the global roles that hold them, as production has them (read-only, 27-10).
const MATERIAL_GRANTS = {
  'inventory.material.create': ['branch_manager', 'company_admin', 'company_owner', 'picker', 'tenant_admin', 'tenant_owner', 'warehouse_keeper'],
  'inventory.material.delete': ['branch_manager', 'company_admin', 'company_owner', 'tenant_admin', 'tenant_owner'],
  'inventory.price.edit': ['branch_manager', 'company_admin', 'company_owner', 'purchaser', 'sales_manager', 'tenant_admin', 'tenant_owner'],
};
/** Differences between the desktop's global grants of the three material capabilities and production's. */
async function materialCapabilityGrants(pg) {
  const diff = [];
  for (const [cap, roles] of Object.entries(MATERIAL_GRANTS)) {
    const cat = (await pg(`SELECT server_enforced FROM public.capability_catalog WHERE code = $1`, [cap])).rows[0];
    if (!cat) { diff.push(`${cap}: not in capability_catalog`); continue; }
    const got = (await pg(`SELECT role_code FROM public.role_capabilities WHERE capability = $1 AND tenant_id IS NULL ORDER BY 1`, [cap])).rows.map((r) => r.role_code);
    if (JSON.stringify(got) !== JSON.stringify([...roles].sort())) diff.push(`${cap}: desktop [${got.join(',')}], production [${[...roles].sort().join(',')}]`);
  }
  return diff;
}
module.exports = { catalogParity, materialCapabilityGrants, MATERIAL_GRANTS, EXPECTED };
