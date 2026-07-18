-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: حذف ناعم للقيود (عكس تلقائي مخفي) + تعديل مباشر للقيود المُرحَّلة
--            مع لقطات تدقيق  (Journal soft-delete + posted-entry direct edit)
-- Date: 2026-07-14
-- ═══════════════════════════════════════════════════════════════════════════
-- طبقة قاعدة البيانات لِمسار عمل القيود «الصديق للـSME»:
--
--   • الحذف = إخفاء عبر عكس تلقائي:
--       - مسودة (غير مُرحَّلة): تُعلَّم is_deleted فقط (لا عكس، لا أثر على الأرصدة).
--       - مُرحَّلة: يُنشأ قيد عكس تلقائي (مدين↔دائن) ويُرحَّل عبر post_journal_entry
--         القائم (فتُصفَّر الأرصدة صافياً)، ثم يُعلَّم الأصل والعكس كلاهما is_deleted،
--         ويُربط العكس.original_entry_id = الأصل.id. الدفتر يبقى غير قابل للتلاعب.
--
--   • التعديل المباشر لقيد مُرحَّل:
--       - لقطة «قبل» (الترويسة + كل الأسطر) في journal_entry_edits.
--       - تُلغى ترحلة القيد (unpost_journal_entry ← يطرح أثر الأسطر القديمة من الأرصدة)،
--         تُطبَّق تعديلات الترويسة (مفاتيح موصوفة فقط)، تُستبدل الأسطر بالكامل،
--         يُعاد الترحيل (post_journal_entry ← يضيف أثر الأسطر الجديدة + يتحقّق التوازن).
--         كامل المسار داخل معاملة الدالة الذرّية → الأرصدة تبقى صحيحة عبر نفس ماكينة
--         الترحيل القائمة (chart_of_accounts.current_balance).
--       - لقطة «بعد» + تدوين السجل.
--
--   • قفل الفترة: يُعاد استخدام آلية القفل القائمة (accounting_periods.is_closed
--     و fiscal_years.is_closed) — وهي نفسها التي يحترمها reverse_journal_entry.
--     لم نخترع journal_lock_date لأن قفلاً حقيقياً موجود سلفاً.
--
-- ملاحظات التنفيذ:
--   • كل دالة SECURITY DEFINER بـ SET search_path مطابق للأخوات.
--   • auth.uid() قد يكون NULL على النسخة المحلية (installer) — مُعالَج: حارس الشركة
--     يُتخطّى عند غياب الهوية، وأعمدة *_by تقبل NULL.
--   • DDL دفاعي (IF NOT EXISTS / CREATE OR REPLACE / فحوص information_schema) ليعمل
--     على السحابة والنسخة المحلية (Postgres 15، نفس نسب المخطط) — كأخوات 20260713*.
--   • قراءة قائمة القيود تتم مباشرةً عبر PostgREST (from('journal_entries'))، لا RPC،
--     لذا استبعاد is_deleted مسؤولية الواجهة (frontend).
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- (0) أعمدة الحذف الناعم على journal_entries (إضافة دفاعية إن غابت)
--     is_reversed / original_entry_id / reversal_entry_id موجودة سلفاً (ميزة العكس)
--     — يُعاد استخدامها، لا تُكرَّر.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.journal_entries
    ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- ضمان الأعمدة ثنائية اللغة (مضافة مباشرةً على السحابة سابقاً، ويعتمدها
-- reverse_journal_entry) — دفاعي لِتكافؤ النسخة المحلية.
ALTER TABLE public.journal_entries
    ADD COLUMN IF NOT EXISTS description_ar TEXT,
    ADD COLUMN IF NOT EXISTS description_en TEXT;

-- فهرس جزئي لاستبعاد المحذوف بسرعة عند قراءة القائمة (per company)
CREATE INDEX IF NOT EXISTS idx_journal_entries_active
    ON public.journal_entries (company_id, entry_date)
    WHERE is_deleted = false;


-- ═══════════════════════════════════════════════════════════════
-- (1) جدول سجل التعديلات: journal_entry_edits
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.journal_entry_edits (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID,
    company_id UUID,
    entry_id   UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
    edited_by  UUID,
    edited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason     TEXT,
    before     JSONB,
    after      JSONB
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_edits_entry
    ON public.journal_entry_edits (entry_id, edited_at DESC);

-- RLS متسقة مع سياسات journal_entries (auth.uid() IS NOT NULL للقراءة والكتابة)
ALTER TABLE public.journal_entry_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jee_read"  ON public.journal_entry_edits;
DROP POLICY IF EXISTS "jee_write" ON public.journal_entry_edits;

CREATE POLICY "jee_read" ON public.journal_entry_edits
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "jee_write" ON public.journal_entry_edits
    FOR ALL USING (auth.uid() IS NOT NULL);


-- ═══════════════════════════════════════════════════════════════
-- (2) حارس قفل الفترة: journal_period_is_locked
--     يُعاد استخدام آلية القفل القائمة (نفس منطق reverse_journal_entry):
--       • فترة محاسبية مطابقة لتاريخ القيد ومقفلة  → مقفل
--       • لا فترة مطابقة لكن السنة المالية للتاريخ مقفلة → مقفل
--       • غير ذلك → مفتوح
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.journal_period_is_locked(
    p_company_id UUID,
    p_date       DATE
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_period_closed BOOLEAN;
    v_found_period  BOOLEAN := false;
BEGIN
    IF p_company_id IS NULL OR p_date IS NULL THEN
        RETURN false;
    END IF;

    SELECT COALESCE(ap.is_closed, false), true
      INTO v_period_closed, v_found_period
    FROM public.accounting_periods ap
    WHERE ap.company_id = p_company_id
      AND p_date BETWEEN ap.start_date AND ap.end_date
    ORDER BY ap.start_date DESC
    LIMIT 1;

    IF v_found_period THEN
        RETURN v_period_closed;
    END IF;

    -- لا فترة مطابقة: نتحقّق من قفل السنة المالية
    RETURN EXISTS (
        SELECT 1 FROM public.fiscal_years fy
        WHERE fy.company_id = p_company_id
          AND p_date BETWEEN fy.start_date AND fy.end_date
          AND COALESCE(fy.is_closed, false) = true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.journal_period_is_locked(UUID, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.journal_period_is_locked(UUID, DATE) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- (3) الحذف الناعم: delete_journal_entry_soft
--     العقد: RETURNS jsonb → {success, error?, reversal_entry_id?}
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.delete_journal_entry_soft(
    p_entry_id UUID,
    p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_orig       public.journal_entries%ROWTYPE;
    v_user_id    UUID;
    v_new_id     UUID;
    v_new_number TEXT;
    v_line       RECORD;
    v_line_num   INT := 0;
    v_orig_deleted BOOLEAN;
    v_reason     TEXT;
BEGIN
    v_user_id := auth.uid();
    v_reason  := COALESCE(NULLIF(btrim(p_reason), ''), 'حذف');

    IF p_entry_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'رقم القيد مطلوب');
    END IF;

    -- جلب القيد مع قفل الصف
    SELECT * INTO v_orig FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'القيد غير موجود');
    END IF;

    -- حارس الشركة (يُتخطّى محلياً عند غياب الهوية)
    IF v_user_id IS NOT NULL THEN
        PERFORM public.assert_can_access_company(v_orig.company_id);
    END IF;

    -- سبق حذفه
    IF COALESCE(v_orig.is_deleted, false) = true THEN
        RETURN jsonb_build_object('success', false, 'error', 'القيد محذوف مسبقاً');
    END IF;

    -- رفض حذف «قيد عكسٍ» لأصلٍ غير محذوف (يُحذف من الأصل لا من عكسه)
    IF v_orig.original_entry_id IS NOT NULL THEN
        SELECT COALESCE(is_deleted, false) INTO v_orig_deleted
        FROM public.journal_entries WHERE id = v_orig.original_entry_id;
        IF COALESCE(v_orig_deleted, false) = false THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'هذا القيد هو قيد عكس لأصلٍ غير محذوف؛ احذف القيد الأصلي بدلاً منه');
        END IF;
    END IF;

    -- قفل الفترة (على تاريخ القيد)
    IF public.journal_period_is_locked(v_orig.company_id, v_orig.entry_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    -- ── الحالة (أ): مسودة غير مُرحَّلة → تُعلَّم محذوفة فقط (بلا عكس) ──
    IF COALESCE(v_orig.is_posted, false) = false THEN
        UPDATE public.journal_entries
        SET is_deleted    = true,
            deleted_at    = NOW(),
            deleted_by    = v_user_id,
            delete_reason = v_reason,
            updated_at    = NOW()
        WHERE id = p_entry_id;

        RETURN jsonb_build_object('success', true, 'reversal_entry_id', NULL);
    END IF;

    -- ── الحالة (ب): مُرحَّلة → عكس تلقائي + ترحيل + تعليم الاثنين محذوفَين ──
    v_new_number := 'DEL-REV-' || COALESCE(v_orig.entry_number, LEFT(p_entry_id::text, 8))
                    || '-' || to_char(clock_timestamp(), 'YYMMDDHH24MISS');

    INSERT INTO public.journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date,
        fiscal_year_id, period_id, entry_type, reference_type, reference_id,
        reference_number, description, description_ar, currency, exchange_rate,
        total_debit, total_credit, status, is_posted,
        original_entry_id, created_by, notes
    ) VALUES (
        v_orig.tenant_id, v_orig.company_id, v_orig.branch_id, v_new_number, v_orig.entry_date,
        v_orig.fiscal_year_id, v_orig.period_id, COALESCE(v_orig.entry_type, 'manual'),
        'deletion_reversal', v_orig.id,
        v_orig.entry_number,
        'عكس تلقائي للحذف: ' || COALESCE(v_orig.entry_number, '') || ' — ' || v_reason,
        'عكس تلقائي للحذف: ' || COALESCE(v_orig.entry_number, '') || ' — ' || v_reason,
        COALESCE(v_orig.currency, 'USD'), COALESCE(v_orig.exchange_rate, 1),
        COALESCE(v_orig.total_credit, 0), COALESCE(v_orig.total_debit, 0),  -- مبادلة الإجماليات
        'draft', false,
        v_orig.id, v_user_id,
        'قيد عكس تلقائي (حذف). السبب: ' || v_reason
    )
    RETURNING id INTO v_new_id;

    -- أسطر معكوسة: مدين↔دائن (نفس المبالغ/الحسابات/العملة)
    FOR v_line IN
        SELECT * FROM public.journal_entry_lines WHERE entry_id = p_entry_id ORDER BY line_number
    LOOP
        v_line_num := v_line_num + 1;
        INSERT INTO public.journal_entry_lines (
            tenant_id, entry_id, line_number, account_id,
            debit, credit, currency, exchange_rate, debit_fc, credit_fc,
            description, cost_center_id, party_type, party_id
        ) VALUES (
            v_orig.tenant_id, v_new_id, v_line_num, v_line.account_id,
            COALESCE(v_line.credit, 0), COALESCE(v_line.debit, 0),   -- المبادلة
            v_line.currency, v_line.exchange_rate,
            COALESCE(v_line.credit_fc, 0), COALESCE(v_line.debit_fc, 0),
            'عكس: ' || COALESCE(v_line.description, ''),
            v_line.cost_center_id, v_line.party_type, v_line.party_id
        );
    END LOOP;

    IF v_line_num = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'القيد الأصلي لا يحتوي على أسطر');
    END IF;

    -- ترحيل قيد العكس عبر الدالة القائمة (تُصفَّر الأرصدة صافياً)
    PERFORM public.post_journal_entry(v_new_id, v_user_id);

    -- تعليم الأصل والعكس كلاهما محذوفَين (إخفاء من القائمة)
    UPDATE public.journal_entries
    SET is_deleted    = true,
        deleted_at    = NOW(),
        deleted_by    = v_user_id,
        delete_reason = v_reason,
        -- ربط دفتري للأصل بعكسه (حقول العكس القائمة)
        is_reversed       = true,
        reversal_entry_id = v_new_id,
        reversed_at       = NOW(),
        reversed_by       = v_user_id,
        updated_at        = NOW()
    WHERE id = p_entry_id;

    UPDATE public.journal_entries
    SET is_deleted    = true,
        deleted_at    = NOW(),
        deleted_by    = v_user_id,
        delete_reason = v_reason,
        updated_at    = NOW()
    WHERE id = v_new_id;

    RETURN jsonb_build_object('success', true, 'reversal_entry_id', v_new_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_journal_entry_soft(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_journal_entry_soft(UUID, TEXT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- (4) التعديل المباشر لقيد مُرحَّل: update_posted_journal_entry
--     العقد: RETURNS jsonb → {success, error?, edit_id?}
--     المنهج: unpost (طرح أثر الأسطر القديمة) → تعديل الترويسة → استبدال الأسطر
--             → post (إضافة أثر الأسطر الجديدة + تحقّق التوازن). ذرّي.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_posted_journal_entry(
    p_entry_id UUID,
    p_header   JSONB,
    p_lines    JSONB,
    p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_entry     public.journal_entries%ROWTYPE;
    v_user_id   UUID;
    v_before    JSONB;
    v_after     JSONB;
    v_edit_id   UUID;
    v_line      JSONB;
    v_line_num  INT := 0;
    v_sum_debit  NUMERIC(18,2) := 0;
    v_sum_credit NUMERIC(18,2) := 0;
    v_new_date  DATE;
BEGIN
    v_user_id := auth.uid();

    IF p_entry_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'رقم القيد مطلوب');
    END IF;
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'الأسطر مطلوبة');
    END IF;

    -- جلب القيد مع قفل الصف
    SELECT * INTO v_entry FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'القيد غير موجود');
    END IF;

    -- حارس الشركة (يُتخطّى محلياً عند غياب الهوية)
    IF v_user_id IS NOT NULL THEN
        PERFORM public.assert_can_access_company(v_entry.company_id);
    END IF;

    IF COALESCE(v_entry.is_deleted, false) = true THEN
        RETURN jsonb_build_object('success', false, 'error', 'القيد محذوف');
    END IF;
    IF COALESCE(v_entry.is_posted, false) = false THEN
        RETURN jsonb_build_object('success', false, 'error', 'التعديل المباشر للقيود المُرحَّلة فقط');
    END IF;

    -- قفل الفترة على التاريخ القديم والجديد (إن تغيّر)
    v_new_date := COALESCE((p_header->>'entry_date')::DATE, v_entry.entry_date);
    IF public.journal_period_is_locked(v_entry.company_id, v_entry.entry_date)
       OR public.journal_period_is_locked(v_entry.company_id, v_new_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    -- تحقّق توازن الأسطر الواردة (مدين = دائن)
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        IF NULLIF(v_line->>'account_id', '') IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'كل سطر يحتاج حساباً');
        END IF;
        v_sum_debit  := v_sum_debit  + COALESCE((v_line->>'debit')::NUMERIC, 0);
        v_sum_credit := v_sum_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
    END LOOP;

    IF ABS(v_sum_debit - v_sum_credit) > 0.01 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'القيد غير متوازن (مدين: ' || v_sum_debit || '، دائن: ' || v_sum_credit || ')');
    END IF;

    -- ── لقطة «قبل»: الترويسة + كل الأسطر ──
    v_before := jsonb_build_object(
        'header', to_jsonb(v_entry),
        'lines', COALESCE(
            (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_number)
             FROM public.journal_entry_lines l WHERE l.entry_id = p_entry_id),
            '[]'::jsonb)
    );

    -- ── إلغاء الترحيل: يطرح أثر الأسطر القديمة من chart_of_accounts.current_balance ──
    PERFORM public.unpost_journal_entry(p_entry_id, NULL::uuid); -- وسيطان صراحةً: نسخة (uuid) و(uuid,uuid DEFAULT) متراكبتان والنداء الأحادي ملتبس

    -- ── تعديلات الترويسة: مفاتيح موصوفة فقط (whitelist) ──
    UPDATE public.journal_entries
    SET entry_date       = COALESCE((p_header->>'entry_date')::DATE, entry_date),
        description      = COALESCE(NULLIF(p_header->>'description', ''), description),
        description_ar   = CASE WHEN p_header ? 'description_ar' THEN p_header->>'description_ar' ELSE description_ar END,
        description_en   = CASE WHEN p_header ? 'description_en' THEN p_header->>'description_en' ELSE description_en END,
        reference_number = CASE WHEN p_header ? 'reference_number' THEN p_header->>'reference_number' WHEN p_header ? 'reference' THEN p_header->>'reference' ELSE reference_number END, -- الواجهة ترسل 'reference' والاسم الرسمي reference_number — نقبل الاثنين
        currency         = COALESCE(NULLIF(p_header->>'currency', ''), currency),
        exchange_rate    = COALESCE((p_header->>'exchange_rate')::NUMERIC, exchange_rate),
        updated_at       = NOW()
    WHERE id = p_entry_id;

    -- ── استبدال الأسطر بالكامل (حذف + إدراج) ──
    DELETE FROM public.journal_entry_lines WHERE entry_id = p_entry_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_num := v_line_num + 1;
        INSERT INTO public.journal_entry_lines (
            tenant_id, entry_id, line_number, account_id,
            debit, credit, currency, exchange_rate, debit_fc, credit_fc,
            description, cost_center_id, party_type, party_id
        ) VALUES (
            v_entry.tenant_id, p_entry_id, v_line_num,
            (v_line->>'account_id')::UUID,
            COALESCE((v_line->>'debit')::NUMERIC, 0),
            COALESCE((v_line->>'credit')::NUMERIC, 0),
            NULLIF(v_line->>'currency', ''),
            COALESCE((v_line->>'exchange_rate')::NUMERIC, 1),
            COALESCE((v_line->>'debit_fc')::NUMERIC, 0),
            COALESCE((v_line->>'credit_fc')::NUMERIC, 0),
            NULLIF(v_line->>'description', ''),
            NULLIF(v_line->>'cost_center_id', '')::UUID,
            NULLIF(v_line->>'party_type', ''),
            NULLIF(v_line->>'party_id', '')::UUID
        );
    END LOOP;
    -- ملاحظة: مُحفِّز trg_check_journal_balance يُعيد حساب total_debit/total_credit
    --         على الترويسة تلقائياً عند حذف/إدراج الأسطر.

    -- ── إعادة الترحيل: يضيف أثر الأسطر الجديدة + يتحقّق التوازن (حارس الترويسة) ──
    PERFORM public.post_journal_entry(p_entry_id, v_user_id);

    -- ── لقطة «بعد» ──
    SELECT * INTO v_entry FROM public.journal_entries WHERE id = p_entry_id;
    v_after := jsonb_build_object(
        'header', to_jsonb(v_entry),
        'lines', COALESCE(
            (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_number)
             FROM public.journal_entry_lines l WHERE l.entry_id = p_entry_id),
            '[]'::jsonb)
    );

    -- ── تدوين السجل ──
    INSERT INTO public.journal_entry_edits (
        tenant_id, company_id, entry_id, edited_by, reason, before, after
    ) VALUES (
        v_entry.tenant_id, v_entry.company_id, p_entry_id, v_user_id,
        NULLIF(btrim(p_reason), ''), v_before, v_after
    )
    RETURNING id INTO v_edit_id;

    RETURN jsonb_build_object('success', true, 'edit_id', v_edit_id);
EXCEPTION WHEN OTHERS THEN
    -- المعاملة تتراجع بالكامل عند أي خطأ (ذرّية)
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.update_posted_journal_entry(UUID, JSONB, JSONB, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.update_posted_journal_entry(UUID, JSONB, JSONB, TEXT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- (5) قراءة سجل التعديلات: get_journal_entry_edits
--     العقد: RETURNS jsonb → مصفوفة الأحدث أولاً:
--            {id, edited_at, edited_by_name, reason, before, after}
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_journal_entry_edits(
    p_entry_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_entry_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    SELECT COALESCE(jsonb_agg(row_data ORDER BY edited_at DESC), '[]'::jsonb)
      INTO v_result
    FROM (
        SELECT
            e.edited_at,
            jsonb_build_object(
                'id',             e.id,
                'edited_at',      e.edited_at,
                'edited_by_name', COALESCE(NULLIF(up.full_name, ''), 'النظام'),
                'reason',         e.reason,
                'before',         e.before,
                'after',          e.after
            ) AS row_data
        FROM public.journal_entry_edits e
        LEFT JOIN public.user_profiles up ON up.id = e.edited_by
        WHERE e.entry_id = p_entry_id
    ) t;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_journal_entry_edits(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.get_journal_entry_edits(UUID) TO authenticated;
