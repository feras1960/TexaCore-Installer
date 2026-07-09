-- ═══════════════════════════════════════════════════════════════════════════
-- Ecommerce dynamic filters — generic, sector-agnostic, ERP-linked
-- ═══════════════════════════════════════════════════════════════════════════
-- Goal: dynamic storefront filters that reflect the ACTUAL materials/products,
-- reusable across every sector (fabric, shoes, clothing, food, …).
--
-- Architecture:
--   1) ecommerce_product_attrs_effective  — a LIVE view of every product's
--      filterable attribute values. It UNIONs:
--        (a) explicit EAV rows in ecommerce_product_attributes (authoritative),
--        (b) values derived LIVE from fabric_materials for products that don't
--            carry an explicit EAV row for that key.
--      => fabric facets stay always-fresh from the ERP with no backfill/trigger
--         drift; other sectors are driven by the EAV the ERP writes. Adding a
--         new sector = write its EAV rows (or extend the derive block) — no app
--         release, no schema change.
--   2) get_ecommerce_facets(store, category, search) — returns ONLY the facets
--      that actually discriminate (select ≥2 distinct values; number min<max),
--      enriched with sector attribute-definition labels/units/order + price
--      range + flag counts. Empty/single-value facets are omitted so the UI
--      never shows a useless filter.
--   3) get_ecommerce_products(…) — extended (backward-compatible) with filter
--      params: p_attrs (select/multiselect/color), p_num_ranges (numeric),
--      p_min_price/p_max_price, p_flags, p_sort. Old 6-arg callers behave
--      identically (all new params default to no-op).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Live effective-attributes view ──────────────────────────────────────
CREATE OR REPLACE VIEW public.ecommerce_product_attrs_effective AS
-- (a) explicit EAV values — authoritative when present
SELECT pa.product_id, pa.attribute_key, pa.attribute_value, pa.attribute_value_num
FROM public.ecommerce_product_attributes pa
UNION ALL
-- (b) values derived live from the linked fabric material, for keys the product
--     has NO explicit EAV row for (so the ERP can always override per-product).
SELECT ep.id AS product_id, d.attribute_key, d.attribute_value, d.attribute_value_num
FROM public.ecommerce_products ep
JOIN public.fabric_materials fm ON fm.id = ep.material_id
CROSS JOIN LATERAL (VALUES
  ('fabric_type'::text,  NULLIF(fm.fabric_type, '')::text,  NULL::numeric),
  ('material_type',      NULLIF(fm.material_type, ''),       NULL),
  ('composition',        NULLIF(fm.composition, ''),         NULL),
  ('color',              NULLIF(fm.color_swatch_hex, ''),    NULL),
  ('origin_country',     NULLIF(fm.origin_country, ''),      NULL),
  ('usage',              NULLIF(fm.usage_type, ''),          NULL),
  ('season',             NULLIF(fm.season, ''),              NULL),
  ('width_cm',           NULL,                               fm.default_width),
  ('weight_gsm',         NULL,                               fm.weight_per_meter)
) AS d(attribute_key, attribute_value, attribute_value_num)
WHERE (d.attribute_value IS NOT NULL OR d.attribute_value_num IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.ecommerce_product_attributes pa2
    WHERE pa2.product_id = ep.id AND pa2.attribute_key = d.attribute_key
  );

COMMENT ON VIEW public.ecommerce_product_attrs_effective IS
  'Live union of explicit EAV attribute values and values derived from the linked material. Backs get_ecommerce_facets and the filter logic in get_ecommerce_products.';

-- ── 2) Facets RPC ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ecommerce_facets(
  p_store_id uuid,
  p_category_slug text DEFAULT NULL,
  p_search text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_sector   text;
  v_currency text;
  v_ids      uuid[];
  v_total    int;
  v_price    jsonb;
  v_flags    jsonb;
  v_attrs    jsonb;
BEGIN
  SELECT s.sector, COALESCE(s.default_currency, 'USD')
    INTO v_sector, v_currency
  FROM public.ecommerce_stores s WHERE s.id = p_store_id;

  -- Products matching (store, published, category, search) — mirrors the
  -- WHERE of get_ecommerce_products so facets match the listing exactly.
  SELECT array_agg(ep.id) INTO v_ids
  FROM public.ecommerce_products ep
  LEFT JOIN public.fabric_materials fm ON fm.id = ep.material_id
  LEFT JOIN public.products p ON p.id = ep.product_id
  WHERE ep.store_id = p_store_id
    AND ep.is_published = true
    AND (p_search IS NULL OR (
        COALESCE(fm.name_ar, p.name_ar, '') ILIKE '%' || p_search || '%' OR
        COALESCE(fm.name_en, p.name_en, '') ILIKE '%' || p_search || '%' OR
        COALESCE(fm.code, p.sku, '')        ILIKE '%' || p_search || '%' OR
        ep.display_no ILIKE '%' || p_search || '%' OR
        ep.marketing_title::text ILIKE '%' || p_search || '%' OR
        p_search = ANY(ep.tags)))
    AND (p_category_slug IS NULL OR EXISTS (
        SELECT 1 FROM public.ecommerce_product_categories epc
        JOIN public.ecommerce_categories ec ON ec.id = epc.category_id
        WHERE epc.product_id = ep.id AND ec.slug = p_category_slug));

  v_total := COALESCE(array_length(v_ids, 1), 0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('total', 0, 'currency', v_currency,
      'price', NULL, 'flags', '{}'::jsonb, 'attributes', '[]'::jsonb);
  END IF;

  -- Effective-price range (same computation as the listing).
  SELECT jsonb_build_object('min', min(x.eff), 'max', max(x.eff))
    INTO v_price
  FROM (
    SELECT COALESCE(
      CASE WHEN ep.is_on_sale AND ep.sale_price IS NOT NULL
        AND (ep.sale_start_date IS NULL OR ep.sale_start_date <= now())
        AND (ep.sale_end_date   IS NULL OR ep.sale_end_date   >= now())
        THEN ep.sale_price ELSE NULL END,
      ep.base_price, fm.selling_price, p.default_price)::numeric AS eff
    FROM public.ecommerce_products ep
    LEFT JOIN public.fabric_materials fm ON fm.id = ep.material_id
    LEFT JOIN public.products p ON p.id = ep.product_id
    WHERE ep.id = ANY(v_ids)
  ) x
  WHERE x.eff IS NOT NULL;

  -- Flag counts (UI shows a flag chip only when 0 < count < total).
  SELECT jsonb_build_object(
      'on_sale',    count(*) FILTER (WHERE ep.is_on_sale),
      'new',        count(*) FILTER (WHERE ep.is_new),
      'bestseller', count(*) FILTER (WHERE ep.is_bestseller),
      'in_stock',   count(*) FILTER (WHERE COALESCE(fm.current_stock, 0) > 0))
    INTO v_flags
  FROM public.ecommerce_products ep
  LEFT JOIN public.fabric_materials fm ON fm.id = ep.material_id
  WHERE ep.id = ANY(v_ids);

  -- Dynamic attribute facets — data-driven, enriched by sector definitions.
  WITH ev AS (
    SELECT e.attribute_key, e.attribute_value, e.attribute_value_num
    FROM public.ecommerce_product_attrs_effective e
    WHERE e.product_id = ANY(v_ids)
  ),
  defs AS (
    SELECT ad.attribute_key, ad.label, ad.attribute_type::text AS attribute_type,
           ad.unit, ad.display_order, ad.is_filterable
    FROM public.ecommerce_attribute_definitions ad
    WHERE ad.sector = v_sector AND (ad.store_id IS NULL OR ad.store_id = p_store_id)
  ),
  keyinfo AS (
    SELECT ev.attribute_key,
           bool_or(ev.attribute_value_num IS NOT NULL) AS has_num,
           bool_or(ev.attribute_value    IS NOT NULL)  AS has_text,
           count(DISTINCT ev.attribute_value)          AS distinct_vals,
           min(ev.attribute_value_num)                 AS num_min,
           max(ev.attribute_value_num)                 AS num_max
    FROM ev GROUP BY ev.attribute_key
  ),
  vals AS (
    SELECT ev.attribute_key, ev.attribute_value AS value, count(*) AS cnt
    FROM ev WHERE ev.attribute_value IS NOT NULL
    GROUP BY ev.attribute_key, ev.attribute_value
  ),
  built AS (
    SELECT
      ki.attribute_key AS key,
      COALESCE(d.label, jsonb_build_object('ar', ki.attribute_key, 'en', ki.attribute_key)) AS label,
      COALESCE(d.unit, '') AS unit,
      COALESCE(d.display_order, 999) AS ord,
      CASE
        WHEN COALESCE(d.attribute_type, '') = 'number'
          OR (ki.has_num AND NOT ki.has_text) THEN 'number'
        ELSE COALESCE(NULLIF(d.attribute_type, ''), 'select')
      END AS type,
      ki.distinct_vals, ki.num_min, ki.num_max
    FROM keyinfo ki
    LEFT JOIN defs d ON d.attribute_key = ki.attribute_key
    WHERE COALESCE(d.is_filterable, true)   -- defined ⇒ must be filterable; undefined ⇒ allow
  )
  SELECT jsonb_agg(item ORDER BY ord, key) INTO v_attrs
  FROM (
    SELECT b.ord, b.key,
      CASE WHEN b.type = 'number' THEN
        jsonb_build_object('key', b.key, 'label', b.label, 'type', 'number',
                           'unit', b.unit, 'min', b.num_min, 'max', b.num_max)
      ELSE
        jsonb_build_object('key', b.key, 'label', b.label, 'type', b.type,
          'unit', b.unit,
          'values', (SELECT jsonb_agg(jsonb_build_object('value', v.value, 'count', v.cnt)
                            ORDER BY v.cnt DESC, v.value)
                     FROM vals v WHERE v.attribute_key = b.key))
      END AS item
    FROM built b
    WHERE (b.type =  'number' AND b.num_min IS NOT NULL AND b.num_max IS NOT NULL AND b.num_min < b.num_max)
       OR (b.type <> 'number' AND b.distinct_vals >= 2)
  ) q;

  RETURN jsonb_build_object(
    'total', v_total,
    'currency', v_currency,
    'price', v_price,
    'flags', v_flags,
    'attributes', COALESCE(v_attrs, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ecommerce_facets(uuid, text, text) TO anon, authenticated;

-- ── 3) Extend get_ecommerce_products with filter params ────────────────────
-- Adding params changes the signature, so drop the old 6-arg version first.
DROP FUNCTION IF EXISTS public.get_ecommerce_products(uuid, text, text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.get_ecommerce_products(
  p_store_id uuid,
  p_category_slug text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_featured_only boolean DEFAULT false,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_attrs jsonb DEFAULT NULL,       -- {"composition":["قطن"],"color":["#fff"]}  (AND across keys, OR within)
  p_num_ranges jsonb DEFAULT NULL,  -- {"width_cm":{"min":100,"max":150}}
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_flags text[] DEFAULT NULL,      -- {on_sale,new,bestseller,in_stock}  (ALL must hold)
  p_sort text DEFAULT NULL          -- newest|price_asc|price_desc|popular|bestseller
)
RETURNS TABLE(id uuid, material_id uuid, product_id uuid, display_no text,
  marketing_title jsonb, marketing_description jsonb, short_description jsonb,
  gallery_images text[], seo_slug text, tags text[], is_featured boolean,
  is_new boolean, is_bestseller boolean, is_on_sale boolean, sale_price numeric,
  sale_unit text, min_order_quantity numeric, view_count integer,
  order_count integer, published_at timestamp with time zone, material_code text,
  material_name_ar text, material_name_en text, unit_price numeric,
  selling_price numeric, material_image text, effective_price numeric,
  category_slugs text[], stock_status text, total_stock numeric,
  available_date timestamp with time zone, supplier_lead_time text, currency text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      ep.id, ep.material_id, ep.product_id, ep.display_no::TEXT AS display_no,
      ep.marketing_title, ep.marketing_description, ep.short_description,
      ep.gallery_images, ep.seo_slug, ep.tags, ep.is_featured, ep.is_new,
      ep.is_bestseller, ep.is_on_sale, ep.sale_price, ep.sale_unit,
      ep.min_order_quantity, ep.view_count, ep.order_count, ep.published_at,
      COALESCE(fm.code, p.sku)::TEXT AS material_code,
      COALESCE(fm.name_ar, p.name_ar)::TEXT AS material_name_ar,
      COALESCE(fm.name_en, p.name_en)::TEXT AS material_name_en,
      COALESCE(fm.selling_price, p.default_price)::DECIMAL AS unit_price,
      COALESCE(ep.base_price, fm.selling_price, p.default_price)::DECIMAL AS selling_price,
      COALESCE(ep.gallery_images[1], (p.images->>0)::TEXT)::TEXT AS material_image,
      COALESCE(
        CASE WHEN ep.is_on_sale AND ep.sale_price IS NOT NULL
             AND (ep.sale_start_date IS NULL OR ep.sale_start_date <= now())
             AND (ep.sale_end_date   IS NULL OR ep.sale_end_date   >= now())
        THEN ep.sale_price ELSE NULL END,
        ep.base_price, fm.selling_price, p.default_price)::DECIMAL AS effective_price,
      ARRAY(
        SELECT ec.slug FROM public.ecommerce_product_categories epc
        JOIN public.ecommerce_categories ec ON ec.id = epc.category_id
        WHERE epc.product_id = ep.id)::TEXT[] AS category_slugs,
      COALESCE(ep.stock_status, 'tracked')::TEXT AS stock_status,
      COALESCE(fm.current_stock, 0)::DECIMAL AS total_stock,
      ep.available_date::TIMESTAMPTZ AS available_date,
      ep.supplier_lead_time::TEXT AS supplier_lead_time,
      COALESCE(ep.currency, 'USD')::TEXT AS currency,
      ep.display_order AS _display_order
    FROM public.ecommerce_products ep
    LEFT JOIN public.fabric_materials fm ON fm.id = ep.material_id
    LEFT JOIN public.products p ON p.id = ep.product_id
    WHERE ep.store_id = p_store_id
      AND ep.is_published = true
      AND (p_featured_only = false OR ep.is_featured = true)
      AND (p_search IS NULL OR (
          COALESCE(fm.name_ar, p.name_ar, '') ILIKE '%' || p_search || '%' OR
          COALESCE(fm.name_en, p.name_en, '') ILIKE '%' || p_search || '%' OR
          COALESCE(fm.code, p.sku, '')        ILIKE '%' || p_search || '%' OR
          ep.display_no ILIKE '%' || p_search || '%' OR
          ep.marketing_title::text ILIKE '%' || p_search || '%' OR
          p_search = ANY(ep.tags)))
      AND (p_category_slug IS NULL OR EXISTS (
          SELECT 1 FROM public.ecommerce_product_categories epc
          JOIN public.ecommerce_categories ec ON ec.id = epc.category_id
          WHERE epc.product_id = ep.id AND ec.slug = p_category_slug))
      -- select/multiselect/color facet filters: AND across keys, OR within a key
      AND (p_attrs IS NULL OR p_attrs = '{}'::jsonb OR NOT EXISTS (
          SELECT 1 FROM jsonb_each(p_attrs) AS req(k, vals)
          WHERE jsonb_typeof(req.vals) = 'array' AND jsonb_array_length(req.vals) > 0
            AND NOT EXISTS (
              SELECT 1 FROM public.ecommerce_product_attrs_effective ea
              WHERE ea.product_id = ep.id AND ea.attribute_key = req.k
                AND ea.attribute_value IN (SELECT jsonb_array_elements_text(req.vals)))))
      -- numeric range facet filters
      AND (p_num_ranges IS NULL OR p_num_ranges = '{}'::jsonb OR NOT EXISTS (
          SELECT 1 FROM jsonb_each(p_num_ranges) AS rq(k, rng)
          WHERE NOT EXISTS (
              SELECT 1 FROM public.ecommerce_product_attrs_effective ea
              WHERE ea.product_id = ep.id AND ea.attribute_key = rq.k
                AND ea.attribute_value_num IS NOT NULL
                AND ((rq.rng->>'min') IS NULL OR ea.attribute_value_num >= (rq.rng->>'min')::numeric)
                AND ((rq.rng->>'max') IS NULL OR ea.attribute_value_num <= (rq.rng->>'max')::numeric))))
      -- boolean flags: every requested flag must hold
      AND (p_flags IS NULL OR (
          (NOT ('on_sale'    = ANY(p_flags)) OR ep.is_on_sale)
          AND (NOT ('new'        = ANY(p_flags)) OR ep.is_new)
          AND (NOT ('bestseller' = ANY(p_flags)) OR ep.is_bestseller)
          AND (NOT ('in_stock'   = ANY(p_flags)) OR COALESCE(fm.current_stock, 0) > 0)))
  )
  SELECT
    b.id, b.material_id, b.product_id, b.display_no, b.marketing_title,
    b.marketing_description, b.short_description, b.gallery_images, b.seo_slug,
    b.tags, b.is_featured, b.is_new, b.is_bestseller, b.is_on_sale, b.sale_price,
    b.sale_unit, b.min_order_quantity, b.view_count, b.order_count,
    b.published_at, b.material_code, b.material_name_ar, b.material_name_en,
    b.unit_price, b.selling_price, b.material_image, b.effective_price,
    b.category_slugs, b.stock_status, b.total_stock, b.available_date,
    b.supplier_lead_time, b.currency
  FROM base b
  WHERE (p_min_price IS NULL OR b.effective_price >= p_min_price)
    AND (p_max_price IS NULL OR b.effective_price <= p_max_price)
  ORDER BY
    CASE WHEN p_sort = 'price_asc'  THEN b.effective_price END ASC  NULLS LAST,
    CASE WHEN p_sort = 'price_desc' THEN b.effective_price END DESC NULLS LAST,
    CASE WHEN p_sort = 'newest'     THEN b.published_at END DESC NULLS LAST,
    CASE WHEN p_sort = 'popular'    THEN b.view_count  END DESC NULLS LAST,
    CASE WHEN p_sort = 'bestseller' THEN b.order_count END DESC NULLS LAST,
    b._display_order ASC, b.published_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ecommerce_products(uuid, text, text, boolean, integer, integer, jsonb, jsonb, numeric, numeric, text[], text) TO anon, authenticated;

COMMIT;
