-- ═══════════════════════════════════════════════════════════════════════════
-- P1 — sector fix: obuvix is a FOOTWEAR store, not textiles
-- ═══════════════════════════════════════════════════════════════════════════
-- The obuvix storefront (store_type='shoes') was mislabelled sector='textiles',
-- so get_sector_attributes / get_ecommerce_facets loaded the wrong (textile)
-- attribute definitions for it. Corrected to 'footwear' — matching the new
-- footwear material type and the footwear rows in ecommerce_attribute_definitions
-- and ecommerce_sale_units. Idempotent; no-op if already correct.
--
-- (The rest of P1 — footwear + chemical material types and their spec forms —
--  is pure frontend: MaterialTypeSelector, MaterialSpecsTab, MaterialBasicInfoTab,
--  and i18n. No storage schema change: sector fields live in materials.industry_data
--  JSON, following the existing standard/vehicle/pharma pattern.)

UPDATE public.ecommerce_stores
   SET sector = 'footwear'
 WHERE slug = 'obuvix' AND sector IS DISTINCT FROM 'footwear';
