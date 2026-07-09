-- 20260707_ecom_cost_columns_and_module_code.sql
-- Store readiness audit — two remaining architectural fixes. Idempotent.
--
-- FIX 1: Cost columns exposed to logged-in storefront customers.
--   The `authenticated` role is shared between ERP staff and storefront
--   customers. Column-level GRANTs cannot distinguish inside one role, and
--   the permissive `ecommerce_products_public_read` policy (is_published=true,
--   no role restriction) lets any logged-in customer read published rows —
--   including supplier_cost_price / commission_override / supplier_tenant_id.
--
--   Investigation proved NO ERP code path SELECTs these three columns:
--     - EcommerceProducts.tsx cost display uses fabric_materials.custom_fields._cost_price
--       (column `erp_cost`), NOT ecommerce_products.supplier_cost_price.
--     - The only ERP touch is supplierMarketplaceService.ts which INSERTs
--       supplier_cost_price on publish (upsert ... .select('id')) — INSERT only.
--     - No UPDATE anywhere writes these columns; no component reads them.
--     - `select('*')` sites (EcommerceProducts.tsx, useDataPreloader.ts) expand
--       only to columns the role may SELECT — PostgREST drops revoked columns
--       silently, it does not error.
--   Therefore the smallest safe fix is to REVOKE SELECT on the three columns
--   from `authenticated` (and re-assert the anon revoke). INSERT/UPDATE stay
--   so the marketplace publish path keeps working. No replacement RPC needed —
--   nothing reads them.
--
-- FIX 2: module_code inconsistency — the guard is dead.
--   tenant_modules stores module_code='ecommerce' (no hyphen), but 48 RLS
--   policies + fn create_erp_customer_on_first_order call
--   tenant_has_module('e-commerce') (hyphen). The single-arg tenant_has_module
--   compares equality, so the guard always returns false for e-commerce
--   tenants. Because `ecommerce_products_module_guard` is a RESTRICTIVE SELECT
--   policy on authenticated, a dead guard actually breaks ERP reads too.
--   Renaming the row is unsafe (the subscriptions gateway keys on 'ecommerce').
--   No two module_codes collide after stripping hyphens (verified), so we
--   normalize hyphens inside the single-arg function — it now accepts both
--   'ecommerce' and 'e-commerce'. The two-arg overload is normalized the same
--   way for consistency.

BEGIN;

-- ─── FIX 1 ────────────────────────────────────────────────────────────────
-- NOTE: `authenticated` holds a TABLE-level GRANT SELECT on ecommerce_products.
-- A column-level `REVOKE SELECT (col)` is a no-op against a whole-table grant —
-- the privilege is stored table-wide, not per-column. The correct pattern
-- (same one already applied to anon) is: drop the table-level SELECT, then
-- GRANT SELECT back on every column EXCEPT the three sensitive ones.
REVOKE SELECT ON public.ecommerce_products FROM authenticated;

-- Public/staff-safe column allow-list (all columns except
-- supplier_cost_price, commission_override, supplier_tenant_id).
GRANT SELECT (
  id, tenant_id, store_id, material_id, marketing_title, marketing_description,
  short_description, gallery_images, seo_slug, seo_title, seo_description,
  seo_keywords, display_order, tags, is_published, is_featured, is_new,
  is_bestseller, is_on_sale, sale_price, sale_start_date, sale_end_date,
  min_order_quantity, max_order_quantity, sale_unit, view_count, order_count,
  published_at, created_at, updated_at, product_id, vendor_id, sector,
  product_type, sku, source_table, source_id, base_price, currency,
  product_origin, stock_status, available_date, supplier_lead_time,
  show_quantity, supplier_link_id, display_no, is_essential
) ON public.ecommerce_products TO authenticated;

-- Defense in depth: anon has no table-level SELECT; ensure no stray column
-- SELECT grant leaks the sensitive three (idempotent no-op if already absent).
REVOKE SELECT (supplier_cost_price, commission_override, supplier_tenant_id)
  ON public.ecommerce_products FROM anon;

-- ─── FIX 2 ────────────────────────────────────────────────────────────────
-- Single-arg guard: normalize hyphens so 'e-commerce' matches stored 'ecommerce'.
CREATE OR REPLACE FUNCTION public.tenant_has_module(p_module_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM tenant_modules
    WHERE tenant_id = get_user_tenant_id()
      AND replace(module_code, '-', '') = replace(p_module_code, '-', '')
      AND is_active = true
  )
  -- Platform admin always has access
  OR is_platform_admin();
$function$;

-- Two-arg overload: same normalization for callers that pass an explicit tenant.
CREATE OR REPLACE FUNCTION public.tenant_has_module(p_tenant_id uuid, p_module_code character varying)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id AND status = 'active') THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM tenant_modules
        WHERE tenant_id = p_tenant_id
          AND replace(module_code, '-', '') = replace(p_module_code, '-', '')
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$function$;

COMMIT;
