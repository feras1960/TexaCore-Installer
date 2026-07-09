-- ════════════════════════════════════════════════════════════════════════
-- 20260702q — قواعد الهامش للمتجر الإلكتروني (تسعير تلقائي فوق التكلفة/سعر المورد)
-- ════════════════════════════════════════════════════════════════════════
-- يحوّل «قواعد التسعير» الوهمية إلى محرّك حقيقي:
--   قاعدة لكل متجر: نطاق (كل المتجر / فئة / منتجات محددة) × أساس (التكلفة
--   المتوسطة avg_cost_per_unit أو سعر المورد purchase_price من المادة
--   المرتبطة material_id) × هامش٪ × تقريب اختياري.
-- الأسبقية عند تعدد القواعد للمنتج الواحد: منتجات > فئة > متجر، ثم priority.
-- apply_margin_rules: إعادة تسعير فورية (مع dry-run للمعاينة) تحدّث base_price.
-- auto_apply: تسعير المنتج الجديد تلقائياً عند إدراجه/تصنيفه — فقط إذا كان
--   سعره فارغاً/صفراً (لا تدوس سعراً يدوياً؛ «إعادة التسعير الآن» تتكفل بالبقية).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) جدول القواعد ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ecommerce_margin_rules (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    store_id     UUID NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
    name         TEXT NOT NULL DEFAULT '',
    scope        TEXT NOT NULL DEFAULT 'store' CHECK (scope IN ('store','category','products')),
    category_id  UUID REFERENCES public.ecommerce_categories(id) ON DELETE CASCADE,
    product_ids  UUID[],
    basis        TEXT NOT NULL DEFAULT 'cost' CHECK (basis IN ('cost','supplier')),
    margin_percent NUMERIC(7,2) NOT NULL CHECK (margin_percent >= 0 AND margin_percent <= 1000),
    round_to     NUMERIC(6,2) CHECK (round_to IS NULL OR round_to > 0),
    auto_apply   BOOLEAN NOT NULL DEFAULT false,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    priority     INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   UUID,
    CONSTRAINT margin_rule_scope_target CHECK (
        (scope = 'store')
        OR (scope = 'category' AND category_id IS NOT NULL)
        OR (scope = 'products' AND product_ids IS NOT NULL AND array_length(product_ids, 1) > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_margin_rules_store ON public.ecommerce_margin_rules(store_id) WHERE is_active;

ALTER TABLE public.ecommerce_margin_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS margin_rules_admin_all ON public.ecommerce_margin_rules;
CREATE POLICY margin_rules_admin_all
    ON public.ecommerce_margin_rules
    FOR ALL TO authenticated
    USING (tenant_id = get_user_tenant_id() OR is_platform_admin())
    WITH CHECK (tenant_id = get_user_tenant_id() OR is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecommerce_margin_rules TO authenticated;

-- ── 2) حساب سعر منتج وفق قاعدة (مساعد داخلي) ────────────────────────────
CREATE OR REPLACE FUNCTION public._margin_rule_price(
    p_basis TEXT, p_margin NUMERIC, p_round_to NUMERIC,
    p_purchase NUMERIC, p_avg_cost NUMERIC
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN base <= 0 THEN NULL
        WHEN p_round_to IS NOT NULL AND p_round_to > 0
            THEN ROUND(ROUND((base * (1 + p_margin / 100)) / p_round_to) * p_round_to, 2)
        ELSE ROUND(base * (1 + p_margin / 100), 2)
    END
    FROM (SELECT CASE p_basis
            WHEN 'supplier' THEN COALESCE(p_purchase, 0)
            ELSE COALESCE(NULLIF(p_avg_cost, 0), p_purchase, 0)
          END AS base) b;
$$;

-- ── 3) إعادة التسعير (مع dry-run) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_margin_rules(
    p_store_id UUID,
    p_rule_id UUID DEFAULT NULL,
    p_dry_run BOOLEAN DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_tenant UUID;
    v_updated INT := 0;
    v_no_cost INT := 0;
    v_unchanged INT := 0;
    v_samples jsonb;
BEGIN
    SELECT tenant_id INTO v_tenant FROM ecommerce_stores WHERE id = p_store_id;
    IF v_tenant IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'store not found');
    END IF;
    IF NOT (v_tenant = get_user_tenant_id() OR is_platform_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'not allowed';
    END IF;

    -- المنتج ← قاعدته الفائزة ← سعره الجديد
    DROP TABLE IF EXISTS _margin_plan;
    CREATE TEMP TABLE _margin_plan ON COMMIT DROP AS
    WITH matched AS (
        SELECT p.id AS product_id, p.sku, p.base_price AS old_price,
               r.id AS rule_id, r.basis, r.margin_percent, r.round_to,
               m.purchase_price, m.avg_cost_per_unit,
               ROW_NUMBER() OVER (
                   PARTITION BY p.id
                   ORDER BY CASE r.scope WHEN 'products' THEN 3 WHEN 'category' THEN 2 ELSE 1 END DESC,
                            r.priority DESC, r.updated_at DESC
               ) AS rn
        FROM ecommerce_products p
        LEFT JOIN fabric_materials m ON m.id = p.material_id
        JOIN ecommerce_margin_rules r
          ON r.store_id = p.store_id
         AND r.is_active
         AND (p_rule_id IS NULL OR r.id = p_rule_id)
         AND (
              r.scope = 'store'
              OR (r.scope = 'category' AND EXISTS (
                    SELECT 1 FROM ecommerce_product_categories pc
                    WHERE pc.product_id = p.id AND pc.category_id = r.category_id))
              OR (r.scope = 'products' AND p.id = ANY(r.product_ids))
         )
        WHERE p.store_id = p_store_id
    )
    SELECT product_id, sku, old_price, rule_id,
           _margin_rule_price(basis, margin_percent, round_to, purchase_price, avg_cost_per_unit) AS new_price
    FROM matched WHERE rn = 1;

    SELECT COUNT(*) FILTER (WHERE new_price IS NULL),
           COUNT(*) FILTER (WHERE new_price IS NOT NULL AND new_price = COALESCE(old_price, -1)),
           COUNT(*) FILTER (WHERE new_price IS NOT NULL AND new_price <> COALESCE(old_price, -1))
    INTO v_no_cost, v_unchanged, v_updated
    FROM _margin_plan;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'sku', sku, 'old', old_price, 'new', new_price) ORDER BY sku), '[]'::jsonb)
    INTO v_samples
    FROM (SELECT sku, old_price, new_price FROM _margin_plan
          WHERE new_price IS NOT NULL AND new_price <> COALESCE(old_price, -1)
          LIMIT 8) s;

    IF NOT p_dry_run AND v_updated > 0 THEN
        UPDATE ecommerce_products p
        SET base_price = mp.new_price, updated_at = NOW()
        FROM _margin_plan mp
        WHERE p.id = mp.product_id
          AND mp.new_price IS NOT NULL
          AND mp.new_price <> COALESCE(p.base_price, -1);
    END IF;

    RETURN jsonb_build_object(
        'success', true, 'dry_run', p_dry_run,
        'updated', v_updated, 'unchanged', v_unchanged, 'skipped_no_cost', v_no_cost,
        'samples', v_samples
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_margin_rules(UUID, UUID, BOOLEAN) TO authenticated;

-- ── 4) التسعير التلقائي للمنتج الجديد (لا يدوس سعراً يدوياً) ─────────────
CREATE OR REPLACE FUNCTION public._auto_price_new_product(p_product_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_new NUMERIC;
BEGIN
    SELECT _margin_rule_price(r.basis, r.margin_percent, r.round_to, m.purchase_price, m.avg_cost_per_unit)
    INTO v_new
    FROM ecommerce_products p
    LEFT JOIN fabric_materials m ON m.id = p.material_id
    JOIN ecommerce_margin_rules r
      ON r.store_id = p.store_id AND r.is_active AND r.auto_apply
     AND (
          r.scope = 'store'
          OR (r.scope = 'category' AND EXISTS (
                SELECT 1 FROM ecommerce_product_categories pc
                WHERE pc.product_id = p.id AND pc.category_id = r.category_id))
          OR (r.scope = 'products' AND p.id = ANY(r.product_ids))
     )
    WHERE p.id = p_product_id
      AND COALESCE(p.base_price, 0) = 0
    ORDER BY CASE r.scope WHEN 'products' THEN 3 WHEN 'category' THEN 2 ELSE 1 END DESC,
             r.priority DESC, r.updated_at DESC
    LIMIT 1;

    IF v_new IS NOT NULL THEN
        UPDATE ecommerce_products SET base_price = v_new, updated_at = NOW()
        WHERE id = p_product_id AND COALESCE(base_price, 0) = 0;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ecommerce_products_auto_margin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    PERFORM _auto_price_new_product(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_products_auto_margin ON public.ecommerce_products;
CREATE TRIGGER trg_ecommerce_products_auto_margin
    AFTER INSERT ON public.ecommerce_products
    FOR EACH ROW EXECUTE FUNCTION public.ecommerce_products_auto_margin();

-- عند تصنيف المنتج لاحقاً: قواعد الفئة auto تلتقطه (إن كان سعره ما زال صفراً)
CREATE OR REPLACE FUNCTION public.ecommerce_product_categories_auto_margin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    PERFORM _auto_price_new_product(NEW.product_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_product_categories_auto_margin ON public.ecommerce_product_categories;
CREATE TRIGGER trg_ecommerce_product_categories_auto_margin
    AFTER INSERT ON public.ecommerce_product_categories
    FOR EACH ROW EXECUTE FUNCTION public.ecommerce_product_categories_auto_margin();

COMMIT;
