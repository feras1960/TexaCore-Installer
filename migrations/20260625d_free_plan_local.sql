-- Free plan for the LOCAL install. included_modules is JSONB locally (cloud is
-- text[]). Storage unlimited locally (storage_gb=-1). plan_type='free' arms the
-- enforcement triggers for the local free tenant.
INSERT INTO public.subscription_plans (
  product_id, code, name_ar, name_en, plan_type,
  max_users, max_companies, max_branches, max_warehouses,
  max_products, max_invoices_monthly, max_customers, max_documents,
  max_images, max_records, storage_gb,
  included_modules, price_monthly, is_active
)
SELECT
  (SELECT product_id FROM public.subscription_plans WHERE product_id IS NOT NULL LIMIT 1),
  'free', 'مجاني إلى الأبد', 'Free Forever', 'free',
  1, 1, 1, 1,
  200, 200, 200, 500,
  -1, -1, -1,
  '["dashboard","accounting","inventory","sales","purchases","crm","ai_analytics","workflows","system_config","activity_log"]'::jsonb,
  0, true
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE code='free');

CREATE OR REPLACE FUNCTION public.check_plan_limits(p_tenant_id uuid, p_limit_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_subscription_id UUID;
    v_plan_id UUID;
    v_plan RECORD;
    v_current_count INT;
    v_current_size BIGINT;
BEGIN
    -- ═══ الحصول على الاشتراك النشط من tenant_subscriptions (المصدر الأساسي) ═══
    SELECT ts.id, ts.plan_id INTO v_subscription_id, v_plan_id
    FROM tenant_subscriptions ts
    WHERE ts.tenant_id = p_tenant_id
      AND ts.status IN ('trial', 'active', 'grace')
    ORDER BY 
      CASE ts.status
        WHEN 'active' THEN 1
        WHEN 'trial' THEN 2
        WHEN 'grace' THEN 3
      END
    LIMIT 1;

    -- Fallback: إذا لم نجد في tenant_subscriptions، نحاول subscriptions (للتوافق)
    IF v_plan_id IS NULL THEN
        SELECT id, plan_id INTO v_subscription_id, v_plan_id
        FROM subscriptions
        WHERE tenant_id = p_tenant_id
          AND status IN ('trial', 'active')
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    IF v_plan_id IS NULL THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'error', 'no_active_subscription',
            'error_ar', 'لا يوجد اشتراك نشط',
            'error_en', 'No active subscription'
        );
    END IF;

    -- الحصول على تفاصيل الباقة
    SELECT * INTO v_plan FROM subscription_plans WHERE id = v_plan_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'error', 'plan_not_found',
            'error_ar', 'الباقة غير موجودة',
            'error_en', 'Plan not found'
        );
    END IF;

    -- ═══════════════════════════════════════════════════════════════
    -- التحقق حسب نوع الحد
    -- ═══════════════════════════════════════════════════════════════

    -- 1. التحقق من عدد الشركات
    IF p_limit_type = 'companies' THEN
        SELECT COUNT(*) INTO v_current_count
        FROM companies
        WHERE tenant_id = p_tenant_id;

        IF v_plan.max_companies = -1 THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'limit_type', 'companies',
                'current', v_current_count,
                'max', -1,
                'unlimited', true,
                'plan_code', v_plan.code,
                'plan_name_ar', v_plan.name_ar,
                'plan_name_en', v_plan.name_en
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', v_current_count < v_plan.max_companies,
            'limit_type', 'companies',
            'current', v_current_count,
            'max', v_plan.max_companies,
            'remaining', GREATEST(v_plan.max_companies - v_current_count, 0),
            'plan_code', v_plan.code,
            'plan_name_ar', v_plan.name_ar,
            'plan_name_en', v_plan.name_en
        );
    END IF;

    -- 2. التحقق من عدد المستخدمين
    IF p_limit_type = 'users' THEN
        SELECT COUNT(*) INTO v_current_count
        FROM user_profiles
        WHERE tenant_id = p_tenant_id;

        IF v_plan.max_users = -1 THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'limit_type', 'users',
                'current', v_current_count,
                'max', -1,
                'unlimited', true,
                'plan_code', v_plan.code,
                'plan_name_ar', v_plan.name_ar,
                'plan_name_en', v_plan.name_en
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', v_current_count < v_plan.max_users,
            'limit_type', 'users',
            'current', v_current_count,
            'max', v_plan.max_users,
            'remaining', GREATEST(v_plan.max_users - v_current_count, 0),
            'plan_code', v_plan.code,
            'plan_name_ar', v_plan.name_ar,
            'plan_name_en', v_plan.name_en
        );
    END IF;

    -- 3. التحقق من عدد الفروع
    IF p_limit_type = 'branches' THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'branches' AND table_schema = 'public') THEN
            SELECT COUNT(*) INTO v_current_count FROM branches WHERE tenant_id = p_tenant_id;
        ELSE
            v_current_count := 0;
        END IF;

        IF v_plan.max_branches = -1 THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'limit_type', 'branches',
                'current', v_current_count,
                'max', -1,
                'unlimited', true,
                'plan_code', v_plan.code
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', v_current_count < v_plan.max_branches,
            'limit_type', 'branches',
            'current', v_current_count,
            'max', v_plan.max_branches,
            'remaining', GREATEST(v_plan.max_branches - v_current_count, 0),
            'plan_code', v_plan.code
        );
    END IF;

    -- 4. التحقق من عدد المخازن
    IF p_limit_type = 'warehouses' THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'warehouses' AND table_schema = 'public') THEN
            SELECT COUNT(*) INTO v_current_count FROM warehouses WHERE tenant_id = p_tenant_id;
        ELSE
            v_current_count := 0;
        END IF;

        IF v_plan.max_warehouses = -1 THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'limit_type', 'warehouses',
                'current', v_current_count,
                'max', -1,
                'unlimited', true,
                'plan_code', v_plan.code
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', v_current_count < v_plan.max_warehouses,
            'limit_type', 'warehouses',
            'current', v_current_count,
            'max', v_plan.max_warehouses,
            'remaining', GREATEST(v_plan.max_warehouses - v_current_count, 0),
            'plan_code', v_plan.code
        );
    END IF;

    -- 5. التحقق من عدد المنتجات
    IF p_limit_type = 'products' THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products' AND table_schema = 'public') THEN
            SELECT COUNT(*) INTO v_current_count FROM products WHERE tenant_id = p_tenant_id;
        ELSE
            v_current_count := 0;
        END IF;

        IF v_plan.max_products = -1 THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'limit_type', 'products',
                'current', v_current_count,
                'max', -1,
                'unlimited', true,
                'plan_code', v_plan.code
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', v_current_count < v_plan.max_products,
            'limit_type', 'products',
            'current', v_current_count,
            'max', v_plan.max_products,
            'remaining', GREATEST(v_plan.max_products - v_current_count, 0),
            'plan_code', v_plan.code
        );
    END IF;

    -- 6. التحقق من عدد العملاء
    IF p_limit_type = 'customers' THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers' AND table_schema = 'public') THEN
            SELECT COUNT(*) INTO v_current_count FROM customers WHERE tenant_id = p_tenant_id;
        ELSE
            v_current_count := 0;
        END IF;

        IF v_plan.max_customers = -1 OR v_plan.max_customers = 0 THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'limit_type', 'customers',
                'current', v_current_count,
                'max', -1,
                'unlimited', true,
                'plan_code', v_plan.code
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', v_current_count < v_plan.max_customers,
            'limit_type', 'customers',
            'current', v_current_count,
            'max', v_plan.max_customers,
            'remaining', GREATEST(v_plan.max_customers - v_current_count, 0),
            'plan_code', v_plan.code
        );
    END IF;

    -- 7. التحقق من الفواتير الشهرية
    IF p_limit_type = 'invoices_monthly' THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_transactions' AND table_schema = 'public') THEN
            SELECT COUNT(*) INTO v_current_count 
            FROM sales_transactions 
            WHERE tenant_id = p_tenant_id
              AND created_at >= date_trunc('month', CURRENT_DATE);
        ELSE
            v_current_count := 0;
        END IF;

        IF v_plan.max_invoices_monthly = -1 THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'limit_type', 'invoices_monthly',
                'current', v_current_count,
                'max', -1,
                'unlimited', true,
                'plan_code', v_plan.code
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', v_current_count < v_plan.max_invoices_monthly,
            'limit_type', 'invoices_monthly',
            'current', v_current_count,
            'max', v_plan.max_invoices_monthly,
            'remaining', GREATEST(v_plan.max_invoices_monthly - v_current_count, 0),
            'plan_code', v_plan.code
        );
    END IF;

    -- 8. التحقق من المساحة التخزينية
    IF p_limit_type = 'storage' THEN
        v_current_size := 0;

        IF v_plan.storage_gb = -1 OR v_plan.storage_gb = 0 THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'limit_type', 'storage',
                'current_gb', v_current_size,
                'max_gb', CASE WHEN v_plan.storage_gb = 0 THEN 0 ELSE -1 END,
                'unlimited', v_plan.storage_gb = -1,
                'plan_code', v_plan.code
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', true,
            'limit_type', 'storage',
            'current_gb', v_current_size,
            'max_gb', v_plan.storage_gb,
            'remaining_gb', v_plan.storage_gb - v_current_size,
            'plan_code', v_plan.code
        );
    END IF;

    -- نوع حد غير معروف
    RETURN jsonb_build_object(
        'allowed', false,
        'error', 'unknown_limit_type',
        'limit_type', p_limit_type
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'error', 'exception',
            'error_message', SQLERRM
        );
END;
$function$

;

-- ═══════════════════════════════════════════════════════════════════════
-- Server-side plan-limit ENFORCEMENT (Free-tier P2)
-- Defensive BEFORE INSERT guard tied to the package limits (subscription_plans).
--  • Resolves the tenant's plan max for the type CHEAPLY (no COUNT).
--  • Tenants with NO active subscription (paid/desktop) or an UNLIMITED (-1)
--    limit are allowed immediately — never blocked, no COUNT overhead.
--  • Only FINITE-limit tenants pay the authoritative check_plan_limits COUNT.
--  • Fails OPEN on any error so it can never break legitimate inserts.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $enf$
DECLARE
  v_type      text := TG_ARGV[0];
  v_plan_type text;
  v_max       int;
  r           jsonb;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;

  -- Cheap pre-check: the active plan's type + its max for this limit (indexed join, no COUNT).
  SELECT sp.plan_type,
         CASE v_type
           WHEN 'products'         THEN sp.max_products
           WHEN 'users'            THEN sp.max_users
           WHEN 'customers'        THEN sp.max_customers
           WHEN 'invoices_monthly' THEN sp.max_invoices_monthly
           WHEN 'companies'        THEN sp.max_companies
           WHEN 'branches'         THEN sp.max_branches
           WHEN 'warehouses'       THEN sp.max_warehouses
         END
    INTO v_plan_type, v_max
  FROM public.tenant_subscriptions ts
  JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  WHERE ts.tenant_id = NEW.tenant_id
    AND ts.status IN ('trial','active','grace')
  ORDER BY CASE ts.status WHEN 'active' THEN 1 WHEN 'trial' THEN 2 ELSE 3 END
  LIMIT 1;

  -- Enforce ONLY the free plan. Paid plans were never hard-enforced; do NOT
  -- retroactively block them (a paid tenant may already be over an old limit).
  IF v_plan_type IS DISTINCT FROM 'free' THEN RETURN NEW; END IF;
  -- No active subscription, unset, or unlimited (-1) → allow, no count.
  IF v_max IS NULL OR v_max < 0 THEN RETURN NEW; END IF;

  -- Finite limit → authoritative check (this is the only path that COUNTs).
  BEGIN
    r := public.check_plan_limits(NEW.tenant_id, v_type);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;  -- fail-open
  END;

  IF r IS NOT NULL
     AND (r->>'allowed') = 'false'
     AND COALESCE(r->>'error','') NOT IN ('no_active_subscription','plan_not_found')
  THEN
    RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED: % (%/%)',
        v_type, COALESCE(r->>'current','?'), COALESCE(r->>'max','?')
      USING ERRCODE = 'check_violation',
            HINT = 'بلغت حدّ باقتك — يرجى الترقية / Plan limit reached — please upgrade';
  END IF;

  RETURN NEW;
END;
$enf$;

-- Attach to the limited tables (idempotent).
DROP TRIGGER IF EXISTS trg_enforce_limit_products ON public.products;
CREATE TRIGGER trg_enforce_limit_products BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('products');

DROP TRIGGER IF EXISTS trg_enforce_limit_users ON public.user_profiles;
CREATE TRIGGER trg_enforce_limit_users BEFORE INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('users');

DROP TRIGGER IF EXISTS trg_enforce_limit_customers ON public.customers;
CREATE TRIGGER trg_enforce_limit_customers BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('customers');

DROP TRIGGER IF EXISTS trg_enforce_limit_invoices ON public.sales_transactions;
CREATE TRIGGER trg_enforce_limit_invoices BEFORE INSERT ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('invoices_monthly');

DROP TRIGGER IF EXISTS trg_enforce_limit_companies ON public.companies;
CREATE TRIGGER trg_enforce_limit_companies BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('companies');

DROP TRIGGER IF EXISTS trg_enforce_limit_branches ON public.branches;
CREATE TRIGGER trg_enforce_limit_branches BEFORE INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('branches');

DROP TRIGGER IF EXISTS trg_enforce_limit_warehouses ON public.warehouses;
CREATE TRIGGER trg_enforce_limit_warehouses BEFORE INSERT ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('warehouses');
