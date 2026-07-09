-- ════════════════════════════════════════════════════════════════════════
-- 20260702s — محرّك كوبونات المتجر الإلكتروني (تكانيكس/أوبوفيكس)
-- ════════════════════════════════════════════════════════════════════════
-- الميزات (ديناميكية لكل متجر):
--   • أنواع: percentage (نسبة٪ بسقف خصم اختياري) / fixed (مبلغ ثابت) / free_shipping
--   • حد أدنى للطلب · سقف استخدامات كلّي · سقف لكل زبون · نافذة صلاحية (من/إلى)
--   • «أول طلب فقط» (عملاء جدد) · «المسجّلون فقط» · تفعيل/تعطيل
-- الأمان (مثل الكاش باك — لا ثقة بالمتصفح):
--   • validate_coupon: تحقّق خادمي anon يُرجع الخصم المعتمد + سبب الرفض
--   • تريغر BEFORE INSERT يعيد الحساب ويقصّ الخصم على الطلب ويحدّث الإجمالي
--     (يسبق تريغر الكاش باك بترقيم 00 كي يكسب الكاش باك على الصافي الصحيح)
--   • تريغر AFTER INSERT يسجّل الاستخدام بالدفتر
--   • عند الإلغاء/الإرجاع: تُبطَل حصة الاستخدام (is_voided) فتتحرّر للغير
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) جدول الكوبونات ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ecommerce_coupons (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    store_id     UUID NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
    code         TEXT NOT NULL,
    description  TEXT,
    discount_type  TEXT NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage','fixed','free_shipping')),
    discount_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
    max_discount_amount NUMERIC(12,2) CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
    min_order_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
    usage_limit_total        INT CHECK (usage_limit_total IS NULL OR usage_limit_total > 0),
    usage_limit_per_customer INT CHECK (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0),
    first_order_only  BOOLEAN NOT NULL DEFAULT false,
    registered_only   BOOLEAN NOT NULL DEFAULT false,
    starts_at    TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by   UUID
);

-- كود فريد لكل متجر (غير حسّاس لحالة الأحرف)
CREATE UNIQUE INDEX IF NOT EXISTS uq_coupons_store_code ON public.ecommerce_coupons(store_id, upper(code));

ALTER TABLE public.ecommerce_coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coupons_admin_all ON public.ecommerce_coupons;
CREATE POLICY coupons_admin_all
    ON public.ecommerce_coupons
    FOR ALL TO authenticated
    USING (tenant_id = get_user_tenant_id() OR is_platform_admin())
    WITH CHECK (tenant_id = get_user_tenant_id() OR is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecommerce_coupons TO authenticated;

-- ── 2) دفتر الاستخدام ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ecommerce_coupon_redemptions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    store_id      UUID NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
    coupon_id     UUID NOT NULL REFERENCES public.ecommerce_coupons(id) ON DELETE CASCADE,
    order_id      UUID REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL,
    customer_id   UUID REFERENCES public.ecommerce_customers(id) ON DELETE SET NULL,
    customer_email TEXT,
    customer_phone TEXT,
    discount_type  TEXT,
    discount_applied NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_voided     BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- فريد عادي (لا جزئي) كي يدعمه ON CONFLICT؛ Postgres يسمح بقيم NULL متعددة
DROP INDEX IF EXISTS public.uq_coupon_redemption_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_coupon_redemption_order ON public.ecommerce_coupon_redemptions(order_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON public.ecommerce_coupon_redemptions(coupon_id) WHERE NOT is_voided;
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_customer ON public.ecommerce_coupon_redemptions(coupon_id, customer_id) WHERE NOT is_voided;

ALTER TABLE public.ecommerce_coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coupon_redemptions_admin_read ON public.ecommerce_coupon_redemptions;
CREATE POLICY coupon_redemptions_admin_read
    ON public.ecommerce_coupon_redemptions
    FOR SELECT TO authenticated
    USING (tenant_id = get_user_tenant_id() OR is_platform_admin());

GRANT SELECT ON public.ecommerce_coupon_redemptions TO authenticated;

-- ── 3) التحقّق (anon) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_coupon(
    p_store_id UUID,
    p_code TEXT,
    p_subtotal NUMERIC,
    p_customer_id UUID DEFAULT NULL,
    p_customer_email TEXT DEFAULT NULL,
    p_customer_phone TEXT DEFAULT NULL
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

    -- سقف لكل زبون (يطابق بالمعرّف أو البريد/الهاتف للضيوف)
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
            WHERE o.store_id = p_store_id
              AND o.status <> 'cancelled'
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

    -- حساب الخصم المعتمد
    IF v_c.discount_type = 'percentage' THEN
        v_discount := ROUND(p_subtotal * v_c.discount_value / 100, 2);
        IF v_c.max_discount_amount IS NOT NULL THEN
            v_discount := LEAST(v_discount, v_c.max_discount_amount);
        END IF;
    ELSIF v_c.discount_type = 'fixed' THEN
        v_discount := LEAST(v_c.discount_value, p_subtotal);
    ELSE -- free_shipping
        v_discount := 0;
        v_free_ship := true;
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'coupon_id', v_c.id,
        'code', v_c.code,
        'discount_type', v_c.discount_type,
        'discount_amount', v_discount,
        'free_shipping', v_free_ship,
        'message', 'Coupon applied', 'message_ar', 'طُبّق الكوبون'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coupon(UUID, TEXT, NUMERIC, UUID, TEXT, TEXT) TO anon, authenticated;

-- ── 4) عدّاد الاستخدام للوحة الإدارة ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_coupon_usage(p_store_id UUID)
RETURNS TABLE (coupon_id UUID, used_total BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF NOT ((SELECT tenant_id FROM ecommerce_stores WHERE id = p_store_id) = get_user_tenant_id()
            OR is_platform_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'not allowed';
    END IF;
    RETURN QUERY
    SELECT r.coupon_id, COUNT(*)::BIGINT
    FROM ecommerce_coupon_redemptions r
    WHERE r.store_id = p_store_id AND NOT r.is_voided
    GROUP BY r.coupon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coupon_usage(UUID) TO authenticated;

-- ── 5) تريغر القصّ الخادمي (يسبق الكاش باك) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ecommerce_orders_coupon_before()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_res jsonb;
BEGIN
    IF NEW.coupon_code IS NULL OR btrim(NEW.coupon_code) = '' THEN
        RETURN NEW;
    END IF;

    v_res := validate_coupon(NEW.store_id, NEW.coupon_code, NEW.subtotal,
                             NEW.customer_id, NEW.customer_email, NEW.customer_phone);

    IF NOT (v_res->>'valid')::boolean THEN
        -- كوبون غير صالح ⇒ ألغِ أثره (discount_amount هو خطّاف الكوبون الوحيد)
        NEW.coupon_code := NULL;
        NEW.discount_amount := 0;
    ELSIF (v_res->>'discount_type') IN ('percentage','fixed') THEN
        -- اعتمد الخصم المحسوب خادمياً (يمنع التلاعب بالمتصفح)
        NEW.discount_amount := (v_res->>'discount_amount')::numeric;
    END IF;
    -- free_shipping: لا يمسّ discount_amount (التوفير في الشحن، يضبطه المتجر)

    -- أعد حساب الإجمالي المعتمد (يتّسق مع صيغة المتجر)
    NEW.total_amount := GREATEST(
        COALESCE(NEW.subtotal, 0) + COALESCE(NEW.shipping_amount, 0) + COALESCE(NEW.tax_amount, 0)
        - COALESCE(NEW.discount_amount, 0) - COALESCE(NEW.cashback_used, 0), 0);

    RETURN NEW;
END;
$$;

-- بادئة 00 تضمن السبق على trg_ecommerce_orders_cashback_before
DROP TRIGGER IF EXISTS trg_ecommerce_orders_00_coupon_before ON public.ecommerce_orders;
CREATE TRIGGER trg_ecommerce_orders_00_coupon_before
    BEFORE INSERT ON public.ecommerce_orders
    FOR EACH ROW EXECUTE FUNCTION public.ecommerce_orders_coupon_before();

-- ── 6) تريغر تسجيل الاستخدام ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ecommerce_orders_coupon_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_tenant UUID;
    v_c ecommerce_coupons%ROWTYPE;
BEGIN
    IF NEW.coupon_code IS NULL OR btrim(NEW.coupon_code) = '' THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_c FROM ecommerce_coupons
    WHERE store_id = NEW.store_id AND upper(code) = upper(NEW.coupon_code);
    IF NOT FOUND THEN RETURN NEW; END IF;

    v_tenant := COALESCE(NEW.tenant_id, (SELECT tenant_id FROM ecommerce_stores WHERE id = NEW.store_id));

    INSERT INTO ecommerce_coupon_redemptions
        (tenant_id, store_id, coupon_id, order_id, customer_id, customer_email, customer_phone,
         discount_type, discount_applied)
    VALUES
        (v_tenant, NEW.store_id, v_c.id, NEW.id, NEW.customer_id, NEW.customer_email, NEW.customer_phone,
         v_c.discount_type,
         CASE WHEN v_c.discount_type = 'free_shipping' THEN 0 ELSE COALESCE(NEW.discount_amount, 0) END)
    ON CONFLICT (order_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_orders_coupon_after_insert ON public.ecommerce_orders;
CREATE TRIGGER trg_ecommerce_orders_coupon_after_insert
    AFTER INSERT ON public.ecommerce_orders
    FOR EACH ROW EXECUTE FUNCTION public.ecommerce_orders_coupon_after_insert();

-- ── 7) إبطال الحصة عند الإلغاء/الإرجاع ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ecommerce_orders_coupon_on_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF NEW.status = OLD.status THEN RETURN NEW; END IF;

    IF NEW.status IN ('cancelled', 'returned') THEN
        UPDATE ecommerce_coupon_redemptions
        SET is_voided = true
        WHERE order_id = NEW.id AND NOT is_voided;
    ELSIF OLD.status IN ('cancelled', 'returned') AND NEW.status NOT IN ('cancelled', 'returned') THEN
        -- أُعيد تفعيل الطلب ⇒ أعِد احتساب الحصة
        UPDATE ecommerce_coupon_redemptions
        SET is_voided = false
        WHERE order_id = NEW.id AND is_voided;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_orders_coupon_on_status ON public.ecommerce_orders;
CREATE TRIGGER trg_ecommerce_orders_coupon_on_status
    AFTER UPDATE OF status ON public.ecommerce_orders
    FOR EACH ROW EXECUTE FUNCTION public.ecommerce_orders_coupon_on_status();

COMMIT;
