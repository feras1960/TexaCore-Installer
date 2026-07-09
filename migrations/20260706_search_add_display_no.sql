-- ══════════════════════════════════════════════════════════════════════════════
-- 🔍 search_ecommerce_products: include the human serial (display_no) in both
-- the searchable corpus and the returned columns, so customers can find a
-- product by TX-10001 the same way support quotes it. Return-type change →
-- DROP first (same pattern as 20260615_storefront_display_no).
-- ══════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.search_ecommerce_products(UUID, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.search_ecommerce_products(
    p_store_id UUID,
    p_query TEXT,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
    id uuid, material_id uuid, product_id uuid, display_no text,
    marketing_title jsonb, marketing_description jsonb, short_description jsonb,
    gallery_images text[], seo_slug text, tags text[],
    is_featured boolean, is_new boolean, is_bestseller boolean, is_on_sale boolean,
    sale_price numeric, sale_unit text, min_order_quantity numeric,
    view_count integer, order_count integer, published_at timestamptz,
    material_code text, material_name_ar text, material_name_en text,
    unit_price numeric, selling_price numeric, material_image text,
    effective_price numeric, category_slugs text[],
    stock_status text, total_stock numeric, available_date timestamptz,
    supplier_lead_time text, currency text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH q AS (
        SELECT ar_normalize(p_query) AS nq,
               regexp_split_to_array(trim(ar_normalize(p_query)), '\s+') AS tokens
    ),
    base AS (
        SELECT g.*,
               ar_normalize(
                   concat_ws(' ',
                       g.material_code, g.display_no,
                       g.material_name_ar, g.material_name_en,
                       m.name_ru, m.name_uk, m.name_tr, m.name_pl, m.name_ro, m.name_it, m.name_de,
                       m.composition, m.default_width,
                       array_to_string(g.tags, ' '),
                       array_to_string(g.category_slugs, ' ')
                   )
               ) AS ntext,
               lower(coalesce(g.material_code, '')) AS lcode,
               lower(coalesce(g.display_no, '')) AS lserial
        FROM get_ecommerce_products(p_store_id, NULL, NULL, false, 1000, 0) g
        LEFT JOIN fabric_materials m ON m.id = g.material_id
    )
    SELECT
        s.id, s.material_id, s.product_id, s.display_no,
        s.marketing_title, s.marketing_description, s.short_description,
        s.gallery_images, s.seo_slug, s.tags,
        s.is_featured, s.is_new, s.is_bestseller, s.is_on_sale,
        s.sale_price, s.sale_unit, s.min_order_quantity,
        s.view_count, s.order_count, s.published_at,
        s.material_code, s.material_name_ar, s.material_name_en,
        s.unit_price, s.selling_price, s.material_image,
        s.effective_price, s.category_slugs,
        s.stock_status, s.total_stock, s.available_date,
        s.supplier_lead_time, s.currency
    FROM (
        SELECT b.*,
               (SELECT count(*) FROM unnest(q.tokens) tok
                  WHERE tok <> '' AND b.ntext LIKE '%' || tok || '%') AS hits,
               (SELECT count(*) FROM unnest(q.tokens) tok WHERE tok <> '') AS ntok
        FROM base b, q
        WHERE q.nq <> ''
    ) s
    WHERE s.hits > 0
       OR s.lcode LIKE lower(trim(p_query)) || '%'
       OR s.lserial LIKE lower(trim(p_query)) || '%'
    ORDER BY
        (s.lcode = lower(trim(p_query))
          OR s.lserial = lower(trim(p_query))) DESC,
        (s.hits::numeric / NULLIF(s.ntok, 0)) DESC NULLS LAST,
        s.order_count DESC, s.view_count DESC
    LIMIT GREATEST(p_limit, 1)
$$;

GRANT EXECUTE ON FUNCTION public.search_ecommerce_products(UUID, TEXT, INTEGER) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
