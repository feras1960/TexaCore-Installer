-- ════════════════════════════════════════════════════════════════════
-- 20260626a — مزامنة سكيما المثبّت المحلية مع السحابة (سطح المكتب)
-- ════════════════════════════════════════════════════════════════════
-- التثبيت الجديد (ويندوز) كان ينقصه أعمدة/دوال ⇒ ضجيج 404/400/406 +
-- فشل استيراد RSF (units_of_measure.category). إصلاح idempotent وغير
-- هدّام: الدوال تُنشَأ فقط إن كانت مفقودة (لا نستبدل دوالاً قائمة قد
-- تحمل معاملات افتراضية أو منطقاً حقيقياً). (.sql متجاهَل ⇒ git add -f.)

-- (1) أعمدة ناقصة
ALTER TABLE public.units_of_measure ADD COLUMN IF NOT EXISTS category character varying;
ALTER TABLE public.user_profiles    ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false;

-- (2) توابع PBX/الحضور = stubs بلا عمل، تُنشَأ فقط إن كانت مفقودة (self-hosted)
DO $g$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='pbx_set_my_presence' AND pronamespace='public'::regnamespace) THEN
    CREATE FUNCTION public.pbx_set_my_presence(p_status text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ BEGIN RETURN; END $f$;
    GRANT EXECUTE ON FUNCTION public.pbx_set_my_presence(text) TO anon, authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='update_tenant_presence' AND pronamespace='public'::regnamespace) THEN
    CREATE FUNCTION public.update_tenant_presence(p_tenant_id uuid, p_ip character varying, p_country character varying, p_city character varying)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ BEGIN RETURN; END $f$;
    GRANT EXECUTE ON FUNCTION public.update_tenant_presence(uuid, character varying, character varying, character varying) TO anon, authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='start_login_session' AND pronamespace='public'::regnamespace) THEN
    CREATE FUNCTION public.start_login_session(p_tenant_id uuid, p_user_id uuid, p_user_email character varying, p_ip character varying, p_country character varying, p_city character varying, p_user_agent text, p_browser character varying, p_os character varying)
      RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ SELECT gen_random_uuid() $f$;
    GRANT EXECUTE ON FUNCTION public.start_login_session(uuid, uuid, character varying, character varying, character varying, character varying, text, character varying, character varying) TO anon, authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_my_extension' AND pronamespace='public'::regnamespace) THEN
    CREATE FUNCTION public.get_my_extension()
      RETURNS TABLE(extension_id uuid, extension_number character varying, display_name text, sip_password text, sip_domain text, call_type_preference text, outbound_caller_id text, is_primary boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ BEGIN RETURN; END $f$;
    GRANT EXECUTE ON FUNCTION public.get_my_extension() TO anon, authenticated;
  END IF;
END $g$;

-- (3) get_all_plan_limits (مزامنة من السحابة — حدود الباقة المجانية للواجهة)
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
            v_plan.included_modules
        ),
        'features', v_plan.features
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('error', 'exception', 'message', SQLERRM);
END;
$function$

;
GRANT EXECUTE ON FUNCTION public.get_all_plan_limits(uuid) TO anon, authenticated;
