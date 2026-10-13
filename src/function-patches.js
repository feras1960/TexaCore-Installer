'use strict';
// ════════════════════════════════════════════════════════════════
// function-patches — the ONLY places where a local database's function body is allowed to differ from the production baseline.
//
// Owner decision 2026-10-13: a Rashid / Al-Ameen import (and its preview) is ALWAYS allowed, whatever the plan limits; the limits apply
// to the work done AFTER the import. The limits are enforced by public.enforce_plan_limit() (a BEFORE INSERT trigger on branches,
// companies, customers, products, sales_transactions, user_profiles, warehouses) — code that is the SAME on the cloud and here. Until the
// cloud has the same change (docs/proposed-cloud/enforce_plan_limit_import_exempt.md is the exact description), the local copy applies it
// to its own database at install time by inserting the snippet below into the function the baseline just created:
//   * the snippet is marked with a sentinel, so a baseline cut AFTER the cloud change (which carries the sentinel) is left alone;
//   * if the function's text no longer has the expected anchors the patch is SKIPPED (the install still works, imports then meet the
//     limits like any other writes) and the launch check fails — never a guess;
//   * the md5 of what was installed is recorded in the bootstrap marker; install verification accepts exactly that body (and the baseline's).
// ════════════════════════════════════════════════════════════════

const SENTINEL = '-- TEXACORE-IMPORT-EXEMPT';

const DECLARE_ANCHOR = '  r           jsonb;\nBEGIN';
const CHECK_ANCHOR = '  BEGIN\n    r := public.check_plan_limits(NEW.tenant_id, v_type);';

const EXEMPT_BLOCK = `  ${SENTINEL} (owner decision 2026-10-13): an IMPORT is never refused by the plan. A row written into a company that is still
  -- being filled by an import (status 'provisioning', made by an import route, its import_operations row still open) is not limited;
  -- the limits apply to what users create AFTER the import, once the company is 'active'. Creating companies and users is not exempt.
  IF v_type NOT IN ('companies', 'users') THEN
    BEGIN
      v_cid := nullif(to_jsonb(NEW) ->> 'company_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_cid := NULL;
    END;
    IF v_cid IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.companies c
          WHERE c.id = v_cid
            AND c.status = 'provisioning'
            AND c.created_source IN ('rsf_import', 'tcdb_restore', 'import')
            AND EXISTS (SELECT 1 FROM public.import_operations io
                         WHERE io.company_id = c.id AND io.status IN ('active', 'restoring')
                           AND io.created_at > now() - interval '3 days')) THEN
      RETURN NEW;
    END IF;
  END IF;

`;

/** enforce_plan_limit's definition → the same definition with the import exemption, or null when the anchors are not found exactly once. */
function patchEnforcePlanLimit(def) {
  if (typeof def !== 'string') return null;
  if (def.includes(SENTINEL)) return def;                       // already has it (a baseline cut after the cloud change)
  if (def.split(DECLARE_ANCHOR).length !== 2 || def.split(CHECK_ANCHOR).length !== 2) return null;
  return def
    .replace(DECLARE_ANCHOR, '  r           jsonb;\n  v_cid       uuid;\nBEGIN')
    .replace(CHECK_ANCHOR, EXEMPT_BLOCK + CHECK_ANCHOR);
}

const PATCHES = [
  { signature: 'public.enforce_plan_limit()', name: 'import-exempt', transform: patchEnforcePlanLimit },
];

/**
 * Apply every patch to the database behind pgQuery. Returns { applied: {signature: md5}, already: [signature], skipped: [{signature, why}] }.
 * `applied` holds the md5(prosrc) now installed for a function THIS call changed (what verification must accept).
 */
async function applyFunctionPatches(pgQuery, log = () => {}) {
  const out = { applied: {}, already: [], skipped: [] };
  for (const p of PATCHES) {
    const cur = await pgQuery('SELECT pg_get_functiondef(to_regprocedure($1)) AS def', [p.signature]);
    const def = cur.rows[0] && cur.rows[0].def;
    if (!def) { out.skipped.push({ signature: p.signature, why: 'function not found' }); continue; }
    if (def.includes(SENTINEL)) { out.already.push(p.signature); continue; }
    const next = p.transform(def);
    if (!next) { out.skipped.push({ signature: p.signature, why: 'anchors not found — the function changed upstream' }); log(`[Bootstrap] patch ${p.name} SKIPPED: anchors not found in ${p.signature}`); continue; }
    await pgQuery(next);
    const m = await pgQuery('SELECT md5(prosrc) AS md5 FROM pg_proc WHERE oid = to_regprocedure($1)', [p.signature]);
    out.applied[p.signature] = m.rows[0].md5;
    log(`[Bootstrap] patch ${p.name} applied to ${p.signature}`);
  }
  return out;
}

module.exports = { SENTINEL, PATCHES, patchEnforcePlanLimit, applyFunctionPatches };
