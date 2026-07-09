-- 20260702c — post_purchase_invoice: دعم مزدوج للجدولين (transactions + invoices)
-- التدقيق كشف أن الواجهة (PurchaseCycleList) تُنشئ المستندات في purchase_transactions
-- وتمرّر id منها، بينما الدالة كانت تقرأ purchase_invoices فقط ⇒ «الفاتورة غير موجودة».
-- (نظير ما فعله post_sales_invoice الذي يقرأ sales_transactions.)
-- الإصلاح: كشف الجدول الذي يحوي الـ id وقراءة الترويسة منه؛ منطق الحسابات والقيد لم يتغيّر.
-- الترحيل عبر الترويسة فقط (الدالة لا تقرأ سطور البنود أصلاً).

BEGIN;

CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_source     TEXT;            -- 'invoices' | 'transactions'
    v_tenant_id  UUID;
    v_company_id UUID;
    v_branch_id  UUID;
    v_supplier_id UUID;
    v_supplier_name TEXT;
    v_invoice_number TEXT;
    v_invoice_date DATE;
    v_currency   TEXT;
    v_exchange_rate NUMERIC;
    v_is_posted  BOOLEAN;
    v_je_id      UUID;
    v_user_id    UUID;
    v_account_purchases UUID;
    v_account_ap        UUID;
    v_account_tax       UUID;
    v_net_amount NUMERIC(15,4);
    v_tax_amount NUMERIC(15,4);
    v_total      NUMERIC(15,4);
    v_purch_debit NUMERIC(15,4);
    v_line_num   INT := 0;
BEGIN
    v_user_id := auth.uid();

    -- ① جلب الترويسة من purchase_invoices أولاً (مع قفل الصف)
    SELECT 'invoices', pi.tenant_id, pi.company_id, pi.branch_id, pi.supplier_id, pi.supplier_name,
           pi.invoice_number, COALESCE(pi.invoice_date, CURRENT_DATE),
           COALESCE(pi.currency, 'SAR'), COALESCE(pi.exchange_rate, 1),
           COALESCE(pi.is_posted, false), COALESCE(pi.total_amount, 0), COALESCE(pi.tax_amount, 0)
      INTO v_source, v_tenant_id, v_company_id, v_branch_id, v_supplier_id, v_supplier_name,
           v_invoice_number, v_invoice_date, v_currency, v_exchange_rate, v_is_posted, v_total, v_tax_amount
    FROM purchase_invoices pi WHERE pi.id = p_invoice_id FOR UPDATE;

    -- ② إن لم تكن هناك، جرّب purchase_transactions
    IF v_source IS NULL THEN
        SELECT 'transactions', pt.tenant_id, pt.company_id, pt.branch_id, pt.supplier_id, pt.supplier_name,
               COALESCE(pt.invoice_no, pt.draft_no, LEFT(pt.id::text, 8)), COALESCE(pt.invoice_date, pt.doc_date, CURRENT_DATE),
               COALESCE(pt.currency, 'SAR'), COALESCE(pt.exchange_rate, 1),
               COALESCE(pt.is_posted, false), COALESCE(pt.total_amount, 0), COALESCE(pt.tax_amount, 0)
          INTO v_source, v_tenant_id, v_company_id, v_branch_id, v_supplier_id, v_supplier_name,
               v_invoice_number, v_invoice_date, v_currency, v_exchange_rate, v_is_posted, v_total, v_tax_amount
        FROM purchase_transactions pt WHERE pt.id = p_invoice_id FOR UPDATE;
    END IF;

    IF v_source IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
    END IF;

    PERFORM assert_can_access_company(v_company_id);   -- عزل المستأجر

    IF v_is_posted = true THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة مُرحَّلة مسبقاً');
    END IF;

    v_net_amount := v_total - v_tax_amount;

    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'مبلغ الفاتورة صفر');
    END IF;

    -- ── الحسابات (المنطق كما هو) ──
    SELECT id INTO v_account_purchases FROM chart_of_accounts
    WHERE company_id = v_company_id
      AND account_code IN ('521', '5100', '5000', '52', '1400')
      AND COALESCE(is_group, false) = false
    ORDER BY CASE account_code WHEN '521' THEN 0 WHEN '5100' THEN 1 WHEN '5000' THEN 2 ELSE 3 END LIMIT 1;
    IF v_account_purchases IS NULL THEN
        SELECT id INTO v_account_purchases FROM chart_of_accounts
        WHERE company_id = v_company_id AND account_code IN ('521','5100','5000','52','1400')
        ORDER BY CASE account_code WHEN '521' THEN 0 WHEN '5100' THEN 1 WHEN '5000' THEN 2 ELSE 3 END LIMIT 1;
    END IF;

    IF v_supplier_id IS NOT NULL THEN
        SELECT id INTO v_account_ap FROM chart_of_accounts
        WHERE company_id = v_company_id AND is_party_account = true
          AND party_type = 'supplier' AND party_id = v_supplier_id LIMIT 1;
    END IF;
    IF v_account_ap IS NULL THEN
        SELECT id INTO v_account_ap FROM chart_of_accounts
        WHERE company_id = v_company_id
          AND COALESCE(is_payable, false) = true
          AND COALESCE(is_group, false) = false
        ORDER BY account_code LIMIT 1;
    END IF;
    IF v_account_ap IS NULL THEN
        SELECT id INTO v_account_ap FROM chart_of_accounts
        WHERE company_id = v_company_id
          AND account_code IN ('2112', '2111', '211', '2100', '2000')
          AND COALESCE(is_group, false) = false
        ORDER BY CASE account_code WHEN '2112' THEN 0 WHEN '2100' THEN 1 ELSE 2 END LIMIT 1;
    END IF;

    IF v_tax_amount > 0 THEN
        SELECT id INTO v_account_tax FROM chart_of_accounts
        WHERE company_id = v_company_id
          AND account_code IN ('1190', '1180', '1510', '1500', '119')
          AND COALESCE(is_group, false) = false
        ORDER BY CASE account_code WHEN '1190' THEN 0 WHEN '1180' THEN 1 WHEN '1510' THEN 2 ELSE 3 END LIMIT 1;
    END IF;

    IF v_account_purchases IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'لم يُعثر على حساب المشتريات (5100/5000/1400)', 'invoice_id', p_invoice_id);
    END IF;
    IF v_account_ap IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'لم يُعثر على حساب الذمم الدائنة (2100/2000)', 'invoice_id', p_invoice_id);
    END IF;

    v_purch_debit := CASE WHEN v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN v_net_amount ELSE v_total END;

    -- ── تحديث حالة المستند على الجدول المصدر ──
    IF v_source = 'invoices' THEN
        UPDATE purchase_invoices
        SET status = 'posted', is_posted = true, posted_at = NOW(), updated_at = NOW()
        WHERE id = p_invoice_id;
    ELSE
        UPDATE purchase_transactions
        SET stage = 'posted', is_posted = true, posted_at = NOW(), posted_by = v_user_id, updated_at = NOW()
        WHERE id = p_invoice_id;
    END IF;

    -- ── القيد ──
    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_date, entry_type, description,
        reference_type, reference_id, reference_number, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by
    ) VALUES (
        v_tenant_id, v_company_id, v_branch_id,
        v_invoice_date, 'auto',
        'فاتورة مشتريات — ' || COALESCE(v_invoice_number, ''),
        'purchase_invoice', p_invoice_id, v_invoice_number,
        v_currency, v_exchange_rate,
        v_total, v_total, 'draft', false, v_user_id
    ) RETURNING id INTO v_je_id;

    -- مدين: المشتريات
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
    VALUES (v_tenant_id, v_je_id, v_line_num, v_account_purchases,
            'مشتريات — ' || COALESCE(v_invoice_number, ''), v_purch_debit, 0, v_purch_debit, 0);

    -- مدين: ضريبة المدخلات
    IF v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_tenant_id, v_je_id, v_line_num, v_account_tax,
                'ضريبة مدخلات — ' || COALESCE(v_invoice_number, ''), v_tax_amount, 0, v_tax_amount, 0);
    END IF;

    -- دائن: الذمم الدائنة
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc, party_type, party_id)
    VALUES (v_tenant_id, v_je_id, v_line_num, v_account_ap,
            'ذمم دائنة — ' || COALESCE(v_supplier_name, '') || ' — ' || COALESCE(v_invoice_number, ''),
            0, v_total, 0, v_total, 'supplier', v_supplier_id);

    PERFORM post_journal_entry(v_je_id, v_user_id);

    IF v_source = 'invoices' THEN
        UPDATE purchase_invoices SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    ELSE
        UPDATE purchase_transactions SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true, 'invoice_id', p_invoice_id, 'invoice_number', v_invoice_number,
        'journal_entry_id', v_je_id, 'total_amount', v_total, 'tax_amount', v_tax_amount,
        'source', v_source,
        'message', 'تم ترحيل فاتورة المشتريات بنجاح'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE, 'invoice_id', p_invoice_id);
END;
$function$;

COMMIT;
