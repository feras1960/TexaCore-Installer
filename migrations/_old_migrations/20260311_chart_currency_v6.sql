-- ═══════════════════════════════════════════════════════════════
-- V6: إضافة العملة لكل حساب في الشجرة القياسية والموسعة
-- العملة المحلية = base_currency (من company_accounting_settings)
-- العملة الدولية = default_international_purchase_currency
-- حسابات الصندوق/البنك بالعملة الأساسية → v_intl_currency
-- باقي الحسابات → v_base_currency
-- ═══════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════
-- 1. create_simple_chart V6
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_simple_chart(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_tenant_id UUID;
    v_base_currency VARCHAR(10);
    v_intl_currency VARCHAR(10);
    v_asset_type UUID; v_current_asset_type UUID; v_fixed_asset_type UUID;
    v_liability_type UUID; v_current_liability_type UUID; v_long_liability_type UUID;
    v_equity_type UUID; v_revenue_type UUID; v_expense_type UUID; v_cogs_type UUID;
    v_assets_id UUID; v_current_assets_id UUID;
    v_cash_grp UUID; v_banks_grp UUID; v_inv_grp UUID;
    v_fixed_assets_id UUID;
    v_liabilities_id UUID; v_current_liab_id UUID; v_long_liab_id UUID;
    v_equity_id UUID;
    v_revenue_id UUID;
    v_expenses_id UUID; v_cogs_grp UUID; v_purchases_grp UUID; v_freight_grp UUID; v_misc_grp UUID;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Company not found: %', p_company_id; END IF;
    IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id LIMIT 1) THEN RETURN; END IF;

    -- 🆕 V6: العملة الديناميكية من إعدادات الشركة
    SELECT COALESCE(cas.base_currency, c.default_currency, 'USD'),
           COALESCE(cas.default_international_purchase_currency, 'USD')
    INTO v_base_currency, v_intl_currency
    FROM companies c
    LEFT JOIN company_accounting_settings cas ON cas.company_id = c.id
    WHERE c.id = p_company_id;
    IF v_base_currency IS NULL THEN v_base_currency := 'USD'; END IF;
    IF v_intl_currency IS NULL THEN v_intl_currency := 'USD'; END IF;
    -- إذا العملة المحلية = الدولية، نتركهم نفس الشيء
    IF v_base_currency = v_intl_currency THEN v_intl_currency := v_base_currency; END IF;

    -- Get account types
    SELECT id INTO v_asset_type FROM account_types WHERE code = 'ASSET';
    SELECT id INTO v_current_asset_type FROM account_types WHERE code = 'CURRENT_ASSET';
    SELECT id INTO v_fixed_asset_type FROM account_types WHERE code = 'FIXED_ASSET';
    SELECT id INTO v_liability_type FROM account_types WHERE code = 'LIABILITY';
    SELECT id INTO v_current_liability_type FROM account_types WHERE code = 'CURRENT_LIABILITY';
    SELECT id INTO v_long_liability_type FROM account_types WHERE code IN ('LONG_TERM_LIABILITY','NON_CURRENT_LIABILITY','LIABILITY');
    IF v_long_liability_type IS NULL THEN v_long_liability_type := v_liability_type; END IF;
    SELECT id INTO v_equity_type FROM account_types WHERE code = 'EQUITY';
    SELECT id INTO v_revenue_type FROM account_types WHERE code = 'REVENUE';
    SELECT id INTO v_expense_type FROM account_types WHERE code = 'EXPENSE';
    SELECT id INTO v_cogs_type FROM account_types WHERE code = 'COGS';
    IF v_cogs_type IS NULL THEN v_cogs_type := v_expense_type; END IF;

    -- ═══ 1️⃣ الأصول ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '1', 'الأصول', 'Assets', v_asset_type, NULL, false, true, v_base_currency) RETURNING id INTO v_assets_id;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '11', 'الأصول المتداولة', 'Current Assets', v_current_asset_type, v_assets_id, false, true, v_base_currency) RETURNING id INTO v_current_assets_id;

    -- الصندوق (111)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '111', 'الصندوق', 'Cash', v_current_asset_type, v_current_assets_id, false, true, v_base_currency) RETURNING id INTO v_cash_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_cash_account, currency)
    VALUES
        (v_tenant_id, p_company_id, '1111', 'صندوق - عملة محلية', 'Cash - Local Currency', v_current_asset_type, v_cash_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1112', 'صندوق - عملة أساسية', 'Cash - Base Currency', v_current_asset_type, v_cash_grp, true, true, true, v_intl_currency);

    -- البنوك (112)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '112', 'البنوك', 'Banks', v_current_asset_type, v_current_assets_id, false, true, v_base_currency) RETURNING id INTO v_banks_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_bank_account, currency)
    VALUES
        (v_tenant_id, p_company_id, '1121', 'بنك - عملة محلية', 'Bank - Local Currency', v_current_asset_type, v_banks_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1122', 'بنك - عملة أساسية', 'Bank - Base Currency', v_current_asset_type, v_banks_grp, true, true, true, v_intl_currency);

    -- العملاء (113)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
    VALUES (v_tenant_id, p_company_id, '113', 'العملاء', 'Accounts Receivable', v_current_asset_type, v_current_assets_id, false, true, true, v_base_currency);

    -- المخزون (114)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '114', 'المخزون', 'Inventory', v_current_asset_type, v_current_assets_id, false, true, v_base_currency) RETURNING id INTO v_inv_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '1141', 'بضاعة جاهزة', 'Finished Goods', v_current_asset_type, v_inv_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1142', 'مواد خام', 'Raw Materials', v_current_asset_type, v_inv_grp, true, true, v_base_currency);

    -- باقي الأصول المتداولة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '116', 'مصاريف مقدمة', 'Prepaid Expenses', v_current_asset_type, v_current_assets_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '117', 'ض.ق.م - مدخلات', 'VAT Input', v_current_asset_type, v_current_assets_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '118', 'دفعات مقدمة للموردين', 'Supplier Deposits', v_current_asset_type, v_current_assets_id, true, true, v_base_currency);

    -- الأصول الثابتة (12)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '12', 'الأصول الثابتة', 'Fixed Assets', v_fixed_asset_type, v_assets_id, false, true, v_base_currency) RETURNING id INTO v_fixed_assets_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '121', 'أصول ثابتة', 'Fixed Assets', v_fixed_asset_type, v_fixed_assets_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '129', 'مجمع الإهلاك', 'Accumulated Depreciation', v_fixed_asset_type, v_fixed_assets_id, true, true, v_base_currency);

    -- ═══ 2️⃣ الخصوم ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '2', 'الخصوم', 'Liabilities', v_liability_type, NULL, false, true, v_base_currency) RETURNING id INTO v_liabilities_id;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '21', 'الخصوم المتداولة', 'Current Liabilities', v_current_liability_type, v_liabilities_id, false, true, v_base_currency) RETURNING id INTO v_current_liab_id;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable, currency)
    VALUES (v_tenant_id, p_company_id, '211', 'الموردون', 'Accounts Payable', v_current_liability_type, v_current_liab_id, false, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '213', 'مستحقات الموظفين', 'Accrued Salaries', v_current_liability_type, v_current_liab_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '214', 'ض.ق.م - مخرجات', 'VAT Output', v_current_liability_type, v_current_liab_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '215', 'سلف العملاء', 'Customer Advances', v_current_liability_type, v_current_liab_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '216', 'دائنون آخرون', 'Other Payables', v_current_liability_type, v_current_liab_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '217', 'أوراق الدفع', 'Notes Payable', v_current_liability_type, v_current_liab_id, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '22', 'الخصوم طويلة الأجل', 'Long-term Liabilities', v_long_liability_type, v_liabilities_id, false, true, v_base_currency) RETURNING id INTO v_long_liab_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '221', 'قروض طويلة الأجل', 'Long-term Loans', v_long_liability_type, v_long_liab_id, true, true, v_base_currency);

    -- ═══ 3️⃣ حقوق الملكية ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '3', 'حقوق الملكية', 'Equity', v_equity_type, NULL, false, true, v_base_currency) RETURNING id INTO v_equity_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '31', 'رأس المال', 'Capital', v_equity_type, v_equity_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '32', 'الأرباح المحتجزة', 'Retained Earnings', v_equity_type, v_equity_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '33', 'أرباح/خسائر العام', 'Current Year P/L', v_equity_type, v_equity_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '34', 'احتياطيات', 'Reserves', v_equity_type, v_equity_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '35', 'أرصدة افتتاحية', 'Opening Balance Equity', v_equity_type, v_equity_id, true, true, v_base_currency);

    -- ═══ 4️⃣ الإيرادات ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '4', 'الإيرادات', 'Revenue', v_revenue_type, NULL, false, true, v_base_currency) RETURNING id INTO v_revenue_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '41', 'المبيعات', 'Sales', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '44', 'مردودات المبيعات', 'Sales Returns', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '45', 'إيرادات أخرى', 'Other Income', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '46', 'أرباح فروقات العملة', 'FX Gains', v_revenue_type, v_revenue_id, true, true, v_base_currency);

    -- ═══ 5️⃣ المصروفات ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '5', 'المصروفات', 'Expenses', v_expense_type, NULL, false, true, v_base_currency) RETURNING id INTO v_expenses_id;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '51', 'تكلفة المبيعات', 'Cost of Sales', v_cogs_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_cogs_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '511', 'تكلفة المبيعات', 'Cost of Sales', v_cogs_type, v_cogs_grp, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '52', 'المشتريات', 'Purchases', v_cogs_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_purchases_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '521', 'مشتريات عامة', 'General Purchases', v_cogs_type, v_purchases_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '522', 'مردودات المشتريات', 'Purchase Returns', v_cogs_type, v_purchases_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '523', 'خصومات المشتريات', 'Purchase Discounts', v_cogs_type, v_purchases_grp, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '53', 'الرواتب والأجور', 'Salaries & Wages', v_expense_type, v_expenses_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '54', 'الإيجارات', 'Rent Expense', v_expense_type, v_expenses_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '55', 'المرافق', 'Utilities', v_expense_type, v_expenses_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '57', 'مصاريف إدارية', 'Administrative Expenses', v_expense_type, v_expenses_id, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '58', 'مصاريف المشتريات والشحن', 'Purchase & Shipping Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_freight_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '581', 'مصاريف الشحن', 'Shipping Expenses', v_expense_type, v_freight_grp, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '59', 'مصروفات متنوعة', 'Miscellaneous Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_misc_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '591', 'خسائر فروقات العملة', 'FX Losses', v_expense_type, v_misc_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '593', 'مصروفات الصيانة', 'Maintenance Expenses', v_expense_type, v_misc_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '596', 'مصروفات أخرى', 'Other Expenses', v_expense_type, v_misc_grp, true, true, v_base_currency);

    UPDATE companies SET chart_type = 'simple' WHERE id = p_company_id;
    RAISE NOTICE '✅ V6 — الشجرة القياسية بعملة محلية=% دولية=%', v_base_currency, v_intl_currency;
END;
$function$;
COMMENT ON FUNCTION create_simple_chart IS 'V6 — الشجرة القياسية (56 حساب) مع currency ديناميكية من إعدادات الشركة';


-- ════════════════════════════════════════════════════════════
-- 2. create_extended_chart V6
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_extended_chart(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_tenant_id UUID;
    v_base_currency VARCHAR(10);
    v_intl_currency VARCHAR(10);
    v_asset_type UUID;
    v_liability_type UUID;
    v_equity_type UUID;
    v_revenue_type UUID;
    v_expense_type UUID;
    v_cogs_type UUID;
    v_assets_id UUID;
    v_current_assets UUID;
    v_cash_grp UUID;
    v_banks_grp UUID;
    v_recv_grp UUID;
    v_inv_grp UUID;
    v_fixed_assets UUID;
    v_git_grp UUID;
    v_liabilities_id UUID;
    v_current_liab UUID;
    v_payable_grp UUID;
    v_logistics_grp UUID;
    v_longterm_liab UUID;
    v_equity_id UUID;
    v_revenue_id UUID;
    v_expenses_id UUID;
    v_cogs_grp UUID;
    v_purchases_grp UUID;
    v_purch_exp_grp UUID;
    v_misc_exp_grp UUID;
    v_exchange_grp UUID;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'الشركة % غير موجودة', p_company_id; END IF;

    -- 🆕 V6: العملة الديناميكية
    SELECT COALESCE(cas.base_currency, c.default_currency, 'USD'),
           COALESCE(cas.default_international_purchase_currency, 'USD')
    INTO v_base_currency, v_intl_currency
    FROM companies c
    LEFT JOIN company_accounting_settings cas ON cas.company_id = c.id
    WHERE c.id = p_company_id;
    IF v_base_currency IS NULL THEN v_base_currency := 'USD'; END IF;
    IF v_intl_currency IS NULL THEN v_intl_currency := 'USD'; END IF;
    IF v_base_currency = v_intl_currency THEN v_intl_currency := v_base_currency; END IF;

    -- Get account types
    SELECT id INTO v_asset_type FROM account_types WHERE code = 'ASSET';
    SELECT id INTO v_liability_type FROM account_types WHERE code = 'LIABILITY';
    SELECT id INTO v_equity_type FROM account_types WHERE code = 'EQUITY';
    SELECT id INTO v_revenue_type FROM account_types WHERE code = 'REVENUE';
    SELECT id INTO v_expense_type FROM account_types WHERE code = 'EXPENSE';
    SELECT id INTO v_cogs_type FROM account_types WHERE code = 'COGS';
    IF v_cogs_type IS NULL THEN v_cogs_type := v_expense_type; END IF;

    -- ═══ 1️⃣ الأصول ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '1', 'الأصول', 'Assets', v_asset_type, false, true, v_base_currency) RETURNING id INTO v_assets_id;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '11', 'الأصول المتداولة', 'Current Assets', v_asset_type, v_assets_id, false, true, v_base_currency) RETURNING id INTO v_current_assets;

    -- الصندوق (111)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_cash_account, currency)
    VALUES (v_tenant_id, p_company_id, '111', 'الصندوق', 'Cash', v_asset_type, v_current_assets, false, true, true, v_base_currency) RETURNING id INTO v_cash_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_cash_account, currency)
    VALUES
        (v_tenant_id, p_company_id, '1111', 'صندوق - عملة محلية', 'Cash - Local Currency', v_asset_type, v_cash_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1112', 'صندوق - عملة أساسية', 'Cash - Base Currency', v_asset_type, v_cash_grp, true, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '1113', 'صندوق النثرية', 'Petty Cash', v_asset_type, v_cash_grp, true, true, true, v_base_currency);

    -- البنوك (112)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_bank_account, currency)
    VALUES (v_tenant_id, p_company_id, '112', 'البنوك', 'Banks', v_asset_type, v_current_assets, false, true, true, v_base_currency) RETURNING id INTO v_banks_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_bank_account, currency)
    VALUES
        (v_tenant_id, p_company_id, '1121', 'بنك - عملة محلية', 'Bank - Local Currency', v_asset_type, v_banks_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1122', 'بنك - عملة أساسية', 'Bank - Base Currency', v_asset_type, v_banks_grp, true, true, true, v_intl_currency);

    -- ذمم العملاء (113)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
    VALUES (v_tenant_id, p_company_id, '113', 'ذمم العملاء', 'Accounts Receivable', v_asset_type, v_current_assets, false, true, true, v_base_currency) RETURNING id INTO v_recv_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
    VALUES
        (v_tenant_id, p_company_id, '1131', 'ذمم الجملة', 'Wholesale Receivables', v_asset_type, v_recv_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1132', 'ذمم التجزئة', 'Retail Receivables', v_asset_type, v_recv_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1133', 'أوراق القبض', 'Notes Receivable', v_asset_type, v_recv_grp, true, true, true, v_base_currency);

    -- المخزون (114)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '114', 'المخزون', 'Inventory', v_asset_type, v_current_assets, false, true, v_base_currency) RETURNING id INTO v_inv_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '1141', 'بضاعة جاهزة', 'Finished Goods', v_asset_type, v_inv_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1142', 'مواد خام', 'Raw Materials', v_asset_type, v_inv_grp, true, true, v_base_currency);

    -- بضاعة في الطريق (115)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '115', 'بضاعة في الطريق', 'Goods in Transit', v_asset_type, v_current_assets, false, true, v_intl_currency) RETURNING id INTO v_git_grp;

    -- أصول متداولة أخرى
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '116', 'مصاريف مقدمة', 'Prepaid Expenses', v_asset_type, v_current_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '117', 'ضريبة القيمة المضافة - مدخلات', 'VAT Input', v_asset_type, v_current_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '118', 'الدفعات المقدمة للموردين', 'Supplier Advances', v_asset_type, v_current_assets, true, true, v_base_currency);

    -- الأصول الثابتة (12)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '12', 'الأصول الثابتة', 'Fixed Assets', v_asset_type, v_assets_id, false, true, v_base_currency) RETURNING id INTO v_fixed_assets;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '121', 'المباني والمستودعات', 'Buildings & Warehouses', v_asset_type, v_fixed_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '122', 'معدات المستودعات', 'Warehouse Equipment', v_asset_type, v_fixed_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '123', 'الأثاث والتجهيزات', 'Furniture & Fixtures', v_asset_type, v_fixed_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '124', 'وسائل النقل', 'Vehicles', v_asset_type, v_fixed_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '125', 'أجهزة الكمبيوتر والأنظمة', 'IT & Systems', v_asset_type, v_fixed_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '129', 'الإهلاك المتراكم', 'Accumulated Depreciation', v_asset_type, v_fixed_assets, true, true, v_base_currency);

    -- ═══ 2️⃣ الخصوم ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '2', 'الخصوم', 'Liabilities', v_liability_type, false, true, v_base_currency) RETURNING id INTO v_liabilities_id;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '21', 'الخصوم المتداولة', 'Current Liabilities', v_liability_type, v_liabilities_id, false, true, v_base_currency) RETURNING id INTO v_current_liab;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable, currency)
    VALUES (v_tenant_id, p_company_id, '211', 'دين الموردين', 'Accounts Payable', v_liability_type, v_current_liab, false, true, true, v_base_currency) RETURNING id INTO v_payable_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable, currency)
    VALUES
        (v_tenant_id, p_company_id, '2111', 'دين الموردين - رئيسي', 'Main Suppliers Payable', v_liability_type, v_payable_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '2112', 'دين الموردين - أخرى', 'Other Suppliers Payable', v_liability_type, v_payable_grp, true, true, true, v_base_currency);

    -- مقدمو خدمات الشحن (212)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '212', 'مقدمو خدمات الشحن والتوريد', 'Logistics Service Providers', v_liability_type, v_current_liab, false, true, v_base_currency) RETURNING id INTO v_logistics_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '2121', 'شركات الشحن البحري', 'Ocean Freight Companies', v_liability_type, v_logistics_grp, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '2122', 'مكاتب التخليص الجمركي', 'Customs Clearance', v_liability_type, v_logistics_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '2123', 'شركات النقل الداخلي', 'Inland Transport', v_liability_type, v_logistics_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '2124', 'شركات التأمين', 'Insurance Companies', v_liability_type, v_logistics_grp, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '2125', 'خدمات لوجستية أخرى', 'Other Logistics', v_liability_type, v_logistics_grp, true, true, v_base_currency);

    -- شركات الصرافة (2126)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_group, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '2126', 'شركات الصرافة والحوالات', 'Exchange & Remittance Companies', v_liability_type, v_logistics_grp, true, false, true, v_base_currency) RETURNING id INTO v_exchange_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_group, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '21261', 'شركة صرافة - عام', 'General Exchange Company', v_liability_type, v_exchange_grp, false, true, true, v_base_currency);

    -- باقي الخصوم المتداولة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '213', 'الرواتب المستحقة', 'Accrued Salaries', v_liability_type, v_current_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '214', 'ضريبة القيمة المضافة - مخرجات', 'VAT Output', v_liability_type, v_current_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '215', 'الدفعات المقدمة من العملاء', 'Customer Advances', v_liability_type, v_current_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '216', 'الضرائب المستحقة', 'Taxes Payable', v_liability_type, v_current_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '217', 'أوراق الدفع', 'Notes Payable', v_liability_type, v_current_liab, true, true, v_base_currency);

    -- خصوم طويلة الأجل (22)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '22', 'الخصوم طويلة الأجل', 'Long-term Liabilities', v_liability_type, v_liabilities_id, false, true, v_base_currency) RETURNING id INTO v_longterm_liab;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '221', 'القروض طويلة الأجل', 'Long-term Loans', v_liability_type, v_longterm_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '222', 'التزامات الإيجار', 'Lease Obligations', v_liability_type, v_longterm_liab, true, true, v_base_currency);

    -- ═══ 3️⃣ حقوق الملكية ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '3', 'حقوق الملكية', 'Equity', v_equity_type, false, true, v_base_currency) RETURNING id INTO v_equity_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '31', 'رأس المال', 'Capital', v_equity_type, v_equity_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '32', 'الأرباح المحتجزة', 'Retained Earnings', v_equity_type, v_equity_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '33', 'أرباح/خسائر العام', 'Current Year P/L', v_equity_type, v_equity_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '34', 'احتياطيات', 'Reserves', v_equity_type, v_equity_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '35', 'أرصدة افتتاحية', 'Opening Balance Equity', v_equity_type, v_equity_id, true, true, v_base_currency);

    -- ═══ 4️⃣ الإيرادات ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '4', 'الإيرادات', 'Revenue', v_revenue_type, false, true, v_base_currency) RETURNING id INTO v_revenue_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '41', 'المبيعات', 'Sales', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '42', 'مبيعات خدمات', 'Service Revenue', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '43', 'خصومات المبيعات', 'Sales Discounts', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '44', 'مردودات المبيعات', 'Sales Returns', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '45', 'إيرادات أخرى', 'Other Income', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '46', 'أرباح فروقات العملة', 'FX Gains', v_revenue_type, v_revenue_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '47', 'إيرادات الفوائد', 'Interest Income', v_revenue_type, v_revenue_id, true, true, v_base_currency);

    -- ═══ 5️⃣ المصروفات ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '5', 'المصروفات', 'Expenses', v_expense_type, false, true, v_base_currency) RETURNING id INTO v_expenses_id;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '51', 'تكلفة المبيعات', 'Cost of Sales', v_cogs_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_cogs_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '511', 'تكلفة المبيعات الأساسية', 'Primary COGS', v_cogs_type, v_cogs_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '512', 'تكلفة المبيعات العامة', 'General COGS', v_cogs_type, v_cogs_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '513', 'تكلفة الخدمات المباعة', 'Cost of Services', v_cogs_type, v_cogs_grp, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '52', 'المشتريات', 'Purchases', v_cogs_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_purchases_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '521', 'مشتريات عامة', 'General Purchases', v_cogs_type, v_purchases_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '522', 'مردودات المشتريات', 'Purchase Returns', v_cogs_type, v_purchases_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '523', 'خصومات المشتريات', 'Purchase Discounts', v_cogs_type, v_purchases_grp, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '53', 'مصروفات الرواتب', 'Salary Expenses', v_expense_type, v_expenses_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '54', 'مصروفات الإيجار', 'Rent Expenses', v_expense_type, v_expenses_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '55', 'مصروفات المرافق', 'Utilities', v_expense_type, v_expenses_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '56', 'مصروفات التسويق', 'Marketing Expenses', v_expense_type, v_expenses_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '57', 'مصروفات إدارية', 'Administrative Expenses', v_expense_type, v_expenses_id, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '58', 'مصاريف المشتريات والشحن', 'Purchase & Shipping Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_purch_exp_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '581', 'مصاريف الشحن', 'Shipping Expenses', v_expense_type, v_purch_exp_grp, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '582', 'مصاريف الجمركة', 'Customs Expenses', v_expense_type, v_purch_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '583', 'تأمين بحري وشحن', 'Marine & Cargo Insurance', v_expense_type, v_purch_exp_grp, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '584', 'مصاريف مشتريات أخرى', 'Other Purchase Expenses', v_expense_type, v_purch_exp_grp, true, true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '59', 'مصروفات متنوعة', 'Miscellaneous Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_misc_exp_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '591', 'خسائر فروقات العملة', 'FX Losses', v_expense_type, v_misc_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '592', 'فروق المخزون', 'Inventory Variances', v_expense_type, v_misc_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '593', 'مصروفات الصيانة', 'Maintenance Expenses', v_expense_type, v_misc_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '594', 'مصروفات التأمين', 'Insurance Expenses', v_expense_type, v_misc_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '595', 'مصروفات قانونية ومهنية', 'Legal & Professional', v_expense_type, v_misc_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '596', 'مصروفات أخرى', 'Other Expenses', v_expense_type, v_misc_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '597', 'مصروفات الإهلاك', 'Depreciation Expense', v_expense_type, v_misc_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '598', 'مصروفات البنوك', 'Bank Charges', v_expense_type, v_misc_exp_grp, true, true, v_base_currency);

    UPDATE companies SET chart_type = 'extended' WHERE id = p_company_id;
    RAISE NOTICE '✅ V6 — الشجرة الموسعة (90 حساب) بعملة محلية=% دولية=%', v_base_currency, v_intl_currency;
END;
$function$;
COMMENT ON FUNCTION create_extended_chart IS 'V6 — الشجرة الموسعة (90 حساب) مع currency ديناميكية من إعدادات الشركة';
