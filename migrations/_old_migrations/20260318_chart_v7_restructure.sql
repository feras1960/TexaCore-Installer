-- ═══════════════════════════════════════════════════════════════
-- V7: إعادة هيكلة الشجرة المحاسبية + حسابات الصرافة
-- 2026-03-18
-- ═══════════════════════════════════════════════════════════════
-- التغييرات:
-- 1. الإيرادات: 41(مجموعة)→411-414, 42(مجموعة)→421-423, 43=صرافة 🆕
-- 2. المصروفات: 53(مجموعة)→531-535, 54=صرافة 🆕
-- 3. أصول الصرافة: 13→131-135
-- 4. خصوم الصرافة: 23→231-233
-- 5. حذف حسابات EX-xx الخاطئة
-- 6. Triggers للوكلاء والشركاء
-- 7. Trigger مزامنة is_group ↔ is_detail
-- ═══════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════
-- 0. Trigger: مزامنة is_group = NOT is_detail تلقائياً
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_is_group_from_is_detail()
RETURNS TRIGGER AS $$
BEGIN
    NEW.is_group := NOT NEW.is_detail;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_is_group ON chart_of_accounts;
CREATE TRIGGER trg_sync_is_group
    BEFORE INSERT OR UPDATE OF is_detail ON chart_of_accounts
    FOR EACH ROW
    EXECUTE FUNCTION sync_is_group_from_is_detail();


-- ════════════════════════════════════════════════════════════
-- 1. create_simple_chart V7
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
    v_exchange_assets_id UUID;
    v_liabilities_id UUID; v_current_liab_id UUID; v_long_liab_id UUID;
    v_exchange_liab_id UUID;
    v_equity_id UUID;
    v_revenue_id UUID; v_rev_ops_id UUID; v_rev_other_id UUID; v_rev_exchange_id UUID;
    v_expenses_id UUID; v_cogs_grp UUID; v_purchases_grp UUID;
    v_opex_grp UUID; v_exchange_exp_id UUID;
    v_freight_grp UUID; v_misc_grp UUID;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Company not found: %', p_company_id; END IF;
    IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id LIMIT 1) THEN RETURN; END IF;

    -- V6: العملة الديناميكية
    SELECT COALESCE(cas.base_currency, c.default_currency, 'USD'),
           COALESCE(cas.default_international_purchase_currency, 'USD')
    INTO v_base_currency, v_intl_currency
    FROM companies c LEFT JOIN company_accounting_settings cas ON cas.company_id = c.id
    WHERE c.id = p_company_id;
    IF v_base_currency IS NULL THEN v_base_currency := 'USD'; END IF;
    IF v_intl_currency IS NULL THEN v_intl_currency := 'USD'; END IF;
    IF v_base_currency = v_intl_currency THEN v_intl_currency := v_base_currency; END IF;

    -- Account types
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

    -- 11 الأصول المتداولة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '11', 'الأصول المتداولة', 'Current Assets', v_current_asset_type, v_assets_id, false, true, v_base_currency) RETURNING id INTO v_current_assets_id;

    -- 111 الصندوق
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '111', 'الصندوق', 'Cash', v_current_asset_type, v_current_assets_id, false, true, v_base_currency) RETURNING id INTO v_cash_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_cash_account, currency)
    VALUES
        (v_tenant_id, p_company_id, '1111', 'صندوق - عملة محلية', 'Cash - Local Currency', v_current_asset_type, v_cash_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1112', 'صندوق - عملة أساسية', 'Cash - Base Currency', v_current_asset_type, v_cash_grp, true, true, true, v_intl_currency);

    -- 112 البنوك
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '112', 'البنوك', 'Banks', v_current_asset_type, v_current_assets_id, false, true, v_base_currency) RETURNING id INTO v_banks_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_bank_account, currency)
    VALUES
        (v_tenant_id, p_company_id, '1121', 'بنك - عملة محلية', 'Bank - Local Currency', v_current_asset_type, v_banks_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1122', 'بنك - عملة أساسية', 'Bank - Base Currency', v_current_asset_type, v_banks_grp, true, true, true, v_intl_currency);

    -- 113 العملاء
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
    VALUES (v_tenant_id, p_company_id, '113', 'العملاء', 'Accounts Receivable', v_current_asset_type, v_current_assets_id, false, true, true, v_base_currency);

    -- 114 المخزون
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

    -- 12 الأصول الثابتة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '12', 'الأصول الثابتة', 'Fixed Assets', v_fixed_asset_type, v_assets_id, false, true, v_base_currency) RETURNING id INTO v_fixed_assets_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '121', 'أصول ثابتة', 'Fixed Assets', v_fixed_asset_type, v_fixed_assets_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '129', 'مجمع الإهلاك', 'Accumulated Depreciation', v_fixed_asset_type, v_fixed_assets_id, true, true, v_base_currency);

    -- 🆕 13 ذمم الصرافة والحوالات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '13', 'ذمم الصرافة والحوالات', 'Exchange & Remittance Receivables', v_current_asset_type, v_assets_id, false, true, v_base_currency) RETURNING id INTO v_exchange_assets_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '131', 'ذمم حوالات صادرة', 'Outgoing Remittance Receivables', v_current_asset_type, v_exchange_assets_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '132', 'ذمم حوالات واردة', 'Incoming Remittance Receivables', v_current_asset_type, v_exchange_assets_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '133', 'ذمم رصائد الصرافة', 'Exchange Balance Receivables', v_current_asset_type, v_exchange_assets_id, true, true, v_base_currency);
    -- 134, 135 = مجموعات trigger للوكلاء/الشركاء (تُنشأ عند تفعيل الموديول)

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

    -- 🆕 23 التزامات الصرافة والحوالات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '23', 'التزامات الصرافة والحوالات', 'Exchange & Remittance Liabilities', v_current_liability_type, v_liabilities_id, false, true, v_base_currency) RETURNING id INTO v_exchange_liab_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '231', 'حوالات مستحقة للتسليم', 'Remittances Payable', v_current_liability_type, v_exchange_liab_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '232', 'ذمم الوكلاء الدائنة', 'Agent Payables', v_current_liability_type, v_exchange_liab_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '233', 'ذمم الشركاء الدائنة', 'Partner Payables', v_current_liability_type, v_exchange_liab_id, true, true, v_base_currency);

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

    -- ═══ 4️⃣ الإيرادات (V7 — مجموعات) ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '4', 'الإيرادات', 'Revenue', v_revenue_type, NULL, false, true, v_base_currency) RETURNING id INTO v_revenue_id;

    -- 41 إيرادات التشغيل (مجموعة) ← كانت مفردة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '41', 'إيرادات التشغيل والتجارة', 'Operating & Trading Revenue', v_revenue_type, v_revenue_id, false, true, v_base_currency) RETURNING id INTO v_rev_ops_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '411', 'المبيعات', 'Sales', v_revenue_type, v_rev_ops_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '414', 'مردودات المبيعات', 'Sales Returns', v_revenue_type, v_rev_ops_id, true, true, v_base_currency);

    -- 42 إيرادات أخرى (مجموعة)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '42', 'إيرادات أخرى', 'Other Revenue', v_revenue_type, v_revenue_id, false, true, v_base_currency) RETURNING id INTO v_rev_other_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '421', 'إيرادات متنوعة', 'Other Income', v_revenue_type, v_rev_other_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '422', 'أرباح فروقات العملة', 'FX Gains', v_revenue_type, v_rev_other_id, true, true, v_base_currency);

    -- 🆕 43 إيرادات الصرافة والحوالات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '43', 'إيرادات الصرافة والحوالات', 'Exchange & Remittance Revenue', v_revenue_type, v_revenue_id, false, true, v_base_currency) RETURNING id INTO v_rev_exchange_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '431', 'إيرادات عمولات صرف', 'Exchange Commission Income', v_revenue_type, v_rev_exchange_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '432', 'إيرادات عمولات حوالات', 'Remittance Commission Income', v_revenue_type, v_rev_exchange_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '433', 'أرباح فروقات عملات - صرافة', 'FX Gains - Exchange', v_revenue_type, v_rev_exchange_id, true, true, v_base_currency);

    -- ═══ 5️⃣ المصروفات (V7 — مجموعات) ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '5', 'المصروفات', 'Expenses', v_expense_type, NULL, false, true, v_base_currency) RETURNING id INTO v_expenses_id;

    -- 51 تكلفة المبيعات (كما هي)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '51', 'تكلفة المبيعات', 'Cost of Sales', v_cogs_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_cogs_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '511', 'تكلفة المبيعات', 'Cost of Sales', v_cogs_type, v_cogs_grp, true, true, v_base_currency);

    -- 52 المشتريات (كما هي)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '52', 'المشتريات', 'Purchases', v_cogs_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_purchases_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '521', 'مشتريات عامة', 'General Purchases', v_cogs_type, v_purchases_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '522', 'مردودات المشتريات', 'Purchase Returns', v_cogs_type, v_purchases_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '523', 'خصومات المشتريات', 'Purchase Discounts', v_cogs_type, v_purchases_grp, true, true, v_base_currency);

    -- 🆕 53 مصروفات تشغيلية (مجموعة) ← كانت مفردة "رواتب"
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '53', 'مصروفات تشغيلية', 'Operating Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_opex_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '531', 'الرواتب والأجور', 'Salaries & Wages', v_expense_type, v_opex_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '532', 'الإيجارات', 'Rent Expense', v_expense_type, v_opex_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '533', 'المرافق', 'Utilities', v_expense_type, v_opex_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '535', 'مصروفات إدارية', 'Administrative Expenses', v_expense_type, v_opex_grp, true, true, v_base_currency);

    -- 🆕 54 مصاريف الصرافة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '54', 'مصاريف الصرافة', 'Exchange Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_exchange_exp_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '541', 'عمولات وكلاء', 'Agent Commissions', v_expense_type, v_exchange_exp_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '542', 'عمولات شركاء', 'Partner Commissions', v_expense_type, v_exchange_exp_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '543', 'خسائر فروقات عملات', 'FX Losses - Exchange', v_expense_type, v_exchange_exp_id, true, true, v_base_currency);

    -- 58 مصاريف الشحن (كما هي)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '58', 'مصاريف المشتريات والشحن', 'Purchase & Shipping Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_freight_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '581', 'مصاريف الشحن', 'Shipping Expenses', v_expense_type, v_freight_grp, true, true, v_base_currency);

    -- 59 مصروفات متنوعة (كما هي)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '59', 'مصروفات متنوعة', 'Miscellaneous Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_misc_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '591', 'خسائر فروقات العملة', 'FX Losses', v_expense_type, v_misc_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '593', 'مصروفات الصيانة', 'Maintenance Expenses', v_expense_type, v_misc_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '596', 'مصروفات أخرى', 'Other Expenses', v_expense_type, v_misc_grp, true, true, v_base_currency);

    UPDATE companies SET chart_type = 'simple' WHERE id = p_company_id;
    RAISE NOTICE '✅ V7 — الشجرة القياسية بعملة محلية=% دولية=%', v_base_currency, v_intl_currency;
END;
$function$;
COMMENT ON FUNCTION create_simple_chart IS 'V7 — الشجرة القياسية مع مجموعات الإيرادات/المصروفات + حسابات الصرافة';


-- ════════════════════════════════════════════════════════════
-- 2. create_extended_chart V7
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
    v_asset_type UUID; v_liability_type UUID; v_equity_type UUID;
    v_revenue_type UUID; v_expense_type UUID; v_cogs_type UUID;
    v_assets_id UUID; v_current_assets UUID;
    v_cash_grp UUID; v_banks_grp UUID; v_recv_grp UUID; v_inv_grp UUID;
    v_fixed_assets UUID; v_git_grp UUID;
    v_exchange_assets UUID;
    v_liabilities_id UUID; v_current_liab UUID;
    v_payable_grp UUID; v_logistics_grp UUID; v_longterm_liab UUID;
    v_exchange_liab UUID;
    v_equity_id UUID;
    v_revenue_id UUID; v_rev_ops_id UUID; v_rev_other_id UUID; v_rev_exchange_id UUID;
    v_expenses_id UUID; v_cogs_grp UUID; v_purchases_grp UUID;
    v_opex_grp UUID; v_exchange_exp UUID;
    v_purch_exp_grp UUID; v_misc_exp_grp UUID;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'الشركة % غير موجودة', p_company_id; END IF;

    -- V7: العملة الديناميكية
    SELECT COALESCE(cas.base_currency, c.default_currency, 'USD'),
           COALESCE(cas.default_international_purchase_currency, 'USD')
    INTO v_base_currency, v_intl_currency
    FROM companies c LEFT JOIN company_accounting_settings cas ON cas.company_id = c.id
    WHERE c.id = p_company_id;
    IF v_base_currency IS NULL THEN v_base_currency := 'USD'; END IF;
    IF v_intl_currency IS NULL THEN v_intl_currency := 'USD'; END IF;
    IF v_base_currency = v_intl_currency THEN v_intl_currency := v_base_currency; END IF;

    -- Account types
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

    -- 111 الصندوق
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_cash_account, currency)
    VALUES (v_tenant_id, p_company_id, '111', 'الصندوق', 'Cash', v_asset_type, v_current_assets, false, true, true, v_base_currency) RETURNING id INTO v_cash_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_cash_account, currency)
    VALUES
        (v_tenant_id, p_company_id, '1111', 'صندوق - عملة محلية', 'Cash - Local Currency', v_asset_type, v_cash_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1112', 'صندوق - عملة أساسية', 'Cash - Base Currency', v_asset_type, v_cash_grp, true, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '1113', 'صندوق النثرية', 'Petty Cash', v_asset_type, v_cash_grp, true, true, true, v_base_currency);

    -- 112 البنوك
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_bank_account, currency)
    VALUES (v_tenant_id, p_company_id, '112', 'البنوك', 'Banks', v_asset_type, v_current_assets, false, true, true, v_base_currency) RETURNING id INTO v_banks_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_bank_account, currency)
    VALUES
        (v_tenant_id, p_company_id, '1121', 'بنك - عملة محلية', 'Bank - Local Currency', v_asset_type, v_banks_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1122', 'بنك - عملة أساسية', 'Bank - Base Currency', v_asset_type, v_banks_grp, true, true, true, v_intl_currency);

    -- 113 ذمم العملاء
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
    VALUES (v_tenant_id, p_company_id, '113', 'ذمم العملاء', 'Accounts Receivable', v_asset_type, v_current_assets, false, true, true, v_base_currency) RETURNING id INTO v_recv_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_receivable, currency)
    VALUES
        (v_tenant_id, p_company_id, '1131', 'ذمم الجملة', 'Wholesale Receivables', v_asset_type, v_recv_grp, false, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1132', 'ذمم التجزئة', 'Retail Receivables', v_asset_type, v_recv_grp, true, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1133', 'أوراق القبض', 'Notes Receivable', v_asset_type, v_recv_grp, true, true, true, v_base_currency);
    -- 📊 حساب ملخص العملاء (ظاهر في الشجرة → يفتح شيت قائمة العملاء)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_summary_account, summary_party_type, is_system, currency)
    VALUES (v_tenant_id, p_company_id, '1131-SUM', 'إجمالي ذمم العملاء', 'Total Customer Receivables', v_asset_type, (SELECT id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1131'), true, true, true, 'customer', true, v_base_currency);

    -- 114 المخزون
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '114', 'المخزون', 'Inventory', v_asset_type, v_current_assets, false, true, v_base_currency) RETURNING id INTO v_inv_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '1141', 'بضاعة جاهزة', 'Finished Goods', v_asset_type, v_inv_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '1142', 'مواد خام', 'Raw Materials', v_asset_type, v_inv_grp, true, true, v_base_currency);

    -- 115 بضاعة في الطريق
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '115', 'بضاعة في الطريق', 'Goods in Transit', v_asset_type, v_current_assets, false, true, v_intl_currency) RETURNING id INTO v_git_grp;

    -- أصول متداولة أخرى
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '116', 'مصاريف مقدمة', 'Prepaid Expenses', v_asset_type, v_current_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '117', 'ضريبة القيمة المضافة - مدخلات', 'VAT Input', v_asset_type, v_current_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '118', 'الدفعات المقدمة للموردين', 'Supplier Advances', v_asset_type, v_current_assets, true, true, v_base_currency);

    -- 12 الأصول الثابتة
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

    -- 🆕 13 ذمم الصرافة والحوالات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '13', 'ذمم الصرافة والحوالات', 'Exchange & Remittance Receivables', v_asset_type, v_assets_id, false, true, v_base_currency) RETURNING id INTO v_exchange_assets;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '131', 'ذمم حوالات صادرة', 'Outgoing Remittance Receivables', v_asset_type, v_exchange_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '132', 'ذمم حوالات واردة', 'Incoming Remittance Receivables', v_asset_type, v_exchange_assets, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '133', 'ذمم رصائد الصرافة', 'Exchange Balance Receivables', v_asset_type, v_exchange_assets, true, true, v_base_currency);
    -- 134, 135 = مجموعات trigger للوكلاء/الشركاء

    -- ═══ 2️⃣ الخصوم ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '2', 'الخصوم', 'Liabilities', v_liability_type, false, true, v_base_currency) RETURNING id INTO v_liabilities_id;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '21', 'الخصوم المتداولة', 'Current Liabilities', v_liability_type, v_liabilities_id, false, true, v_base_currency) RETURNING id INTO v_current_liab;

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable, currency)
    VALUES (v_tenant_id, p_company_id, '211', 'دين الموردين', 'Accounts Payable', v_liability_type, v_current_liab, false, true, true, v_base_currency) RETURNING id INTO v_payable_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_payable, currency)
    VALUES
        (v_tenant_id, p_company_id, '2111', 'دين الموردين - رئيسي', 'Main Suppliers Payable', v_liability_type, v_payable_grp, false, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '2112', 'دين الموردين - أخرى', 'Other Suppliers Payable', v_liability_type, v_payable_grp, true, true, true, v_base_currency);
    -- 📊 حساب ملخص الموردين
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_summary_account, summary_party_type, is_system, currency)
    VALUES (v_tenant_id, p_company_id, '2111-SUM', 'إجمالي ذمم الموردين', 'Total Supplier Payables', v_liability_type, (SELECT id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2111'), true, true, true, 'supplier', true, v_base_currency);

    -- 212 مقدمو خدمات الشحن
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '212', 'مقدمو خدمات الشحن والتوريد', 'Logistics Service Providers', v_liability_type, v_current_liab, false, true, v_base_currency) RETURNING id INTO v_logistics_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '2121', 'شركات الشحن البحري', 'Ocean Freight Companies', v_liability_type, v_logistics_grp, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '2122', 'مكاتب التخليص الجمركي', 'Customs Clearance', v_liability_type, v_logistics_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '2123', 'شركات النقل الداخلي', 'Inland Transport', v_liability_type, v_logistics_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '2124', 'شركات التأمين', 'Insurance Companies', v_liability_type, v_logistics_grp, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '2125', 'خدمات لوجستية أخرى', 'Other Logistics', v_liability_type, v_logistics_grp, true, true, v_base_currency);

    -- 213 مستحقات الموظفين (مجموعة + ملخص)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '213', 'مستحقات الموظفين', 'Employee Payables', v_liability_type, v_current_liab, false, true, v_base_currency);
    -- 📊 حساب ملخص الموظفين
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_summary_account, summary_party_type, is_system, currency)
    VALUES (v_tenant_id, p_company_id, '213-SUM', 'مستحقات الموظفين', 'Employee Payables Summary', v_liability_type, (SELECT id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '213'), true, true, true, 'employee', true, v_base_currency);

    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '214', 'ضريبة القيمة المضافة - مخرجات', 'VAT Output', v_liability_type, v_current_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '215', 'الدفعات المقدمة من العملاء', 'Customer Advances', v_liability_type, v_current_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '216', 'الضرائب المستحقة', 'Taxes Payable', v_liability_type, v_current_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '217', 'أوراق الدفع', 'Notes Payable', v_liability_type, v_current_liab, true, true, v_base_currency);

    -- 22 خصوم طويلة الأجل
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '22', 'الخصوم طويلة الأجل', 'Long-term Liabilities', v_liability_type, v_liabilities_id, false, true, v_base_currency) RETURNING id INTO v_longterm_liab;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '221', 'القروض طويلة الأجل', 'Long-term Loans', v_liability_type, v_longterm_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '222', 'التزامات الإيجار', 'Lease Obligations', v_liability_type, v_longterm_liab, true, true, v_base_currency);

    -- 🆕 23 التزامات الصرافة والحوالات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '23', 'التزامات الصرافة والحوالات', 'Exchange & Remittance Liabilities', v_liability_type, v_liabilities_id, false, true, v_base_currency) RETURNING id INTO v_exchange_liab;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '231', 'حوالات مستحقة للتسليم', 'Remittances Payable', v_liability_type, v_exchange_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '232', 'ذمم الوكلاء الدائنة', 'Agent Payables', v_liability_type, v_exchange_liab, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '233', 'ذمم الشركاء الدائنة', 'Partner Payables', v_liability_type, v_exchange_liab, true, true, v_base_currency);

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

    -- ═══ 4️⃣ الإيرادات (V7 — مجموعات) ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '4', 'الإيرادات', 'Revenue', v_revenue_type, false, true, v_base_currency) RETURNING id INTO v_revenue_id;

    -- 41 إيرادات التشغيل (مجموعة)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '41', 'إيرادات التشغيل والتجارة', 'Operating & Trading Revenue', v_revenue_type, v_revenue_id, false, true, v_base_currency) RETURNING id INTO v_rev_ops_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '411', 'المبيعات', 'Sales', v_revenue_type, v_rev_ops_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '412', 'مبيعات خدمات', 'Service Revenue', v_revenue_type, v_rev_ops_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '413', 'خصومات المبيعات', 'Sales Discounts', v_revenue_type, v_rev_ops_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '414', 'مردودات المبيعات', 'Sales Returns', v_revenue_type, v_rev_ops_id, true, true, v_base_currency);

    -- 42 إيرادات أخرى (مجموعة)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '42', 'إيرادات أخرى', 'Other Revenue', v_revenue_type, v_revenue_id, false, true, v_base_currency) RETURNING id INTO v_rev_other_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '421', 'إيرادات متنوعة', 'Other Income', v_revenue_type, v_rev_other_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '422', 'أرباح فروقات العملة', 'FX Gains', v_revenue_type, v_rev_other_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '423', 'إيرادات الفوائد', 'Interest Income', v_revenue_type, v_rev_other_id, true, true, v_base_currency);

    -- 🆕 43 إيرادات الصرافة والحوالات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '43', 'إيرادات الصرافة والحوالات', 'Exchange & Remittance Revenue', v_revenue_type, v_revenue_id, false, true, v_base_currency) RETURNING id INTO v_rev_exchange_id;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '431', 'إيرادات عمولات صرف', 'Exchange Commission Income', v_revenue_type, v_rev_exchange_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '432', 'إيرادات عمولات حوالات', 'Remittance Commission Income', v_revenue_type, v_rev_exchange_id, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '433', 'أرباح فروقات عملات - صرافة', 'FX Gains - Exchange', v_revenue_type, v_rev_exchange_id, true, true, v_base_currency);

    -- ═══ 5️⃣ المصروفات (V7 — مجموعات) ═══
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '5', 'المصروفات', 'Expenses', v_expense_type, false, true, v_base_currency) RETURNING id INTO v_expenses_id;

    -- 51 تكلفة المبيعات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '51', 'تكلفة المبيعات', 'Cost of Sales', v_cogs_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_cogs_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '511', 'تكلفة المبيعات الأساسية', 'Primary COGS', v_cogs_type, v_cogs_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '512', 'تكلفة المبيعات العامة', 'General COGS', v_cogs_type, v_cogs_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '513', 'تكلفة الخدمات المباعة', 'Cost of Services', v_cogs_type, v_cogs_grp, true, true, v_base_currency);

    -- 52 المشتريات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '52', 'المشتريات', 'Purchases', v_cogs_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_purchases_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '521', 'مشتريات عامة', 'General Purchases', v_cogs_type, v_purchases_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '522', 'مردودات المشتريات', 'Purchase Returns', v_cogs_type, v_purchases_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '523', 'خصومات المشتريات', 'Purchase Discounts', v_cogs_type, v_purchases_grp, true, true, v_base_currency);

    -- 🆕 53 مصروفات تشغيلية (مجموعة)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '53', 'مصروفات تشغيلية', 'Operating Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_opex_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '531', 'الرواتب والأجور', 'Salaries & Wages', v_expense_type, v_opex_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '532', 'الإيجارات', 'Rent Expense', v_expense_type, v_opex_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '533', 'المرافق', 'Utilities', v_expense_type, v_opex_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '534', 'التسويق', 'Marketing Expenses', v_expense_type, v_opex_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '535', 'مصروفات إدارية', 'Administrative Expenses', v_expense_type, v_opex_grp, true, true, v_base_currency);

    -- 🆕 54 مصاريف الصرافة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '54', 'مصاريف الصرافة', 'Exchange Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_exchange_exp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '541', 'عمولات وكلاء', 'Agent Commissions', v_expense_type, v_exchange_exp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '542', 'عمولات شركاء', 'Partner Commissions', v_expense_type, v_exchange_exp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '543', 'خسائر فروقات عملات', 'FX Losses - Exchange', v_expense_type, v_exchange_exp, true, true, v_base_currency);

    -- 58 مصاريف المشتريات والشحن
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES (v_tenant_id, p_company_id, '58', 'مصاريف المشتريات والشحن', 'Purchase & Shipping Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency) RETURNING id INTO v_purch_exp_grp;
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
    VALUES
        (v_tenant_id, p_company_id, '581', 'مصاريف الشحن', 'Shipping Expenses', v_expense_type, v_purch_exp_grp, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '582', 'مصاريف الجمركة', 'Customs Expenses', v_expense_type, v_purch_exp_grp, true, true, v_base_currency),
        (v_tenant_id, p_company_id, '583', 'تأمين بحري وشحن', 'Marine & Cargo Insurance', v_expense_type, v_purch_exp_grp, true, true, v_intl_currency),
        (v_tenant_id, p_company_id, '584', 'مصاريف مشتريات أخرى', 'Other Purchase Expenses', v_expense_type, v_purch_exp_grp, true, true, v_base_currency);

    -- 59 مصروفات متنوعة
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
    RAISE NOTICE '✅ V7 — الشجرة الموسعة مع مجموعات إيرادات/مصروفات + حسابات صرافة بعملة محلية=% دولية=%', v_base_currency, v_intl_currency;
END;
$function$;
COMMENT ON FUNCTION create_extended_chart IS 'V7 — الشجرة الموسعة مع مجموعات الإيرادات/المصروفات + حسابات الصرافة (13, 23, 43, 54)';


-- ════════════════════════════════════════════════════════════
-- 3. setup_exchange_accounts V7
-- يُستدعى عند تفعيل موديول الصرافة — يتأكد من وجود الحسابات
-- يُنشئ فقط الحسابات الناقصة (لا يكرر)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.setup_exchange_accounts(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_tenant_id UUID;
    v_base_currency VARCHAR(10);
    v_asset_type UUID;
    v_liability_type UUID;
    v_revenue_type UUID;
    v_expense_type UUID;
    v_assets_id UUID;
    v_liabilities_id UUID;
    v_revenue_id UUID;
    v_expenses_id UUID;
    v_parent_id UUID;
    v_created_count INT := 0;
    v_deleted_count INT := 0;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('error', 'Company not found');
    END IF;

    -- العملة الأساسية
    SELECT COALESCE(cas.base_currency, c.default_currency, 'USD')
    INTO v_base_currency
    FROM companies c LEFT JOIN company_accounting_settings cas ON cas.company_id = c.id
    WHERE c.id = p_company_id;
    IF v_base_currency IS NULL THEN v_base_currency := 'USD'; END IF;

    -- ═══ 1. حذف حسابات EX-xx القديمة ═══
    DELETE FROM chart_of_accounts
    WHERE company_id = p_company_id
      AND account_code LIKE 'EX-%';
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- Account types
    SELECT id INTO v_asset_type FROM account_types WHERE code = 'CURRENT_ASSET';
    IF v_asset_type IS NULL THEN SELECT id INTO v_asset_type FROM account_types WHERE code = 'ASSET'; END IF;
    SELECT id INTO v_liability_type FROM account_types WHERE code = 'CURRENT_LIABILITY';
    IF v_liability_type IS NULL THEN SELECT id INTO v_liability_type FROM account_types WHERE code = 'LIABILITY'; END IF;
    SELECT id INTO v_revenue_type FROM account_types WHERE code = 'REVENUE';
    SELECT id INTO v_expense_type FROM account_types WHERE code = 'EXPENSE';

    -- الحسابات الجذرية
    SELECT id INTO v_assets_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1';
    SELECT id INTO v_liabilities_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2';
    SELECT id INTO v_revenue_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '4';
    SELECT id INTO v_expenses_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '5';

    -- ═══ 2. إنشاء 13 ذمم الصرافة (إذا لم تكن موجودة) ═══
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '13') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '13', 'ذمم الصرافة والحوالات', 'Exchange & Remittance Receivables', v_asset_type, v_assets_id, false, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '13';

    -- فروع 13
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '131') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '131', 'ذمم حوالات صادرة', 'Outgoing Remittance Receivables', v_asset_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '132') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '132', 'ذمم حوالات واردة', 'Incoming Remittance Receivables', v_asset_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '133') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '133', 'ذمم رصائد الصرافة', 'Exchange Balance Receivables', v_asset_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;

    -- 134 مجموعة الوكلاء
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '134') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '134', 'حسابات الوكلاء الجارية', 'Agent Current Accounts', v_asset_type, v_parent_id, false, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;

    -- 135 مجموعة الشركاء
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '135') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '135', 'حسابات الشركاء الجارية', 'Partner Current Accounts', v_asset_type, v_parent_id, false, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;

    -- ═══ 3. إنشاء 23 التزامات الصرافة ═══
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '23') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '23', 'التزامات الصرافة والحوالات', 'Exchange & Remittance Liabilities', v_liability_type, v_liabilities_id, false, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '23';

    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '231') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '231', 'حوالات مستحقة للتسليم', 'Remittances Payable', v_liability_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '232') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '232', 'ذمم الوكلاء الدائنة', 'Agent Payables', v_liability_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '233') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '233', 'ذمم الشركاء الدائنة', 'Partner Payables', v_liability_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;

    -- ═══ 4. إنشاء 43 إيرادات الصرافة ═══
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '43') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '43', 'إيرادات الصرافة والحوالات', 'Exchange & Remittance Revenue', v_revenue_type, v_revenue_id, false, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '43';

    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '431') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '431', 'إيرادات عمولات صرف', 'Exchange Commission Income', v_revenue_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '432') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '432', 'إيرادات عمولات حوالات', 'Remittance Commission Income', v_revenue_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '433') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '433', 'أرباح فروقات عملات - صرافة', 'FX Gains - Exchange', v_revenue_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;

    -- ═══ 5. إنشاء 54 مصاريف الصرافة ═══
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '54') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '54', 'مصاريف الصرافة', 'Exchange Expenses', v_expense_type, v_expenses_id, false, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '54';

    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '541') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '541', 'عمولات وكلاء', 'Agent Commissions', v_expense_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '542') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '542', 'عمولات شركاء', 'Partner Commissions', v_expense_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '543') THEN
        INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
        VALUES (v_tenant_id, p_company_id, '543', 'خسائر فروقات عملات', 'FX Losses - Exchange', v_expense_type, v_parent_id, true, true, v_base_currency);
        v_created_count := v_created_count + 1;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'created', v_created_count,
        'deleted_ex', v_deleted_count,
        'message', 'V7 exchange accounts setup complete'
    );
END;
$function$;
COMMENT ON FUNCTION setup_exchange_accounts IS 'V7 — إعداد حسابات الصرافة (13, 23, 43, 54) + حذف EX-xx القديمة + مجموعات الوكلاء (134) والشركاء (135)';
