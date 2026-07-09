-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: عكس القيد + الإقفال السنوي (Journal Reversal & Year-End Closing)
-- Date: 2026-07-08
-- ═══════════════════════════════════════════════════════════════════════════
-- يضيف مسار عكس قيد صحيح محاسبياً (يحافظ على immutability للدفتر) وإقفالاً
-- سنوياً يرحّل صافي الربح/الخسارة للأرباح المحتجّزة ويصفّر الإيراد/المصروف.
--
-- المبادئ:
--   • العكس = قيد جديد مستقل (مدين↔دائن) يُرحَّل عبر post_journal_entry القائم؛
--     الأصل يبقى posted (لا حذف/لا unpost)، ويُعلَّم is_reversed=true فقط.
--   • أثر الرصيد الصافي للأصل + العكس = صفر على كل حساب.
--   • كل دالة SECURITY DEFINER بحارس شركة (assert_can_access_company).
--   • idempotent: عكس قيد معكوس مسبقاً / إقفال سنة مقفلة => رفض برسالة عربية.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- (1) دالة عكس القيد: reverse_journal_entry
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
    p_entry_id UUID,
    p_reason   TEXT,
    p_date     DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_orig        journal_entries%ROWTYPE;
    v_new_id      UUID;
    v_date        DATE;
    v_user_id     UUID;
    v_period_id   UUID;
    v_period      accounting_periods%ROWTYPE;
    v_line        RECORD;
    v_line_num    INT := 0;
    v_new_number  TEXT;
BEGIN
    v_user_id := auth.uid();

    IF p_entry_id IS NULL THEN
        RAISE EXCEPTION 'رقم القيد مطلوب';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'سبب العكس مطلوب';
    END IF;

    -- جلب الأصل مع قفل الصف
    SELECT * INTO v_orig FROM journal_entries WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'القيد غير موجود';
    END IF;

    -- حارس الشركة (عزل tenant)
    PERFORM assert_can_access_company(v_orig.company_id);

    -- يجب أن يكون مُرحَّلاً
    IF COALESCE(v_orig.is_posted, false) = false THEN
        RAISE EXCEPTION 'لا يمكن عكس قيد غير مُرحَّل (مسودة): %', v_orig.entry_number;
    END IF;

    -- idempotency: قيد معكوس سلفاً يُرفض
    IF COALESCE(v_orig.is_reversed, false) = true THEN
        RAISE EXCEPTION 'القيد معكوس مسبقاً (رقم العكس: %)', v_orig.reversal_entry_id;
    END IF;

    -- منع عكس قيد عكسٍ آخر (تجنّب السلاسل الملتبسة)
    IF v_orig.original_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'هذا القيد هو نفسه قيد عكس؛ لا يُعكس قيد العكس';
    END IF;

    v_date := COALESCE(p_date, CURRENT_DATE);

    -- الفترة المحاسبية لتاريخ العكس يجب أن تكون مفتوحة
    SELECT * INTO v_period
    FROM accounting_periods
    WHERE company_id = v_orig.company_id
      AND v_date BETWEEN start_date AND end_date
    ORDER BY start_date DESC
    LIMIT 1;

    IF FOUND THEN
        IF COALESCE(v_period.is_closed, false) = true THEN
            RAISE EXCEPTION 'لا يمكن العكس داخل فترة محاسبية مقفلة (%)، اختر تاريخاً في فترة مفتوحة', v_period.name;
        END IF;
        v_period_id := v_period.id;
    ELSE
        -- لا فترة مطابقة: نتحقّق أن السنة المالية غير مقفلة
        IF EXISTS (
            SELECT 1 FROM fiscal_years fy
            WHERE fy.company_id = v_orig.company_id
              AND v_date BETWEEN fy.start_date AND fy.end_date
              AND COALESCE(fy.is_closed, false) = true
        ) THEN
            RAISE EXCEPTION 'لا يمكن العكس داخل سنة مالية مقفلة، اختر تاريخاً في سنة مفتوحة';
        END IF;
        v_period_id := v_orig.period_id;
    END IF;

    -- توليد رقم القيد (نستعمل نفس تريغر generate_entry_number عبر تركه NULL؟
    -- لا: التريغر يتوقّع صيغة \d+/\d{4}؛ نولّد رقماً صريحاً مميّزاً للعكس)
    v_new_number := 'REV-' || COALESCE(v_orig.entry_number, LEFT(p_entry_id::text,8))
                    || '-' || to_char(clock_timestamp(),'YYMMDDHH24MISS');

    -- إنشاء القيد المعكوس (رأس)
    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date,
        fiscal_year_id, period_id, entry_type, reference_type, reference_id,
        reference_number, description, description_ar, currency, exchange_rate,
        total_debit, total_credit, status, is_posted,
        original_entry_id, created_by, notes
    ) VALUES (
        v_orig.tenant_id, v_orig.company_id, v_orig.branch_id, v_new_number, v_date,
        v_orig.fiscal_year_id, v_period_id, COALESCE(v_orig.entry_type,'manual'),
        'reversal', v_orig.id,
        v_orig.entry_number,
        'عكس قيد ' || COALESCE(v_orig.entry_number,'') || ' — ' || p_reason,
        'عكس قيد ' || COALESCE(v_orig.entry_number,'') || ' — ' || p_reason,
        COALESCE(v_orig.currency,'USD'), COALESCE(v_orig.exchange_rate,1),
        COALESCE(v_orig.total_credit,0), COALESCE(v_orig.total_debit,0),  -- مبادلة الإجماليات
        'draft', false,
        v_orig.id, v_user_id,
        'قيد عكس تلقائي. السبب: ' || p_reason
    )
    RETURNING id INTO v_new_id;

    -- أسطر معكوسة: مدين↔دائن
    FOR v_line IN
        SELECT * FROM journal_entry_lines WHERE entry_id = p_entry_id ORDER BY line_number
    LOOP
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id,
            debit, credit, currency, exchange_rate, debit_fc, credit_fc,
            description, cost_center_id, party_type, party_id
        ) VALUES (
            v_orig.tenant_id, v_new_id, v_line_num, v_line.account_id,
            COALESCE(v_line.credit,0), COALESCE(v_line.debit,0),   -- المبادلة
            v_line.currency, v_line.exchange_rate,
            COALESCE(v_line.credit_fc,0), COALESCE(v_line.debit_fc,0),
            'عكس: ' || COALESCE(v_line.description,''),
            v_line.cost_center_id, v_line.party_type, v_line.party_id
        );
    END LOOP;

    IF v_line_num = 0 THEN
        RAISE EXCEPTION 'القيد الأصلي لا يحتوي على أسطر';
    END IF;

    -- ترحيل القيد المعكوس عبر الدالة القائمة (تحدّث الأرصدة بأمان)
    PERFORM post_journal_entry(v_new_id, v_user_id);

    -- تعليم الأصل معكوساً (دون حذف/unpost — immutability محفوظة)
    UPDATE journal_entries
    SET is_reversed       = true,
        reversal_entry_id = v_new_id,
        reversed_at       = NOW(),
        reversed_by       = v_user_id,
        updated_at        = NOW()
    WHERE id = p_entry_id;

    RETURN jsonb_build_object(
        'success', true,
        'original_entry_id', p_entry_id,
        'reversal_entry_id', v_new_id,
        'reversal_entry_number', v_new_number,
        'reversal_date', v_date,
        'message', 'تم عكس القيد بنجاح'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_journal_entry(UUID, TEXT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(UUID, TEXT, DATE) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- (2) دالة الإقفال السنوي: close_fiscal_year
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.close_fiscal_year(
    p_company_id     UUID,
    p_fiscal_year_id UUID,
    p_reason         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_fy            fiscal_years%ROWTYPE;
    v_user_id       UUID;
    v_tenant_id     UUID;
    v_re_account    UUID;
    v_total_income  NUMERIC(18,2) := 0;   -- رصيد الإيراد (دائن موجب طبيعةً)
    v_total_expense NUMERIC(18,2) := 0;   -- رصيد المصروف (مدين موجب طبيعةً)
    v_net_profit    NUMERIC(18,2) := 0;
    v_je_id         UUID;
    v_close_number  TEXT;
    v_line_num      INT := 0;
    v_open_periods  INT := 0;
    v_last_period_end DATE;
    v_acc           RECORD;
    v_total_debit   NUMERIC(18,2) := 0;
    v_total_credit  NUMERIC(18,2) := 0;
BEGIN
    v_user_id := auth.uid();

    IF p_company_id IS NULL OR p_fiscal_year_id IS NULL THEN
        RAISE EXCEPTION 'معرّف الشركة والسنة المالية مطلوبان';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'سبب الإقفال مطلوب';
    END IF;

    -- حارس الشركة
    PERFORM assert_can_access_company(p_company_id);

    SELECT * INTO v_fy
    FROM fiscal_years
    WHERE id = p_fiscal_year_id AND company_id = p_company_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'السنة المالية غير موجودة لهذه الشركة';
    END IF;

    -- idempotency: سنة مقفلة تُرفض
    IF COALESCE(v_fy.is_closed, false) = true THEN
        RAISE EXCEPTION 'السنة المالية مقفلة مسبقاً (% ) بتاريخ %', v_fy.name, v_fy.closed_at;
    END IF;

    v_tenant_id := v_fy.tenant_id;

    -- كل فتراتها يجب أن تكون منتهية زمنياً (end_date < بداية اليوم)
    SELECT COUNT(*) INTO v_open_periods
    FROM accounting_periods
    WHERE fiscal_year_id = p_fiscal_year_id
      AND end_date >= CURRENT_DATE;
    IF v_open_periods > 0 THEN
        RAISE EXCEPTION 'لا يمكن الإقفال: توجد فترة محاسبية لم تنتهِ بعد ضمن السنة';
    END IF;

    -- حساب الأرباح المحتجّزة
    SELECT default_retained_earnings_account_id INTO v_re_account
    FROM company_accounting_settings
    WHERE company_id = p_company_id;

    IF v_re_account IS NULL THEN
        -- احتياط: البحث بكود قياسي شائع للأرباح المحتجّزة
        SELECT id INTO v_re_account
        FROM chart_of_accounts
        WHERE company_id = p_company_id
          AND is_active = true AND COALESCE(is_group,false) = false
          AND (account_code IN ('3200','320','3300','330','32000','33000')
               OR full_code IN ('3200','3300'))
        ORDER BY account_code
        LIMIT 1;
    END IF;

    IF v_re_account IS NULL THEN
        RAISE EXCEPTION 'حدّد حساب الأرباح المحتجّزة في إعدادات المحاسبة قبل الإقفال';
    END IF;

    v_close_number := 'CLOSE-' || COALESCE(v_fy.code, to_char(v_fy.end_date,'YYYY'))
                      || '-' || to_char(clock_timestamp(),'YYMMDDHH24MISS');

    -- إنشاء قيد الإقفال (رأس مؤقت، الإجماليات تُحدّث لاحقاً)
    INSERT INTO journal_entries (
        tenant_id, company_id, entry_number, entry_date,
        fiscal_year_id, entry_type, reference_type,
        description, description_ar, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by, notes
    ) VALUES (
        v_tenant_id, p_company_id, v_close_number, v_fy.end_date,
        p_fiscal_year_id, 'closing', 'year_end_closing',
        'قيد إقفال السنة المالية ' || COALESCE(v_fy.name,'') || ' — ' || p_reason,
        'قيد إقفال السنة المالية ' || COALESCE(v_fy.name,'') || ' — ' || p_reason,
        COALESCE((SELECT base_currency FROM company_accounting_settings WHERE company_id=p_company_id),'USD'),
        1, 0, 0, 'draft', false, v_user_id,
        'إقفال سنوي تلقائي. السبب: ' || p_reason
    )
    RETURNING id INTO v_je_id;

    -- تصفير كل حساب إيراد/مصروف له حركة مُرحَّلة ضمن السنة، بعكس رصيده
    -- v_bal = Σ(debit - credit) للحساب ضمن قيود السنة المُرحَّلة (اصطلاح Net Dr-Cr)
    FOR v_acc IN
        SELECT l.account_id,
               at.classification,
               SUM(l.debit - l.credit) AS net_bal
        FROM journal_entry_lines l
        JOIN journal_entries je ON je.id = l.entry_id
        JOIN chart_of_accounts coa ON coa.id = l.account_id
        JOIN account_types at ON at.id = coa.account_type_id
        WHERE je.company_id = p_company_id
          AND je.fiscal_year_id = p_fiscal_year_id
          AND je.is_posted = true
          AND at.classification IN ('income','expenses')
        GROUP BY l.account_id, at.classification
        HAVING SUM(l.debit - l.credit) <> 0
    LOOP
        v_line_num := v_line_num + 1;
        -- لتصفير الحساب نضيف سطراً بعكس صافي رصيده:
        --   إذا net_bal>0 (مدين) => نضع credit=net_bal
        --   إذا net_bal<0 (دائن) => نضع debit=-net_bal
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id,
            debit, credit, currency, exchange_rate, description
        ) VALUES (
            v_tenant_id, v_je_id, v_line_num, v_acc.account_id,
            CASE WHEN v_acc.net_bal < 0 THEN -v_acc.net_bal ELSE 0 END,
            CASE WHEN v_acc.net_bal > 0 THEN  v_acc.net_bal ELSE 0 END,
            NULL, 1,
            'تصفير ' || v_acc.classification || ' عند الإقفال'
        );

        -- الإيراد رصيده دائن (net_bal<0) والمصروف مدين (net_bal>0)
        IF v_acc.classification = 'income' THEN
            v_total_income := v_total_income + (-v_acc.net_bal);   -- موجب
        ELSE
            v_total_expense := v_total_expense + (v_acc.net_bal);  -- موجب
        END IF;
    END LOOP;

    v_net_profit := v_total_income - v_total_expense;

    -- سطر الأرباح المحتجّزة يستقبل صافي الربح/الخسارة
    -- ربح (net_profit>0): نُرحّله دائناً للمحتجّزة (credit)
    -- خسارة (net_profit<0): مديناً (debit)
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id,
        debit, credit, currency, exchange_rate, description
    ) VALUES (
        v_tenant_id, v_je_id, v_line_num, v_re_account,
        CASE WHEN v_net_profit < 0 THEN -v_net_profit ELSE 0 END,
        CASE WHEN v_net_profit > 0 THEN  v_net_profit ELSE 0 END,
        NULL, 1,
        CASE WHEN v_net_profit >= 0 THEN 'ترحيل صافي الربح للأرباح المحتجّزة'
             ELSE 'ترحيل صافي الخسارة من الأرباح المحتجّزة' END
    );

    -- تحديث إجماليات الرأس
    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
      INTO v_total_debit, v_total_credit
    FROM journal_entry_lines WHERE entry_id = v_je_id;

    UPDATE journal_entries
    SET total_debit = v_total_debit, total_credit = v_total_credit, updated_at = NOW()
    WHERE id = v_je_id;

    -- ترحيل قيد الإقفال (يصفّر الإيراد/المصروف ويحدّث المحتجّزة عبر الأرصدة)
    IF v_line_num > 0 THEN
        PERFORM post_journal_entry(v_je_id, v_user_id);
    ELSE
        -- لا حركات إيراد/مصروف — نحذف الرأس الفارغ ونكتفي بإقفال السنة
        DELETE FROM journal_entries WHERE id = v_je_id;
        v_je_id := NULL;
    END IF;

    -- إقفال السنة وفتراتها
    UPDATE fiscal_years
    SET is_closed = true, closed_at = NOW(), closed_by = v_user_id, updated_at = NOW()
    WHERE id = p_fiscal_year_id;

    UPDATE accounting_periods
    SET is_closed = true, closed_at = NOW(), closed_by = v_user_id, updated_at = NOW()
    WHERE fiscal_year_id = p_fiscal_year_id AND COALESCE(is_closed,false) = false;

    RETURN jsonb_build_object(
        'success', true,
        'fiscal_year_id', p_fiscal_year_id,
        'closing_entry_id', v_je_id,
        'closing_entry_number', v_close_number,
        'total_income', v_total_income,
        'total_expense', v_total_expense,
        'net_profit', v_net_profit,
        'retained_earnings_account_id', v_re_account,
        'message', CASE WHEN v_net_profit >= 0
                        THEN 'تم إقفال السنة بصافي ربح ' || v_net_profit
                        ELSE 'تم إقفال السنة بصافي خسارة ' || abs(v_net_profit) END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_fiscal_year(UUID, UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(UUID, UUID, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ملاحظة: منع الترحيل داخل سنة مقفلة يعتمد على is_closed المُتحقّق منه
-- في مسار الترحيل القائم (لم يُلمس). أضفنا حارساً احتياطياً غير مُلزِم أدناه
-- عبر post_journal_entry لن يُعدّل — التحقّق يُترك لطبقة الترحيل الحالية.
-- ═══════════════════════════════════════════════════════════════
