-- 20260626k — unify purchase/sales transaction stage CHECK constraints
-- ─────────────────────────────────────────────────────────────────────────────
-- The `stage` CHECK on purchase_transactions / sales_transactions DRIFTED across
-- installs (several migrations + CREATE TABLE IF NOT EXISTS skips left different
-- allowed-sets): some installs allow 'order' but not 'confirmed', others the
-- reverse. So whichever stage the RSF importer / sales-purchase cycle writes can
-- violate the check on SOME install — exactly the
--   new row violates check constraint "purchase_transactions_stage_check"
-- the user hit. This OVERRIDES both checks with a comprehensive SUPERSET (the
-- union of every stage the cloud, the installer, and the importer use), so no
-- legitimate stage is ever rejected. Superset ⇒ existing rows always pass.
-- Idempotent (DROP IF EXISTS + ADD); guarded so it no-ops if a table is absent.
DO $$
BEGIN
  IF to_regclass('public.purchase_transactions') IS NOT NULL THEN
    ALTER TABLE public.purchase_transactions DROP CONSTRAINT IF EXISTS purchase_transactions_stage_check;
    ALTER TABLE public.purchase_transactions ADD CONSTRAINT purchase_transactions_stage_check
      CHECK (stage = ANY (ARRAY[
        'request','quotation','draft','confirmed','order','approved','receipt',
        'received','invoice','posted','partial_paid','partially_paid','paid','cancelled'
      ]::text[]));
  END IF;

  IF to_regclass('public.sales_transactions') IS NOT NULL THEN
    ALTER TABLE public.sales_transactions DROP CONSTRAINT IF EXISTS sales_transactions_stage_check;
    ALTER TABLE public.sales_transactions ADD CONSTRAINT sales_transactions_stage_check
      CHECK (stage = ANY (ARRAY[
        'request','quotation','draft','confirmed','order','reservation','approved',
        'receipt','received','delivery','in_delivery','in_transit','sent_to_branch',
        'at_branch','delivered','invoice','posted','partial_paid','partially_paid',
        'paid','returned','cancelled'
      ]::text[]));
  END IF;
END $$;
