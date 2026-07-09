-- ════════════════════════════════════════════════════════════════
-- Expand fabric_materials.material_type CHECK to allow footwear + chemical
-- ────────────────────────────────────────────────────────────────
-- The UI (MaterialTypeSelector.tsx) offers material types 'footwear' and
-- 'chemical', but the DB constraint chk_material_type_valid only permitted
-- fabric/standard/vehicle/real_estate/pharma — so saving such a material was
-- rejected. This migration widens the allowed set. Idempotent (drop+add).
-- NOTE: original constraint had NO explicit NULL-allowance clause; a CHECK
-- with `= ANY(...)` already passes on NULL (NULL yields UNKNOWN, not false),
-- so NULL material_type remains allowed exactly as before.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.fabric_materials
    DROP CONSTRAINT IF EXISTS chk_material_type_valid;

ALTER TABLE public.fabric_materials
    ADD CONSTRAINT chk_material_type_valid
    CHECK (
        (material_type)::text = ANY (
            (ARRAY[
                'fabric'::character varying,
                'standard'::character varying,
                'vehicle'::character varying,
                'real_estate'::character varying,
                'pharma'::character varying,
                'footwear'::character varying,
                'chemical'::character varying
            ])::text[]
        )
    );
