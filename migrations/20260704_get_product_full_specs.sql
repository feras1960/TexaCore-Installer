-- ══════════════════════════════════════════════════════════════════════════════
-- 🧾 Comprehensive, sector-dynamic product specs for the storefront detail page.
-- Date: 2026-07-04
-- Purpose:
--   The app/website product page needs the FULL, sector-aware spec list — not the
--   fabric-only 7 fields of get_material_specs. This joins the live effective-
--   attributes view (explicit EAV ∪ values derived from the linked material) with
--   the sector attribute definitions to return each attribute already labelled
--   (JSONB ar/en/uk/ru/tr/de), unit-tagged and ordered. Works for ANY sector
--   (textiles / footwear / clothing / …): fabrics derive composition, width_cm,
--   weight_gsm, fabric_type, origin_country, usage, season live from fabric_materials;
--   other sectors surface whatever ecommerce_product_attributes holds.
--   SECURITY DEFINER so anon can read (the view touches fabric_materials RLS).
--   See memory: marketplace-b2b-master-plan, tkanex-storefront-status.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_product_full_specs(
    p_product_id UUID,
    p_sector TEXT DEFAULT 'textiles',
    p_store_id UUID DEFAULT NULL
)
RETURNS TABLE (
    attribute_key  TEXT,
    label          JSONB,
    value          TEXT,
    value_num      NUMERIC,
    unit           TEXT,
    attribute_type TEXT,
    options        JSONB,
    display_order  INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT
        e.attribute_key,
        COALESCE(d.label, jsonb_build_object('en', e.attribute_key)) AS label,
        e.attribute_value      AS value,
        e.attribute_value_num  AS value_num,
        d.unit,
        d.attribute_type,
        d.options,
        COALESCE(d.display_order, 999) AS display_order
    FROM public.ecommerce_product_attrs_effective e
    LEFT JOIN LATERAL (
        SELECT dd.label,
               dd.unit,
               dd.attribute_type::TEXT AS attribute_type,
               dd.options,
               dd.display_order,
               dd.display_in_detail
        FROM public.ecommerce_attribute_definitions dd
        WHERE dd.attribute_key = e.attribute_key
          AND dd.sector = p_sector
          AND (dd.store_id IS NULL OR dd.store_id = p_store_id)
        ORDER BY (dd.store_id = p_store_id) DESC NULLS LAST, dd.display_order ASC
        LIMIT 1
    ) d ON TRUE
    WHERE e.product_id = p_product_id
      AND (e.attribute_value IS NOT NULL OR e.attribute_value_num IS NOT NULL)
      AND (d.display_in_detail IS NULL OR d.display_in_detail = TRUE)
    ORDER BY COALESCE(d.display_order, 999) ASC, e.attribute_key ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_full_specs(UUID, TEXT, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
