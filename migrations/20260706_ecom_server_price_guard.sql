-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 CRITICAL BREAKER 1 — Server-side price guard on e-commerce order items
--
-- المشكلة الموثّقة: المتجر (tkanex/src/lib/orderService.ts) يحسب أسعار البنود في
-- المتصفح ويُدرجها مباشرة في ecommerce_order_items، ثم تريغر الكوبون على
-- ecommerce_orders يعيد حساب total_amount من NEW.subtotal المُرسل من العميل.
-- ⇒ زبون متجر مصادَق يستطيع إرسال unit_price=0.01 و subtotal مزيّف.
--
-- الحل (أصغر تدخّل صحيح):
--   1) دالة مساعدة ecom_server_price(product_id, qty, customer_id) — تحسب السعر
--      الخادمي الرسمي: effective price (نسخة حرفية من منطق get_ecommerce_products)
--      × شريحة الكمية (ecommerce_quantity_tiers) × خصم العميل (discount_percent).
--   2) تريغر BEFORE INSERT على ecommerce_order_items — يفرض unit_price/total_price
--      المحسوبَين خادمياً، لكن فقط حين المُدرِج زبون متجر (is_storefront_customer()).
--      إدراج موظفي ERP / service_role لا يُمَسّ (قد ينشئون بأسعار تفاوضية).
--   3) تريغر AFTER INSERT على البنود — يعيد مزامنة رأس الطلب (subtotal من مجموع
--      البنود، قصّ discount_amount بسقف الكوبون، إعادة total_amount) بحصانة ضد
--      التكرار اللانهائي.
--
-- منطق التسعير مطابق حرفياً للمتجر:
--   base      = effective_price (sale ساري النطاق الزمني وإلا base_price→selling→default)
--   tier%     = أعلى شريحة نشطة min_qty<=qty (laddered — نفس quantityDiscountPercent)
--   cust%     = ecommerce_customers.discount_percent للعميل المصادَق
--   unit      = ROUND(base × (1−tier%/100) × (1−cust%/100), 2)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) دالة السعر الخادمي (قابلة للاختبار مستقلّة)
--    p_customer_id اختياري: خصم العميل يُطبّق فقط إن مُرِّر (يطابق المتجر الذي
--    يطبّقه للعميل المسجّل فقط). تُعيد NULL إن لم يُعرف المنتج/لا سعر.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ecom_server_price(
    p_product_id uuid,
    p_qty numeric,
    p_customer_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_store_id   uuid;
    v_base       numeric;
    v_tier_pct   numeric := 0;
    v_cust_pct   numeric := 0;
    v_price      numeric;
BEGIN
    -- base = effective_price — نسخة حرفية من get_ecommerce_products:
    --   COALESCE( sale إن كان is_on_sale وساري النطاق, base_price, fm.selling_price, p.default_price )
    SELECT
        ep.store_id,
        COALESCE(
            CASE WHEN ep.is_on_sale AND ep.sale_price IS NOT NULL
                 AND (ep.sale_start_date IS NULL OR ep.sale_start_date <= now())
                 AND (ep.sale_end_date   IS NULL OR ep.sale_end_date   >= now())
            THEN ep.sale_price ELSE NULL END,
            ep.base_price, fm.selling_price, p.default_price
        )
    INTO v_store_id, v_base
    FROM ecommerce_products ep
    LEFT JOIN fabric_materials fm ON fm.id = ep.material_id
    LEFT JOIN products p          ON p.id  = ep.product_id
    WHERE ep.id = p_product_id;

    IF v_base IS NULL THEN
        RETURN NULL;  -- منتج غير معروف أو بلا سعر مصدر
    END IF;

    -- tier% = أعلى شريحة نشطة min_qty<=qty (laddered by min_qty — نفس منطق pricing.ts)
    SELECT COALESCE(t.discount_percent, 0) INTO v_tier_pct
    FROM ecommerce_quantity_tiers t
    WHERE t.store_id = v_store_id
      AND t.is_active = true
      AND t.min_qty <= COALESCE(p_qty, 0)
    ORDER BY t.min_qty DESC
    LIMIT 1;
    v_tier_pct := COALESCE(v_tier_pct, 0);

    -- cust% = خصم العميل المسجّل (فقط إن مُرِّر معرّف عميل)
    IF p_customer_id IS NOT NULL THEN
        SELECT COALESCE(c.discount_percent, 0) INTO v_cust_pct
        FROM ecommerce_customers c
        WHERE c.id = p_customer_id;
        v_cust_pct := COALESCE(v_cust_pct, 0);
    END IF;

    v_price := v_base * (1 - v_tier_pct / 100.0) * (1 - v_cust_pct / 100.0);
    RETURN ROUND(v_price, 2);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) تريغر BEFORE INSERT على البنود — يفرض السعر الخادمي لزبائن المتجر فقط
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_ecom_item_server_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_customer_id uuid;
    v_server_unit numeric;
    v_qty         numeric;
BEGIN
    -- يعمل فقط حين المُدرِج زبون متجر مصادَق. إدراج موظفي ERP / service_role
    -- (is_storefront_customer()=false لأنّ auth.uid() ليس عميل متجر) لا يُمَسّ.
    IF NOT public.is_storefront_customer() THEN
        RETURN NEW;
    END IF;

    v_qty := COALESCE(NEW.quantity, 0);

    -- معرّف العميل من رأس الطلب (لتطبيق خصم العميل المسجّل خادمياً)
    SELECT o.customer_id INTO v_customer_id
    FROM ecommerce_orders o
    WHERE o.id = NEW.order_id;

    v_server_unit := public.ecom_server_price(NEW.product_id, v_qty, v_customer_id);

    -- منتج غير معروف / بلا سعر مصدر ⇒ ارفض (زبون لا يُدرج بنداً غير مُسعّر خادمياً)
    IF v_server_unit IS NULL THEN
        RAISE EXCEPTION 'ecom_price_guard: product % has no server price (unpublished or missing source price)', NEW.product_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- افرض السعر الخادمي. فرق تقريب تافه (≤0.01) من العميل مقبول ضمناً لأننا
    -- نستبدل القيمة كلياً بالمحسوب خادمياً على أي حال.
    NEW.unit_price  := v_server_unit;
    NEW.total_price := ROUND(v_server_unit * v_qty, 2);

    RETURN NEW;
END;
$function$;

-- BEFORE INSERT فقط (بعد trg_fill_ecom_item_material أبجدياً — الترتيب لا يهمّ:
-- هذا يستخدم product_id لا material_id). لا نلمس UPDATE (تعديلات ERP للبنود).
DROP TRIGGER IF EXISTS trg_zz_enforce_ecom_item_price ON public.ecommerce_order_items;
CREATE TRIGGER trg_zz_enforce_ecom_item_price
    BEFORE INSERT ON public.ecommerce_order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_ecom_item_server_price();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) تريغر AFTER INSERT على البنود — مزامنة رأس الطلب من مجموع البنود الحقيقي
--    (row-level: يعيد الحساب من مجموع كل بنود الطلب، فآمن مع إدراج عدّة بنود)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resync_ecom_order_header_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_o           ecommerce_orders%ROWTYPE;
    v_subtotal    numeric;
    v_ceiling     numeric;
    v_discount    numeric;
    v_c           ecommerce_coupons%ROWTYPE;
    v_res         jsonb;
BEGIN
    -- يعمل فقط لبنود زبائن المتجر (نفس البوابة). إدراجات ERP تُدير رأسها بنفسها.
    IF NOT public.is_storefront_customer() THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_o FROM ecommerce_orders WHERE id = NEW.order_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- subtotal الحقيقي = مجموع total_price لكل بنود الطلب (المفروضة خادمياً)
    SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal
    FROM ecommerce_order_items
    WHERE order_id = NEW.order_id;

    -- إعادة قصّ discount_amount بسقف الكوبون الآمن (نفس منطق ecommerce_orders_coupon_before
    -- لكن على subtotal الخادمي الحقيقي بدل NEW.subtotal العميلي)
    v_discount := COALESCE(v_o.discount_amount, 0);
    IF v_o.coupon_code IS NOT NULL AND btrim(v_o.coupon_code) <> '' THEN
        SELECT * INTO v_c FROM ecommerce_coupons
        WHERE store_id = v_o.store_id AND upper(code) = upper(v_o.coupon_code);

        IF FOUND AND v_c.discount_type IN ('percentage', 'fixed') THEN
            IF v_c.discount_type = 'percentage' THEN
                v_ceiling := ROUND(v_subtotal * v_c.discount_value / 100.0, 2);
                IF v_c.max_discount_amount IS NOT NULL THEN
                    v_ceiling := LEAST(v_ceiling, v_c.max_discount_amount);
                END IF;
            ELSE
                v_ceiling := LEAST(v_c.discount_value, v_subtotal);
            END IF;

            IF v_c.applies_to = 'all' THEN
                v_discount := v_ceiling;                         -- على مستوى الطلب: المحسوب خادمياً
            ELSE
                v_discount := LEAST(v_discount, v_ceiling);      -- على مستوى فئة: اقصص للسقف
            END IF;
        ELSE
            v_discount := 0;                                     -- كوبون غير موجود ⇒ لا خصم
        END IF;
    END IF;

    -- total_amount = subtotal - discount - cashback_used + shipping + tax (بالأعمدة الفعلية)
    UPDATE ecommerce_orders
    SET subtotal        = v_subtotal,
        discount_amount = v_discount,
        total_amount    = GREATEST(
            v_subtotal
            + COALESCE(v_o.shipping_amount, 0)
            + COALESCE(v_o.tax_amount, 0)
            - v_discount
            - COALESCE(v_o.cashback_used, 0), 0),
        total_amount_uah = CASE
            WHEN v_o.exchange_rate_applied IS NOT NULL THEN
                ROUND(GREATEST(
                    v_subtotal + COALESCE(v_o.shipping_amount, 0) + COALESCE(v_o.tax_amount, 0)
                    - v_discount - COALESCE(v_o.cashback_used, 0), 0) * v_o.exchange_rate_applied)
            ELSE v_o.total_amount_uah
        END,
        updated_at = now()
    WHERE id = NEW.order_id;
    -- ملاحظة الحصانة ضد التكرار اللانهائي: هذا يحدّث ecommerce_orders لا
    -- ecommerce_order_items، فلا يعيد تشغيل هذا التريغر (تريغرات البنود على INSERT فقط).

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zz_resync_ecom_order_header ON public.ecommerce_order_items;
CREATE TRIGGER trg_zz_resync_ecom_order_header
    AFTER INSERT ON public.ecommerce_order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.resync_ecom_order_header_from_items();

COMMIT;
