-- 20260626l — re-seed subscriptions for any tenant still missing one
-- ─────────────────────────────────────────────────────────────────────────────
-- The RSF import handler used to seed the local-unlimited subscription only when
-- CREATING a company; re-importing reused the existing company and skipped it, so
-- imported tenants ended up with NO active subscription → get_all_plan_limits
-- returns no_active_subscription → the UI shows "0/0" and blocks invoice creation.
-- 20260626i ran once (before those companies existed). This re-runs the repair so
-- companies created/imported since then are fixed on update, without re-importing.
-- Idempotent: only tenants without an active/trial/grace subscription get one.
INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, start_date, end_date)
SELECT t.id, sp.id, 'active', CURRENT_DATE, DATE '2099-12-31'
FROM public.tenants t
CROSS JOIN (SELECT id FROM public.subscription_plans WHERE code = 'local-unlimited' LIMIT 1) sp
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = t.id AND ts.status IN ('trial', 'active', 'grace')
)
ON CONFLICT DO NOTHING;
