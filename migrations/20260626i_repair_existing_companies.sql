-- 20260626i — repair companies/tenants created before the company-setup fixes
-- ─────────────────────────────────────────────────────────────────────────────
-- Companies created by create-local-company before v1.5.29 are missing their
-- company_accounting_settings row + default warehouse + linked accounts (the
-- handler only built the chart), and paid/trial installs got no tenant_subscription
-- (→ get_all_plan_limits "0/0" → invoice creation blocked). This repairs them
-- in place so the user does not have to recreate the company. Fully idempotent:
-- it only touches companies/tenants that are actually missing the rows.

-- 1) Companies with no settings row → build defaults (settings + warehouse +
--    branch), link the default accounts, and carry the chosen currencies from
--    the company jsonb. Triggers stay ON so trg_set_cas_tenant_id fills tenant_id;
--    the migration runs without a JWT so auth.uid() is NULL → audit insert is fine.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.id FROM public.companies c
    WHERE NOT EXISTS (SELECT 1 FROM public.company_accounting_settings cas WHERE cas.company_id = c.id)
  LOOP
    BEGIN PERFORM public.setup_company_defaults(r.id);
      EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'repair defaults % : %', r.id, SQLERRM; END;
    BEGIN PERFORM public.auto_set_default_accounts(r.id);
      EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'repair accounts % : %', r.id, SQLERRM; END;
    BEGIN
      UPDATE public.company_accounting_settings cas
      SET supported_currencies = ARRAY(SELECT jsonb_array_elements_text(c.accounting_settings->'supported_currencies'))
      FROM public.companies c
      WHERE cas.company_id = c.id AND c.id = r.id AND c.accounting_settings ? 'supported_currencies';
      EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'repair currency % : %', r.id, SQLERRM; END;
  END LOOP;
END $$;

-- 2) Tenants with no active subscription → local-unlimited (free installs already
--    carry a 'free' subscription; this only catches paid/trial installs that used
--    to get none, which is what produced the "0/0" limit).
INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, start_date, end_date)
SELECT t.id, sp.id, 'active', CURRENT_DATE, DATE '2099-12-31'
FROM public.tenants t
CROSS JOIN (SELECT id FROM public.subscription_plans WHERE code = 'local-unlimited' LIMIT 1) sp
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = t.id AND ts.status IN ('trial', 'active', 'grace')
)
ON CONFLICT DO NOTHING;
