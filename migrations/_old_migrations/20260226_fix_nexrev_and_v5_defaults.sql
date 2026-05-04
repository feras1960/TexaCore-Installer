-- ═══════════════════════════════════════════════════════════════════════════════
-- 🔧 V5.1 Final — auto_set_default_accounts + upgrade_company_chart
-- تاريخ: 2026-02-26 | الإصدار: V5.1 Final
-- ═══════════════════════════════════════════════════════════════════════════════
-- التغييرات:
-- • 23 حساب افتراضي — بدون أي مرجع fabric_extended
-- • 115=GIT, 581=شحن, 597=إهلاك, 598=بنوك
-- • دالة ترقية Simple→Extended تدريجية
-- • حذف الدوال القديمة (V1-V3)
-- ═══════════════════════════════════════════════════════════════════════════════

-- حذف الدوال القديمة (لو بقيت)
DROP FUNCTION IF EXISTS create_default_chart_of_accounts(UUID);
DROP FUNCTION IF EXISTS create_comprehensive_chart_of_accounts(UUID);
DROP FUNCTION IF EXISTS create_fabric_extended_chart(UUID);
DROP FUNCTION IF EXISTS create_unified_extended_chart(UUID, BOOLEAN);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1️⃣ auto_set_default_accounts V5.1 Final
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS auto_set_default_accounts(UUID);

CREATE OR REPLACE FUNCTION auto_set_default_accounts(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_chart_type VARCHAR(30);
    v_settings_id UUID;
    v_account_id UUID;
    v_count INT := 0;
BEGIN
    SELECT chart_type INTO v_chart_type FROM companies WHERE id = p_company_id;
    IF v_chart_type IS NULL THEN RETURN; END IF;

    SELECT id INTO v_settings_id FROM company_accounting_settings WHERE company_id = p_company_id;
    IF v_settings_id IS NULL THEN
        INSERT INTO company_accounting_settings (company_id, base_currency, fiscal_year_start_month, fiscal_year_end_month, enable_vat, decimal_places)
        VALUES (p_company_id, 'USD', 1, 12, true, 2) RETURNING id INTO v_settings_id;
    END IF;

    -- 1 الصندوق — 1111
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1111' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_cash_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 2 البنك — 1121
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1121' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_bank_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 3 ذمم مدينة — Simple: 113, Extended: 1131
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND is_active = true
      AND account_code = CASE v_chart_type WHEN 'simple' THEN '113' ELSE '1131' END LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_receivable_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 4 ذمم دائنة — Simple: 211, Extended: 2111
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND is_active = true
      AND account_code = CASE v_chart_type WHEN 'simple' THEN '211' ELSE '2111' END LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_payable_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 5 المبيعات — 41
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '41' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_revenue_account_id = v_account_id, default_sales_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 6 المشتريات — 521
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '521' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_purchase_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 7 COGS — 511
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '511' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_cogs_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 8 المصروفات — 57
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '57' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_expense_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 9 ض.ق.م مدخلات — 117
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '117' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_tax_input_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 10 ض.ق.م مخرجات — 214
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '214' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_tax_output_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 11 المخزون — 1141
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1141' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_inventory_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 12 FX Gains — 46
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '46' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_fx_gain_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 13 FX Losses — 591
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '591' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_fx_loss_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 14 الشحن — 581
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '581' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_freight_in_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 15 أرباح محتجزة — 32
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '32' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_retained_earnings_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 16 مردودات مشتريات — 522
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '522' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_purchase_returns_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 17 خصومات مشتريات — 523
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '523' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_purchase_discount_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 18 فروق مخزون — 592 (Extended)
    IF v_chart_type = 'extended' THEN
        SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '592' AND is_detail = true AND is_active = true LIMIT 1;
        IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_inventory_variance_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;
    END IF;

    -- 19 دفعات موردين — 118
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '118' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_supplier_advance_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 20 سلف عملاء — 215
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '215' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_customer_advance_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 21 نثرية — 1113 (Extended)
    IF v_chart_type = 'extended' THEN
        SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1113' AND is_detail = true AND is_active = true LIMIT 1;
        IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_petty_cash_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;
    END IF;

    -- 22 إهلاك — 597 (Extended)
    IF v_chart_type = 'extended' THEN
        SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '597' AND is_detail = true AND is_active = true LIMIT 1;
        IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_depreciation_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;
    END IF;

    -- 23 بضاعة في الطريق — 115 (Extended)
    IF v_chart_type = 'extended' THEN
        SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '115' AND is_detail = false AND is_active = true LIMIT 1;
        IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_git_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;
    END IF;

    RAISE NOTICE 'V5.1 — تم تحديد %/23 حساب افتراضي', v_count;
END;
$$;

COMMENT ON FUNCTION auto_set_default_accounts(UUID) IS 'V5.1 Final — 23 حساب: 115=GIT, 581=شحن, 597=إهلاك';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2️⃣ upgrade_company_chart — ترقية تدريجية Simple→Extended
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS upgrade_company_chart(UUID, VARCHAR);

CREATE OR REPLACE FUNCTION upgrade_company_chart(
    p_company_id UUID,
    p_target_chart_type VARCHAR DEFAULT 'extended'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_current_type VARCHAR;
    v_asset_type UUID;
    v_liability_type UUID;
    v_revenue_type UUID;
    v_expense_type UUID;
    v_cogs_type UUID;
    v_added INT := 0;
    v_parent_id UUID;
BEGIN
    SELECT tenant_id, chart_type INTO v_tenant_id, v_current_type
    FROM companies WHERE id = p_company_id;

    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'الشركة % غير موجودة', p_company_id; END IF;
    IF v_current_type = p_target_chart_type THEN RAISE NOTICE 'الشركة بالفعل %', p_target_chart_type; RETURN; END IF;
    IF p_target_chart_type != 'extended' THEN RAISE EXCEPTION 'الترقية مدعومة فقط إلى extended'; END IF;
    IF v_current_type != 'simple' THEN RAISE EXCEPTION 'الترقية مدعومة فقط من simple — الحالي: %', v_current_type; END IF;

    SELECT id INTO v_asset_type FROM account_types WHERE code = 'ASSET';
    SELECT id INTO v_liability_type FROM account_types WHERE code = 'LIABILITY';
    SELECT id INTO v_revenue_type FROM account_types WHERE code = 'REVENUE';
    SELECT id INTO v_expense_type FROM account_types WHERE code = 'EXPENSE';
    SELECT id INTO v_cogs_type FROM account_types WHERE code = 'COGS';
    IF v_cogs_type IS NULL THEN v_cogs_type := v_expense_type; END IF;

    -- ═══ الأصول الإضافية ═══

    -- 1113 صندوق النثرية
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '111' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1113') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_cash_account)
        VALUES (v_tenant_id, p_company_id, '1113', 'صندوق النثرية', 'Petty Cash', v_asset_type, v_parent_id, true, true, true);
        v_added := v_added + 1;
    END IF;

    -- 1131, 1132, 1133 (ذمم تفصيلية)
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '113' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1131') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable)
            VALUES (v_tenant_id, p_company_id, '1131', 'ذمم الجملة', 'Wholesale Receivables', v_asset_type, v_parent_id, true, true, true);
            v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1132') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable)
            VALUES (v_tenant_id, p_company_id, '1132', 'ذمم التجزئة', 'Retail Receivables', v_asset_type, v_parent_id, true, true, true);
            v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1133') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable)
            VALUES (v_tenant_id, p_company_id, '1133', 'أوراق القبض', 'Notes Receivable', v_asset_type, v_parent_id, true, true, true);
            v_added := v_added + 1;
        END IF;
    END IF;

    -- 115 بضاعة في الطريق
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '11' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '115') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active)
        VALUES (v_tenant_id, p_company_id, '115', 'بضاعة في الطريق', 'Goods in Transit', v_asset_type, v_parent_id, false, true);
        v_added := v_added + 1;
    END IF;

    -- أصول ثابتة إضافية (122-125)
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '12' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '122') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '122', 'معدات المستودعات', 'Warehouse Equipment', v_asset_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '123') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '123', 'الأثاث والتجهيزات', 'Furniture & Fixtures', v_asset_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '124') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '124', 'وسائل النقل', 'Vehicles', v_asset_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '125') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '125', 'أجهزة الكمبيوتر والأنظمة', 'IT & Systems', v_asset_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
    END IF;

    -- ═══ الخصوم الإضافية ═══

    -- 2111, 2112
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '211' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2111') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable) VALUES (v_tenant_id, p_company_id, '2111', 'دين الموردين - رئيسي', 'Main Suppliers', v_liability_type, v_parent_id, true, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2112') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable) VALUES (v_tenant_id, p_company_id, '2112', 'دين الموردين - أخرى', 'Other Suppliers', v_liability_type, v_parent_id, true, true, true); v_added := v_added + 1;
        END IF;
    END IF;

    -- 212 مقدمو خدمات الشحن + 2121-2125
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '21' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '212') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active)
        VALUES (v_tenant_id, p_company_id, '212', 'مقدمو خدمات الشحن', 'Logistics Providers', v_liability_type, v_parent_id, false, true)
        RETURNING id INTO v_parent_id;
        v_added := v_added + 1;
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES
            (v_tenant_id, p_company_id, '2121', 'شركات الشحن البحري', 'Ocean Freight', v_liability_type, v_parent_id, true, true),
            (v_tenant_id, p_company_id, '2122', 'مكاتب التخليص الجمركي', 'Customs Clearance', v_liability_type, v_parent_id, true, true),
            (v_tenant_id, p_company_id, '2123', 'شركات النقل الداخلي', 'Inland Transport', v_liability_type, v_parent_id, true, true),
            (v_tenant_id, p_company_id, '2124', 'شركات التأمين', 'Insurance', v_liability_type, v_parent_id, true, true),
            (v_tenant_id, p_company_id, '2125', 'خدمات لوجستية أخرى', 'Other Logistics', v_liability_type, v_parent_id, true, true);
        v_added := v_added + 5;
    END IF;

    -- 2126 شركات الصرافة والحوالات (V5.2)
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '212' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2126') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_group, is_detail, is_active)
        VALUES (v_tenant_id, p_company_id, '2126', 'شركات الصرافة والحوالات', 'Exchange & Remittance Companies', v_liability_type, v_parent_id, true, false, true)
        RETURNING id INTO v_parent_id;
        v_added := v_added + 1;
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_group, is_detail, is_active)
        VALUES (v_tenant_id, p_company_id, '21261', 'شركة صرافة - عام', 'General Exchange Company', v_liability_type, v_parent_id, false, true, true);
        v_added := v_added + 1;
    END IF;

    -- 222 التزامات الإيجار
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '22' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '222') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '222', 'التزامات الإيجار', 'Lease Obligations', v_liability_type, v_parent_id, true, true); v_added := v_added + 1;
    END IF;

    -- ═══ الإيرادات الإضافية ═══
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '4' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '42') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '42', 'مبيعات خدمات', 'Service Revenue', v_revenue_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '43') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '43', 'خصومات المبيعات', 'Sales Discounts', v_revenue_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '47') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '47', 'إيرادات الفوائد', 'Interest Income', v_revenue_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
    END IF;

    -- ═══ المصروفات الإضافية ═══

    -- 512, 513
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '51' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '512') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '512', 'تكلفة المبيعات العامة', 'General COGS', v_cogs_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '513') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '513', 'تكلفة الخدمات', 'Cost of Services', v_cogs_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
    END IF;

    -- 56 تسويق
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '5' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '56') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '56', 'مصروفات التسويق', 'Marketing Expenses', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
    END IF;

    -- 582, 583, 584
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '58' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '582') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '582', 'مصاريف الجمركة', 'Customs Expenses', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '583') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '583', 'تأمين بحري وشحن', 'Marine Insurance', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '584') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '584', 'مصاريف مشتريات أخرى', 'Other Purchase Exp.', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
    END IF;

    -- 592, 594, 595, 597, 598
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '59' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '592') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '592', 'فروق المخزون', 'Inventory Variances', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '594') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '594', 'مصروفات التأمين', 'Insurance Expenses', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '595') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '595', 'مصروفات قانونية ومهنية', 'Legal & Professional', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '597') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '597', 'مصروفات الإهلاك', 'Depreciation Expense', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '598') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active) VALUES (v_tenant_id, p_company_id, '598', 'مصروفات البنوك', 'Bank Charges', v_expense_type, v_parent_id, true, true); v_added := v_added + 1;
        END IF;
    END IF;

    -- ═══ تحديث النوع + الحسابات الافتراضية ═══
    UPDATE companies SET chart_type = 'extended' WHERE id = p_company_id;
    PERFORM auto_set_default_accounts(p_company_id);

    RAISE NOTICE '✅ تمت الترقية Simple→Extended — أُضيف % حساب', v_added;
END;
$$;

COMMENT ON FUNCTION upgrade_company_chart(UUID, VARCHAR) IS 'V5.1 — ترقية تدريجية Simple→Extended: يضيف الحسابات الناقصة فقط بدون مساس البيانات';
