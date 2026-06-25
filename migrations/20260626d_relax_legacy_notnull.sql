-- ════════════════════════════════════════════════════════════════════
-- 20260626d — relax legacy NOT NULL constraints that block UPGRADE installs
-- ════════════════════════════════════════════════════════════════════
-- Older versions created columns the current cloud schema dropped/relaxed —
-- e.g. a legacy `name` alongside the current name_ar/name_en. The sync's
-- CREATE TABLE IF NOT EXISTS skips an existing (older) table, so the stale
-- NOT NULL stays. The current code (built for the cloud) never populates it
-- ⇒ RSF import / inserts fail "violates not-null constraint" (price_lists.name).
-- Align upgrade installs to the cloud. Idempotent + fully tolerant.
DO $$
DECLARE r RECORD;
BEGIN
  -- (1) legacy bilingual `name` NOT NULL where the table already has name_ar
  --     (so `name` is the orphan the cloud no longer requires) → make nullable
  FOR r IN
    SELECT c.table_name AS t FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.column_name='name' AND c.is_nullable='NO'
      AND EXISTS (SELECT 1 FROM information_schema.columns c2
                  WHERE c2.table_schema='public' AND c2.table_name=c.table_name AND c2.column_name='name_ar')
  LOOP
    BEGIN EXECUTE format('ALTER TABLE public.%I ALTER COLUMN name DROP NOT NULL', r.t);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  -- (2) FK columns the cloud allows NULL but older bundled migrations forced NOT NULL
  FOR r IN SELECT t, c FROM (VALUES
      ('fabric_rolls','warehouse_id'),
      ('inventory_movements','created_by'),
      ('purchase_invoices','supplier_id')
    ) AS v(t,c)
  LOOP
    BEGIN EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
