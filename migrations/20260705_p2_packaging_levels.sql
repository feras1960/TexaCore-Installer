-- ═══════════════════════════════════════════════════════════════════════════
-- P2 — multi-level packaging on material_unit_conversions
-- ═══════════════════════════════════════════════════════════════════════════
-- The prompt's `item_packaging` concept is ALREADY covered by
-- material_unit_conversions (material_id, from/to unit, conversion_factor,
-- contains_quantity = qty in base unit, weight_per_unit, volume_cbm). Rather
-- than duplicate it into a new table, we EXTEND it with the missing packaging
-- attributes so one row can describe a full packaging level
-- (Each/Inner/Carton/Pallet/Container) — optionally per-supplier.
--
-- All columns are nullable / defaulted ⇒ safe on existing rows. RLS is
-- column-agnostic, so the 4 existing tenant-isolation policies keep applying
-- unchanged. Fully idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.material_unit_conversions
  ADD COLUMN IF NOT EXISTS packaging_level text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS length_cm numeric,
  ADD COLUMN IF NOT EXISTS width_cm numeric,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS gross_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS is_default_purchase_uom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_default_sales_uom boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.material_unit_conversions.packaging_level IS
  'EACH | INNER | CARTON | PALLET | CONTAINER — the packaging tier this row describes (NULL = a plain unit conversion).';
COMMENT ON COLUMN public.material_unit_conversions.supplier_id IS
  'Optional supplier this packaging is specific to (e.g. pairs-per-carton differs per supplier/model). NULL = applies to any supplier.';
COMMENT ON COLUMN public.material_unit_conversions.gross_weight_kg IS
  'Packed gross weight of one unit at this level (incl. packaging). weight_per_unit stays the net content weight.';

-- packaging_level domain guard (allows NULL for legacy rows).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'muc_packaging_level_chk'
      AND conrelid = 'public.material_unit_conversions'::regclass
  ) THEN
    ALTER TABLE public.material_unit_conversions
      ADD CONSTRAINT muc_packaging_level_chk
      CHECK (packaging_level IS NULL OR packaging_level IN
             ('EACH','INNER','CARTON','PALLET','CONTAINER'));
  END IF;
END $$;

-- supplier_id FK → suppliers (guarded; ON DELETE SET NULL keeps packaging rows).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'muc_supplier_id_fkey'
      AND conrelid = 'public.material_unit_conversions'::regclass
  ) THEN
    ALTER TABLE public.material_unit_conversions
      ADD CONSTRAINT muc_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Lookups by material (+ optional supplier) for packaging pick-lists.
CREATE INDEX IF NOT EXISTS idx_muc_material_supplier
  ON public.material_unit_conversions (material_id, supplier_id);

-- At most one default purchase UoM and one default sales UoM per (material,
-- supplier) — partial unique indexes (only enforce among the flagged rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_muc_default_purchase
  ON public.material_unit_conversions (material_id, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default_purchase_uom;
CREATE UNIQUE INDEX IF NOT EXISTS uq_muc_default_sales
  ON public.material_unit_conversions (material_id, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default_sales_uom;

COMMIT;
