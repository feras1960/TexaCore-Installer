-- 20260626h — fix get_all_plan_limits for the local JSONB included_modules column
-- ─────────────────────────────────────────────────────────────────────────────
-- get_all_plan_limits was synced from the cloud, where subscription_plans.
-- included_modules is text[]. Locally that column is JSONB, so the modules
-- COALESCE — COALESCE(<text[] from tenant_modules>, v_plan.included_modules) —
-- raises:  "COALESCE types character varying[] and jsonb cannot be matched".
-- The function then returns {error:'exception'} for ANY tenant that has a plan,
-- which the UI reads as 0/0 and blocks invoice creation. This re-creates the
-- function casting the JSONB included_modules to text[] so the COALESCE matches.

CREATE OR REPLACE FUNCTION public.get_all_plan_limits(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_plan RECORD;
    v_plan_id UUID;
    v_users_count INT := 0;
    v_companies_count INT := 0;
    v_branches_count INT := 0;
    v_warehouses_count INT := 0;
    v_products_count INT := 0;
    v_customers_count INT := 0;
    v_invoices_count INT := 0;
    v_plan_modules text[];
BEGIN
    -- جلب الباقة من tenant_subscriptions
    SELECT ts.plan_id INTO v_plan_id
    FROM tenant_subscriptions ts
    WHERE ts.tenant_id = p_tenant_id
      AND ts.status IN ('trial', 'active', 'grace')
    ORDER BY
      CASE ts.status
        WHEN 'active' THEN 1 WHEN 'trial' THEN 2 WHEN 'grace' THEN 3
      END
    LIMIT 1;

    -- Fallback
    IF v_plan_id IS NULL THEN
        SELECT plan_id INTO v_plan_id
        FROM subscriptions
        WHERE tenant_id = p_tenant_id AND status IN ('trial', 'active')
        ORDER BY created_at DESC LIMIT 1;
    END IF;

    IF v_plan_id IS NULL THEN
        RETURN jsonb_build_object('error', 'no_active_subscription');
    END IF;

    SELECT * INTO v_plan FROM subscription_plans WHERE id = v_plan_id;

    -- included_modules is JSONB locally → convert to text[] so it matches the
    -- text[] produced by tenant_modules in the COALESCE below.
    v_plan_modules := CASE
        WHEN v_plan.included_modules IS NULL THEN NULL::text[]
        WHEN jsonb_typeof(v_plan.included_modules) = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(v_plan.included_modules))
        ELSE NULL::text[]
    END;

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
            v_plan_modules
        ),
        'features', v_plan.features
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('error', 'exception', 'message', SQLERRM);
END;
$function$;
