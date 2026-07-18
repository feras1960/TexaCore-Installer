-- ════════════════════════════════════════════════════════════════════
-- 20260717a — معالج التسجيل: احترام مدخلات المستخدم المهملة
-- ════════════════════════════════════════════════════════════════════
-- كان المعالج يجمع (بداية السنة المالية، دورة الفوترة، المدينة، اللغة)
-- ثم تتجاهلها register_new_subscriber كلياً:
--   • fiscal_year_start_month كان مثبّتاً = 1 (يناير) دائماً
--   • tenant_subscriptions.billing_cycle كان 'monthly' دائماً
--   • companies.city لا تُحفظ أبداً
--   • tenants.default_language كان 'ar' مهما كانت لغة الواجهة
-- المعاملات الجديدة كلها بقيم افتراضية ⇒ الواجهة المنشورة (11 معاملاً) تظل تعمل.
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.register_new_subscriber(
    uuid, character varying, character varying, character varying,
    character varying, character varying, character varying, character varying,
    character varying, character varying, character varying
);

CREATE OR REPLACE FUNCTION public.register_new_subscriber(
    p_user_id uuid,
    p_user_email character varying,
    p_user_name character varying,
    p_company_name character varying DEFAULT NULL::character varying,
    p_phone character varying DEFAULT NULL::character varying,
    p_business_type character varying DEFAULT 'general'::character varying,
    p_currency character varying DEFAULT 'USD'::character varying,
    p_country_code character varying DEFAULT 'SA'::character varying,
    p_plan_code character varying DEFAULT 'texa-professional'::character varying,
    p_chart_template character varying DEFAULT 'extended'::character varying,
    p_local_currency character varying DEFAULT NULL::character varying,
    p_fiscal_year_start integer DEFAULT 1,
    p_billing_cycle character varying DEFAULT 'monthly'::character varying,
    p_city character varying DEFAULT NULL::character varying,
    p_language character varying DEFAULT 'ar'::character varying
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
      DECLARE
          v_tenant_code VARCHAR(50);
          v_tenant_id UUID;
          v_company_id UUID;
          v_plan_id UUID;
          v_product_id UUID;
          v_subscription_id UUID;
          v_tenant_sub_id UUID;
          v_trial_days INT;
          v_plan_type VARCHAR;
          v_included_modules jsonb;  -- [installer-adapt] subscription_plans.included_modules is jsonb locally (text[] on cloud)
          v_result JSONB;
          v_currencies TEXT[];
          v_tenant_owner_role_id UUID;
          v_branch_id UUID;
          v_warehouse_id UUID;
          -- مدخلات المستخدم المُطهَّرة
          v_fy_start INT := LEAST(GREATEST(COALESCE(p_fiscal_year_start, 1), 1), 12);
          v_fy_end INT;
          v_billing VARCHAR := CASE WHEN p_billing_cycle IN ('monthly', 'yearly') THEN p_billing_cycle ELSE 'monthly' END;
          v_language VARCHAR := COALESCE(NULLIF(p_language, ''), 'ar');
          -- CORE: الأساسيات الوظيفية فقط (يُمنح لكل مستأجر فوق موديولات الباقة)
          -- موديولات الأعمال تأتي حصراً من included_modules للباقة (التزام بالباقة)
          v_core_modules text[] := ARRAY[
              'core', 'dashboard', 'settings', 'users',
              'companies', 'system_config', 'activity_log', 'workflows'
          ];
      BEGIN
          PERFORM set_config('app.is_registering', 'true', true);

          -- نهاية السنة المالية = الشهر السابق لبدايتها (1→12، 4→3)
          v_fy_end := ((v_fy_start + 10) % 12) + 1;

          IF EXISTS (
              SELECT 1 FROM user_profiles WHERE id = p_user_id AND tenant_id IS NOT NULL
          ) THEN
              RETURN jsonb_build_object(
                  'success', false,
                  'error_code', 'ALREADY_REGISTERED',
                  'message', 'This account is already registered'
              );
          END IF;

          v_tenant_code := 'T-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 10));

          v_currencies := ARRAY[p_currency];
          IF p_local_currency IS NOT NULL AND p_local_currency != p_currency THEN
              v_currencies := array_append(v_currencies, p_local_currency);
          END IF;

          -- ═══ البحث عن الباقة المطلوبة ═══
          SELECT id, trial_days, included_modules, COALESCE(plan_type, 'paid'), product_id
          INTO v_plan_id, v_trial_days, v_included_modules, v_plan_type, v_product_id
          FROM subscription_plans
          WHERE code = p_plan_code AND is_active = true
          LIMIT 1;

          -- Fallback 1 → texa-professional
          IF v_plan_id IS NULL THEN
              SELECT id, trial_days, included_modules, COALESCE(plan_type, 'paid'), product_id
              INTO v_plan_id, v_trial_days, v_included_modules, v_plan_type, v_product_id
              FROM subscription_plans
              WHERE code = 'texa-professional' AND is_active = true
              LIMIT 1;
          END IF;

          -- Fallback 2 → texa-starter
          IF v_plan_id IS NULL THEN
              SELECT id, trial_days, included_modules, COALESCE(plan_type, 'paid'), product_id
              INTO v_plan_id, v_trial_days, v_included_modules, v_plan_type, v_product_id
              FROM subscription_plans
              WHERE code = 'texa-starter' AND is_active = true
              LIMIT 1;
          END IF;

          -- Fallback 3: free plan
          IF v_plan_id IS NULL THEN
              SELECT id, trial_days, included_modules, COALESCE(plan_type, 'free'), product_id
              INTO v_plan_id, v_trial_days, v_included_modules, v_plan_type, v_product_id
              FROM subscription_plans
              WHERE plan_type = 'free' AND is_active = true
              LIMIT 1;
          END IF;

          IF v_plan_id IS NULL THEN
              RAISE EXCEPTION 'No active plans found';
          END IF;

          IF v_product_id IS NULL THEN
              SELECT id INTO v_product_id FROM saas_products
              WHERE code = 'texacore' AND is_active = true LIMIT 1;
          END IF;

          v_tenant_id := create_new_tenant(
              v_tenant_code,
              COALESCE(p_company_name, p_user_name),
              p_user_email,
              p_phone,
              p_country_code,
              v_language,
              p_business_type,
              v_product_id
          );

          IF v_tenant_id IS NULL THEN
              RAISE EXCEPTION 'Failed to create Tenant';
          END IF;

          -- ═══ تحديث بيانات المالك في التينانت ═══
          UPDATE tenants SET
              owner_name = COALESCE(p_company_name, p_user_name),
              owner_email = p_user_email,
              owner_phone = p_phone,
              country = p_country_code
          WHERE id = v_tenant_id;

          -- ═══ 1. subscriptions ═══
          INSERT INTO subscriptions (
              tenant_id, product_id, plan_id, status,
              trial_ends_at, current_period_start, current_period_end
          )
          SELECT
              v_tenant_id, sp.product_id, v_plan_id,
              CASE
                  WHEN v_plan_type = 'free' THEN 'active'
                  WHEN v_trial_days > 0 THEN 'trial'
                  ELSE 'active'
              END,
              CASE WHEN v_trial_days > 0 AND v_plan_type != 'free' THEN NOW() + (v_trial_days || ' days')::INTERVAL ELSE NULL END,
              NOW(),
              CASE
                  WHEN v_plan_type = 'free' THEN NULL
                  ELSE NOW() + (v_trial_days || ' days')::INTERVAL
              END
          FROM subscription_plans sp
          WHERE sp.id = v_plan_id
          RETURNING id INTO v_subscription_id;

          -- ═══ 2. tenant_subscriptions ═══
          INSERT INTO tenant_subscriptions (
              tenant_id, plan_id, status,
              start_date, end_date, trial_end_date,
              billing_cycle, created_by
          ) VALUES (
              v_tenant_id, v_plan_id,
              CASE
                  WHEN v_plan_type = 'free' THEN 'active'
                  WHEN v_trial_days > 0 THEN 'trial'
                  ELSE 'active'
              END,
              CURRENT_DATE,
              CASE
                  WHEN v_plan_type = 'free' THEN DATE '2099-12-31'
                  ELSE CURRENT_DATE + v_trial_days
              END,
              CASE
                  WHEN v_trial_days > 0 AND v_plan_type != 'free' THEN CURRENT_DATE + v_trial_days
                  ELSE NULL
              END,
              v_billing,
              p_user_id
          ) RETURNING id INTO v_tenant_sub_id;

          v_company_id := create_default_company_for_tenant(
              v_tenant_id,
              COALESCE(p_company_name, p_user_name),
              p_business_type,
              'production',
              p_currency,
              p_country_code
          );

          IF v_company_id IS NULL THEN
              RAISE EXCEPTION 'Failed to create company';
          END IF;

          -- ═══ المدينة (اختيارية من المعالج) ═══
          IF p_city IS NOT NULL AND p_city != '' THEN
              UPDATE companies SET city = p_city WHERE id = v_company_id;
          END IF;

          INSERT INTO company_accounting_settings (
              company_id, base_currency, supported_currencies,
              fiscal_year_start_month, fiscal_year_end_month,
              enable_vat, decimal_places
          )
          VALUES (
              v_company_id, p_currency, v_currencies,
              v_fy_start, v_fy_end,
              true, 2
          )
          ON CONFLICT (company_id) DO UPDATE SET
              base_currency = EXCLUDED.base_currency,
              supported_currencies = EXCLUDED.supported_currencies,
              fiscal_year_start_month = EXCLUDED.fiscal_year_start_month,
              fiscal_year_end_month = EXCLUDED.fiscal_year_end_month,
              updated_at = NOW();

          INSERT INTO user_profiles (id, email, full_name, tenant_id, company_id, role)
          VALUES (p_user_id, p_user_email, p_user_name, v_tenant_id, v_company_id, 'admin')
          ON CONFLICT (id) DO UPDATE SET
              email = EXCLUDED.email,
              full_name = EXCLUDED.full_name,
              tenant_id = EXCLUDED.tenant_id,
              company_id = EXCLUDED.company_id,
              role = EXCLUDED.role;

          SELECT id INTO v_tenant_owner_role_id FROM roles WHERE code = 'tenant_owner' LIMIT 1;
          IF v_tenant_owner_role_id IS NOT NULL THEN
              INSERT INTO user_roles (user_id, role_id, tenant_id, company_id, assigned_by, is_active)
              VALUES (p_user_id, v_tenant_owner_role_id, v_tenant_id, v_company_id, p_user_id, true)
              ON CONFLICT DO NOTHING;

              INSERT INTO tenant_users (tenant_id, user_id, role, is_active)
              VALUES (v_tenant_id, p_user_id, 'owner', true)
              ON CONFLICT (tenant_id, user_id) DO NOTHING;

              INSERT INTO user_role_assignments (user_id, role_id, tenant_id, company_id, assigned_by)
              VALUES (p_user_id, v_tenant_owner_role_id, v_tenant_id, v_company_id, p_user_id)
              ON CONFLICT DO NOTHING;
          END IF;

          -- ═══ الموديولات ═══
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_modules') THEN
              INSERT INTO tenant_modules (tenant_id, module_code, is_active, source)
              SELECT v_tenant_id, sm.code, true, 'plan'
              FROM system_modules sm
              WHERE v_included_modules ? sm.code  -- [installer-adapt] jsonb membership (was = ANY on text[])
              AND sm.is_active = true
              ON CONFLICT (tenant_id, module_code) DO UPDATE SET is_active = true;

              INSERT INTO tenant_modules (tenant_id, module_code, is_active, source)
              SELECT v_tenant_id, sm.code, true, 'core'
              FROM system_modules sm
              WHERE sm.code = ANY(v_core_modules)
              AND sm.is_active = true
              ON CONFLICT (tenant_id, module_code) DO UPDATE SET is_active = true;
          END IF;

          IF p_chart_template IS NOT NULL THEN
              BEGIN
                  PERFORM apply_chart_template_to_company(v_company_id, p_chart_template);
              EXCEPTION WHEN OTHERS THEN
                  RAISE NOTICE 'Chart template warning: %', SQLERRM;
              END;
          END IF;

          -- ═══ الفرع الرئيسي والمستودع ═══
          INSERT INTO branches (tenant_id, company_id, name, name_ar, name_en, code, is_main, is_active)
          VALUES (v_tenant_id, v_company_id, 'الفرع الرئيسي', 'الفرع الرئيسي', 'Main Branch', 'MAIN-001', true, true)
          RETURNING id INTO v_branch_id;

          INSERT INTO warehouses (tenant_id, company_id, code, name, name_ar, name_en, warehouse_type, branch_id, is_active)
          VALUES (v_tenant_id, v_company_id, 'WH-MAIN', 'المستودع الرئيسي', 'المستودع الرئيسي', 'Main Warehouse', 'regular', v_branch_id, true)
          RETURNING id INTO v_warehouse_id;

          -- ═══ 🔔 إرسال الإشعار الشامل (بعد اكتمال كل البيانات) ═══
          BEGIN
              PERFORM send_new_subscriber_notification(v_tenant_id);
          EXCEPTION WHEN OTHERS THEN
              RAISE NOTICE 'Notification warning: %', SQLERRM;
          END;

          v_result := jsonb_build_object(
              'success', true,
              'tenant_id', v_tenant_id,
              'tenant_code', v_tenant_code,
              'company_id', v_company_id,
              'product_id', v_product_id,
              'subscription_id', v_subscription_id,
              'tenant_subscription_id', v_tenant_sub_id,
              'plan_code', p_plan_code,
              'plan_type', v_plan_type,
              'trial_days', v_trial_days,
              'trial_ends_at', CASE WHEN v_trial_days > 0 AND v_plan_type != 'free'
                               THEN NOW() + (v_trial_days || ' days')::INTERVAL
                               ELSE NULL END,
              'currencies', v_currencies,
              'billing_cycle', v_billing,
              'fiscal_year_start', v_fy_start,
              'message', 'Registration successful'
          );

          RETURN v_result;

      EXCEPTION
          WHEN OTHERS THEN
              RAISE EXCEPTION 'Registration error: %', SQLERRM;
      END;
$function$;

-- DROP+CREATE يُسقط الصلاحيات — إعادتها كما كانت
GRANT EXECUTE ON FUNCTION public.register_new_subscriber(
    uuid, character varying, character varying, character varying,
    character varying, character varying, character varying, character varying,
    character varying, character varying, character varying,
    integer, character varying, character varying, character varying
) TO authenticated, anon, service_role;
