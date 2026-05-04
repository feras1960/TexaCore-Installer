-- 20260418100000_update_chart_functions.sql
-- Fixes is_detail flags and missing SUM accounts generation.

CREATE OR REPLACE FUNCTION public.upgrade_company_chart(p_company_id UUID, p_target_chart_type VARCHAR DEFAULT 'extended')
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_current_type VARCHAR;
    v_base_currency VARCHAR(10);
    v_asset_type UUID;
    v_liability_type UUID;
    v_revenue_type UUID;
    v_expense_type UUID;
    v_cogs_type UUID;
    v_added INT := 0;
    v_parent_id UUID;
    v_1131_id UUID;
    v_2111_id UUID;
BEGIN
    SELECT tenant_id, chart_type INTO v_tenant_id, v_current_type
    FROM companies WHERE id = p_company_id;

    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'الشركة % غير موجودة', p_company_id; END IF;
    IF v_current_type = p_target_chart_type THEN RAISE NOTICE 'الشركة بالفعل %', p_target_chart_type; RETURN; END IF;
    IF p_target_chart_type != 'extended' THEN RAISE EXCEPTION 'الترقية مدعومة فقط إلى extended'; END IF;
    IF v_current_type != 'simple' THEN RAISE EXCEPTION 'الترقية مدعومة فقط من simple — الحالي: %', v_current_type; END IF;

    -- Fetch base currency
    SELECT COALESCE(cas.base_currency, c.default_currency, 'USD') INTO v_base_currency
    FROM companies c LEFT JOIN company_accounting_settings cas ON cas.company_id = c.id
    WHERE c.id = p_company_id;

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
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_cash_account, currency)
        VALUES (v_tenant_id, p_company_id, '1113', 'صندوق النثرية', 'Petty Cash', v_asset_type, v_parent_id, true, true, true, v_base_currency);
        v_added := v_added + 1;
    END IF;

    -- 1131, 1132, 1133 (ذمم تفصيلية)
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '113' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        -- 1131 ذمم الجملة is GROUP now
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1131') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
            VALUES (v_tenant_id, p_company_id, '1131', 'ذمم الجملة', 'Wholesale Receivables', v_asset_type, v_parent_id, false, true, true, v_base_currency) RETURNING id INTO v_1131_id;
            
            -- Insert 1131-SUM
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_summary_account, summary_party_type, is_system, currency)
            VALUES (v_tenant_id, p_company_id, '1131-SUM', 'إجمالي ذمم العملاء', 'Total Customer Receivables', v_asset_type, v_1131_id, true, true, true, 'customer', true, v_base_currency);
            v_added := v_added + 2;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1132') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
            VALUES (v_tenant_id, p_company_id, '1132', 'ذمم التجزئة', 'Retail Receivables', v_asset_type, v_parent_id, true, true, true, v_base_currency);
            v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1133') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
            VALUES (v_tenant_id, p_company_id, '1133', 'أوراق القبض', 'Notes Receivable', v_asset_type, v_parent_id, true, true, true, v_base_currency);
            v_added := v_added + 1;
        END IF;
    END IF;

    -- 115 بضاعة في الطريق
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '11' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '115') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '115', 'بضاعة في الطريق', 'Goods in Transit', v_asset_type, v_parent_id, false, true, v_base_currency);
        v_added := v_added + 1;
    END IF;

    -- أصول ثابتة إضافية (122-125)
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '12' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '122') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '122', 'معدات المستودعات', 'Warehouse Equipment', v_asset_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '123') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '123', 'الأثاث والتجهيزات', 'Furniture & Fixtures', v_asset_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '124') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '124', 'وسائل النقل', 'Vehicles', v_asset_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '125') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '125', 'أجهزة الكمبيوتر والأنظمة', 'IT & Systems', v_asset_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
    END IF;

    -- ═══ الخصوم الإضافية ═══

    -- 2111, 2112
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '211' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2111') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable, currency) VALUES (v_tenant_id, p_company_id, '2111', 'دين الموردين - رئيسي', 'Main Suppliers', v_liability_type, v_parent_id, false, true, true, v_base_currency) RETURNING id INTO v_2111_id; 
            
            -- Insert 2111-SUM
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_summary_account, summary_party_type, is_system, currency)
            VALUES (v_tenant_id, p_company_id, '2111-SUM', 'إجمالي ذمم الموردين', 'Total Supplier Payables', v_liability_type, v_2111_id, true, true, true, 'supplier', true, v_base_currency);
            
            v_added := v_added + 2;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2112') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable, currency) VALUES (v_tenant_id, p_company_id, '2112', 'دين الموردين - أخرى', 'Other Suppliers', v_liability_type, v_parent_id, true, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
    END IF;

    -- 212 مقدمو خدمات الشحن + 2121-2125
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '21' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '212') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '212', 'مقدمو خدمات الشحن', 'Logistics Providers', v_liability_type, v_parent_id, false, true, v_base_currency)
        RETURNING id INTO v_parent_id;
        v_added := v_added + 1;
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES
            (v_tenant_id, p_company_id, '2121', 'شركات الشحن البحري', 'Ocean Freight', v_liability_type, v_parent_id, true, true, v_base_currency),
            (v_tenant_id, p_company_id, '2122', 'مكاتب التخليص الجمركي', 'Customs Clearance', v_liability_type, v_parent_id, true, true, v_base_currency),
            (v_tenant_id, p_company_id, '2123', 'شركات النقل الداخلي', 'Inland Transport', v_liability_type, v_parent_id, true, true, v_base_currency),
            (v_tenant_id, p_company_id, '2124', 'شركات التأمين', 'Insurance', v_liability_type, v_parent_id, true, true, v_base_currency),
            (v_tenant_id, p_company_id, '2125', 'خدمات لوجستية أخرى', 'Other Logistics', v_liability_type, v_parent_id, true, true, v_base_currency);
        v_added := v_added + 5;
    END IF;

    -- 2126 شركات الصرافة والحوالات (V5.2)
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '212' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2126') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_group, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '2126', 'شركات الصرافة والحوالات', 'Exchange & Remittance Companies', v_liability_type, v_parent_id, true, false, true, v_base_currency)
        RETURNING id INTO v_parent_id;
        v_added := v_added + 1;
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_group, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '21261', 'شركة صرافة - عام', 'General Exchange Company', v_liability_type, v_parent_id, false, true, true, v_base_currency);
        v_added := v_added + 1;
    END IF;

    -- 222 التزامات الإيجار
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '22' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '222') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '222', 'التزامات الإيجار', 'Lease Obligations', v_liability_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
    END IF;

    -- ═══ الإيرادات الإضافية ═══
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '4' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '42') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '42', 'مبيعات خدمات', 'Service Revenue', v_revenue_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '43') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '43', 'خصومات المبيعات', 'Sales Discounts', v_revenue_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '47') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '47', 'إيرادات الفوائد', 'Interest Income', v_revenue_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
    END IF;

    -- ═══ المصروفات الإضافية ═══

    -- 512, 513
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '51' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '512') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '512', 'تكلفة المبيعات العامة', 'General COGS', v_cogs_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '513') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '513', 'تكلفة الخدمات', 'Cost of Services', v_cogs_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
    END IF;

    -- 56 تسويق
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '5' LIMIT 1;
    IF v_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '56') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '56', 'مصروفات التسويق', 'Marketing Expenses', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
    END IF;

    -- 582, 583, 584
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '58' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '582') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '582', 'مصاريف الجمركة', 'Customs Expenses', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '583') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '583', 'تأمين بحري وشحن', 'Marine Insurance', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '584') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '584', 'مصاريف مشتريات أخرى', 'Other Purchase Exp.', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
    END IF;

    -- 592, 594, 595, 597, 598
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '59' LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '592') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '592', 'فروق المخزون', 'Inventory Variances', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '594') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '594', 'مصروفات التأمين', 'Insurance Expenses', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '595') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '595', 'مصروفات قانونية ومهنية', 'Legal & Professional', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '597') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '597', 'مصروفات الإهلاك', 'Depreciation Expense', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '598') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency) VALUES (v_tenant_id, p_company_id, '598', 'مصروفات البنوك', 'Bank Charges', v_expense_type, v_parent_id, true, true, v_base_currency); v_added := v_added + 1;
        END IF;
    END IF;

    -- ═══ تحديث النوع + الحسابات الافتراضية ═══
    UPDATE companies SET chart_type = 'extended' WHERE id = p_company_id;
    PERFORM auto_set_default_accounts(p_company_id);

    RAISE NOTICE '✅ تمت الترقية Simple→Extended — أُضيف % حساب', v_added;
END;
$$;
