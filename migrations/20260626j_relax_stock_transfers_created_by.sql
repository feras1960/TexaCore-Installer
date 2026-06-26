-- 20260626j — relax stock_transfers.created_by for historical Al-Rasheed imports
-- ─────────────────────────────────────────────────────────────────────────────
-- The cloud requires stock_transfers.created_by (live user context). But the RSF
-- (.rsf) import runs BEFORE any user exists in the database, so RSF-imported stock
-- transfers (= inventory moves) carry created_by = NULL → NOT NULL violation →
-- the whole "inventory moves" phase is skipped (0 of N imported). 20260626e kept
-- the column NOT NULL because it is cloud-required, but on a self-hosted install
-- importing legacy data that is wrong. Relax it (the FK, if any, still permits
-- NULL). Idempotent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='stock_transfers'
      AND column_name='created_by' AND is_nullable='NO'
  ) THEN
    ALTER TABLE public.stock_transfers ALTER COLUMN created_by DROP NOT NULL;
  END IF;
END $$;
