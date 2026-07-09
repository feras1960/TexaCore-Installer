-- 20260702i — إنفاذ انتهاء الاشتراك في get_all_plan_limits
-- المشكلة: الدالة كانت تقبل status IN ('trial','active','grace') فقط، بينما
-- check_expired_subscriptions تضع 'expired' فوراً عند end_date وتمنح grace_period_end
-- (+7 أيام) — أي أن حالة 'grace' لا تُكتب أبداً، فكان المنتهي داخل السماح يحصل على
-- no_active_subscription (قائمة موديولات فارغة → بوّابة الباقة كانت تتجاوزه كلياً).
-- التغيير:
--   1. الاشتراك expired وما زال داخل grace_period_end → يُعامل كسماح (وصول كامل)
--      ويُعاد subscription_status='grace' + grace_until للواجهة (بانر لاحقاً).
--   2. المستأجر المعلّق (tenants.status='suspended') → error='tenant_suspended'.
--   3. المنتهي بعد السماح → error='no_active_subscription' كما كان، والواجهة
--      (ModuleGuard) تقفل عليه الآن بدل التجاوز.

CREATE OR REPLACE FUNCTION public.get_all_plan_limits(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_plan RECORD;
    v_sub RECORD;
    v_plan_id UUID;
    v_users_count INT := 0;
    v_companies_count INT := 0;
    v_branches_count INT := 0;
    v_warehouses_count INT := 0;
    v_products_count INT := 0;
    v_customers_count INT := 0;
    v_invoices_count INT := 0;
BEGIN
    -- المستأجر المعلّق: قفل صريح مهما كانت حالة الاشتراك
    IF EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id AND status = 'suspended') THEN
        RETURN jsonb_build_object('error', 'tenant_suspended');
    END IF;

    -- جلب الاشتراك: النشط/التجريبي/السماح، أو المنتهي داخل نافذة السماح
    SELECT ts.plan_id, ts.status, ts.grace_period_end, ts.end_date
      INTO v_sub
    FROM tenant_subscriptions ts
    WHERE ts.tenant_id = p_tenant_id
      AND (
        ts.status IN ('trial', 'active', 'grace')
        OR (ts.status = 'expired' AND ts.grace_period_end IS NOT NULL
            AND ts.grace_period_end >= CURRENT_DATE)
      )
    ORDER BY
      CASE ts.status
        WHEN 'active' THEN 1 WHEN 'trial' THEN 2 WHEN 'grace' THEN 3 ELSE 4
      END
    LIMIT 1;
    v_plan_id := v_sub.plan_id;

    -- Fallback (الجدول القديم subscriptions) — فقط لمستأجر بلا أي صف في
    -- tenant_subscriptions إطلاقاً. بدون هذا الشرط كان المنتهي بعد السماح يسقط
    -- على صفّه القديم في subscriptions (لا تحدّثه check_expired_subscriptions أبداً)
    -- فيبدو نشطاً للأبد.
    IF v_plan_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions ts2 WHERE ts2.tenant_id = p_tenant_id) THEN
        SELECT plan_id INTO v_plan_id
        FROM subscriptions
        WHERE tenant_id = p_tenant_id AND status IN ('trial', 'active')
        ORDER BY created_at DESC LIMIT 1;
    END IF;

    IF v_plan_id IS NULL THEN
        RETURN jsonb_build_object('error', 'no_active_subscription');
    END IF;

    SELECT * INTO v_plan FROM subscription_plans WHERE id = v_plan_id;

    -- عد الموارد الحالية
    SELECT COUNT(*) INTO v_users_count FROM user_profiles WHERE tenant_id = p_tenant_id;
    SELECT COUNT(*) INTO v_companies_count FROM companies WHERE tenant_id = p_tenant_id;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'branches' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_branches_count FROM branches WHERE tenant_id = p_tenant_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'warehouses' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_warehouses_count FROM warehouses WHERE tenant_id = p_tenant_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_products_count FROM products WHERE tenant_id = p_tenant_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_customers_count FROM customers WHERE tenant_id = p_tenant_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_invoices_count FROM sales_invoices WHERE tenant_id = p_tenant_id AND created_at >= date_trunc('month', CURRENT_DATE);
    END IF;

    RETURN jsonb_build_object(
        'plan_code', v_plan.code,
        'plan_name_ar', v_plan.name_ar,
        'plan_name_en', v_plan.name_en,
        'plan_type', v_plan.plan_type,
        'subscription_status', CASE
            WHEN v_sub.status = 'expired' THEN 'grace'
            ELSE COALESCE(v_sub.status, 'active')
        END,
        'grace_until', CASE
            WHEN v_sub.status = 'expired' THEN v_sub.grace_period_end
            ELSE NULL
        END,
        'limits', jsonb_build_object(
            'users',      jsonb_build_object('current', v_users_count, 'max', v_plan.max_users, 'unlimited', v_plan.max_users = -1, 'allowed', v_plan.max_users = -1 OR v_users_count < v_plan.max_users),
            'companies',  jsonb_build_object('current', v_companies_count, 'max', v_plan.max_companies, 'unlimited', v_plan.max_companies = -1, 'allowed', v_plan.max_companies = -1 OR v_companies_count < v_plan.max_companies),
            'branches',   jsonb_build_object('current', v_branches_count, 'max', v_plan.max_branches, 'unlimited', v_plan.max_branches = -1, 'allowed', v_plan.max_branches = -1 OR v_branches_count < v_plan.max_branches),
            'warehouses', jsonb_build_object('current', v_warehouses_count, 'max', v_plan.max_warehouses, 'unlimited', v_plan.max_warehouses = -1, 'allowed', v_plan.max_warehouses = -1 OR v_warehouses_count < v_plan.max_warehouses),
            'products',   jsonb_build_object('current', v_products_count, 'max', v_plan.max_products, 'unlimited', v_plan.max_products = -1, 'allowed', v_plan.max_products = -1 OR v_products_count < v_plan.max_products),
            'customers',  jsonb_build_object('current', v_customers_count, 'max', v_plan.max_customers, 'unlimited', v_plan.max_customers = -1, 'allowed', v_plan.max_customers = -1 OR v_customers_count < v_plan.max_customers),
            'invoices_monthly', jsonb_build_object('current', v_invoices_count, 'max', v_plan.max_invoices_monthly, 'unlimited', v_plan.max_invoices_monthly = -1, 'allowed', v_plan.max_invoices_monthly = -1 OR v_invoices_count < v_plan.max_invoices_monthly),
            'storage_gb', jsonb_build_object('current', 0, 'max', v_plan.storage_gb, 'unlimited', v_plan.storage_gb = -1)
        ),
        'modules', COALESCE(
            NULLIF((SELECT array_agg(tm.module_code ORDER BY tm.module_code)
                    FROM tenant_modules tm
                    WHERE tm.tenant_id = p_tenant_id AND tm.is_active), '{}'),
            v_plan.included_modules
        ),
        'features', v_plan.features
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('error', 'exception', 'message', SQLERRM);
END;
$$;
