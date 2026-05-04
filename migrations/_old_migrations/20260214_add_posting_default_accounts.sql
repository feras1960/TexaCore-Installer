-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة وربط حسابات الترحيل الافتراضية
-- Add & Link Default Posting Accounts 
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- المشكلة: كود الترحيل كان يبحث عن حسابات بأكواد ثابتة (5120, 2110...)
-- لكن شجرة الأقمشة تستخدم أكواد مختلفة (51, 211...)
-- 
-- الحل: ربط الحسابات الافتراضية في company_accounting_settings
-- ثم يقرأ كود الترحيل من هذه الإعدادات مباشرة
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'company_accounting_settings') THEN
        EXECUTE 'ALTER TABLE company_accounting_settings 
            ADD COLUMN IF NOT EXISTS default_purchase_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_cogs_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_tax_input_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_tax_output_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_sales_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_inventory_account_id UUID REFERENCES chart_of_accounts(id)';

        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_purchase_account_id IS ''حساب المشتريات الافتراضي — يُستخدم في الجانب المدين عند ترحيل فواتير المشتريات''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_cogs_account_id IS ''حساب تكلفة البضاعة المباعة — يُستخدم عند ترحيل فواتير المبيعات''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_tax_input_account_id IS ''حساب ضريبة المدخلات (القيمة المضافة) — الجانب المدين''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_tax_output_account_id IS ''حساب ضريبة المخرجات (القيمة المضافة) — الجانب الدائن''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_sales_account_id IS ''حساب المبيعات الافتراضي — يُستخدم في الجانب الدائن عند ترحيل فواتير المبيعات''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_inventory_account_id IS ''حساب المخزون الافتراضي''';
    END IF;
END $$;

-- 2️⃣ ربط الحسابات الافتراضية تلقائياً بناءً على شجرة الحسابات الموجودة
DO $$
DECLARE
    v_company RECORD;
    v_account_id UUID;
BEGIN
-- لكل شركة لديها إعدادات محاسبية
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'company_accounting_settings') THEN
        FOR v_company IN 
            EXECUTE 'SELECT cas.id as settings_id, cas.company_id, c.tenant_id FROM company_accounting_settings cas JOIN companies c ON c.id = cas.company_id'
        LOOP
        RAISE NOTICE '🔧 ربط الحسابات للشركة: %', v_company.company_id;

        -- ═══ حساب المشتريات/تكلفة البضاعة (الجانب المدين) ═══
        -- يبحث أولاً عن حساب COGS تفصيلي، ثم عن أي حساب مشتريات
        SELECT id INTO v_account_id
        FROM chart_of_accounts 
        WHERE company_id = v_company.company_id 
          AND is_active = true
          AND is_detail = true
          AND (
              -- Fabric chart: 51 = تكلفة الأقمشة المباعة
              account_code IN ('51', '52')
              -- Standard chart: 5120 = مشتريات, 5110 = تكلفة المبيعات
              OR account_code IN ('5120', '5110', '5100')
              -- By name
              OR name_ar ILIKE '%تكلفة%مباع%'
              OR name_ar ILIKE '%مشتريات%'
          )
        ORDER BY 
            CASE 
                WHEN account_code = '51' THEN 0   -- تكلفة الأقمشة المباعة (Fabric)
                WHEN account_code = '5120' THEN 1 -- مشتريات (Standard)
                WHEN account_code = '5110' THEN 2 -- تكلفة المبيعات
                ELSE 10
            END
        LIMIT 1;
        
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings 
            SET default_purchase_account_id = v_account_id,
                default_cogs_account_id = v_account_id
            WHERE id = v_company.settings_id
              AND default_purchase_account_id IS NULL;
            RAISE NOTICE '  ✅ حساب المشتريات/COGS: %', v_account_id;
        ELSE
            RAISE NOTICE '  ⚠️ لم يتم العثور على حساب المشتريات';
        END IF;

        -- ═══ حساب الذمم الدائنة - الموردين (الجانب الدائن) ═══
        SELECT id INTO v_account_id
        FROM chart_of_accounts 
        WHERE company_id = v_company.company_id 
          AND is_active = true
          AND is_detail = true
          AND (
              is_payable = true
              -- Fabric chart: 211+212
              OR account_code IN ('211', '212')
              -- Standard chart: 2110+2111+2112
              OR account_code IN ('2110', '2111', '2112')
              -- By name
              OR name_ar ILIKE '%دين المور%'
              OR name_ar ILIKE '%ذمم دائنة%'
          )
        ORDER BY 
            CASE 
                WHEN is_payable = true THEN 0
                WHEN account_code = '211' THEN 1
                WHEN account_code = '2110' THEN 2
                ELSE 10
            END
        LIMIT 1;
        
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings 
            SET default_payable_account_id = v_account_id
            WHERE id = v_company.settings_id
              AND default_payable_account_id IS NULL;
            RAISE NOTICE '  ✅ حساب الذمم الدائنة: %', v_account_id;
        ELSE
            RAISE NOTICE '  ⚠️ لم يتم العثور على حساب الذمم الدائنة';
        END IF;

        -- ═══ حساب الضريبة (القيمة المضافة) ═══
        SELECT id INTO v_account_id
        FROM chart_of_accounts 
        WHERE company_id = v_company.company_id 
          AND is_active = true
          AND is_detail = true
          AND (
              -- Fabric chart: 215
              account_code IN ('215')
              -- Standard chart: 2141
              OR account_code IN ('2141', '2142')
              -- By name
              OR name_ar ILIKE '%ضريبة القيمة المضافة%'
              OR name_ar ILIKE '%ضريبة%'
          )
        ORDER BY 
            CASE 
                WHEN name_ar ILIKE '%قيمة مضافة%' THEN 0
                WHEN account_code = '215' THEN 1
                WHEN account_code = '2141' THEN 2
                ELSE 10
            END
        LIMIT 1;
        
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings 
            SET default_tax_input_account_id = v_account_id,
                default_tax_output_account_id = v_account_id
            WHERE id = v_company.settings_id
              AND default_tax_input_account_id IS NULL;
            RAISE NOTICE '  ✅ حساب الضريبة: %', v_account_id;
        ELSE
            RAISE NOTICE '  ⚠️ لم يتم العثور على حساب الضريبة';
        END IF;

        -- ═══ حساب المبيعات (الجانب الدائن للمبيعات) ═══
        SELECT id INTO v_account_id
        FROM chart_of_accounts 
        WHERE company_id = v_company.company_id 
          AND is_active = true
          AND is_detail = true
          AND (
              -- Fabric chart: 41, 42
              account_code IN ('41', '42')
              -- Standard chart: 4110, 4120
              OR account_code IN ('4110', '4120', '4100')
              -- By name
              OR name_ar ILIKE '%مبيعات%'
          )
        ORDER BY 
            CASE 
                WHEN account_code = '41' THEN 0
                WHEN account_code = '4110' THEN 1
                ELSE 10
            END
        LIMIT 1;
        
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings 
            SET default_sales_account_id = v_account_id,
                default_revenue_account_id = COALESCE(default_revenue_account_id, v_account_id)
            WHERE id = v_company.settings_id
              AND default_sales_account_id IS NULL;
            RAISE NOTICE '  ✅ حساب المبيعات: %', v_account_id;
        ELSE
            RAISE NOTICE '  ⚠️ لم يتم العثور على حساب المبيعات';
        END IF;

        -- ═══ حساب الذمم المدينة - العملاء (الجانب المدين للمبيعات) ═══
        SELECT id INTO v_account_id
        FROM chart_of_accounts 
        WHERE company_id = v_company.company_id 
          AND is_active = true
          AND is_detail = true
          AND (
              is_receivable = true
              -- Fabric chart: 115, 116
              OR account_code IN ('115', '116')
              -- Standard chart: 1130, 1131
              OR account_code IN ('1130', '1131', '1132')
              -- By name
              OR name_ar ILIKE '%ذمم%جملة%'
              OR name_ar ILIKE '%عملاء%'
          )
        ORDER BY 
            CASE 
                WHEN is_receivable = true THEN 0
                WHEN account_code = '115' THEN 1
                WHEN account_code = '1130' THEN 2
                ELSE 10
            END
        LIMIT 1;
        
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings 
            SET default_receivable_account_id = v_account_id
            WHERE id = v_company.settings_id
              AND default_receivable_account_id IS NULL;
            RAISE NOTICE '  ✅ حساب الذمم المدينة: %', v_account_id;
        ELSE
            RAISE NOTICE '  ⚠️ لم يتم العثور على حساب الذمم المدينة';
        END IF;

        -- ═══ حساب المخزون ═══
        SELECT id INTO v_account_id
        FROM chart_of_accounts 
        WHERE company_id = v_company.company_id 
          AND is_active = true
          AND is_detail = true
          AND (
              -- Fabric chart: 131 (مخزون أقمشة رولونات)
              account_code IN ('131', '132', '13')
              -- Standard chart: 1141, 1140
              OR account_code IN ('1141', '1140')
              -- By name
              OR name_ar ILIKE '%مخزون%رولون%'
              OR name_ar ILIKE '%مخزون%أقمشة%'
              OR name_ar ILIKE '%بضاعة جاهزة%'
          )
        ORDER BY 
            CASE 
                WHEN account_code = '131' THEN 0
                WHEN account_code = '1141' THEN 1
                ELSE 10
            END
        LIMIT 1;
        
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings 
            SET default_inventory_account_id = v_account_id
            WHERE id = v_company.settings_id
              AND default_inventory_account_id IS NULL;
            RAISE NOTICE '  ✅ حساب المخزون: %', v_account_id;
        ELSE
            RAISE NOTICE '  ⚠️ لم يتم العثور على حساب المخزون';
        END IF;

    END LOOP;
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ تم ربط الحسابات الافتراضية بنجاح!';
    RAISE NOTICE '';
    RAISE NOTICE '📋 الحسابات المربوطة:';
    RAISE NOTICE '  • default_purchase_account_id  — حساب المشتريات/COGS';
    RAISE NOTICE '  • default_payable_account_id   — حساب الذمم الدائنة';
    RAISE NOTICE '  • default_tax_input_account_id — حساب ضريبة المدخلات';
    RAISE NOTICE '  • default_sales_account_id     — حساب المبيعات';
    RAISE NOTICE '  • default_receivable_account_id— حساب الذمم المدينة';
    RAISE NOTICE '  • default_inventory_account_id — حساب المخزون';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

-- 3️⃣ التحقق من النتائج (Commented out because table might not exist)
/*
SELECT 
    c.name_ar as company_name,
    cas.default_purchase_account_id IS NOT NULL as has_purchase,
    cas.default_payable_account_id IS NOT NULL as has_payable,
    cas.default_tax_input_account_id IS NOT NULL as has_tax,
    cas.default_sales_account_id IS NOT NULL as has_sales,
    cas.default_receivable_account_id IS NOT NULL as has_receivable,
    cas.default_inventory_account_id IS NOT NULL as has_inventory,
    (SELECT account_code || ' - ' || name_ar FROM chart_of_accounts WHERE id = cas.default_purchase_account_id) as purchase_account,
    (SELECT account_code || ' - ' || name_ar FROM chart_of_accounts WHERE id = cas.default_payable_account_id) as payable_account,
    (SELECT account_code || ' - ' || name_ar FROM chart_of_accounts WHERE id = cas.default_tax_input_account_id) as tax_account,
    (SELECT account_code || ' - ' || name_ar FROM chart_of_accounts WHERE id = cas.default_sales_account_id) as sales_account,
    (SELECT account_code || ' - ' || name_ar FROM chart_of_accounts WHERE id = cas.default_receivable_account_id) as receivable_account
FROM company_accounting_settings cas
JOIN companies c ON c.id = cas.company_id;
*/
