-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: تعميم نمط الحذف الناعم/التعديل المدقَّق من القيود إلى مستندات
--            المرحلة الأولى (Document soft-delete + audited edit — Phase 1)
-- Date: 2026-07-14
-- ═══════════════════════════════════════════════════════════════════════════
-- يعمّم نمط 20260714100000 (القيود) على أربعة أنواع مستندات:
--
--   • 'sales_invoice'    → sales_transactions   (الجدول الموحّد النشط؛ الترحيل عبر
--       post_sales_invoice؛ الربط journal_entry_id + cost_entry_id للتكلفة إن وُجد.
--       الجدول القديم sales_invoices ميّت للكتابة لكنه لا يزال يُقرأ في
--       get_dashboard_recent_activity — لذلك تُعكَس الأعلام على صفّه التوأم
--       (نفس الـid عبر تريغر المزامنة القديم) ليختفي من اللوحة أيضاً).
--   • 'purchase_invoice' → purchase_invoices + purchase_transactions (ثنائي:
--       post_purchase_invoice يقرأ purchase_invoices أولاً ثم transactions —
--       نعتمد نفس الأسبقية «invoices أولاً» ونعكس الأعلام على التوأم إن وُجد).
--   • 'payment_voucher'  → payment_vouchers  (القيد يُنشأ بتريغر
--       create_payment_voucher_journal_entry عند status='confirmed').
--   • 'payment_receipt'  → payment_receipts  (تريغر مماثل + مزامنة paid_amount
--       على الفاتورة عبر trg_sync_invoice_paid_from_receipts).
--
--   • الحذف = delete_document_soft:
--       - غير مُرحَّل/غير مؤكَّد: تُعلَّم is_deleted فقط.
--       - مُرحَّل/مؤكَّد: يُعكس القيد المرتبط عبر public.reverse_journal_entry
--         القائمة (uuid, text, date DEFAULT NULL) — ويُعكس قيد التكلفة
--         cost_entry_id أيضاً إن وُجد — ثم يُعلَّم المستند «ملغى» (مفردات النوع)
--         + is_deleted، ويُخفى القيد الأصلي وعكسه (is_deleted) اتساقاً مع نمط
--         حذف القيود (الدفتر يبقى سليماً؛ الأثر الصافي صفر).
--       - حارس التبعيات (منع لا تتالي): سندات قبض مؤكَّدة مربوطة بفاتورة البيع،
--         سندات صرف مؤكَّدة مربوطة بفاتورة الشراء، مرتجعات/تسليمات تشير للفاتورة
--         → error:'has_dependents' + blocking_dependents [{type, doc_number}].
--
--   • التعديل = update_posted_document:
--       - لقطة «قبل» (ترويسة + أسطر) في document_edits.
--       - مفاتيح بسيطة (ملاحظات/مرجع/تواريخ آمنة) = UPDATE موصوف مباشر.
--       - تغيير مالي = عكس القيد ← تطبيق التعديلات ← إعادة الترحيل عبر نفس
--         ماكينة الترحيل (post_sales_invoice / post_purchase_invoice، وللسندات:
--         تصفير journal_entry_id داخل نفس UPDATE فيُنشئ التريغر القائم قيداً
--         جديداً من القيم الجديدة). ذرّي بالكامل.
--         ⚠️ هذا يُصلح علّة السندات المعروفة: التريغر يرجع مبكراً عندما
--         journal_entry_id IS NOT NULL فكان أي UPDATE لاحق للمبلغ يفكّ التزامن
--         مع القيد — الآن يمرّ التعديل المالي حصراً عبر عكسٍ + إعادة إنشاء.
--       - لقطة «بعد» + تدوين السجل.
--
--   • قفل الفترة: يُعاد استخدام public.journal_period_is_locked (من 20260714100000)
--     على تاريخ المستند. reverse_journal_entry يتحقّق بدوره من فترة تاريخ العكس.
--
-- ملاحظات التنفيذ (كالأخوات):
--   • كل دالة SECURITY DEFINER بـ SET search_path مطابق.
--   • auth.uid() قد يكون NULL محلياً (installer) — حارس الشركة يُتخطّى عند
--     غياب الهوية، وأعمدة *_by تقبل NULL.
--   • DDL دفاعي (IF NOT EXISTS / CREATE OR REPLACE / to_regclass /
--     information_schema) ليعمل على السحابة والنسخة المحلية.
--   • جداول المرتجعات (sales_returns / purchase_returns) لا يوجد CREATE TABLE
--     لها في هذا المستودع — فحص تبعياتها ديناميكي بالكامل (to_regclass +
--     information_schema) كي لا تفشل الدالة إن غابت محلياً.
--   • قراءة قوائم المستندات تتم عبر PostgREST مباشرةً — استبعاد is_deleted
--     في القوائم مسؤولية الواجهة؛ هنا نُحدّث فقط get_dashboard_recent_activity.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- (0) أعمدة الحذف الناعم على جداول المستندات (إضافة دفاعية إن غابت)
--     تشمل sales_invoices القديم لأن لوحة «النشاط الأخير» تقرأه —
--     الأعلام تُعكس عليه ليختفي المستند من اللوحة أيضاً.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.sales_transactions
    ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.purchase_invoices
    ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.purchase_transactions
    ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.payment_vouchers
    ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.payment_receipts
    ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- التوأم القديم المقروء في لوحة النشاط فقط
ALTER TABLE public.sales_invoices
    ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- فهارس جزئية لاستبعاد المحذوف بسرعة عند قراءة القوائم (per company)
CREATE INDEX IF NOT EXISTS idx_sales_transactions_active
    ON public.sales_transactions (company_id, doc_date)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_active
    ON public.purchase_invoices (company_id, invoice_date)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_purchase_transactions_active
    ON public.purchase_transactions (company_id, doc_date)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_payment_vouchers_active
    ON public.payment_vouchers (company_id, voucher_date)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_payment_receipts_active
    ON public.payment_receipts (company_id, receipt_date)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_active
    ON public.sales_invoices (company_id, invoice_date)
    WHERE is_deleted = false;


-- ═══════════════════════════════════════════════════════════════
-- (1) جدول سجل تعديلات المستندات: document_edits
--     (مرآة journal_entry_edits مع doc_type/doc_id بدل entry_id —
--      بلا FK لأن doc_id يشير لجداول متعددة)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.document_edits (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID,
    company_id UUID,
    doc_type   TEXT NOT NULL,
    doc_id     UUID NOT NULL,
    edited_by  UUID,
    edited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason     TEXT,
    before     JSONB,
    after      JSONB
);

CREATE INDEX IF NOT EXISTS idx_document_edits_doc
    ON public.document_edits (doc_type, doc_id, edited_at DESC);

-- RLS متسقة مع journal_entry_edits (auth.uid() IS NOT NULL للقراءة والكتابة)
ALTER TABLE public.document_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "de_read"  ON public.document_edits;
DROP POLICY IF EXISTS "de_write" ON public.document_edits;

CREATE POLICY "de_read" ON public.document_edits
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "de_write" ON public.document_edits
    FOR ALL USING (auth.uid() IS NOT NULL);


-- ═══════════════════════════════════════════════════════════════
-- (2) مساعد داخلي: doc_reverse_linked_je
--     يعكس قيداً مرتبطاً بمستند عبر reverse_journal_entry القائمة ثم يُخفي
--     الأصل والعكس (is_deleted) اتساقاً مع نمط حذف القيود.
--     يتسامح: قيد غائب/غير مُرحَّل/معكوس مسبقاً/هو نفسه قيد عكس → NULL بلا خطأ.
--     داخلي فقط (يُستدعى من دوال definer) — لا GRANT لأحد.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_reverse_linked_je(
    p_je_id   UUID,
    p_reason  TEXT,
    p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_je     public.journal_entries%ROWTYPE;
    v_res    JSONB;
    v_rev_id UUID;
BEGIN
    IF p_je_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_je FROM public.journal_entries WHERE id = p_je_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- غير مُرحَّل (مسودة): لا أثر على الأرصدة — يكفي إخفاؤه
    IF COALESCE(v_je.is_posted, false) = false THEN
        UPDATE public.journal_entries
        SET is_deleted = true, deleted_at = NOW(), deleted_by = p_user_id,
            delete_reason = p_reason, updated_at = NOW()
        WHERE id = p_je_id;
        RETURN NULL;
    END IF;

    -- معكوس مسبقاً أو هو نفسه قيد عكس: الأثر الصافي معالج سلفاً — إخفاء فقط
    IF COALESCE(v_je.is_reversed, false) = true OR v_je.original_entry_id IS NOT NULL THEN
        UPDATE public.journal_entries
        SET is_deleted = true, deleted_at = NOW(), deleted_by = p_user_id,
            delete_reason = p_reason, updated_at = NOW()
        WHERE id = p_je_id;
        RETURN v_je.reversal_entry_id;
    END IF;

    -- العكس داخلياً (نمط delete_journal_entry_soft حرفياً) — ⚠️ لا نستدعي
    -- reverse_journal_entry القائمة: حارسها assert_can_access_company غير
    -- متسامح مع auth.uid()=NULL فيرفض على النسخة المحلية (installer).
    DECLARE
        v_new_number TEXT;
        v_line       public.journal_entry_lines%ROWTYPE;
        v_line_num   INT := 0;
    BEGIN
        v_new_number := 'DEL-REV-' || COALESCE(v_je.entry_number, LEFT(p_je_id::text, 8))
                        || '-' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS');

        INSERT INTO public.journal_entries (
            tenant_id, company_id, branch_id, entry_number, entry_date,
            fiscal_year_id, period_id, entry_type, reference_type, reference_id,
            reference_number, description, description_ar, currency, exchange_rate,
            total_debit, total_credit, status, is_posted,
            original_entry_id, created_by, notes
        ) VALUES (
            v_je.tenant_id, v_je.company_id, v_je.branch_id, v_new_number, v_je.entry_date,
            v_je.fiscal_year_id, v_je.period_id, COALESCE(v_je.entry_type, 'manual'),
            'deletion_reversal', v_je.id,
            v_je.entry_number,
            'عكس تلقائي للحذف: ' || COALESCE(v_je.entry_number, '') || ' — ' || COALESCE(p_reason, ''),
            'عكس تلقائي للحذف: ' || COALESCE(v_je.entry_number, '') || ' — ' || COALESCE(p_reason, ''),
            COALESCE(v_je.currency, 'USD'), COALESCE(v_je.exchange_rate, 1),
            COALESCE(v_je.total_credit, 0), COALESCE(v_je.total_debit, 0),
            'draft', false,
            v_je.id, p_user_id,
            'قيد عكس تلقائي (حذف مستند). السبب: ' || COALESCE(p_reason, '')
        )
        RETURNING id INTO v_rev_id;

        FOR v_line IN
            SELECT * FROM public.journal_entry_lines WHERE entry_id = p_je_id ORDER BY line_number
        LOOP
            v_line_num := v_line_num + 1;
            INSERT INTO public.journal_entry_lines (
                tenant_id, entry_id, line_number, account_id,
                debit, credit, currency, exchange_rate, debit_fc, credit_fc,
                description, cost_center_id, party_type, party_id
            ) VALUES (
                v_je.tenant_id, v_rev_id, v_line_num, v_line.account_id,
                COALESCE(v_line.credit, 0), COALESCE(v_line.debit, 0),
                v_line.currency, v_line.exchange_rate,
                COALESCE(v_line.credit_fc, 0), COALESCE(v_line.debit_fc, 0),
                'عكس: ' || COALESCE(v_line.description, ''),
                v_line.cost_center_id, v_line.party_type, v_line.party_id
            );
        END LOOP;

        IF v_line_num = 0 THEN
            RAISE EXCEPTION 'القيد المرتبط % بلا أسطر — لا يمكن عكسه', v_je.entry_number;
        END IF;

        PERFORM public.post_journal_entry(v_rev_id, p_user_id);

        -- ربط الأصل بعكسه (حقول العكس القائمة)
        UPDATE public.journal_entries
        SET is_reversed = true, reversal_entry_id = v_rev_id,
            reversed_at = NOW(), reversed_by = p_user_id
        WHERE id = p_je_id;
    END;

    -- إخفاء الأصل والعكس معاً (نمط delete_journal_entry_soft)
    UPDATE public.journal_entries
    SET is_deleted = true, deleted_at = NOW(), deleted_by = p_user_id,
        delete_reason = p_reason, updated_at = NOW()
    WHERE id IN (p_je_id, v_rev_id);

    RETURN v_rev_id;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_reverse_linked_je(UUID, TEXT, UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (3) الحذف الناعم: delete_document_soft
--     العقد: RETURNS jsonb →
--            {success, error?, reversal_je_id?, blocking_dependents?}
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.delete_document_soft(
    p_doc_type TEXT,
    p_doc_id   UUID,
    p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_user_id  UUID;
    v_reason   TEXT;
    v_deps     JSONB := '[]'::jsonb;
    v_rec      RECORD;
    v_rev_id   UUID;
    v_rev_cogs UUID;
    -- sales
    v_st       public.sales_transactions%ROWTYPE;
    -- purchase (ثنائي)
    v_pi       public.purchase_invoices%ROWTYPE;
    v_pt       public.purchase_transactions%ROWTYPE;
    v_pi_found BOOLEAN := false;
    v_pt_found BOOLEAN := false;
    -- payments
    v_pv       public.payment_vouchers%ROWTYPE;
    v_pr       public.payment_receipts%ROWTYPE;
    -- مشترك
    v_company  UUID;
    v_doc_date DATE;
    v_posted   BOOLEAN := false;
    v_label    TEXT;
    v_je_id    UUID;
    v_cost_je  UUID;
BEGIN
    v_user_id := auth.uid();
    v_reason  := COALESCE(NULLIF(btrim(p_reason), ''), 'حذف');

    IF p_doc_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'رقم المستند مطلوب');
    END IF;
    IF p_doc_type IS NULL OR p_doc_type NOT IN
       ('sales_invoice', 'purchase_invoice', 'payment_voucher', 'payment_receipt') THEN
        RETURN jsonb_build_object('success', false, 'error',
            'نوع مستند غير مدعوم: ' || COALESCE(p_doc_type, 'NULL'));
    END IF;

    -- ═════════════════ فاتورة مبيعات (sales_transactions) ═════════════════
    IF p_doc_type = 'sales_invoice' THEN
        SELECT * INTO v_st FROM public.sales_transactions WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_st.company_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_st.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
        END IF;

        v_doc_date := COALESCE(v_st.invoice_date, v_st.doc_date, v_st.created_at::date);
        IF public.journal_period_is_locked(v_company, v_doc_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label  := COALESCE(v_st.invoice_no, v_st.draft_no, LEFT(p_doc_id::text, 8));
        v_posted := COALESCE(v_st.is_posted, false)
                    OR v_st.stage IN ('posted', 'partial_paid', 'paid');

        -- ── حارس التبعيات (منع، لا تتالي) ──
        -- سندات قبض مؤكَّدة مربوطة (العمود النشط sales_transaction_id — 20260617h)
        FOR v_rec IN
            SELECT COALESCE(receipt_number, LEFT(id::text, 8)) AS dn
            FROM public.payment_receipts
            WHERE sales_transaction_id = p_doc_id
              AND status = 'confirmed'
              AND COALESCE(is_deleted, false) = false
        LOOP
            v_deps := v_deps || jsonb_build_object('type', 'payment_receipt', 'doc_number', v_rec.dn);
        END LOOP;

        -- سندات قبض عبر العمود القديم sales_invoice_id (ديناميكي — قد يغيب محلياً)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'payment_receipts'
                     AND column_name = 'sales_invoice_id') THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(receipt_number, LEFT(id::text, 8)) AS dn
                 FROM public.payment_receipts
                 WHERE sales_invoice_id = $1 AND sales_transaction_id IS DISTINCT FROM $1
                   AND status = ''confirmed'' AND COALESCE(is_deleted, false) = false'
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'payment_receipt', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        -- سندات صرف تشير للفاتورة (أعمدة اختيارية — ديناميكي)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'payment_vouchers'
                     AND column_name = 'sales_invoice_id') THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(voucher_number, LEFT(id::text, 8)) AS dn
                 FROM public.payment_vouchers
                 WHERE sales_invoice_id = $1
                   AND status = ''confirmed'' AND COALESCE(is_deleted, false) = false'
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'payment_voucher', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'payment_vouchers'
                     AND column_name = 'sales_order_id') THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(voucher_number, LEFT(id::text, 8)) AS dn
                 FROM public.payment_vouchers
                 WHERE sales_order_id = $1
                   AND status = ''confirmed'' AND COALESCE(is_deleted, false) = false'
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'payment_voucher', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        -- مرتجعات مبيعات (جدول قد يغيب محلياً — ديناميكي بالكامل)
        IF to_regclass('public.sales_returns') IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'sales_returns'
                         AND column_name = 'invoice_id') THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(return_number, LEFT(id::text, 8)) AS dn
                 FROM public.sales_returns
                 WHERE invoice_id = $1 AND COALESCE(status, '''') <> ''cancelled'''
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'sales_return', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        -- مرتجعات موحّدة (صف مبيعات مرتجع يشير للأصل)
        FOR v_rec IN
            SELECT COALESCE(invoice_no, draft_no, LEFT(id::text, 8)) AS dn
            FROM public.sales_transactions
            WHERE original_transaction_id = p_doc_id
              AND COALESCE(is_return, false) = true
              AND COALESCE(is_deleted, false) = false
              AND stage <> 'cancelled'
        LOOP
            v_deps := v_deps || jsonb_build_object('type', 'sales_return', 'doc_number', v_rec.dn);
        END LOOP;

        -- إشعارات تسليم تشير للمعاملة
        FOR v_rec IN
            SELECT COALESCE(note_number, LEFT(id::text, 8)) AS dn
            FROM public.delivery_notes
            WHERE sales_order_id = p_doc_id
              AND COALESCE(status, '') <> 'cancelled'
        LOOP
            v_deps := v_deps || jsonb_build_object('type', 'delivery_note', 'doc_number', v_rec.dn);
        END LOOP;

        IF jsonb_array_length(v_deps) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'has_dependents',
                                      'blocking_dependents', v_deps);
        END IF;

        -- ── الحالة (أ): غير مُرحَّلة → تعليم فقط ──
        IF NOT v_posted THEN
            UPDATE public.sales_transactions
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason, updated_at = NOW()
            WHERE id = p_doc_id;

            -- التوأم القديم (نفس الـid عبر تريغر المزامنة) — للوحة النشاط
            UPDATE public.sales_invoices
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason
            WHERE id = p_doc_id;

            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
        END IF;

        -- ── الحالة (ب): مُرحَّلة → عكس القيد (+قيد التكلفة) ثم إلغاء+تعليم ──
        v_rev_id   := public.doc_reverse_linked_je(
                          v_st.journal_entry_id,
                          'حذف فاتورة مبيعات ' || v_label || ' — ' || v_reason,
                          v_user_id);
        IF v_st.cost_entry_id IS NOT NULL
           AND v_st.cost_entry_id IS DISTINCT FROM v_st.journal_entry_id THEN
            v_rev_cogs := public.doc_reverse_linked_je(
                              v_st.cost_entry_id,
                              'حذف فاتورة مبيعات ' || v_label || ' (قيد التكلفة) — ' || v_reason,
                              v_user_id);
        END IF;

        UPDATE public.sales_transactions
        SET stage = 'cancelled',
            cancelled_by = v_user_id,
            cancelled_at = NOW(),
            cancellation_reason = v_reason,
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        UPDATE public.sales_invoices
        SET status = 'cancelled',
            cancelled_at = NOW(), cancelled_by = v_user_id, cancel_reason = v_reason,
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id,
                                  'cogs_reversal_je_id', v_rev_cogs);
    END IF;

    -- ═════════════════ فاتورة مشتريات (ثنائي الجدولين) ═════════════════
    IF p_doc_type = 'purchase_invoice' THEN
        -- الأسبقية كما في post_purchase_invoice: purchase_invoices أولاً
        SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_doc_id FOR UPDATE;
        v_pi_found := FOUND;
        SELECT * INTO v_pt FROM public.purchase_transactions WHERE id = p_doc_id FOR UPDATE;
        v_pt_found := FOUND;

        IF NOT v_pi_found AND NOT v_pt_found THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        IF v_pi_found THEN
            v_company  := v_pi.company_id;
            v_doc_date := COALESCE(v_pi.invoice_date, v_pi.created_at::date);
            v_label    := COALESCE(v_pi.invoice_number, LEFT(p_doc_id::text, 8));
            v_posted   := COALESCE(v_pi.is_posted, false) OR v_pi.journal_entry_id IS NOT NULL;
            v_je_id    := v_pi.journal_entry_id;
            IF COALESCE(v_pi.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
            END IF;
        ELSE
            v_company  := v_pt.company_id;
            v_doc_date := COALESCE(v_pt.invoice_date, v_pt.doc_date, v_pt.created_at::date);
            v_label    := COALESCE(v_pt.invoice_no, v_pt.draft_no, LEFT(p_doc_id::text, 8));
            v_posted   := COALESCE(v_pt.is_posted, false)
                          OR v_pt.stage IN ('posted', 'partial_paid', 'paid');
            v_je_id    := v_pt.journal_entry_id;
            IF COALESCE(v_pt.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
            END IF;
        END IF;

        -- التوأم يكمل معلومة الترحيل إن غابت عن الصف القانوني
        IF v_pt_found AND v_je_id IS NULL THEN
            v_je_id  := v_pt.journal_entry_id;
            v_posted := v_posted OR COALESCE(v_pt.is_posted, false)
                        OR v_pt.stage IN ('posted', 'partial_paid', 'paid');
        END IF;

        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF public.journal_period_is_locked(v_company, v_doc_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        -- ── حارس التبعيات ──
        -- سندات صرف مربوطة بالفاتورة (purchase_invoice_id — 20260428100000)
        FOR v_rec IN
            SELECT COALESCE(voucher_number, LEFT(id::text, 8)) AS dn
            FROM public.payment_vouchers
            WHERE purchase_invoice_id = p_doc_id
              AND status = 'confirmed'
              AND COALESCE(is_deleted, false) = false
        LOOP
            v_deps := v_deps || jsonb_build_object('type', 'payment_voucher', 'doc_number', v_rec.dn);
        END LOOP;

        -- مرتجعات مشتريات (جدول/عمود ربط غير موثّقين بالمستودع — ديناميكي)
        IF to_regclass('public.purchase_returns') IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'purchase_returns'
                         AND column_name = 'invoice_id') THEN
                FOR v_rec IN EXECUTE
                    'SELECT COALESCE(return_number, LEFT(id::text, 8)) AS dn
                     FROM public.purchase_returns
                     WHERE invoice_id = $1 AND COALESCE(status, '''') <> ''cancelled'''
                    USING p_doc_id
                LOOP
                    v_deps := v_deps || jsonb_build_object('type', 'purchase_return', 'doc_number', v_rec.dn);
                END LOOP;
            ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'purchase_returns'
                            AND column_name = 'purchase_invoice_id') THEN
                FOR v_rec IN EXECUTE
                    'SELECT COALESCE(return_number, LEFT(id::text, 8)) AS dn
                     FROM public.purchase_returns
                     WHERE purchase_invoice_id = $1 AND COALESCE(status, '''') <> ''cancelled'''
                    USING p_doc_id
                LOOP
                    v_deps := v_deps || jsonb_build_object('type', 'purchase_return', 'doc_number', v_rec.dn);
                END LOOP;
            END IF;
        END IF;

        -- مرتجعات موحّدة (صف مشتريات مرتجع يشير للأصل)
        FOR v_rec IN
            SELECT COALESCE(invoice_no, draft_no, LEFT(id::text, 8)) AS dn
            FROM public.purchase_transactions
            WHERE original_transaction_id = p_doc_id
              AND COALESCE(is_return, false) = true
              AND COALESCE(is_deleted, false) = false
              AND stage <> 'cancelled'
        LOOP
            v_deps := v_deps || jsonb_build_object('type', 'purchase_return', 'doc_number', v_rec.dn);
        END LOOP;

        IF jsonb_array_length(v_deps) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'has_dependents',
                                      'blocking_dependents', v_deps);
        END IF;

        -- ── الحالة (أ): غير مُرحَّلة → تعليم فقط (على التوأمين) ──
        IF NOT v_posted THEN
            IF v_pi_found THEN
                UPDATE public.purchase_invoices
                SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                    delete_reason = v_reason, updated_at = NOW()
                WHERE id = p_doc_id;
            END IF;
            IF v_pt_found THEN
                UPDATE public.purchase_transactions
                SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                    delete_reason = v_reason, updated_at = NOW()
                WHERE id = p_doc_id;
            END IF;
            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
        END IF;

        -- ── الحالة (ب): مُرحَّلة → عكس القيد ثم إلغاء+تعليم (على التوأمين) ──
        v_rev_id := public.doc_reverse_linked_je(
                        v_je_id,
                        'حذف فاتورة مشتريات ' || v_label || ' — ' || v_reason,
                        v_user_id);

        IF v_pi_found THEN
            UPDATE public.purchase_invoices
            SET status = 'cancelled',
                is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason, updated_at = NOW()
            WHERE id = p_doc_id;
        END IF;
        IF v_pt_found THEN
            UPDATE public.purchase_transactions
            SET stage = 'cancelled',
                cancelled_by = v_user_id,
                cancelled_at = NOW(),
                cancellation_reason = v_reason,
                is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason, updated_at = NOW()
            WHERE id = p_doc_id;
        END IF;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id);
    END IF;

    -- ═════════════════ سند صرف (payment_vouchers) ═════════════════
    IF p_doc_type = 'payment_voucher' THEN
        SELECT * INTO v_pv FROM public.payment_vouchers WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_pv.company_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_pv.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
        END IF;

        IF public.journal_period_is_locked(v_company, v_pv.voucher_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label  := COALESCE(v_pv.voucher_number, LEFT(p_doc_id::text, 8));
        v_posted := (v_pv.status = 'confirmed');

        -- السندات بلا تبعيات (حسب العقد)

        IF NOT v_posted THEN
            -- ملاحظة: UPDATE يمرّ عبر تريغر القيد لكن NEW.status <> 'confirmed' → آمن
            UPDATE public.payment_vouchers
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason
            WHERE id = p_doc_id;
            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
        END IF;

        v_rev_id := public.doc_reverse_linked_je(
                        v_pv.journal_entry_id,
                        'حذف سند صرف ' || v_label || ' — ' || v_reason,
                        v_user_id);

        -- status='cancelled' يجعل التريغر يرجع مبكراً (NEW.status <> 'confirmed')
        UPDATE public.payment_vouchers
        SET status = 'cancelled',
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id);
    END IF;

    -- ═════════════════ سند قبض (payment_receipts) ═════════════════
    IF p_doc_type = 'payment_receipt' THEN
        SELECT * INTO v_pr FROM public.payment_receipts WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_pr.company_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_pr.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
        END IF;

        IF public.journal_period_is_locked(v_company, v_pr.receipt_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label  := COALESCE(v_pr.receipt_number, LEFT(p_doc_id::text, 8));
        v_posted := (v_pr.status = 'confirmed');

        IF NOT v_posted THEN
            UPDATE public.payment_receipts
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason
            WHERE id = p_doc_id;
            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
        END IF;

        v_rev_id := public.doc_reverse_linked_je(
                        v_pr.journal_entry_id,
                        'حذف سند قبض ' || v_label || ' — ' || v_reason,
                        v_user_id);

        -- الإلغاء يمرّ عبر trg_sync_invoice_paid_from_receipts (AFTER UPDATE)
        -- فيعاد احتساب paid_amount على الفاتورة المرتبطة تلقائياً (يستثني غير المؤكَّد)
        UPDATE public.payment_receipts
        SET status = 'cancelled',
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id);
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'نوع مستند غير مدعوم');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_document_soft(TEXT, UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_document_soft(TEXT, UUID, TEXT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- (4) التعديل المدقَّق لمستند مُرحَّل/مؤكَّد: update_posted_document
--     العقد: RETURNS jsonb → {success, error?, edit_id?}
--     المنهج:
--       • مفاتيح بسيطة فقط + بلا p_lines → UPDATE موصوف مباشر.
--       • تغيير مالي (p_lines أو مفتاح مالي) → عكس القيد (مخفيّاً) ← تطبيق
--         التعديلات/استبدال الأسطر ← إعادة الترحيل عبر نفس ماكينة الترحيل. ذرّي.
--       • للسندات: تصفير journal_entry_id داخل نفس UPDATE يجعل التريغر القائم
--         يُنشئ قيداً جديداً من القيم الجديدة → يُصلح علّة فكّ التزامن.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_posted_document(
    p_doc_type TEXT,
    p_doc_id   UUID,
    p_header   JSONB,
    p_lines    JSONB DEFAULT NULL,
    p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_user_id   UUID;
    v_header    JSONB;
    v_before    JSONB;
    v_after     JSONB;
    v_edit_id   UUID;
    v_line      JSONB;
    v_line_num  INT := 0;
    v_financial BOOLEAN := false;
    v_res       JSONB;
    v_rev_id    UUID;
    -- sales
    v_st        public.sales_transactions%ROWTYPE;
    -- purchase
    v_pi        public.purchase_invoices%ROWTYPE;
    v_pt        public.purchase_transactions%ROWTYPE;
    v_pi_found  BOOLEAN := false;
    v_pt_found  BOOLEAN := false;
    -- payments
    v_pv        public.payment_vouchers%ROWTYPE;
    v_pr        public.payment_receipts%ROWTYPE;
    -- مشترك
    v_company   UUID;
    v_tenant    UUID;
    v_old_date  DATE;
    v_new_date  DATE;
    v_label     TEXT;
    -- إجماليات محسوبة من الأسطر
    v_sub       NUMERIC(18,4) := 0;
    v_disc      NUMERIC(18,4) := 0;
    v_tax       NUMERIC(18,4) := 0;
    v_total     NUMERIC(18,4) := 0;
    v_l_sub     NUMERIC(18,4);
    v_l_disc    NUMERIC(18,4);
    v_l_tax     NUMERIC(18,4);
    v_qty       NUMERIC(18,4);
    v_price     NUMERIC(18,4);
BEGIN
    v_user_id := auth.uid();
    v_header  := COALESCE(p_header, '{}'::jsonb);

    IF p_doc_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'رقم المستند مطلوب');
    END IF;
    IF p_doc_type IS NULL OR p_doc_type NOT IN
       ('sales_invoice', 'purchase_invoice', 'payment_voucher', 'payment_receipt') THEN
        RETURN jsonb_build_object('success', false, 'error',
            'نوع مستند غير مدعوم: ' || COALESCE(p_doc_type, 'NULL'));
    END IF;
    IF p_lines IS NOT NULL AND
       (jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'الأسطر إن أُرسلت يجب أن تكون مصفوفة غير فارغة');
    END IF;

    -- ═════════════════ فاتورة مبيعات ═════════════════
    IF p_doc_type = 'sales_invoice' THEN
        SELECT * INTO v_st FROM public.sales_transactions WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_st.company_id;
        v_tenant  := v_st.tenant_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_st.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
        END IF;
        IF COALESCE(v_st.is_posted, false) = false
           AND v_st.stage NOT IN ('posted', 'partial_paid', 'paid') THEN
            RETURN jsonb_build_object('success', false, 'error',
                'التعديل المباشر للمستندات المُرحَّلة فقط — عدّل المسودة مباشرةً');
        END IF;

        v_old_date := COALESCE(v_st.invoice_date, v_st.doc_date, v_st.created_at::date);
        v_new_date := COALESCE((v_header->>'invoice_date')::date, v_old_date);
        IF public.journal_period_is_locked(v_company, v_old_date)
           OR public.journal_period_is_locked(v_company, v_new_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label := COALESCE(v_st.invoice_no, v_st.draft_no, LEFT(p_doc_id::text, 8));

        v_financial := (p_lines IS NOT NULL) OR (v_header ?| ARRAY[
            'currency', 'exchange_rate', 'shipping_amount',
            'subtotal', 'discount_amount', 'tax_amount', 'total_amount'
        ]);

        -- ── لقطة «قبل» ──
        v_before := jsonb_build_object(
            'header', to_jsonb(v_st),
            'lines', COALESCE(
                (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_number)
                 FROM public.sales_transaction_items i WHERE i.transaction_id = p_doc_id),
                '[]'::jsonb)
        );

        IF NOT v_financial THEN
            -- ── مفاتيح بسيطة موصوفة فقط ──
            UPDATE public.sales_transactions
            SET invoice_date     = COALESCE((v_header->>'invoice_date')::date, invoice_date),
                due_date         = COALESCE((v_header->>'due_date')::date, due_date),
                notes            = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                internal_notes   = CASE WHEN v_header ? 'internal_notes' THEN v_header->>'internal_notes' ELSE internal_notes END,
                shipping_address = CASE WHEN v_header ? 'shipping_address' THEN v_header->>'shipping_address' ELSE shipping_address END,
                shipping_method  = CASE WHEN v_header ? 'shipping_method' THEN v_header->>'shipping_method' ELSE shipping_method END,
                tracking_number  = CASE WHEN v_header ? 'tracking_number' THEN v_header->>'tracking_number' ELSE tracking_number END,
                updated_by       = COALESCE(v_user_id, updated_by),
                updated_at       = NOW()
            WHERE id = p_doc_id;
        ELSE
            -- ── مسار مالي: عكس ← تعديل ← إعادة ترحيل ──
            v_rev_id := public.doc_reverse_linked_je(
                            v_st.journal_entry_id,
                            'تعديل فاتورة مبيعات ' || v_label || ' — ' ||
                            COALESCE(NULLIF(btrim(p_reason), ''), 'تعديل'),
                            v_user_id);
            IF v_st.cost_entry_id IS NOT NULL
               AND v_st.cost_entry_id IS DISTINCT FROM v_st.journal_entry_id THEN
                PERFORM public.doc_reverse_linked_je(
                            v_st.cost_entry_id,
                            'تعديل فاتورة مبيعات ' || v_label || ' (قيد التكلفة)',
                            v_user_id);
            END IF;

            -- تعديلات الترويسة (موصوفة) + فكّ حالة الترحيل استعداداً لإعادة الترحيل
            UPDATE public.sales_transactions
            SET journal_entry_id = NULL,
                cost_entry_id    = NULL,
                is_posted        = false,
                stage            = 'invoice',
                invoice_date     = COALESCE((v_header->>'invoice_date')::date, invoice_date),
                due_date         = COALESCE((v_header->>'due_date')::date, due_date),
                notes            = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                internal_notes   = CASE WHEN v_header ? 'internal_notes' THEN v_header->>'internal_notes' ELSE internal_notes END,
                shipping_address = CASE WHEN v_header ? 'shipping_address' THEN v_header->>'shipping_address' ELSE shipping_address END,
                shipping_method  = CASE WHEN v_header ? 'shipping_method' THEN v_header->>'shipping_method' ELSE shipping_method END,
                tracking_number  = CASE WHEN v_header ? 'tracking_number' THEN v_header->>'tracking_number' ELSE tracking_number END,
                currency         = COALESCE(NULLIF(v_header->>'currency', ''), currency),
                exchange_rate    = COALESCE((v_header->>'exchange_rate')::numeric, exchange_rate),
                shipping_amount  = COALESCE((v_header->>'shipping_amount')::numeric, shipping_amount),
                updated_by       = COALESCE(v_user_id, updated_by),
                updated_at       = NOW()
            WHERE id = p_doc_id;

            -- استبدال الأسطر بالكامل (إن أُرسلت) + إعادة حساب إجماليات الترويسة
            IF p_lines IS NOT NULL THEN
                DELETE FROM public.sales_transaction_items WHERE transaction_id = p_doc_id;

                FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
                LOOP
                    v_line_num := v_line_num + 1;
                    v_qty   := COALESCE((v_line->>'quantity')::numeric, 0);
                    v_price := COALESCE((v_line->>'unit_price')::numeric, 0);
                    v_l_sub := v_qty * v_price;
                    v_l_disc := CASE
                        WHEN COALESCE((v_line->>'discount_percent')::numeric, 0) > 0
                        THEN v_l_sub * (v_line->>'discount_percent')::numeric / 100
                        ELSE COALESCE((v_line->>'discount_amount')::numeric, 0)
                    END;
                    v_l_tax := (v_l_sub - v_l_disc) * COALESCE((v_line->>'tax_rate')::numeric, 0) / 100;

                    INSERT INTO public.sales_transaction_items (
                        transaction_id, line_number,
                        product_id, material_id, item_code, description, description_ar,
                        quantity, delivered_qty, unit,
                        unit_price, discount_amount, discount_percent,
                        tax_rate, tax_amount, subtotal, total,
                        color_id, color_name, roll_id, roll_code, rolls_count,
                        warehouse_id, cost_price, notes
                    ) VALUES (
                        p_doc_id, v_line_num,
                        NULLIF(v_line->>'product_id', '')::uuid,
                        NULLIF(v_line->>'material_id', '')::uuid,
                        NULLIF(v_line->>'item_code', ''),
                        NULLIF(v_line->>'description', ''),
                        NULLIF(v_line->>'description_ar', ''),
                        v_qty,
                        COALESCE((v_line->>'delivered_qty')::numeric, v_qty),
                        COALESCE(NULLIF(v_line->>'unit', ''), 'piece'),
                        v_price,
                        round(v_l_disc, 2),
                        COALESCE((v_line->>'discount_percent')::numeric, 0),
                        COALESCE((v_line->>'tax_rate')::numeric, 0),
                        round(v_l_tax, 2),
                        round(v_l_sub, 2),
                        round(v_l_sub - v_l_disc + v_l_tax, 2),
                        NULLIF(v_line->>'color_id', '')::uuid,
                        NULLIF(v_line->>'color_name', ''),
                        NULLIF(v_line->>'roll_id', '')::uuid,
                        NULLIF(v_line->>'roll_code', ''),
                        (v_line->>'rolls_count')::int,
                        NULLIF(v_line->>'warehouse_id', '')::uuid,
                        (v_line->>'cost_price')::numeric,
                        NULLIF(v_line->>'notes', '')
                    );

                    v_sub  := v_sub  + v_l_sub;
                    v_disc := v_disc + v_l_disc;
                    v_tax  := v_tax  + v_l_tax;
                END LOOP;

                -- الترويسة من الأسطر الجديدة (post_sales_invoice يقرأها في مسار
                -- «بلا كميات مسلَّمة»، ويعيد اشتقاقها بنفسه في مسار المسلَّم)
                UPDATE public.sales_transactions
                SET subtotal        = round(v_sub, 2),
                    discount_amount = round(v_disc, 2),
                    tax_amount      = round(v_tax, 2),
                    total_amount    = round(v_sub - v_disc + v_tax, 2)
                                      + GREATEST(COALESCE(shipping_amount, 0), 0),
                    updated_at      = NOW()
                WHERE id = p_doc_id;
            END IF;

            -- إعادة الترحيل عبر نفس الماكينة القائمة
            v_res := public.post_sales_invoice(p_doc_id);
            IF COALESCE((v_res->>'success')::boolean, false) = false THEN
                RAISE EXCEPTION 'فشل إعادة الترحيل: %', COALESCE(v_res->>'error', 'خطأ غير معروف');
            END IF;
        END IF;

        -- ── لقطة «بعد» + مرآة التوأم القديم (لوحة النشاط) ──
        SELECT * INTO v_st FROM public.sales_transactions WHERE id = p_doc_id;
        v_after := jsonb_build_object(
            'header', to_jsonb(v_st),
            'lines', COALESCE(
                (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_number)
                 FROM public.sales_transaction_items i WHERE i.transaction_id = p_doc_id),
                '[]'::jsonb)
        );

        UPDATE public.sales_invoices
        SET subtotal        = v_st.subtotal,
            discount_amount = v_st.discount_amount,
            tax_amount      = v_st.tax_amount,
            total_amount    = v_st.total_amount,
            currency        = COALESCE(v_st.currency, currency),
            invoice_date    = COALESCE(v_st.invoice_date, invoice_date),
            notes           = v_st.notes,
            updated_at      = NOW()
        WHERE id = p_doc_id;

    -- ═════════════════ فاتورة مشتريات (ثنائي) ═════════════════
    ELSIF p_doc_type = 'purchase_invoice' THEN
        SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_doc_id FOR UPDATE;
        v_pi_found := FOUND;
        SELECT * INTO v_pt FROM public.purchase_transactions WHERE id = p_doc_id FOR UPDATE;
        v_pt_found := FOUND;

        IF NOT v_pi_found AND NOT v_pt_found THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        IF v_pi_found THEN
            v_company  := v_pi.company_id;
            v_tenant   := v_pi.tenant_id;
            v_old_date := COALESCE(v_pi.invoice_date, v_pi.created_at::date);
            v_label    := COALESCE(v_pi.invoice_number, LEFT(p_doc_id::text, 8));
            IF COALESCE(v_pi.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
            END IF;
            IF COALESCE(v_pi.is_posted, false) = false AND v_pi.journal_entry_id IS NULL THEN
                RETURN jsonb_build_object('success', false, 'error',
                    'التعديل المباشر للمستندات المُرحَّلة فقط — عدّل المسودة مباشرةً');
            END IF;
        ELSE
            v_company  := v_pt.company_id;
            v_tenant   := v_pt.tenant_id;
            v_old_date := COALESCE(v_pt.invoice_date, v_pt.doc_date, v_pt.created_at::date);
            v_label    := COALESCE(v_pt.invoice_no, v_pt.draft_no, LEFT(p_doc_id::text, 8));
            IF COALESCE(v_pt.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
            END IF;
            IF COALESCE(v_pt.is_posted, false) = false AND v_pt.journal_entry_id IS NULL THEN
                RETURN jsonb_build_object('success', false, 'error',
                    'التعديل المباشر للمستندات المُرحَّلة فقط — عدّل المسودة مباشرةً');
            END IF;
        END IF;

        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        v_new_date := COALESCE((v_header->>'invoice_date')::date, v_old_date);
        IF public.journal_period_is_locked(v_company, v_old_date)
           OR public.journal_period_is_locked(v_company, v_new_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        -- invoice_date مالي هنا: post_purchase_invoice يجعله تاريخ القيد
        v_financial := (p_lines IS NOT NULL) OR (v_header ?| ARRAY[
            'currency', 'exchange_rate', 'invoice_date',
            'subtotal', 'discount_amount', 'tax_amount', 'total_amount'
        ]);

        -- ── لقطة «قبل» (الترويسة القانونية + أسطر الجدولين المتاحين) ──
        v_before := jsonb_build_object(
            'header', CASE WHEN v_pi_found THEN to_jsonb(v_pi) ELSE to_jsonb(v_pt) END,
            'twin_header', CASE WHEN v_pi_found AND v_pt_found THEN to_jsonb(v_pt) ELSE NULL END,
            'lines', CASE
                WHEN v_pi_found THEN COALESCE(
                    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_number)
                     FROM public.purchase_invoice_items i WHERE i.invoice_id = p_doc_id),
                    '[]'::jsonb)
                ELSE COALESCE(
                    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_number)
                     FROM public.purchase_transaction_items i WHERE i.transaction_id = p_doc_id),
                    '[]'::jsonb)
            END
        );

        IF NOT v_financial THEN
            -- ── مفاتيح بسيطة (تُعكس على التوأمين حيث تنطبق) ──
            IF v_pi_found THEN
                UPDATE public.purchase_invoices
                SET due_date                = COALESCE((v_header->>'due_date')::date, due_date),
                    notes                   = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                    internal_notes          = CASE WHEN v_header ? 'internal_notes' THEN v_header->>'internal_notes' ELSE internal_notes END,
                    supplier_invoice_number = CASE WHEN v_header ? 'supplier_invoice_number' THEN v_header->>'supplier_invoice_number' ELSE supplier_invoice_number END,
                    supplier_invoice_date   = COALESCE((v_header->>'supplier_invoice_date')::date, supplier_invoice_date),
                    updated_at              = NOW()
                WHERE id = p_doc_id;
            END IF;
            IF v_pt_found THEN
                UPDATE public.purchase_transactions
                SET due_date                = COALESCE((v_header->>'due_date')::date, due_date),
                    notes                   = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                    internal_notes          = CASE WHEN v_header ? 'internal_notes' THEN v_header->>'internal_notes' ELSE internal_notes END,
                    supplier_invoice_number = CASE WHEN v_header ? 'supplier_invoice_number' THEN v_header->>'supplier_invoice_number' ELSE supplier_invoice_number END,
                    supplier_invoice_date   = COALESCE((v_header->>'supplier_invoice_date')::date, supplier_invoice_date),
                    updated_by              = COALESCE(v_user_id, updated_by),
                    updated_at              = NOW()
                WHERE id = p_doc_id;
            END IF;
        ELSE
            -- ── مسار مالي: عكس ← تعديل ← إعادة ترحيل ──
            v_rev_id := public.doc_reverse_linked_je(
                            COALESCE(CASE WHEN v_pi_found THEN v_pi.journal_entry_id END,
                                     CASE WHEN v_pt_found THEN v_pt.journal_entry_id END),
                            'تعديل فاتورة مشتريات ' || v_label || ' — ' ||
                            COALESCE(NULLIF(btrim(p_reason), ''), 'تعديل'),
                            v_user_id);

            -- استبدال الأسطر (في الجدول القانوني) + حساب الإجماليات
            IF p_lines IS NOT NULL THEN
                FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
                LOOP
                    v_qty   := COALESCE((v_line->>'quantity')::numeric, 0);
                    v_price := COALESCE((v_line->>'unit_price')::numeric, 0);
                    v_l_sub := v_qty * v_price;
                    v_l_disc := CASE
                        WHEN COALESCE((v_line->>'discount_percent')::numeric, 0) > 0
                        THEN v_l_sub * (v_line->>'discount_percent')::numeric / 100
                        ELSE COALESCE((v_line->>'discount_amount')::numeric, 0)
                    END;
                    v_l_tax := (v_l_sub - v_l_disc) * COALESCE((v_line->>'tax_rate')::numeric, 0) / 100;
                    v_sub  := v_sub  + v_l_sub;
                    v_disc := v_disc + v_l_disc;
                    v_tax  := v_tax  + v_l_tax;
                END LOOP;
                v_total := v_sub - v_disc + v_tax;
            ELSE
                -- إجماليات من p_header مباشرة (post_purchase_invoice يقرأ الترويسة فقط)
                v_total := COALESCE((v_header->>'total_amount')::numeric,
                                    CASE WHEN v_pi_found THEN v_pi.total_amount ELSE v_pt.total_amount END);
                v_tax   := COALESCE((v_header->>'tax_amount')::numeric,
                                    CASE WHEN v_pi_found THEN v_pi.tax_amount ELSE v_pt.tax_amount END);
                v_sub   := COALESCE((v_header->>'subtotal')::numeric, v_total - v_tax);
                v_disc  := COALESCE((v_header->>'discount_amount')::numeric,
                                    CASE WHEN v_pi_found THEN v_pi.discount_amount ELSE v_pt.discount_amount END);
            END IF;

            -- فكّ حالة الترحيل + تطبيق الترويسة على التوأمين
            IF v_pi_found THEN
                UPDATE public.purchase_invoices
                SET journal_entry_id        = NULL,
                    is_posted               = false,
                    status                  = 'draft',
                    invoice_date            = COALESCE((v_header->>'invoice_date')::date, invoice_date),
                    due_date                = COALESCE((v_header->>'due_date')::date, due_date),
                    notes                   = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                    internal_notes          = CASE WHEN v_header ? 'internal_notes' THEN v_header->>'internal_notes' ELSE internal_notes END,
                    supplier_invoice_number = CASE WHEN v_header ? 'supplier_invoice_number' THEN v_header->>'supplier_invoice_number' ELSE supplier_invoice_number END,
                    supplier_invoice_date   = COALESCE((v_header->>'supplier_invoice_date')::date, supplier_invoice_date),
                    currency                = COALESCE(NULLIF(v_header->>'currency', ''), currency),
                    exchange_rate           = COALESCE((v_header->>'exchange_rate')::numeric, exchange_rate),
                    subtotal                = round(v_sub, 2),
                    discount_amount         = round(v_disc, 2),
                    tax_amount              = round(v_tax, 2),
                    total_amount            = round(v_total, 2),
                    updated_at              = NOW()
                WHERE id = p_doc_id;
            END IF;
            IF v_pt_found THEN
                UPDATE public.purchase_transactions
                SET journal_entry_id        = NULL,
                    is_posted               = false,
                    stage                   = 'invoice',
                    invoice_date            = COALESCE((v_header->>'invoice_date')::date, invoice_date),
                    due_date                = COALESCE((v_header->>'due_date')::date, due_date),
                    notes                   = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                    internal_notes          = CASE WHEN v_header ? 'internal_notes' THEN v_header->>'internal_notes' ELSE internal_notes END,
                    supplier_invoice_number = CASE WHEN v_header ? 'supplier_invoice_number' THEN v_header->>'supplier_invoice_number' ELSE supplier_invoice_number END,
                    supplier_invoice_date   = COALESCE((v_header->>'supplier_invoice_date')::date, supplier_invoice_date),
                    currency                = COALESCE(NULLIF(v_header->>'currency', ''), currency),
                    exchange_rate           = COALESCE((v_header->>'exchange_rate')::numeric, exchange_rate),
                    subtotal                = round(v_sub, 2),
                    discount_amount         = round(v_disc, 2),
                    tax_amount              = round(v_tax, 2),
                    total_amount            = round(v_total, 2),
                    updated_by              = COALESCE(v_user_id, updated_by),
                    updated_at              = NOW()
                WHERE id = p_doc_id;
            END IF;

            -- إدراج الأسطر الجديدة في الجدول القانوني
            IF p_lines IS NOT NULL THEN
                IF v_pi_found THEN
                    DELETE FROM public.purchase_invoice_items WHERE invoice_id = p_doc_id;
                ELSE
                    DELETE FROM public.purchase_transaction_items WHERE transaction_id = p_doc_id;
                END IF;

                v_line_num := 0;
                FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
                LOOP
                    v_line_num := v_line_num + 1;
                    v_qty   := COALESCE((v_line->>'quantity')::numeric, 0);
                    v_price := COALESCE((v_line->>'unit_price')::numeric, 0);
                    v_l_sub := v_qty * v_price;
                    v_l_disc := CASE
                        WHEN COALESCE((v_line->>'discount_percent')::numeric, 0) > 0
                        THEN v_l_sub * (v_line->>'discount_percent')::numeric / 100
                        ELSE COALESCE((v_line->>'discount_amount')::numeric, 0)
                    END;
                    v_l_tax := (v_l_sub - v_l_disc) * COALESCE((v_line->>'tax_rate')::numeric, 0) / 100;

                    IF v_pi_found THEN
                        INSERT INTO public.purchase_invoice_items (
                            tenant_id, invoice_id, line_number,
                            product_id, variant_id, material_id, description,
                            quantity, unit_price, discount_amount,
                            tax_rate, tax_amount, subtotal, total,
                            warehouse_id, notes
                        ) VALUES (
                            v_tenant, p_doc_id, v_line_num,
                            NULLIF(v_line->>'product_id', '')::uuid,
                            NULLIF(v_line->>'variant_id', '')::uuid,
                            NULLIF(v_line->>'material_id', '')::uuid,
                            COALESCE(NULLIF(v_line->>'description', ''), 'بند'),
                            v_qty, v_price, round(v_l_disc, 2),
                            COALESCE((v_line->>'tax_rate')::numeric, 0),
                            round(v_l_tax, 2), round(v_l_sub, 2),
                            round(v_l_sub - v_l_disc + v_l_tax, 2),
                            NULLIF(v_line->>'warehouse_id', '')::uuid,
                            NULLIF(v_line->>'notes', '')
                        );
                    ELSE
                        INSERT INTO public.purchase_transaction_items (
                            transaction_id, line_number,
                            product_id, material_id, item_code, description, description_ar,
                            quantity, unit, unit_price,
                            discount_amount, discount_percent,
                            tax_rate, tax_amount, subtotal, total,
                            warehouse_id, cost_price, notes
                        ) VALUES (
                            p_doc_id, v_line_num,
                            NULLIF(v_line->>'product_id', '')::uuid,
                            NULLIF(v_line->>'material_id', '')::uuid,
                            NULLIF(v_line->>'item_code', ''),
                            NULLIF(v_line->>'description', ''),
                            NULLIF(v_line->>'description_ar', ''),
                            v_qty,
                            COALESCE(NULLIF(v_line->>'unit', ''), 'piece'),
                            v_price,
                            round(v_l_disc, 2),
                            COALESCE((v_line->>'discount_percent')::numeric, 0),
                            COALESCE((v_line->>'tax_rate')::numeric, 0),
                            round(v_l_tax, 2), round(v_l_sub, 2),
                            round(v_l_sub - v_l_disc + v_l_tax, 2),
                            NULLIF(v_line->>'warehouse_id', '')::uuid,
                            (v_line->>'cost_price')::numeric,
                            NULLIF(v_line->>'notes', '')
                        );
                    END IF;
                END LOOP;
            END IF;

            -- إعادة الترحيل عبر نفس الماكينة (تقرأ invoices أولاً ثم transactions —
            -- نفس أسبقيتنا القانونية)
            v_res := public.post_purchase_invoice(p_doc_id);
            IF COALESCE((v_res->>'success')::boolean, false) = false THEN
                RAISE EXCEPTION 'فشل إعادة الترحيل: %', COALESCE(v_res->>'error', 'خطأ غير معروف');
            END IF;
        END IF;

        -- ── لقطة «بعد» ──
        IF v_pi_found THEN
            SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_doc_id;
        END IF;
        IF v_pt_found THEN
            SELECT * INTO v_pt FROM public.purchase_transactions WHERE id = p_doc_id;
        END IF;
        v_after := jsonb_build_object(
            'header', CASE WHEN v_pi_found THEN to_jsonb(v_pi) ELSE to_jsonb(v_pt) END,
            'twin_header', CASE WHEN v_pi_found AND v_pt_found THEN to_jsonb(v_pt) ELSE NULL END,
            'lines', CASE
                WHEN v_pi_found THEN COALESCE(
                    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_number)
                     FROM public.purchase_invoice_items i WHERE i.invoice_id = p_doc_id),
                    '[]'::jsonb)
                ELSE COALESCE(
                    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_number)
                     FROM public.purchase_transaction_items i WHERE i.transaction_id = p_doc_id),
                    '[]'::jsonb)
            END
        );

    -- ═════════════════ سند صرف ═════════════════
    ELSIF p_doc_type = 'payment_voucher' THEN
        SELECT * INTO v_pv FROM public.payment_vouchers WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_pv.company_id;
        v_tenant  := v_pv.tenant_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_pv.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
        END IF;
        IF v_pv.status <> 'confirmed' THEN
            RETURN jsonb_build_object('success', false, 'error',
                'التعديل المباشر للسندات المؤكَّدة فقط — عدّل المسودة مباشرةً');
        END IF;

        v_new_date := COALESCE((v_header->>'voucher_date')::date, v_pv.voucher_date);
        IF public.journal_period_is_locked(v_company, v_pv.voucher_date)
           OR public.journal_period_is_locked(v_company, v_new_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label := COALESCE(v_pv.voucher_number, LEFT(p_doc_id::text, 8));

        v_financial := v_header ?| ARRAY[
            'amount', 'currency', 'exchange_rate', 'voucher_date',
            'payment_method', 'treasury_account_id'
        ];

        v_before := jsonb_build_object('header', to_jsonb(v_pv), 'lines', '[]'::jsonb);

        IF NOT v_financial THEN
            -- ── مفاتيح بسيطة (لا تمسّ القيد؛ التريغر يرجع مبكراً لوجود القيد) ──
            UPDATE public.payment_vouchers
            SET notes              = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                check_number       = CASE WHEN v_header ? 'check_number' THEN v_header->>'check_number' ELSE check_number END,
                check_date         = COALESCE((v_header->>'check_date')::date, check_date),
                bank_name          = CASE WHEN v_header ? 'bank_name' THEN v_header->>'bank_name' ELSE bank_name END,
                transfer_reference = CASE WHEN v_header ? 'transfer_reference' THEN v_header->>'transfer_reference' ELSE transfer_reference END
            WHERE id = p_doc_id;
        ELSE
            -- ── مسار مالي: عكس القيد القديم ثم UPDATE واحد يصفّر journal_entry_id
            --    ويطبّق القيم — فيُنشئ التريغر القائم قيداً جديداً من القيم الجديدة.
            --    (هذا يُصلح علّة فكّ التزامن: كان التريغر يرجع مبكراً لوجود القيد)
            v_rev_id := public.doc_reverse_linked_je(
                            v_pv.journal_entry_id,
                            'تعديل سند صرف ' || v_label || ' — ' ||
                            COALESCE(NULLIF(btrim(p_reason), ''), 'تعديل'),
                            v_user_id);

            -- أرشفة رقم القيد القديم: التريغر سيُنشئ قيداً جديداً بنفس الاسم
            -- الحتمي 'JE-PV-<رقم السند>' و journal_entries عليه
            -- UNIQUE(tenant_id, entry_number) — نعيد تسمية القديم (المخفي) لتفادي التصادم
            UPDATE public.journal_entries
            SET entry_number = entry_number || '-E' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS'),
                updated_at   = NOW()
            WHERE id = v_pv.journal_entry_id;

            UPDATE public.payment_vouchers
            SET journal_entry_id    = NULL,
                amount              = COALESCE((v_header->>'amount')::numeric, amount),
                currency            = COALESCE(NULLIF(v_header->>'currency', ''), currency),
                exchange_rate       = COALESCE((v_header->>'exchange_rate')::numeric, exchange_rate),
                voucher_date        = COALESCE((v_header->>'voucher_date')::date, voucher_date),
                payment_method      = COALESCE(NULLIF(v_header->>'payment_method', ''), payment_method),
                treasury_account_id = CASE WHEN v_header ? 'treasury_account_id'
                                           THEN NULLIF(v_header->>'treasury_account_id', '')::uuid
                                           ELSE treasury_account_id END,
                notes               = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                check_number        = CASE WHEN v_header ? 'check_number' THEN v_header->>'check_number' ELSE check_number END,
                check_date          = COALESCE((v_header->>'check_date')::date, check_date),
                bank_name           = CASE WHEN v_header ? 'bank_name' THEN v_header->>'bank_name' ELSE bank_name END,
                transfer_reference  = CASE WHEN v_header ? 'transfer_reference' THEN v_header->>'transfer_reference' ELSE transfer_reference END
            WHERE id = p_doc_id;

            -- تحقّق أن التريغر أنشأ القيد الجديد فعلاً
            SELECT * INTO v_pv FROM public.payment_vouchers WHERE id = p_doc_id;
            IF v_pv.journal_entry_id IS NULL THEN
                RAISE EXCEPTION 'لم يُنشأ قيد جديد للسند بعد التعديل — تراجع كامل';
            END IF;
        END IF;

        SELECT * INTO v_pv FROM public.payment_vouchers WHERE id = p_doc_id;
        v_after := jsonb_build_object('header', to_jsonb(v_pv), 'lines', '[]'::jsonb);

    -- ═════════════════ سند قبض ═════════════════
    ELSIF p_doc_type = 'payment_receipt' THEN
        SELECT * INTO v_pr FROM public.payment_receipts WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_pr.company_id;
        v_tenant  := v_pr.tenant_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_pr.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
        END IF;
        IF v_pr.status <> 'confirmed' THEN
            RETURN jsonb_build_object('success', false, 'error',
                'التعديل المباشر للسندات المؤكَّدة فقط — عدّل المسودة مباشرةً');
        END IF;

        v_new_date := COALESCE((v_header->>'receipt_date')::date, v_pr.receipt_date);
        IF public.journal_period_is_locked(v_company, v_pr.receipt_date)
           OR public.journal_period_is_locked(v_company, v_new_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label := COALESCE(v_pr.receipt_number, LEFT(p_doc_id::text, 8));

        v_financial := v_header ?| ARRAY[
            'amount', 'currency', 'exchange_rate', 'receipt_date',
            'payment_method', 'treasury_account_id'
        ];

        v_before := jsonb_build_object('header', to_jsonb(v_pr), 'lines', '[]'::jsonb);

        IF NOT v_financial THEN
            UPDATE public.payment_receipts
            SET notes              = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                check_number       = CASE WHEN v_header ? 'check_number' THEN v_header->>'check_number' ELSE check_number END,
                check_date         = COALESCE((v_header->>'check_date')::date, check_date),
                bank_name          = CASE WHEN v_header ? 'bank_name' THEN v_header->>'bank_name' ELSE bank_name END,
                transfer_reference = CASE WHEN v_header ? 'transfer_reference' THEN v_header->>'transfer_reference' ELSE transfer_reference END
            WHERE id = p_doc_id;
        ELSE
            v_rev_id := public.doc_reverse_linked_je(
                            v_pr.journal_entry_id,
                            'تعديل سند قبض ' || v_label || ' — ' ||
                            COALESCE(NULLIF(btrim(p_reason), ''), 'تعديل'),
                            v_user_id);

            -- أرشفة رقم القيد القديم ('JE-PR-<رقم السند>' حتمي +
            -- UNIQUE(tenant_id, entry_number)) لتفادي تصادم القيد الجديد
            UPDATE public.journal_entries
            SET entry_number = entry_number || '-E' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS'),
                updated_at   = NOW()
            WHERE id = v_pr.journal_entry_id;

            -- UPDATE واحد: تصفير القيد + القيم الجديدة → التريغر يُنشئ قيداً جديداً،
            -- وترغير مزامنة paid_amount يعيد الحساب على الفاتورة المرتبطة تلقائياً.
            UPDATE public.payment_receipts
            SET journal_entry_id    = NULL,
                amount              = COALESCE((v_header->>'amount')::numeric, amount),
                currency            = COALESCE(NULLIF(v_header->>'currency', ''), currency),
                exchange_rate       = COALESCE((v_header->>'exchange_rate')::numeric, exchange_rate),
                receipt_date        = COALESCE((v_header->>'receipt_date')::date, receipt_date),
                payment_method      = COALESCE(NULLIF(v_header->>'payment_method', ''), payment_method),
                treasury_account_id = CASE WHEN v_header ? 'treasury_account_id'
                                           THEN NULLIF(v_header->>'treasury_account_id', '')::uuid
                                           ELSE treasury_account_id END,
                notes               = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                check_number        = CASE WHEN v_header ? 'check_number' THEN v_header->>'check_number' ELSE check_number END,
                check_date          = COALESCE((v_header->>'check_date')::date, check_date),
                bank_name           = CASE WHEN v_header ? 'bank_name' THEN v_header->>'bank_name' ELSE bank_name END,
                transfer_reference  = CASE WHEN v_header ? 'transfer_reference' THEN v_header->>'transfer_reference' ELSE transfer_reference END
            WHERE id = p_doc_id;

            SELECT * INTO v_pr FROM public.payment_receipts WHERE id = p_doc_id;
            IF v_pr.journal_entry_id IS NULL THEN
                RAISE EXCEPTION 'لم يُنشأ قيد جديد للسند بعد التعديل — تراجع كامل';
            END IF;
        END IF;

        SELECT * INTO v_pr FROM public.payment_receipts WHERE id = p_doc_id;
        v_after := jsonb_build_object('header', to_jsonb(v_pr), 'lines', '[]'::jsonb);
    END IF;

    -- ── تدوين السجل ──
    INSERT INTO public.document_edits (
        tenant_id, company_id, doc_type, doc_id, edited_by, reason, before, after
    ) VALUES (
        v_tenant, v_company, p_doc_type, p_doc_id, v_user_id,
        NULLIF(btrim(p_reason), ''), v_before, v_after
    )
    RETURNING id INTO v_edit_id;

    RETURN jsonb_build_object('success', true, 'edit_id', v_edit_id);
EXCEPTION WHEN OTHERS THEN
    -- المعاملة تتراجع بالكامل عند أي خطأ (ذرّية)
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.update_posted_document(TEXT, UUID, JSONB, JSONB, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.update_posted_document(TEXT, UUID, JSONB, JSONB, TEXT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- (5) قراءة سجل التعديلات: get_document_edits
--     العقد: RETURNS jsonb → مصفوفة الأحدث أولاً:
--            {id, edited_at, edited_by_name, reason, before, after}
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_document_edits(
    p_doc_type TEXT,
    p_doc_id   UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_doc_type IS NULL OR p_doc_id IS NULL THEN
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
        FROM public.document_edits e
        LEFT JOIN public.user_profiles up ON up.id = e.edited_by
        WHERE e.doc_type = p_doc_type
          AND e.doc_id   = p_doc_id
    ) t;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_document_edits(TEXT, UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.get_document_edits(TEXT, UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- (6) لوحة «النشاط الأخير»: استبعاد المستندات المحذوفة
--     الجسم نسخة مطابقة بايتاً لـ20260714101000 + ثلاثة شروط فقط:
--       • فرع 1 يقرأ sales_invoices (القديم — توأم sales_transactions بنفس الـid؛
--         الأعلام تُعكس عليه في delete_document_soft) → استبعاد is_deleted.
--       • فرع 2 purchase_invoices → استبعاد is_deleted.
--       • فرع 3 payment_vouchers → استبعاد is_deleted.
--     (payment_receipts و purchase_transactions لا يقرأهما أي فرع؛ فرع القيود
--      يستبعد is_deleted سلفاً منذ 20260714101000.)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_dashboard_recent_activity(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH all_activity AS (
    -- 1. فواتير المبيعات
    SELECT
      si.id::text,
      'sale' as type,
      'فاتورة مبيعات' as type_label,
      si.invoice_number as doc_number,
      COALESCE(NULLIF(si.customer_name,''), NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''), 'عميل') as party_name,
      si.total_amount as amount,
      si.currency,
      si.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      si.created_at
    FROM sales_invoices si
    LEFT JOIN customers c ON c.id = si.customer_id
    LEFT JOIN user_profiles u ON u.id = si.created_by
    WHERE si.company_id = p_company_id
      AND COALESCE(si.is_deleted, false) = false

    UNION ALL

    -- 2. فواتير المشتريات
    SELECT
      pi.id::text,
      'purchase' as type,
      'فاتورة مشتريات' as type_label,
      pi.invoice_number as doc_number,
      COALESCE(NULLIF(pi.supplier_name,''), NULLIF(s.name_ar,''), NULLIF(s.company_name,''), NULLIF(s.name_en,''), 'مورد') as party_name,
      pi.total_amount as amount,
      pi.currency,
      pi.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      pi.created_at
    FROM purchase_invoices pi
    LEFT JOIN suppliers s ON s.id = pi.supplier_id
    LEFT JOIN user_profiles u ON u.id = pi.created_by
    WHERE pi.company_id = p_company_id
      AND COALESCE(pi.is_deleted, false) = false

    UNION ALL

    -- 3. سندات الدفع / القبض (الطرف: مورد للدفع، عميل للقبض)
    SELECT
      pv.id::text,
      CASE WHEN pv.type = 'payment' THEN 'payment' ELSE 'receipt' END as type,
      CASE WHEN pv.type = 'payment' THEN 'سند دفع' ELSE 'سند قبض' END as type_label,
      pv.voucher_number as doc_number,
      COALESCE(
        NULLIF(pv.supplier_name,''),
        NULLIF(s.name_ar,''), NULLIF(s.company_name,''), NULLIF(s.name_en,''),
        NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''),
        ''
      ) as party_name,
      pv.amount,
      pv.currency,
      pv.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      pv.created_at
    FROM payment_vouchers pv
    LEFT JOIN suppliers s ON s.id = pv.supplier_id
    LEFT JOIN customers c ON c.id = pv.customer_id
    LEFT JOIN user_profiles u ON u.id = pv.created_by
    WHERE pv.company_id = p_company_id
      AND COALESCE(pv.is_deleted, false) = false

    UNION ALL

    -- 4. أوامر الشراء
    SELECT
      po.id::text,
      'purchase_order' as type,
      'أمر شراء' as type_label,
      po.order_number as doc_number,
      COALESCE(NULLIF(po.supplier_name,''), NULLIF(s.name_ar,''), NULLIF(s.company_name,''), NULLIF(s.name_en,''), 'مورد') as party_name,
      po.total_amount as amount,
      po.currency,
      po.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      po.created_at
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN user_profiles u ON u.id = po.created_by
    WHERE po.company_id = p_company_id

    UNION ALL

    -- 5. أوامر البيع
    SELECT
      so.id::text,
      'sales_order' as type,
      'أمر بيع' as type_label,
      so.order_number as doc_number,
      COALESCE(NULLIF(so.customer_name,''), NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''), 'عميل') as party_name,
      so.total_amount as amount,
      so.currency,
      so.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      so.created_at
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    LEFT JOIN user_profiles u ON u.id = so.created_by
    WHERE so.company_id = p_company_id

    UNION ALL

    -- 6. إشعارات التسليم (الحالة المُبلَّغة: customer_id موجود والاسم النصي "")
    SELECT
      dn.id::text,
      'delivery' as type,
      'إذن تسليم' as type_label,
      dn.note_number as doc_number,
      COALESCE(NULLIF(dn.customer_name,''), NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''), 'عميل') as party_name,
      NULL::numeric as amount,
      NULL as currency,
      dn.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      dn.created_at
    FROM delivery_notes dn
    LEFT JOIN customers c ON c.id = dn.customer_id
    LEFT JOIN user_profiles u ON u.id = dn.created_by
    WHERE dn.company_id = p_company_id

    UNION ALL

    -- 7. القيود المحاسبية اليدوية فقط
    SELECT
      je.id::text,
      'journal' as type,
      'قيد محاسبي' as type_label,
      COALESCE(je.reference_number, je.entry_number::text) as doc_number,
      COALESCE(je.description, '') as party_name,
      je.total_debit as amount,
      je.currency,
      CASE WHEN je.is_posted THEN 'posted' ELSE 'draft' END as status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      je.created_at
    FROM journal_entries je
    LEFT JOIN user_profiles u ON u.id = je.created_by
    WHERE je.company_id = p_company_id
      AND je.reference_type IS NULL
      AND COALESCE(je.is_deleted, false) = false
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'type', a.type,
      'typeLabel', a.type_label,
      'docNumber', COALESCE(a.doc_number, ''),
      'partyName', a.party_name,
      'amount', a.amount,
      'currency', a.currency,
      'status', a.status,
      'actorName', a.actor_name,
      'timestamp', to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) ORDER BY a.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM all_activity ORDER BY created_at DESC LIMIT 15
  ) a;

  RETURN v_result;
END;
$function$;
