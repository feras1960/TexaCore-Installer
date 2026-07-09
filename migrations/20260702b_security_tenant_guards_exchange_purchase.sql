-- 20260702b — تحصين أمني: حراس المستأجر على دوال SECURITY DEFINER المكشوفة
-- التدقيق الشامل 2026-07-02 كشف 3 دوال definer تأخذ company_id/account_id من العميل
-- بلا أي تحقق من صلاحية الوصول، وكلها ممنوحة لدور authenticated ⇒ عبور مستأجرين.
--   1) setup_exchange_accounts(p_company_id)      — تحذف/تعيد زرع حسابات EX-% لأي شركة
--   2) get_account_balance_fc(p_account_id, p_company_id) — تقرأ أرصدة حسابات أي شركة
--   3) update_purchase_document_status_bypass_rls(...)   — تعدّل حالة مستندات مشتريات أي شركة
-- الإصلاح: إضافة assert_can_access_company(...) في مقدّمة كل دالة. الحارس نفسه يمرّر
-- service_role وplatform_admin وسياق psql المباشر، فلا يكسر الكرون أو الإدارة.

BEGIN;

-- ═══ 1) setup_exchange_accounts — حارس على p_company_id ═══
CREATE OR REPLACE FUNCTION public.setup_exchange_accounts(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
    DECLARE
        v_tenant_id UUID;
        v_base_currency VARCHAR(3);
        v_parent_id UUID;
        v_asset_type UUID;
        v_liability_type UUID;
        v_revenue_type UUID;
        v_expense_type UUID;
        v_assets_id UUID;
        v_liabilities_id UUID;
        v_revenue_id UUID;
        v_expenses_id UUID;
        v_created_count INT := 0;
        v_deleted_count INT := 0;
        v_133_id UUID;
        v_134_id UUID;
        v_135_id UUID;
    BEGIN
        -- 🔒 حارس عبور المستأجرين (يمرّر service_role/platform_admin/psql)
        PERFORM public.assert_can_access_company(p_company_id);

        SELECT tenant_id, default_currency INTO v_tenant_id, v_base_currency
        FROM companies WHERE id = p_company_id;

        IF v_tenant_id IS NULL THEN
            RAISE EXCEPTION 'الشركة غير موجودة';
        END IF;

        IF v_base_currency IS NULL THEN
            v_base_currency := 'USD';
        END IF;

        SELECT id INTO v_asset_type FROM account_types WHERE code = 'ASSET' LIMIT 1;
        SELECT id INTO v_liability_type FROM account_types WHERE code = 'LIABILITY' LIMIT 1;
        SELECT id INTO v_revenue_type FROM account_types WHERE code = 'REVENUE' LIMIT 1;
        SELECT id INTO v_expense_type FROM account_types WHERE code = 'EXPENSE' LIMIT 1;

        SELECT id INTO v_assets_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1';
        SELECT id INTO v_liabilities_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2';
        SELECT id INTO v_revenue_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '4';
        SELECT id INTO v_expenses_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '5';

        UPDATE company_accounting_settings
        SET default_bank_account_id = NULL,
            default_cash_account_id = CASE
              WHEN default_cash_account_id IN (SELECT id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code IN ('1121', '1122', '1123', '2121', '2122', '2123', '412', '512', '513'))
              THEN NULL ELSE default_cash_account_id END
        WHERE company_id = p_company_id
          AND default_bank_account_id IN (
            SELECT id FROM chart_of_accounts
            WHERE company_id = p_company_id
              AND account_code IN ('1121', '1122', '1123', '2121', '2122', '2123', '412', '512', '513')
          );

        DELETE FROM chart_of_accounts
        WHERE company_id = p_company_id
          AND account_code IN ('1121', '1122', '1123', '2121', '2122', '2123', '412', '512', '513')
          AND NOT EXISTS (SELECT 1 FROM journal_entry_lines WHERE account_id = chart_of_accounts.id);

        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

        -- ═══ 13 أصول الصرافة ═══
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '13') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
            VALUES (v_tenant_id, p_company_id, '13', 'ذمم الصرافة والحوالات', 'Exchange & Remittance Receivables', v_asset_type, v_assets_id, false, true, v_base_currency);
            v_created_count := v_created_count + 1;
        END IF;
        SELECT id INTO v_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '13';

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
            VALUES (v_tenant_id, p_company_id, '133', 'حسابات زبائن الصرافة', 'Exchange Customer Accounts', v_asset_type, v_parent_id, false, true, v_base_currency);
            v_created_count := v_created_count + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '134') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
            VALUES (v_tenant_id, p_company_id, '134', 'حسابات الوكلاء الجارية', 'Agent Current Accounts', v_asset_type, v_parent_id, false, true, v_base_currency);
            v_created_count := v_created_count + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '135') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
            VALUES (v_tenant_id, p_company_id, '135', 'حسابات الشركاء الجارية', 'Partner Current Accounts', v_asset_type, v_parent_id, false, true, v_base_currency);
            v_created_count := v_created_count + 1;
        END IF;

        SELECT id INTO v_133_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '133';
        SELECT id INTO v_134_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '134';
        SELECT id INTO v_135_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '135';

        IF v_133_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '133-SUM') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
            VALUES (v_tenant_id, p_company_id, '133-SUM', 'إجمالي ذمم زبائن الصرافة', 'Total Exchange Customer Receivables', v_asset_type, v_133_id, true, true, v_base_currency);
            v_created_count := v_created_count + 1;
        END IF;
        IF v_134_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '134-SUM') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
            VALUES (v_tenant_id, p_company_id, '134-SUM', 'إجمالي حسابات الوكلاء', 'Total Agent Accounts', v_asset_type, v_134_id, true, true, v_base_currency);
            v_created_count := v_created_count + 1;
        END IF;
        IF v_135_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '135-SUM') THEN
            INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
            VALUES (v_tenant_id, p_company_id, '135-SUM', 'إجمالي حسابات الشركاء', 'Total Partner Accounts', v_asset_type, v_135_id, true, true, v_base_currency);
            v_created_count := v_created_count + 1;
        END IF;

        -- ═══ 23 التزامات الصرافة ═══
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

        -- ═══ 43 إيرادات الصرافة ═══
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

        -- ═══ 54 مصاريف الصرافة ═══
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
            'message', 'V7 exchange accounts setup complete with correct currency column'
        );
    END;
    $function$;

-- ═══ 2) get_account_balance_fc — حارس على الشركة (بلا أي تغيير في منطق الحساب) ═══
-- الجسم الأصلي محفوظ حرفياً؛ أُضيف سطر واحد فقط في account_info:
-- can_access_company(coa.company_id) — لغير المصرّح تصبح account_info فارغة ⇒ صفر صفوف
-- (لا تسريب رصيد عبر المستأجرين)، بلا كسر السلوك للمستخدم الشرعي.
CREATE OR REPLACE FUNCTION public.get_account_balance_fc(p_account_id uuid, p_company_id uuid)
 RETURNS TABLE(total_debit numeric, total_credit numeric, balance numeric, currency text, transaction_count bigint, last_activity date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
WITH
account_info AS (
    SELECT
        coa.id,
        COALESCE(coa.currency, c.default_currency, 'USD') AS account_currency
    FROM chart_of_accounts coa
    LEFT JOIN companies c ON c.id = coa.company_id
    WHERE coa.id = p_account_id
      AND coa.company_id = p_company_id
      AND public.can_access_company(coa.company_id)  -- 🔒 حارس عبور المستأجرين
),
currency_check AS (
    SELECT
        COUNT(DISTINCT jel.currency) AS num_currencies
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.account_id = p_account_id
      AND jel.currency IS NOT NULL
      AND jel.currency != ''
),
mixed_base AS (
    SELECT jel.currency AS base_currency
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.account_id = p_account_id
      AND jel.currency IS NOT NULL
      AND jel.currency != ''
      AND COALESCE(jel.exchange_rate, 1) = 1
    GROUP BY jel.currency
    ORDER BY COUNT(*) DESC
    LIMIT 1
),
posted_lines AS (
    SELECT
        CASE
            WHEN jel.debit_fc IS NOT NULL AND jel.debit_fc > 0 THEN jel.debit_fc
            WHEN COALESCE(jel.exchange_rate, 1) > 1 THEN jel.debit / jel.exchange_rate
            ELSE jel.debit
        END AS fc_debit,
        CASE
            WHEN jel.credit_fc IS NOT NULL AND jel.credit_fc > 0 THEN jel.credit_fc
            WHEN COALESCE(jel.exchange_rate, 1) > 1 THEN jel.credit / jel.exchange_rate
            ELSE jel.credit
        END AS fc_credit,
        jel.debit AS base_debit,
        jel.credit AS base_credit,
        je.entry_date
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.account_id = p_account_id
)
SELECT
    COALESCE(SUM(pl.fc_debit), 0)::NUMERIC AS total_debit,
    COALESCE(SUM(pl.fc_credit), 0)::NUMERIC AS total_credit,
    CASE
        WHEN (SELECT num_currencies FROM currency_check) > 1 THEN
            (COALESCE(SUM(pl.base_debit), 0) - COALESCE(SUM(pl.base_credit), 0))::NUMERIC
        ELSE
            (COALESCE(SUM(pl.fc_debit), 0) - COALESCE(SUM(pl.fc_credit), 0))::NUMERIC
    END AS balance,
    CASE
        WHEN (SELECT num_currencies FROM currency_check) > 1 THEN
            COALESCE(
                (SELECT base_currency FROM mixed_base),
                (SELECT default_currency FROM companies WHERE id = p_company_id),
                'USD'
            )
        ELSE ai.account_currency
    END::TEXT AS currency,
    COUNT(*)::BIGINT AS transaction_count,
    MAX(pl.entry_date)::DATE AS last_activity
FROM account_info ai
LEFT JOIN posted_lines pl ON true
GROUP BY ai.account_currency;
$function$;

-- ═══ 3) update_purchase_document_status_bypass_rls — حارس على الشركة المالكة للمستند ═══
CREATE OR REPLACE FUNCTION public.update_purchase_document_status_bypass_rls(p_table text, p_id uuid, p_status text, p_receipt_id uuid, p_receipt_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_company_id uuid;
BEGIN
    IF p_table = 'purchase_orders' THEN
        SELECT company_id INTO v_company_id FROM purchase_orders WHERE id = p_id;
        PERFORM public.assert_can_access_company(v_company_id);  -- 🔒
        UPDATE purchase_orders SET status = p_status, updated_at = NOW() WHERE id = p_id;
    ELSIF p_table = 'purchase_invoices' THEN
        SELECT company_id INTO v_company_id FROM purchase_invoices WHERE id = p_id;
        PERFORM public.assert_can_access_company(v_company_id);  -- 🔒
        UPDATE purchase_invoices SET status = p_status, updated_at = NOW() WHERE id = p_id;
    END IF;
END;
$function$;

COMMIT;
