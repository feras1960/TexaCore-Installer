-- ════════════════════════════════════════════════════════════════════════
-- 20260702t — تحسينات: تقييد الكوبون بفئة + «كوبوناتي» بالكابينة + شرائح الكاش باك الشهرية
-- ════════════════════════════════════════════════════════════════════════
-- 1) الكوبون على مستوى فئة: applies_to + category_id — الخصم يُحسب على المؤهّل فقط
--    (بنود السلة تُمرَّر إلى validate_conو RPC يحسب المؤهّل خادمياً).
--    تريغر القصّ للمقيّد بفئة يقصّ إلى «المكافئ على مستوى الطلب» (سقف آمن؛ البنود
--    غير متاحة وقت BEFORE INSERT للطلب — راجع الملاحظة).
-- 2) is_public + get_available_coupons: عرض الكوبونات العامة المؤهّلة للزبون بالكابينة
--    (الأكواد السرّية تبقى غير معروضة).
-- 3) شرائح الكاش باك الشهرية: v_settings.tiers [{"min_monthly":N,"rate":R}] — النسبة
--    الفعّالة = أعلى شريحة يبلغها إنفاق الزبون آخر 30 يوماً، وإلا rate_percent الأساس.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) أعمدة الكوبون الجديدة ────────────────────────────────────────────
ALTER TABLE public.ecommerce_coupons ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'all'
    CHECK (applies_to IN ('all','category'));
ALTER TABLE public.ecommerce_coupons ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.ecommerce_categories(id) ON DELETE SET NULL;
ALTER TABLE public.ecommerce_coupons ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- ── 2) validate_coupon مع بنود السلة + التقييد بفئة ─────────────────────
CREATE OR REPLACE FUNCTION public.validate_coupon(
    p_store_id UUID,
    p_code TEXT,
    p_subtotal NUMERIC,
    p_customer_id UUID DEFAULT NULL,
    p_customer_email TEXT DEFAULT NULL,
    p_customer_phone TEXT DEFAULT NULL,
    p_items JSONB DEFAULT NULL   -- [{"product_id":"…","line_total":N}]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_c ecommerce_coupons%ROWTYPE;
    v_used_total INT;
    v_used_cust INT;
    v_has_prior BOOLEAN;
    v_discount NUMERIC := 0;
    v_free_ship BOOLEAN := false;
    v_base NUMERIC;         -- الأساس الذي يُحسب عليه الخصم (المؤهّل أو الكلّي)
BEGIN
    IF p_code IS NULL OR btrim(p_code) = '' THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'empty',
            'message', 'Enter a coupon code', 'message_ar', 'أدخل كود الكوبون');
    END IF;

    SELECT * INTO v_c FROM ecommerce_coupons
    WHERE store_id = p_store_id AND upper(code) = upper(btrim(p_code));

    IF NOT FOUND OR NOT v_c.is_active THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'not_found',
            'message', 'Invalid or inactive coupon', 'message_ar', 'كوبون غير صالح أو غير مفعّل');
    END IF;

    IF v_c.starts_at IS NOT NULL AND NOW() < v_c.starts_at THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'not_started',
            'message', 'Coupon not active yet', 'message_ar', 'الكوبون لم يبدأ بعد');
    END IF;
    IF v_c.expires_at IS NOT NULL AND NOW() > v_c.expires_at THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'expired',
            'message', 'Coupon has expired', 'message_ar', 'انتهت صلاحية الكوبون');
    END IF;

    IF v_c.registered_only AND p_customer_id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'registered_only',
            'message', 'For registered customers only — please sign in', 'message_ar', 'للعملاء المسجّلين فقط — سجّل الدخول');
    END IF;

    IF COALESCE(p_subtotal, 0) < v_c.min_order_amount THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'min_order',
            'min_order_amount', v_c.min_order_amount,
            'message', 'Order below the coupon minimum', 'message_ar', 'قيمة الطلب أقل من الحد الأدنى للكوبون');
    END IF;

    -- سقف الاستخدام الكلّي
    IF v_c.usage_limit_total IS NOT NULL THEN
        SELECT COUNT(*) INTO v_used_total FROM ecommerce_coupon_redemptions
        WHERE coupon_id = v_c.id AND NOT is_voided;
        IF v_used_total >= v_c.usage_limit_total THEN
            RETURN jsonb_build_object('valid', false, 'reason', 'limit_total',
                'message', 'Coupon usage limit reached', 'message_ar', 'استُنفد الحد الأقصى لاستخدام الكوبون');
        END IF;
    END IF;

    -- سقف لكل زبون
    IF v_c.usage_limit_per_customer IS NOT NULL THEN
        SELECT COUNT(*) INTO v_used_cust FROM ecommerce_coupon_redemptions r
        WHERE r.coupon_id = v_c.id AND NOT r.is_voided
          AND (
            (p_customer_id IS NOT NULL AND r.customer_id = p_customer_id)
            OR (p_customer_id IS NULL AND (
                  (p_customer_email IS NOT NULL AND r.customer_email = p_customer_email)
               OR (p_customer_phone IS NOT NULL AND r.customer_phone = p_customer_phone)))
          );
        IF v_used_cust >= v_c.usage_limit_per_customer THEN
            RETURN jsonb_build_object('valid', false, 'reason', 'limit_customer',
                'message', 'You have already used this coupon', 'message_ar', 'لقد استخدمت هذا الكوبون سابقاً');
        END IF;
    END IF;

    -- أول طلب فقط
    IF v_c.first_order_only THEN
        SELECT EXISTS (
            SELECT 1 FROM ecommerce_orders o
            WHERE o.store_id = p_store_id AND o.status <> 'cancelled'
              AND (
                (p_customer_id IS NOT NULL AND o.customer_id = p_customer_id)
                OR (p_customer_id IS NULL AND (
                      (p_customer_email IS NOT NULL AND o.customer_email = p_customer_email)
                   OR (p_customer_phone IS NOT NULL AND o.customer_phone = p_customer_phone)))
              )
        ) INTO v_has_prior;
        IF v_has_prior THEN
            RETURN jsonb_build_object('valid', false, 'reason', 'not_first_order',
                'message', 'Valid on your first order only', 'message_ar', 'صالح على أول طلب فقط');
        END IF;
    END IF;

    -- الأساس: المؤهّل (فئة) أو الكلّي
    v_base := COALESCE(p_subtotal, 0);
    IF v_c.applies_to = 'category' AND v_c.category_id IS NOT NULL THEN
        IF p_items IS NULL THEN
            -- بلا بنود لا يمكن حساب المؤهّل — اعتبره غير قابل للتطبيق هنا (سيُحسب عند الدفع)
            v_base := 0;
        ELSE
            SELECT COALESCE(SUM((it->>'line_total')::numeric), 0) INTO v_base
            FROM jsonb_array_elements(p_items) it
            WHERE EXISTS (
                SELECT 1 FROM ecommerce_product_categories pc
                WHERE pc.product_id = (it->>'product_id')::uuid AND pc.category_id = v_c.category_id
            );
        END IF;

        IF v_base <= 0 THEN
            RETURN jsonb_build_object('valid', false, 'reason', 'no_qualifying_items',
                'message', 'No items from the coupon''s category in your cart',
                'message_ar', 'لا توجد أصناف من فئة الكوبون في سلّتك');
        END IF;
    END IF;

    -- الخصم
    IF v_c.discount_type = 'percentage' THEN
        v_discount := ROUND(v_base * v_c.discount_value / 100, 2);
        IF v_c.max_discount_amount IS NOT NULL THEN
            v_discount := LEAST(v_discount, v_c.max_discount_amount);
        END IF;
    ELSIF v_c.discount_type = 'fixed' THEN
        v_discount := LEAST(v_c.discount_value, v_base);
    ELSE
        v_discount := 0;
        v_free_ship := true;
    END IF;

    RETURN jsonb_build_object(
        'valid', true, 'coupon_id', v_c.id, 'code', v_c.code,
        'discount_type', v_c.discount_type, 'discount_amount', v_discount,
        'free_shipping', v_free_ship, 'applies_to', v_c.applies_to,
        'message', 'Coupon applied', 'message_ar', 'طُبّق الكوبون'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coupon(UUID, TEXT, NUMERIC, UUID, TEXT, TEXT, JSONB) TO anon, authenticated;

-- ── 3) تريغر القصّ: يراعي التقييد بفئة ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ecommerce_orders_coupon_before()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_res jsonb;
    v_c ecommerce_coupons%ROWTYPE;
    v_ceiling NUMERIC;
BEGIN
    IF NEW.coupon_code IS NULL OR btrim(NEW.coupon_code) = '' THEN
        RETURN NEW;
    END IF;

    -- تحقّق الأهلية على مستوى الطلب (بلا بنود — غير متاحة بعد)
    v_res := validate_coupon(NEW.store_id, NEW.coupon_code, NEW.subtotal,
                             NEW.customer_id, NEW.customer_email, NEW.customer_phone, NULL);

    SELECT * INTO v_c FROM ecommerce_coupons
    WHERE store_id = NEW.store_id AND upper(code) = upper(NEW.coupon_code);

    -- «غير مؤهّل» لكوبون فئة يعني فقط تعذّر حساب المؤهّل بلا بنود ⇒ لا نرفضه هنا،
    -- بل نتحقق من بقية أسباب الرفض (النافذة/الحدود/الحد الأدنى/أول طلب).
    IF NOT (v_res->>'valid')::boolean
       AND COALESCE(v_res->>'reason','') <> 'no_qualifying_items' THEN
        NEW.coupon_code := NULL;
        NEW.discount_amount := 0;
    ELSIF FOUND AND v_c.discount_type IN ('percentage','fixed') THEN
        -- سقف آمن = المكافئ على مستوى الطلب (كأنّ كل السلة مؤهّلة)
        IF v_c.discount_type = 'percentage' THEN
            v_ceiling := ROUND(COALESCE(NEW.subtotal,0) * v_c.discount_value / 100, 2);
            IF v_c.max_discount_amount IS NOT NULL THEN
                v_ceiling := LEAST(v_ceiling, v_c.max_discount_amount);
            END IF;
        ELSE
            v_ceiling := LEAST(v_c.discount_value, COALESCE(NEW.subtotal,0));
        END IF;

        IF v_c.applies_to = 'all' THEN
            -- على مستوى الطلب: اعتمد المحسوب خادمياً بالضبط
            NEW.discount_amount := v_ceiling;
        ELSE
            -- على مستوى فئة: اقصص خصم المتصفح إلى السقف الآمن (المؤهّل محسوب عند الدفع)
            NEW.discount_amount := LEAST(COALESCE(NEW.discount_amount, 0), v_ceiling);
        END IF;
    END IF;

    NEW.total_amount := GREATEST(
        COALESCE(NEW.subtotal, 0) + COALESCE(NEW.shipping_amount, 0) + COALESCE(NEW.tax_amount, 0)
        - COALESCE(NEW.discount_amount, 0) - COALESCE(NEW.cashback_used, 0), 0);

    RETURN NEW;
END;
$$;

-- ── 4) get_available_coupons — «كوبوناتي المتاحة» بالكابينة ──────────────
CREATE OR REPLACE FUNCTION public.get_available_coupons(
    p_store_id UUID,
    p_customer_id UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_arr jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'code', c.code,
        'description', c.description,
        'discount_type', c.discount_type,
        'discount_value', c.discount_value,
        'max_discount_amount', c.max_discount_amount,
        'min_order_amount', c.min_order_amount,
        'first_order_only', c.first_order_only,
        'expires_at', c.expires_at
    ) ORDER BY c.min_order_amount, c.created_at DESC), '[]'::jsonb)
    INTO v_arr
    FROM ecommerce_coupons c
    WHERE c.store_id = p_store_id
      AND c.is_public AND c.is_active
      AND (c.starts_at IS NULL OR NOW() >= c.starts_at)
      AND (c.expires_at IS NULL OR NOW() <= c.expires_at)
      -- ليس مستنفَداً كلّياً
      AND (c.usage_limit_total IS NULL OR
           (SELECT COUNT(*) FROM ecommerce_coupon_redemptions r WHERE r.coupon_id = c.id AND NOT r.is_voided) < c.usage_limit_total)
      -- المسجّلون فقط: يظهر للمسجّل فقط
      AND (NOT c.registered_only OR p_customer_id IS NOT NULL)
      -- سقف الزبون لم يُستنفد
      AND (c.usage_limit_per_customer IS NULL OR p_customer_id IS NULL OR
           (SELECT COUNT(*) FROM ecommerce_coupon_redemptions r
            WHERE r.coupon_id = c.id AND NOT r.is_voided AND r.customer_id = p_customer_id) < c.usage_limit_per_customer)
      -- أول طلب فقط: يظهر لمن لا طلب سابق له
      AND (NOT c.first_order_only OR p_customer_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM ecommerce_orders o
            WHERE o.store_id = p_store_id AND o.customer_id = p_customer_id AND o.status <> 'cancelled'));

    RETURN v_arr;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_coupons(UUID, UUID) TO anon, authenticated;

-- ── 5) شرائح الكاش باك الشهرية ──────────────────────────────────────────
-- النسبة الفعّالة = أعلى شريحة يبلغها إنفاق الزبون في آخر 30 يوماً (طلبات غير ملغاة)
CREATE OR REPLACE FUNCTION public.cashback_effective_rate(
    p_store_id UUID, p_customer_id UUID, p_base_rate NUMERIC, p_tiers JSONB
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_monthly NUMERIC;
    v_rate NUMERIC := COALESCE(p_base_rate, 0);
    v_tier_rate NUMERIC;
BEGIN
    IF p_tiers IS NULL OR jsonb_typeof(p_tiers) <> 'array' OR jsonb_array_length(p_tiers) = 0
       OR p_customer_id IS NULL THEN
        RETURN v_rate;
    END IF;

    SELECT COALESCE(SUM(total_amount), 0) INTO v_monthly
    FROM ecommerce_orders
    WHERE store_id = p_store_id AND customer_id = p_customer_id
      AND status NOT IN ('cancelled','returned')
      AND created_at >= NOW() - INTERVAL '30 days';

    SELECT MAX((t->>'rate')::numeric) INTO v_tier_rate
    FROM jsonb_array_elements(p_tiers) t
    WHERE v_monthly >= COALESCE((t->>'min_monthly')::numeric, 0);

    RETURN GREATEST(v_rate, COALESCE(v_tier_rate, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashback_effective_rate(UUID, UUID, NUMERIC, JSONB) TO authenticated;

-- تحديث تريغر الكاش باك ليستعمل النسبة الفعّالة (الشرائح)
CREATE OR REPLACE FUNCTION public.ecommerce_orders_cashback_before()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_settings ecommerce_cashback_settings%ROWTYPE;
    v_balance  NUMERIC;
    v_cap      NUMERIC;
    v_earn_base NUMERIC;
    v_tenant   UUID;
    v_rate     NUMERIC;
BEGIN
    v_tenant := COALESCE(NEW.tenant_id, (SELECT tenant_id FROM ecommerce_stores WHERE id = NEW.store_id));
    SELECT * INTO v_settings FROM ecommerce_cashback_settings WHERE store_id = NEW.store_id;

    -- التحقق من الاسترداد
    IF COALESCE(NEW.cashback_used, 0) > 0 THEN
        IF v_settings IS NULL OR v_settings.enabled = false THEN
            RAISE EXCEPTION 'cashback is not enabled for this store';
        END IF;
        IF NEW.customer_id IS NULL THEN
            RAISE EXCEPTION 'cashback requires a registered customer';
        END IF;
        IF NOT (NEW.customer_id = current_customer_id()
                OR v_tenant = get_user_tenant_id()
                OR is_platform_admin()
                OR auth.role() = 'service_role') THEN
            RAISE EXCEPTION 'cashback redemption identity mismatch';
        END IF;
        v_balance := cashback_confirmed_balance(NEW.customer_id);
        IF NEW.cashback_used > v_balance + 0.01 THEN
            RAISE EXCEPTION 'cashback amount exceeds balance (% > %)', NEW.cashback_used, v_balance;
        END IF;
        v_cap := ROUND((COALESCE(NEW.subtotal,0) - COALESCE(NEW.discount_amount,0))
                       * v_settings.redeem_cap_percent / 100, 2);
        IF NEW.cashback_used > v_cap + 0.01 THEN
            RAISE EXCEPTION 'cashback amount exceeds redeem cap (% > %)', NEW.cashback_used, v_cap;
        END IF;
    END IF;

    -- لقطة الكسب بالنسبة الفعّالة (الشرائح الشهرية)
    NEW.cashback_earned := 0;
    IF v_settings.enabled AND NEW.customer_id IS NOT NULL THEN
        v_rate := cashback_effective_rate(NEW.store_id, NEW.customer_id, v_settings.rate_percent, v_settings.tiers);
        IF v_rate > 0 THEN
            v_earn_base := COALESCE(NEW.subtotal,0) - COALESCE(NEW.discount_amount,0) - COALESCE(NEW.cashback_used,0);
            IF v_earn_base >= GREATEST(v_settings.min_order_amount, 0.01) THEN
                NEW.cashback_earned := ROUND(v_earn_base * v_rate / 100, 2);
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMIT;
