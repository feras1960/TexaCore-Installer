# Plan limits and imports — how the cloud enforces today, and the change that makes it match the owner's rule

Owner decision (2026-10-13, final): **a Rashid / Al-Ameen import, and its preview, is always allowed whatever the plan limits.** The limits apply only
to the work done after the import (records users create afterwards).

## How the cloud enforces limits today (read from the production baseline cut 2026-10-13T08:15:22Z and the ERP at main 372326874)

**Database (the enforcement that matters; identical on the local copy because it is the same code):**

| piece | what it does |
|---|---|
| `public.enforce_plan_limit()` (SECURITY DEFINER, BEFORE INSERT row trigger) | the only hard enforcement. Fires on **branches, companies, customers, products, sales_transactions (invoices/month), user_profiles (users), warehouses** (`trg_enforce_limit_*`). |
| its rules | looks up the tenant's live subscription (`tenant_subscriptions` status trial/active/grace → `subscription_plans`). **Only a plan with `plan_type = 'free'` is enforced** ("paid plans were never hard-enforced"). A limit of -1/NULL = unlimited. Otherwise it calls `check_plan_limits(tenant, type)` and raises `PLAN_LIMIT_EXCEEDED: <type> (<current>/<max>)` (ERRCODE 23514). If `check_plan_limits` itself errors it fails OPEN. |
| `public.check_plan_limits(tenant, type)` | the counter. companies: not failed/cancelled/deleted; users: profiles ∪ active `tenant_users`; invoices: this month; customers/products/branches/warehouses: all rows of the tenant. |
| `public.fn_provision_import_target_company(...)` | creating the import's target company reserves a company slot and raises "cannot create another company under its current plan (current, max)" when the tenant is at its company limit. |

**Not enforced anywhere in the database:** `max_documents`, `max_images`, `max_records`, storage, and every paid-plan limit. (`max_documents` appears only in the plan editor
screens and `update_plan_limits`; no trigger or function counts documents.)

**Client checks (ERP):** the list/creation pages show the limit and block the "new" button — SalesCycleList, PurchaseCycleList, WarehouseListPage, MaterialsPage, Parties,
UsersManagementTab, BranchesManagementTab (components/shared/PlanLimitComponents, hooks/planLimitState), PBX pages. **The import wizard and its preview have no plan check at all**
(`grep -ri "planLimit|check_plan_limits" src/features/import` → nothing); the preview writes nothing.

**So is an import blocked today?** Yes, by the database trigger, on the cloud exactly as locally: the importer writes customers / warehouses / products / invoices
(`sales_transactions`) through PostgREST as the signed-in user (client importer) or as that user's JWT from the `import-runner` edge function (server mode) — both are ordinary
INSERTs, `enforce_plan_limit` has no bypass (it does not look at `fn_tcdb_import_active()`; `session_replication_role = replica` is not available on the cloud project). On a
free-plan tenant a Rashid file with more than the plan's customers, more than 1 warehouse, or more invoices in a month than the plan allows fails half-way with
`PLAN_LIMIT_EXCEEDED` (the first real case we saw: `warehouses (1/1)`, inventory opening movements never written).

## What must change on the cloud so it honours the same rule (the installer already applies exactly this to its own database)

**One function, no client change, no new table.** Replace `public.enforce_plan_limit()` with the same body plus the block below, inserted immediately **before** the
`BEGIN ... r := public.check_plan_limits(NEW.tenant_id, v_type);` sub-block, and a new variable `v_cid uuid;` in `DECLARE` (after `r jsonb;`):

```sql
  -- TEXACORE-IMPORT-EXEMPT (owner decision 2026-10-13): an IMPORT is never refused by the plan. A row written into a company that is still
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
```

Why this marker: every import route creates its target company through `fn_provision_import_target_company` (status `provisioning`, `created_source` rsf_import / tcdb_restore / import,
plus an `import_operations` row with status `active`), fills it, and ends with `fn_complete_company_provisioning` (company → `active`, operation → `completed`). From that moment the
exemption is gone and the ordinary limit applies to new records. The three-day bound stops a company that is left in `provisioning` forever from staying exempt.
It sits after the cheap pre-checks, so a paid tenant (never enforced) and an unlimited free plan pay nothing; only an enforced free-plan insert evaluates it.

Deliberate scope choices (say if the owner wants them different):
* **companies and users are not exempt.** `fn_provision_import_target_company` still refuses a second company for a free tenant at its company limit, and an import never creates users.
  (A free tenant's first company — the normal Rashid first-run — is not blocked.)
* **max_documents is not enforced by anything today**, so an import cannot be refused for it; if the owner wants the 500-document cap to exist for post-import work it needs a counter and a
  trigger of its own — a separate decision, and it must carry the same import exemption.
* Fail-open behaviour of `check_plan_limits` is unchanged.

Local application: `src/function-patches.js` applies the identical snippet to the local database right after the baseline loads (sentinel `TEXACORE-IMPORT-EXEMPT`; skipped when the baseline
already contains it, so once the cloud migration is live and the baseline is re-cut the local patch becomes a no-op and can be deleted). Install verification accepts the patched body only
with the md5 recorded when the patch was applied.
