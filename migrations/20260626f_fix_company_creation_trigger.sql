-- 20260626f — fix broken company-creation trigger (self-hosted)
-- ─────────────────────────────────────────────────────────────────────────────
-- The installer schema (synced from an older dev DB) carries an EXTRA trigger
-- `trg_on_company_created` → on_company_created() whose body does
-- `PERFORM create_simple_chart_of_accounts(NEW.id)` — a function that DOES NOT
-- EXIST (the real one is create_simple_chart). So ANY company INSERT with
-- triggers enabled aborts with:
--     function create_simple_chart_of_accounts(uuid) does not exist
-- The cloud has no such trigger (the chart is built by the registration wizard /
-- the installer's create-local-company handler explicitly). create-local-company
-- worked around it by disabling all triggers during the INSERT, but the trigger
-- is still a latent landmine for every other company-insert path.
--
-- This migration removes the bad trigger, neutralises the stale function, and
-- adds a defensive alias so the old name (if ever referenced) routes to the real
-- create_simple_chart. Fully idempotent + non-destructive.

-- 1) Drop the extra/broken trigger (cloud does not have it).
DROP TRIGGER IF EXISTS trg_on_company_created ON public.companies;

-- 2) Neutralise the stale function — no auto-chart, just a harmless default
--    (kept rather than dropped in case anything still references it).
CREATE OR REPLACE FUNCTION public.on_company_created()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- لا ننشئ شجرة تلقائياً — المعالج/المستخدم يختار القالب
  IF NEW.chart_type IS NULL THEN
    NEW.chart_type := 'simple';
  END IF;
  RETURN NEW;
END;
$$;

-- 3) Defensive alias: route the old (missing) name to the real function so any
--    lingering caller succeeds instead of erroring.
CREATE OR REPLACE FUNCTION public.create_simple_chart_of_accounts(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.create_simple_chart(p_company_id);
END;
$$;
