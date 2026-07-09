-- 20260702g — auto_set_default_accounts: تصحيح 3 بحثات حساب افتراضي فاشلة للمشتركين الجدد
-- كانت تبحث عن أكواد مجموعات (41/57/46) بشرط is_detail=true فلا تُطابق شيئاً ⇒ الإيراد/المبيعات،
-- المصروف العام، وربح فروقات العملة تبقى غير مربوطة (20/23). التصحيح: 41→411، 57→535، 46→422.
BEGIN;
CREATE OR REPLACE FUNCTION public.auto_set_default_accounts(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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

    -- 5 المبيعات — 411 (كان '41' وهو حساب مجموعة is_detail=false ⇒ لا يُطابق)
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '411' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_revenue_account_id = v_account_id, default_sales_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 6 المشتريات — 521
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '521' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_purchase_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 7 COGS — 511
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '511' AND is_detail = true AND is_active = true LIMIT 1;
    IF v_account_id IS NOT NULL THEN UPDATE company_accounting_settings SET default_cogs_account_id = v_account_id WHERE id = v_settings_id; v_count := v_count + 1; END IF;

    -- 8 المصروفات — 535 مصروفات إدارية (كان '57' وهو كود غير موجود في الشجرة الموسّعة)
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '535' AND is_detail = true AND is_active = true LIMIT 1;
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

    -- 12 FX Gains — 422 أرباح فروقات العملة (كان '46' وهو كود غير موجود)
    SELECT id INTO v_account_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '422' AND is_detail = true AND is_active = true LIMIT 1;
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
$function$

;
COMMIT;
