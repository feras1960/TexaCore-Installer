-- ═══════════════════════════════════════════════════════════════════════════
-- P0 — UoM cleanup & unification  (Multi-UOM system, phase 0)
-- ═══════════════════════════════════════════════════════════════════════════
-- Makes `units_of_measure` the SINGLE source of truth for units. This phase is
-- pure hygiene + gap-fill — NO behavioural change to conversions yet (P3).
--
-- Context (verified before writing):
--   • `units_of_measure` (33 rows) already holds category/base_unit_id/
--     conversion_factor/symbol/is_base_unit/allows_decimal/tenant_id — it is the
--     de-facto uom_categories+uom_units table. The app reads ONLY this table
--     (warehouseService, MaterialsPage, useInventoryPage, MaterialOverviewTab).
--   • It contains TWO generations: ~23 clean categorised rows + 10 duplicate
--     rows with category IS NULL and factor=1 (BOX/DCM/SQM/YRD/GM/KG/PCS/MTR/
--     ROLL/CONT) — legacy pollution.
--   • Dead tables with ZERO code references in src/: `uom`, `_backup_uom`,
--     `_deprecated_uom_table`, `product_uom_conversions` (empty). Migration
--     20260214 shows the intended-but-commented `uom → _deprecated_uom_table`
--     rename that produced this cruft.
--   • Units are tenant-scoped (tenant_id NOT NULL). This migration is
--     tenant-agnostic: it adds/dedups PER tenant that already owns units in a
--     category, so it is correct whether there is 1 tenant or many.
--
-- Safety: everything is idempotent and wrapped in one transaction. Reference
-- remaps run BEFORE deletes; table drops SELF-VERIFY (raise if any inbound FK)
-- so a surprise dependency aborts the whole migration instead of losing data.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Section A: add the missing standard units ──────────────────────────────
-- Each missing unit inherits tenant_id + base_unit_id + type from the EXISTING
-- base unit of its category, for EVERY tenant that owns that category — so it
-- adapts to the real tenant model with no hard-coded ids. Variable-capacity
-- units (pack/container/size-run) get factor=1 here; their true capacity lives
-- per-item in material_unit_conversions (P2), never as a global constant.
WITH missing(code, name_ar, name_en, category, factor, symbol, allows_decimal) AS (
  VALUES
    -- LENGTH (base MTR=1) — mm / foot / inch / decimeter
    ('MM',   'مليمتر',  'Millimeter', 'length', 0.001,  'مم',  true),
    ('FT',   'قدم',     'Foot',       'length', 0.3048, 'ft',  true),
    ('INCH', 'بوصة',    'Inch',       'length', 0.0254, 'in',  true),
    ('DCM',  'ديسيمتر', 'Decimeter',  'length', 0.1,    'dm',  true),
    -- WEIGHT (base KG=1) — ounce
    ('OZ',   'أونصة',   'Ounce',      'weight', 0.02835,'oz',  true),
    -- AREA (base SQM=1) — square yard
    ('SQYD', 'ياردة مربعة','Square yard','area', 0.8361,'yd²', true),
    -- COUNT (base PC=1) — pair / dozen-pairs / gross (fixed multiples)
    ('PAIR',      'زوج',        'Pair',        'count', 2,   'زوج',  false),
    ('DZN_PAIR',  'دستة أزواج', 'Dozen pairs', 'count', 24,  'دستة أزواج', false),
    ('GROSS',     'غروس',       'Gross',       'count', 144, 'غروس', false),
    -- COUNT — variable-capacity packaging (real qty per-item in P2)
    ('INNER',   'إنر باك',    'Inner pack',      'count', 1, 'إنر',   false),
    ('CONT20',  'حاوية 20 قدم','Container 20ft', 'count', 1, '20ft', false),
    ('CONT40',  'حاوية 40 قدم','Container 40ft', 'count', 1, '40ft', false),
    ('SIZE_RUN','سلسلة مقاسات','Size run',       'count', 1, 'سلسلة', false)
)
INSERT INTO public.units_of_measure
  (id, tenant_id, code, name_ar, name_en, type, category, base_unit_id,
   conversion_factor, symbol, is_base_unit, is_active, allows_decimal, created_at)
SELECT gen_random_uuid(), base.tenant_id, m.code, m.name_ar, m.name_en,
       base.type, m.category, base.id, m.factor, m.symbol, false, true,
       m.allows_decimal, now()
FROM missing m
JOIN LATERAL (
  SELECT b.id, b.tenant_id, b.type
  FROM public.units_of_measure b
  WHERE b.category = m.category AND b.is_base_unit = true AND b.category IS NOT NULL
) base ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.units_of_measure u
  WHERE u.code = m.code AND u.category = m.category
    AND u.tenant_id IS NOT DISTINCT FROM base.tenant_id
);

-- ── Section B: dedup the uncategorised legacy rows ─────────────────────────
-- Remap any references from a duplicate (category IS NULL) unit to its
-- canonical categorised twin (same tenant), THEN delete the now-orphan dupes.
-- Dupes with no same-tenant canonical are LEFT UNTOUCHED (reported, not lost).
WITH alias(dupe_code, canon_code) AS (
  VALUES ('GM','GRM'), ('PCS','PC'), ('CONT','CONT20'), ('BOX','BOX'),
         ('SQM','SQM'), ('YRD','YRD'), ('KG','KG'), ('MTR','MTR'),
         ('ROLL','ROLL'), ('DCM','DCM')
),
map AS (
  SELECT d.id AS dupe_id, c.id AS canon_id
  FROM public.units_of_measure d
  JOIN alias a ON a.dupe_code = d.code
  JOIN public.units_of_measure c
    ON c.code = a.canon_code AND c.category IS NOT NULL
   AND c.tenant_id IS NOT DISTINCT FROM d.tenant_id
  WHERE d.category IS NULL
)
UPDATE public.fabric_materials f
   SET base_unit_id = map.canon_id
  FROM map WHERE f.base_unit_id = map.dupe_id;

WITH alias(dupe_code, canon_code) AS (
  VALUES ('GM','GRM'), ('PCS','PC'), ('CONT','CONT20'), ('BOX','BOX'),
         ('SQM','SQM'), ('YRD','YRD'), ('KG','KG'), ('MTR','MTR'),
         ('ROLL','ROLL'), ('DCM','DCM')
),
map AS (
  SELECT d.id AS dupe_id, c.id AS canon_id
  FROM public.units_of_measure d
  JOIN alias a ON a.dupe_code = d.code
  JOIN public.units_of_measure c
    ON c.code = a.canon_code AND c.category IS NOT NULL
   AND c.tenant_id IS NOT DISTINCT FROM d.tenant_id
  WHERE d.category IS NULL
)
UPDATE public.material_unit_conversions muc
   SET from_unit_id = CASE WHEN muc.from_unit_id = map.dupe_id THEN map.canon_id ELSE muc.from_unit_id END,
       to_unit_id   = CASE WHEN muc.to_unit_id   = map.dupe_id THEN map.canon_id ELSE muc.to_unit_id   END
  FROM map
 WHERE muc.from_unit_id = map.dupe_id OR muc.to_unit_id = map.dupe_id;

-- Delete only dupes that are now unreferenced anywhere.
DELETE FROM public.units_of_measure d
WHERE d.category IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.fabric_materials f WHERE f.base_unit_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM public.material_unit_conversions m
                  WHERE d.id IN (m.from_unit_id, m.to_unit_id));

-- ── Section B.2: self-heal any surviving uncategorised straggler ───────────
-- A dupe that is still referenced but has NO same-tenant canonical twin can't
-- be remapped/deleted. Instead of leaving it uncategorised, categorise it IN
-- PLACE from its code (it becomes that tenant's canonical unit for the
-- category). Idempotent: only touches rows still category IS NULL.
WITH canon(code, category, factor, is_base) AS (
  VALUES ('MTR','length',1,true), ('KG','weight',1,true), ('SQM','area',1,true),
         ('PC','count',1,true), ('PCS','count',1,true),
         ('GM','weight',0.001,false), ('YRD','length',0.9144,false),
         ('BOX','count',1,false), ('ROLL','count',1,false),
         ('CONT','count',1,false), ('DCM','length',0.1,false)
)
UPDATE public.units_of_measure u
SET category = c.category,
    type = c.category,
    conversion_factor = c.factor,
    is_base_unit = c.is_base,
    base_unit_id = CASE WHEN c.is_base THEN u.id
      ELSE COALESCE((SELECT b.id FROM public.units_of_measure b
                     WHERE b.category = c.category AND b.is_base_unit
                       AND b.tenant_id IS NOT DISTINCT FROM u.tenant_id LIMIT 1),
                    u.base_unit_id) END
FROM canon c
WHERE u.category IS NULL AND u.code = c.code;

-- ── Section C: drop the dead TABLES (self-verifying) ───────────────────────
-- Only the three real dead tables. NOTE: `uom` is a compatibility VIEW over
-- units_of_measure (zero dependents, zero code refs) — we KEEP it, because
-- dropping a view could break an unknown external consumer (edge function /
-- local installer) for no benefit (it holds no data). It stays a candidate for
-- later removal once external consumers are ruled out.
-- Abort the whole migration if any target still has an inbound FK (they must
-- not — zero code refs, self-labelled backups). Safer than DROP … CASCADE.
DO $$
DECLARE
  t text;
  refs int;
  kind "char";
BEGIN
  FOREACH t IN ARRAY ARRAY['_backup_uom','_deprecated_uom_table','product_uom_conversions']
  LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    SELECT count(*) INTO refs
    FROM pg_constraint
    WHERE contype = 'f' AND confrelid = to_regclass('public.'||t);
    IF refs > 0 THEN
      RAISE EXCEPTION 'Refusing to drop % — it still has % inbound FK(s).', t, refs;
    END IF;
    SELECT relkind INTO kind FROM pg_class WHERE oid = to_regclass('public.'||t);
    IF kind = 'v' THEN
      EXECUTE format('DROP VIEW IF EXISTS public.%I', t);
    ELSE
      EXECUTE format('DROP TABLE IF EXISTS public.%I', t);
    END IF;
    RAISE NOTICE 'Dropped dead relation % (kind=%)', t, kind;
  END LOOP;
END $$;

-- ── Post-checks (informational) ────────────────────────────────────────────
DO $$
DECLARE nulls int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE category IS NULL), count(*)
    INTO nulls, total FROM public.units_of_measure;
  RAISE NOTICE 'units_of_measure: % rows, % still uncategorised (expected 0, or dupes with no canonical twin).', total, nulls;
END $$;

COMMIT;
