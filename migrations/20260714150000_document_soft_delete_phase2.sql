-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: تعميم الحذف الناعم/التعديل المدقَّق — المرحلة الثانية
--            (Document soft-delete + audited edit — Phase 2)
-- Date: 2026-07-14
-- ═══════════════════════════════════════════════════════════════════════════
-- يمدّد 20260714120000 (المرحلة الأولى) بخمسة أنواع مستندات جديدة:
--
--   • 'purchase_receipt' → purchase_receipts (الترحيل post_purchase_receipt:
--       status='completed' + حركات inventory_movements movement_type='receipt'
--       reference_type='purchase_receipt' + قيد DR مخزون / CR ذمم دائنة عبر
--       journal_entry_id). الحذف المُرحَّل = عكس القيد inline (doc_reverse_linked_je)
--       + صفوف حركات عاكسة (adjustment_out، reference_type='receipt_deletion_reversal')
--       — لا حذف/تعديل لأي صف حركة قائم (الأثر التدقيقي مقدَّس) — ثم
--       status='cancelled' + أعلام is_deleted. آلية المخزون المكتشفة: تريغر
--       BEFORE INSERT على inventory_movements (update_inventory_stock) يعدّل
--       inventory_stock.quantity_on_hand حسب اتجاه movement_type — لذا الصفوف
--       العاكسة تُصفّر الرصيد عبر «نفس» الآلية حرفياً.
--       حارس تبعيات: فاتورة شراء تشير للسند (purchase_invoices.receipt_id) → منع.
--
--   • 'sales_delivery' → sales_deliveries و 'delivery_note' → delivery_notes:
--       الاستكشاف: لا يوجد جدول stock_movements في هذا النظام إطلاقاً —
--       inventory_movements هو الجدول الوحيد للحركات؛ العكس يُكتب فيه نفسه
--       مفتاحاً بـreference_id=معرّف المستند (reference_type أصلي غير موحَّد
--       بين المسارات، لذا الالتقاط بأي reference_type عدا صفوف العكس نفسها).
--       الجدولان بلا أعمدة journal_entry_id/cogs_journal_entry_id على السحابة —
--       تُقرأ ديناميكياً إن وُجدت على نسخةٍ ما ويُعكس القيدان (الأساسي + COGS).
--       تسليم بلا حركات وبلا قيود = إخفاء فقط (is_deleted).
--
--   • 'sales_order' → sales_orders و 'purchase_order' → purchase_orders:
--       بلا قيود ولا مخزون. طلب متجر إلكتروني (المميّز المكتشَف:
--       ecommerce_orders.sales_order_id / ecommerce_orders.purchase_order_id
--       يشير للطلب) → error:'use_ecom_cancel' كي توجّه الواجهة لمسار
--       cancel_ecom_order_cascade القائم (لا نمسّه هنا). حارس التبعيات أولاً:
--       تسليمات/إشعارات تسليم/سندات استلام/فواتير/سندات دفع وقبض مربوطة → منع
--       بقائمة. النظيف → status='cancelled' + is_deleted.
--
--   • التعديل update_posted_document للأنواع الجديدة: ترويسة فقط (whitelist
--       تواريخ/مرجع/ملاحظات) — «قيد موثَّق»: لا إعادة تدوير أسطر لمستندات
--       المخزون في هذه المرحلة (يستلزم عكس/إعادة توليد الحركات — مؤجَّل).
--       اللقطات قبل/بعد في document_edits كما في المرحلة الأولى.
--
--   • get_dashboard_recent_activity: الفروع 4 (purchase_orders) و5 (sales_orders)
--     و6 (delivery_notes) تستبعد is_deleted — الجسم نسخة مطابقة بايتاً لنسخة
--     20260714120000 (القسم 6 — أحدث حامل للدالة) + الشروط الثلاثة فقط.
--
-- فروع المرحلة الأولى داخل delete_document_soft / update_posted_document
-- مُعادة هنا مطابقة بايتاً (CREATE OR REPLACE للدالة كاملة) — التغيير الوحيد
-- عليها: توسيع قائمة الأنواع المدعومة + متغيّرات جديدة في DECLARE.
--
-- القواعد الصلبة (المستفادة من المرحلة الأولى):
--   1. لا استدعاء لـpublic.reverse_journal_entry (حارسها يرفض auth.uid()=NULL
--      محلياً) — العكس عبر doc_reverse_linked_je القائمة (تعكس inline).
--   2. assert_can_access_company فقط عندما auth.uid() IS NOT NULL.
--   3. لا دوال مثقلة تُستدعى هنا بلا أنواع صريحة (الأنواع مصرَّحة بالكاست).
--   4. DDL دفاعي (to_regclass/IF NOT EXISTS/information_schema)، SECURITY DEFINER
--      + SET search_path، EXCEPTION يعيد {success:false,error:SQLERRM}،
--      FOR UPDATE، idempotency (already_deleted + حارس عدم تكرار العكس المخزني)،
--      قفل الفترة journal_period_is_locked على تاريخ المستند.
--   5. purchase_receipts وsales_deliveries لا CREATE TABLE لهما في مسار
--      الهجرات (أُنشئا من scripts/) — لذا كل DDL عليهما داخل حارس to_regclass،
--      ومتغيّراتهما RECORD (لا %ROWTYPE) كي لا يفشل تحميل الدوال إن غابا محلياً.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- (0) أعمدة الحذف الناعم على جداول المرحلة الثانية + فهارس جزئية
--     (داخل حرّاس to_regclass — القاعدة 5)
-- ═══════════════════════════════════════════════════════════════
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['purchase_receipts','sales_deliveries','delivery_notes',
                             'sales_orders','purchase_orders']
    LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE public.%I
                     ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
                     ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
                     ADD COLUMN IF NOT EXISTS deleted_by    UUID,
                     ADD COLUMN IF NOT EXISTS delete_reason TEXT', t);
        END IF;
    END LOOP;
END $$;

DO $$
BEGIN
    IF to_regclass('public.purchase_receipts') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_purchase_receipts_active
            ON public.purchase_receipts (company_id, receipt_date)
            WHERE is_deleted = false;
    END IF;
    IF to_regclass('public.sales_deliveries') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_sales_deliveries_active
            ON public.sales_deliveries (company_id, delivery_date)
            WHERE is_deleted = false;
    END IF;
    IF to_regclass('public.delivery_notes') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_delivery_notes_active
            ON public.delivery_notes (company_id, note_date)
            WHERE is_deleted = false;
    END IF;
    IF to_regclass('public.sales_orders') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_sales_orders_active
            ON public.sales_orders (company_id, order_date)
            WHERE is_deleted = false;
    END IF;
    IF to_regclass('public.purchase_orders') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_purchase_orders_active
            ON public.purchase_orders (company_id, order_date)
            WHERE is_deleted = false;
    END IF;
END $$;

-- فهرس التقاط الحركات بمرجع المستند (يُستخدم في العكس المخزني وفحص الترحيل)
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference
    ON public.inventory_movements (reference_id);


-- ═══════════════════════════════════════════════════════════════
-- (1) مساعد داخلي: doc_reverse_stock_movements
--     يعكس حركات مستند بصفوف جديدة معاكسة الاتجاه — لا يحذف ولا يعدّل أي صف
--     قائم (الأثر التدقيقي). التصنيف وارد/صادر مطابق حرفياً لمفردات
--     update_inventory_stock (تريغر BEFORE INSERT على inventory_movements
--     الذي يعدّل inventory_stock.quantity_on_hand) — فتمرّ الصفوف العاكسة عبر
--     «نفس» الآلية وتُصفّر الرصيد:
--       وارد:  receipt, purchase, return_in, adjustment_in, transfer_in,
--              container_receipt, purchase_receipt          → عكسه adjustment_out
--       صادر:  sale, issue, return_out, adjustment_out, transfer_out,
--              sales_delivery, out                          → عكسه adjustment_in
--       غير معروف: بلا أثر مخزني أصلاً → لا صف عاكس.
--     المستودع الفعلي للأصل يُحسب كما في التريغر (وارد: to أولاً؛ صادر: from
--     أولاً) ويوضَع في الاتجاه المقابل للصف العاكس.
--     idempotent: وجود صفوف بـreference_type العاكس نفسه = عُكس سلفاً → 0.
--     تُنسخ transaction_unit_id/conversion_factor كي يحسب
--     trg_calculate_base_quantity نفس base_quantity للأصل.
--     ملاحظة: حارس الرصيد السالب في التريغر قد يرفض عكس وارد استُهلك لاحقاً —
--     وهذا منع صحيح يفشل الحذف بأكمله ذرّياً برسالة واضحة.
--     داخلي فقط (يُستدعى من دوال definer) — لا GRANT لأحد.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_reverse_stock_movements(
    p_doc_id       UUID,
    p_src_types    TEXT[],   -- reference_type للأصل (NULL = أي نوع عدا صفوف العكس)
    p_rev_ref_type TEXT,     -- reference_type للصفوف العاكسة
    p_reason       TEXT,
    p_user_id      UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_mov      RECORD;
    v_count    INT := 0;
    v_mt       TEXT;
    v_new_type TEXT;
    v_from     UUID;
    v_to       UUID;
BEGIN
    IF p_doc_id IS NULL OR p_rev_ref_type IS NULL THEN
        RETURN 0;
    END IF;

    -- idempotency: عكوس هذا المستند مكتوبة سلفاً → لا تكرار
    IF EXISTS (SELECT 1 FROM public.inventory_movements
               WHERE reference_id = p_doc_id
                 AND reference_type = p_rev_ref_type) THEN
        RETURN 0;
    END IF;

    FOR v_mov IN
        SELECT * FROM public.inventory_movements
        WHERE reference_id = p_doc_id
          AND (p_src_types IS NULL OR reference_type = ANY(p_src_types))
          AND COALESCE(reference_type, '') NOT LIKE '%deletion_reversal'
        ORDER BY created_at, id
    LOOP
        v_mt := lower(COALESCE(v_mov.movement_type, ''));

        IF v_mt IN ('receipt','purchase','return_in','adjustment_in','transfer_in',
                    'container_receipt','purchase_receipt') THEN
            -- أصل وارد → صف عاكس صادر من نفس المستودع الفعلي
            v_new_type := 'adjustment_out';
            v_from     := COALESCE(v_mov.to_warehouse_id, v_mov.from_warehouse_id);
            v_to       := NULL;
        ELSIF v_mt IN ('sale','issue','return_out','adjustment_out','transfer_out',
                       'sales_delivery','out') THEN
            -- أصل صادر → صف عاكس وارد إلى نفس المستودع الفعلي
            v_new_type := 'adjustment_in';
            v_to       := COALESCE(v_mov.from_warehouse_id, v_mov.to_warehouse_id);
            v_from     := NULL;
        ELSE
            CONTINUE;   -- نوع لا يمسّ الرصيد في update_inventory_stock — لا عكس
        END IF;

        INSERT INTO public.inventory_movements (
            tenant_id, company_id,
            movement_number, movement_date, movement_type,
            product_id, material_id, variant_id,
            color_id, color_name, roll_id,
            from_warehouse_id, to_warehouse_id,
            quantity, unit_id, transaction_unit_id, conversion_factor,
            unit_cost, total_cost,
            reference_type, reference_id, reference_number,
            notes, created_by
        ) VALUES (
            v_mov.tenant_id, v_mov.company_id,
            'RVD-' || LEFT(v_mov.id::text, 8), CURRENT_DATE, v_new_type,
            v_mov.product_id, v_mov.material_id, v_mov.variant_id,
            v_mov.color_id, v_mov.color_name, v_mov.roll_id,
            v_from, v_to,
            v_mov.quantity, v_mov.unit_id, v_mov.transaction_unit_id, v_mov.conversion_factor,
            v_mov.unit_cost, v_mov.total_cost,
            p_rev_ref_type, p_doc_id, v_mov.movement_number,
            'عكس تلقائي للحذف: ' || COALESCE(p_reason, ''), p_user_id
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_reverse_stock_movements(UUID, TEXT[], TEXT, TEXT, UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (2) مساعد داخلي: doc_lines_snapshot
--     لقطة أسطر مستند بجدول/عمود ربط ديناميكيين — يتسامح مع غياب الجدول
--     محلياً (to_regclass) فيعيد []. داخلي فقط — لا GRANT لأحد.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_lines_snapshot(
    p_table   TEXT,
    p_key_col TEXT,
    p_doc_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_table IS NULL OR p_key_col IS NULL OR p_doc_id IS NULL
       OR to_regclass('public.' || p_table) IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    EXECUTE format(
        'SELECT COALESCE(jsonb_agg(to_jsonb(i)), ''[]''::jsonb)
         FROM public.%I i WHERE i.%I = $1',
        p_table, p_key_col)
    INTO v_result
    USING p_doc_id;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.doc_lines_snapshot(TEXT, TEXT, UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (3) الحذف الناعم: delete_document_soft — موسَّعة بأنواع المرحلة الثانية
--     العقد: RETURNS jsonb →
--            {success, error?, reversal_je_id?, cogs_reversal_je_id?,
--             reversing_movements?, blocking_dependents?}
--     فروع المرحلة الأولى مطابقة بايتاً لـ20260714120000.
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
    -- Phase-2 (RECORD عمداً لا %ROWTYPE — كي لا يفشل تحميل الدالة إن غاب
    -- purchase_receipts/sales_deliveries على نسخة محلية مبنية من الهجرات فقط)
    v_prcpt    RECORD;
    v_sd       RECORD;
    v_dn       RECORD;
    v_so       RECORD;
    v_po       RECORD;
    v_mov_count INT := 0;
    v_has_ecom BOOLEAN := false;
BEGIN
    v_user_id := auth.uid();
    v_reason  := COALESCE(NULLIF(btrim(p_reason), ''), 'حذف');

    IF p_doc_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'رقم المستند مطلوب');
    END IF;
    IF p_doc_type IS NULL OR p_doc_type NOT IN
       ('sales_invoice', 'purchase_invoice', 'payment_voucher', 'payment_receipt',
        'purchase_receipt', 'sales_delivery', 'delivery_note',
        'sales_order', 'purchase_order') THEN
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

    -- ═══════════════════════════ Phase-2 ═══════════════════════════

    -- ═════════════════ سند استلام مشتريات (purchase_receipts) ═════════════════
    IF p_doc_type = 'purchase_receipt' THEN
        IF to_regclass('public.purchase_receipts') IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error',
                'جدول purchase_receipts غير موجود على هذه النسخة');
        END IF;

        SELECT * INTO v_prcpt FROM public.purchase_receipts WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_prcpt.company_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_prcpt.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
        END IF;

        v_doc_date := COALESCE(v_prcpt.receipt_date, v_prcpt.created_at::date);
        IF public.journal_period_is_locked(v_company, v_doc_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label  := COALESCE(v_prcpt.receipt_number, LEFT(p_doc_id::text, 8));
        -- post_purchase_receipt يجعل status='completed' عند الترحيل (لا عمود is_posted)
        v_posted := (v_prcpt.status = 'completed');

        -- ── حارس التبعيات: فاتورة شراء تشير لهذا السند (purchase_invoices.receipt_id) ──
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'purchase_invoices'
                     AND column_name = 'receipt_id') THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(invoice_number, LEFT(id::text, 8)) AS dn
                 FROM public.purchase_invoices
                 WHERE receipt_id = $1
                   AND COALESCE(is_deleted, false) = false
                   AND COALESCE(status, '''') <> ''cancelled'''
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'purchase_invoice', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        IF jsonb_array_length(v_deps) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'has_dependents',
                                      'blocking_dependents', v_deps);
        END IF;

        -- ── الحالة (أ): غير مُرحَّل (لا حركات ولا قيد) → تعليم فقط ──
        IF NOT v_posted THEN
            UPDATE public.purchase_receipts
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason, updated_at = NOW()
            WHERE id = p_doc_id;
            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
        END IF;

        -- ── الحالة (ب): مُرحَّل → عكس القيد inline + حركات عاكسة + إلغاء+تعليم ──
        v_rev_id := public.doc_reverse_linked_je(
                        v_prcpt.journal_entry_id,
                        'حذف سند استلام مشتريات ' || v_label || ' — ' || v_reason,
                        v_user_id);

        -- الحركات الأصلية (movement_type='receipt'، reference_type='purchase_receipt')
        -- تُعكس بصفوف جديدة adjustment_out تمرّ عبر نفس تريغر update_inventory_stock —
        -- لا حذف/تعديل لأي صف قائم. حارس الرصيد السالب قد يُفشل الحذف ذرّياً إن
        -- كانت الكمية المستلمَة قد استُهلكت لاحقاً — منع صحيح.
        v_mov_count := public.doc_reverse_stock_movements(
                           p_doc_id,
                           ARRAY['purchase_receipt']::text[],
                           'receipt_deletion_reversal',
                           'حذف سند استلام مشتريات ' || v_label || ' — ' || v_reason,
                           v_user_id);

        UPDATE public.purchase_receipts
        SET status = 'cancelled',
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        -- إعادة حالة الاستلام على الفاتورة الأم (post_purchase_receipt جعلها 'received')
        IF v_prcpt.invoice_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'purchase_invoices'
                         AND column_name = 'receiving_status') THEN
            EXECUTE 'UPDATE public.purchase_invoices
                     SET receiving_status = ''pending'', updated_at = NOW()
                     WHERE id = $1'
            USING v_prcpt.invoice_id;
        END IF;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id,
                                  'reversing_movements', v_mov_count);
    END IF;

    -- ═════════════════ تسليم مبيعات (sales_deliveries) ═════════════════
    IF p_doc_type = 'sales_delivery' THEN
        IF to_regclass('public.sales_deliveries') IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error',
                'جدول sales_deliveries غير موجود على هذه النسخة');
        END IF;

        SELECT * INTO v_sd FROM public.sales_deliveries WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_sd.company_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_sd.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
        END IF;

        v_doc_date := COALESCE(v_sd.delivery_date, v_sd.created_at::date);
        IF public.journal_period_is_locked(v_company, v_doc_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label := COALESCE(v_sd.delivery_number, LEFT(p_doc_id::text, 8));

        -- ── حارس التبعيات: مرتجع مبيعات يشير للتسليم (ديناميكي) ──
        IF to_regclass('public.sales_returns') IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'sales_returns'
                         AND column_name = 'delivery_id') THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(return_number, LEFT(id::text, 8)) AS dn
                 FROM public.sales_returns
                 WHERE delivery_id = $1 AND COALESCE(status, '''') <> ''cancelled'''
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'sales_return', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        IF jsonb_array_length(v_deps) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'has_dependents',
                                      'blocking_dependents', v_deps);
        END IF;

        -- قيود مرتبطة: العمودان غير موجودَين على السحابة اليوم — قراءة ديناميكية
        -- كي تُغطَّى أي نسخة أضافتهما (القاعدة: عكس فقط إن وُجد ربط فعلي)
        v_je_id   := NULL;
        v_cost_je := NULL;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'sales_deliveries'
                     AND column_name = 'journal_entry_id') THEN
            EXECUTE 'SELECT journal_entry_id FROM public.sales_deliveries WHERE id = $1'
            INTO v_je_id USING p_doc_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'sales_deliveries'
                     AND column_name = 'cogs_journal_entry_id') THEN
            EXECUTE 'SELECT cogs_journal_entry_id FROM public.sales_deliveries WHERE id = $1'
            INTO v_cost_je USING p_doc_id;
        END IF;

        -- «مُنفَّذ» = له حركات مخزنية (مفتاحها reference_id=معرّف التسليم) أو قيد مرتبط
        v_posted := (v_je_id IS NOT NULL) OR (v_cost_je IS NOT NULL)
                    OR EXISTS (SELECT 1 FROM public.inventory_movements
                               WHERE reference_id = p_doc_id
                                 AND COALESCE(reference_type, '') NOT LIKE '%deletion_reversal');

        -- ── الحالة (أ): بلا حركات وبلا قيود → إخفاء فقط ──
        IF NOT v_posted THEN
            UPDATE public.sales_deliveries
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason, updated_at = NOW()
            WHERE id = p_doc_id;
            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
        END IF;

        -- ── الحالة (ب): مُنفَّذ → عكس القيدين + حركات عاكسة + إلغاء+تعليم ──
        v_rev_id := public.doc_reverse_linked_je(
                        v_je_id,
                        'حذف تسليم مبيعات ' || v_label || ' — ' || v_reason,
                        v_user_id);
        IF v_cost_je IS NOT NULL AND v_cost_je IS DISTINCT FROM v_je_id THEN
            v_rev_cogs := public.doc_reverse_linked_je(
                              v_cost_je,
                              'حذف تسليم مبيعات ' || v_label || ' (قيد التكلفة) — ' || v_reason,
                              v_user_id);
        END IF;

        -- العكس في «نفس» جدول الأصل (inventory_movements — لا جدول stock_movements
        -- في هذا النظام)؛ reference_type الأصلي غير موحَّد → NULL = التقاط أي نوع
        v_mov_count := public.doc_reverse_stock_movements(
                           p_doc_id,
                           NULL::text[],
                           'delivery_deletion_reversal',
                           'حذف تسليم مبيعات ' || v_label || ' — ' || v_reason,
                           v_user_id);

        UPDATE public.sales_deliveries
        SET status = 'cancelled',
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id,
                                  'cogs_reversal_je_id', v_rev_cogs,
                                  'reversing_movements', v_mov_count);
    END IF;

    -- ═════════════════ إذن تسليم (delivery_notes) ═════════════════
    IF p_doc_type = 'delivery_note' THEN
        SELECT * INTO v_dn FROM public.delivery_notes WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_dn.company_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_dn.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
        END IF;

        v_doc_date := COALESCE(v_dn.note_date, v_dn.created_at::date);
        IF public.journal_period_is_locked(v_company, v_doc_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label := COALESCE(v_dn.note_number, LEFT(p_doc_id::text, 8));

        -- قيود مرتبطة (أعمدة اختيارية — ديناميكي؛ غير موجودة على السحابة اليوم)
        v_je_id   := NULL;
        v_cost_je := NULL;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'delivery_notes'
                     AND column_name = 'journal_entry_id') THEN
            EXECUTE 'SELECT journal_entry_id FROM public.delivery_notes WHERE id = $1'
            INTO v_je_id USING p_doc_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'delivery_notes'
                     AND column_name = 'cogs_journal_entry_id') THEN
            EXECUTE 'SELECT cogs_journal_entry_id FROM public.delivery_notes WHERE id = $1'
            INTO v_cost_je USING p_doc_id;
        END IF;

        v_posted := (v_je_id IS NOT NULL) OR (v_cost_je IS NOT NULL)
                    OR EXISTS (SELECT 1 FROM public.inventory_movements
                               WHERE reference_id = p_doc_id
                                 AND COALESCE(reference_type, '') NOT LIKE '%deletion_reversal');

        -- ── الحالة (أ): بلا حركات وبلا قيود → إخفاء فقط ──
        -- (مسار POS يكتب حركاته بمفتاح «الفاتورة» لا الإذن — فالإذن هنا يُخفى فقط
        --  وتُعالج حركات الفاتورة عند حذف الفاتورة نفسها)
        IF NOT v_posted THEN
            UPDATE public.delivery_notes
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason, updated_at = NOW()
            WHERE id = p_doc_id;
            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
        END IF;

        -- ── الحالة (ب): مُنفَّذ → عكس القيدين + حركات عاكسة + إلغاء+تعليم ──
        v_rev_id := public.doc_reverse_linked_je(
                        v_je_id,
                        'حذف إذن تسليم ' || v_label || ' — ' || v_reason,
                        v_user_id);
        IF v_cost_je IS NOT NULL AND v_cost_je IS DISTINCT FROM v_je_id THEN
            v_rev_cogs := public.doc_reverse_linked_je(
                              v_cost_je,
                              'حذف إذن تسليم ' || v_label || ' (قيد التكلفة) — ' || v_reason,
                              v_user_id);
        END IF;

        v_mov_count := public.doc_reverse_stock_movements(
                           p_doc_id,
                           NULL::text[],
                           'delivery_deletion_reversal',
                           'حذف إذن تسليم ' || v_label || ' — ' || v_reason,
                           v_user_id);

        UPDATE public.delivery_notes
        SET status = 'cancelled',
            cancelled_at = NOW(), cancelled_by = v_user_id, cancel_reason = v_reason,
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id,
                                  'cogs_reversal_je_id', v_rev_cogs,
                                  'reversing_movements', v_mov_count);
    END IF;

    -- ═════════════════ أمر بيع (sales_orders) ═════════════════
    IF p_doc_type = 'sales_order' THEN
        SELECT * INTO v_so FROM public.sales_orders WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_so.company_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_so.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
        END IF;

        v_doc_date := COALESCE(v_so.order_date, v_so.created_at::date);
        IF public.journal_period_is_locked(v_company, v_doc_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label := COALESCE(v_so.order_number, LEFT(p_doc_id::text, 8));

        -- ── طلب متجر إلكتروني؟ المميّز: ecommerce_orders.sales_order_id يشير للطلب —
        --    الإلغاء له مساره المتسلسل القائم (cancel_ecom_order_cascade) — لا نتجاوزه
        IF to_regclass('public.ecommerce_orders') IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'ecommerce_orders'
                         AND column_name = 'sales_order_id') THEN
            EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.ecommerce_orders WHERE sales_order_id = $1)'
            INTO v_has_ecom USING p_doc_id;
            IF v_has_ecom THEN
                RETURN jsonb_build_object('success', false, 'error', 'use_ecom_cancel');
            END IF;
        END IF;

        -- ── حارس التبعيات أولاً (منع، لا تتالي) ──
        -- تسليمات مبيعات (sales_deliveries.order_id — جدول قد يغيب محلياً)
        IF to_regclass('public.sales_deliveries') IS NOT NULL THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(delivery_number, LEFT(id::text, 8)) AS dn
                 FROM public.sales_deliveries
                 WHERE order_id = $1
                   AND COALESCE(is_deleted, false) = false
                   AND COALESCE(status, '''') <> ''cancelled'''
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'sales_delivery', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        -- إشعارات تسليم (delivery_notes.sales_order_id)
        FOR v_rec IN
            SELECT COALESCE(note_number, LEFT(id::text, 8)) AS dn
            FROM public.delivery_notes
            WHERE sales_order_id = p_doc_id
              AND COALESCE(is_deleted, false) = false
              AND COALESCE(status, '') <> 'cancelled'
        LOOP
            v_deps := v_deps || jsonb_build_object('type', 'delivery_note', 'doc_number', v_rec.dn);
        END LOOP;

        -- سندات قبض مؤكَّدة مربوطة بالأمر (payment_receipts.sales_order_id — FK مؤكَّد)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'payment_receipts'
                     AND column_name = 'sales_order_id') THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(receipt_number, LEFT(id::text, 8)) AS dn
                 FROM public.payment_receipts
                 WHERE sales_order_id = $1
                   AND status = ''confirmed''
                   AND COALESCE(is_deleted, false) = false'
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'payment_receipt', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        -- سندات صرف مؤكَّدة مربوطة بالأمر (عمود اختياري)
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'payment_vouchers'
                     AND column_name = 'sales_order_id') THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(voucher_number, LEFT(id::text, 8)) AS dn
                 FROM public.payment_vouchers
                 WHERE sales_order_id = $1
                   AND status = ''confirmed''
                   AND COALESCE(is_deleted, false) = false'
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'payment_voucher', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        IF jsonb_array_length(v_deps) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'has_dependents',
                                      'blocking_dependents', v_deps);
        END IF;

        -- ── نظيف (لا قيود ولا مخزون للأوامر) → إلغاء + تعليم ──
        UPDATE public.sales_orders
        SET status = 'cancelled',
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
    END IF;

    -- ═════════════════ أمر شراء (purchase_orders) ═════════════════
    IF p_doc_type = 'purchase_order' THEN
        SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
        END IF;

        v_company := v_po.company_id;
        IF v_user_id IS NOT NULL THEN
            PERFORM public.assert_can_access_company(v_company);
        END IF;

        IF COALESCE(v_po.is_deleted, false) = true THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
        END IF;

        v_doc_date := COALESCE(v_po.order_date, v_po.created_at::date);
        IF public.journal_period_is_locked(v_company, v_doc_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked');
        END IF;

        v_label := COALESCE(v_po.order_number, LEFT(p_doc_id::text, 8));

        -- ── طلب متجر إلكتروني؟ (ecommerce_orders.purchase_order_id) ──
        IF to_regclass('public.ecommerce_orders') IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'ecommerce_orders'
                         AND column_name = 'purchase_order_id') THEN
            EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.ecommerce_orders WHERE purchase_order_id = $1)'
            INTO v_has_ecom USING p_doc_id;
            IF v_has_ecom THEN
                RETURN jsonb_build_object('success', false, 'error', 'use_ecom_cancel');
            END IF;
        END IF;

        -- ── حارس التبعيات أولاً ──
        -- سندات استلام (purchase_receipts.order_id — جدول قد يغيب محلياً)
        IF to_regclass('public.purchase_receipts') IS NOT NULL THEN
            FOR v_rec IN EXECUTE
                'SELECT COALESCE(receipt_number, LEFT(id::text, 8)) AS dn
                 FROM public.purchase_receipts
                 WHERE order_id = $1
                   AND COALESCE(is_deleted, false) = false
                   AND COALESCE(status, '''') <> ''cancelled'''
                USING p_doc_id
            LOOP
                v_deps := v_deps || jsonb_build_object('type', 'purchase_receipt', 'doc_number', v_rec.dn);
            END LOOP;
        END IF;

        -- فواتير شراء (purchase_invoices.order_id — FK مؤكَّد)
        FOR v_rec IN
            SELECT COALESCE(invoice_number, LEFT(id::text, 8)) AS dn
            FROM public.purchase_invoices
            WHERE order_id = p_doc_id
              AND COALESCE(is_deleted, false) = false
              AND COALESCE(status, '') <> 'cancelled'
        LOOP
            v_deps := v_deps || jsonb_build_object('type', 'purchase_invoice', 'doc_number', v_rec.dn);
        END LOOP;

        IF jsonb_array_length(v_deps) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'has_dependents',
                                      'blocking_dependents', v_deps);
        END IF;

        -- ── نظيف → إلغاء + تعليم ──
        UPDATE public.purchase_orders
        SET status = 'cancelled',
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'نوع مستند غير مدعوم');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_document_soft(TEXT, UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_document_soft(TEXT, UUID, TEXT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- (4) التعديل المدقَّق: update_posted_document — موسَّعة بأنواع المرحلة الثانية
--     العقد: RETURNS jsonb → {success, error?, edit_id?}
--     فروع المرحلة الأولى مطابقة بايتاً لـ20260714120000.
--     أنواع المرحلة الثانية: ترويسة فقط (قيد موثَّق — لا إعادة تدوير أسطر
--     لمستندات المخزون في هذه المرحلة: يستلزم عكس/إعادة توليد الحركات).
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
    -- Phase-2 (RECORD عمداً — كي لا يفشل التحميل إن غاب جدول على نسخة محلية)
    v_doc       RECORD;
    v_lines_tbl TEXT;
    v_lines_key TEXT;
BEGIN
    v_user_id := auth.uid();
    v_header  := COALESCE(p_header, '{}'::jsonb);

    IF p_doc_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'رقم المستند مطلوب');
    END IF;
    IF p_doc_type IS NULL OR p_doc_type NOT IN
       ('sales_invoice', 'purchase_invoice', 'payment_voucher', 'payment_receipt',
        'purchase_receipt', 'sales_delivery', 'delivery_note',
        'sales_order', 'purchase_order') THEN
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

    -- ═════════ Phase-2: أنواع ترويسة-فقط (قيد موثَّق — لا أسطر ولا مالي) ═════════
    ELSIF p_doc_type IN ('purchase_receipt', 'sales_delivery', 'delivery_note',
                         'sales_order', 'purchase_order') THEN
        -- تقييد المرحلة الثانية: لا إعادة تدوير أسطر لمستندات المخزون —
        -- تعديل الأسطر يستلزم عكس/إعادة توليد الحركات المخزنية (مؤجَّل لمرحلة لاحقة)
        IF p_lines IS NOT NULL THEN
            RETURN jsonb_build_object('success', false, 'error',
                'تعديل الأسطر غير مدعوم لهذا النوع في هذه المرحلة — ترويسة فقط');
        END IF;
        -- ولا مفاتيح مالية/هيكلية: هذه تمسّ القيد/الحركات/الحالة
        IF v_header ?| ARRAY['currency', 'exchange_rate', 'amount', 'subtotal',
                             'discount_amount', 'tax_amount', 'total_amount',
                             'shipping_cost', 'shipping_amount', 'warehouse_id',
                             'supplier_id', 'customer_id', 'status',
                             'quantity', 'unit_price'] THEN
            RETURN jsonb_build_object('success', false, 'error',
                'التعديل المالي غير مدعوم لهذا النوع في هذه المرحلة — مفاتيح الترويسة البسيطة فقط');
        END IF;

        -- ── سند استلام مشتريات ──
        IF p_doc_type = 'purchase_receipt' THEN
            IF to_regclass('public.purchase_receipts') IS NULL THEN
                RETURN jsonb_build_object('success', false, 'error',
                    'جدول purchase_receipts غير موجود على هذه النسخة');
            END IF;

            SELECT * INTO v_doc FROM public.purchase_receipts WHERE id = p_doc_id FOR UPDATE;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
            END IF;

            v_company := v_doc.company_id;
            v_tenant  := v_doc.tenant_id;
            IF v_user_id IS NOT NULL THEN
                PERFORM public.assert_can_access_company(v_company);
            END IF;

            IF COALESCE(v_doc.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
            END IF;
            IF v_doc.status = 'cancelled' THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند ملغى');
            END IF;
            IF v_doc.status <> 'completed' THEN
                RETURN jsonb_build_object('success', false, 'error',
                    'التعديل المباشر للمستندات المُرحَّلة فقط — عدّل المسودة مباشرةً');
            END IF;

            v_old_date := COALESCE(v_doc.receipt_date, v_doc.created_at::date);
            v_new_date := COALESCE((v_header->>'receipt_date')::date, v_old_date);
            IF public.journal_period_is_locked(v_company, v_old_date)
               OR public.journal_period_is_locked(v_company, v_new_date) THEN
                RETURN jsonb_build_object('success', false, 'error', 'period_locked');
            END IF;

            v_lines_tbl := 'purchase_receipt_items';
            v_lines_key := 'receipt_id';
            v_before := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

            -- whitelist الترويسة: receipt_date آمن (قيد الاستلام يُؤرَّخ بيوم الترحيل
            -- لا بتاريخ السند — لا فكّ تزامن) + مرجع إذن المورد + الملاحظات
            UPDATE public.purchase_receipts
            SET receipt_date         = COALESCE((v_header->>'receipt_date')::date, receipt_date),
                delivery_note_number = CASE WHEN v_header ? 'delivery_note_number' THEN v_header->>'delivery_note_number' ELSE delivery_note_number END,
                notes                = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                updated_at           = NOW()
            WHERE id = p_doc_id;

            SELECT * INTO v_doc FROM public.purchase_receipts WHERE id = p_doc_id;
            v_after := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

        -- ── تسليم مبيعات ──
        ELSIF p_doc_type = 'sales_delivery' THEN
            IF to_regclass('public.sales_deliveries') IS NULL THEN
                RETURN jsonb_build_object('success', false, 'error',
                    'جدول sales_deliveries غير موجود على هذه النسخة');
            END IF;

            SELECT * INTO v_doc FROM public.sales_deliveries WHERE id = p_doc_id FOR UPDATE;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
            END IF;

            v_company := v_doc.company_id;
            v_tenant  := v_doc.tenant_id;
            IF v_user_id IS NOT NULL THEN
                PERFORM public.assert_can_access_company(v_company);
            END IF;

            IF COALESCE(v_doc.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
            END IF;
            IF v_doc.status = 'cancelled' THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند ملغى');
            END IF;

            v_old_date := COALESCE(v_doc.delivery_date, v_doc.created_at::date);
            v_new_date := COALESCE((v_header->>'delivery_date')::date, v_old_date);
            IF public.journal_period_is_locked(v_company, v_old_date)
               OR public.journal_period_is_locked(v_company, v_new_date) THEN
                RETURN jsonb_build_object('success', false, 'error', 'period_locked');
            END IF;

            v_lines_tbl := 'sales_delivery_items';
            v_lines_key := 'delivery_id';
            v_before := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

            UPDATE public.sales_deliveries
            SET delivery_date    = COALESCE((v_header->>'delivery_date')::date, delivery_date),
                driver_name      = CASE WHEN v_header ? 'driver_name' THEN v_header->>'driver_name' ELSE driver_name END,
                vehicle_plate    = CASE WHEN v_header ? 'vehicle_plate' THEN v_header->>'vehicle_plate' ELSE vehicle_plate END,
                tracking_number  = CASE WHEN v_header ? 'tracking_number' THEN v_header->>'tracking_number' ELSE tracking_number END,
                shipping_carrier = CASE WHEN v_header ? 'shipping_carrier' THEN v_header->>'shipping_carrier' ELSE shipping_carrier END,
                delivery_notes   = CASE WHEN v_header ? 'delivery_notes' THEN v_header->>'delivery_notes' ELSE delivery_notes END,
                notes            = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                updated_at       = NOW()
            WHERE id = p_doc_id;

            SELECT * INTO v_doc FROM public.sales_deliveries WHERE id = p_doc_id;
            v_after := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

        -- ── إذن تسليم ──
        ELSIF p_doc_type = 'delivery_note' THEN
            SELECT * INTO v_doc FROM public.delivery_notes WHERE id = p_doc_id FOR UPDATE;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
            END IF;

            v_company := v_doc.company_id;
            v_tenant  := v_doc.tenant_id;
            IF v_user_id IS NOT NULL THEN
                PERFORM public.assert_can_access_company(v_company);
            END IF;

            IF COALESCE(v_doc.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
            END IF;
            IF v_doc.status = 'cancelled' THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند ملغى');
            END IF;

            v_old_date := COALESCE(v_doc.note_date, v_doc.created_at::date);
            v_new_date := COALESCE((v_header->>'note_date')::date, v_old_date);
            IF public.journal_period_is_locked(v_company, v_old_date)
               OR public.journal_period_is_locked(v_company, v_new_date) THEN
                RETURN jsonb_build_object('success', false, 'error', 'period_locked');
            END IF;

            v_lines_tbl := 'delivery_note_items';
            v_lines_key := 'delivery_note_id';
            v_before := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

            UPDATE public.delivery_notes
            SET note_date              = COALESCE((v_header->>'note_date')::date, note_date),
                expected_delivery_date = COALESCE((v_header->>'expected_delivery_date')::date, expected_delivery_date),
                driver_name            = CASE WHEN v_header ? 'driver_name' THEN v_header->>'driver_name' ELSE driver_name END,
                vehicle_number         = CASE WHEN v_header ? 'vehicle_number' THEN v_header->>'vehicle_number' ELSE vehicle_number END,
                tracking_number        = CASE WHEN v_header ? 'tracking_number' THEN v_header->>'tracking_number' ELSE tracking_number END,
                notes                  = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                internal_notes         = CASE WHEN v_header ? 'internal_notes' THEN v_header->>'internal_notes' ELSE internal_notes END,
                updated_at             = NOW()
            WHERE id = p_doc_id;

            SELECT * INTO v_doc FROM public.delivery_notes WHERE id = p_doc_id;
            v_after := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

        -- ── أمر بيع (قبل-تنفيذي — منخفض الخطورة) ──
        ELSIF p_doc_type = 'sales_order' THEN
            SELECT * INTO v_doc FROM public.sales_orders WHERE id = p_doc_id FOR UPDATE;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
            END IF;

            v_company := v_doc.company_id;
            v_tenant  := v_doc.tenant_id;
            IF v_user_id IS NOT NULL THEN
                PERFORM public.assert_can_access_company(v_company);
            END IF;

            IF COALESCE(v_doc.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
            END IF;
            IF v_doc.status = 'cancelled' THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند ملغى');
            END IF;

            v_old_date := COALESCE(v_doc.order_date, v_doc.created_at::date);
            v_new_date := COALESCE((v_header->>'order_date')::date, v_old_date);
            IF public.journal_period_is_locked(v_company, v_old_date)
               OR public.journal_period_is_locked(v_company, v_new_date) THEN
                RETURN jsonb_build_object('success', false, 'error', 'period_locked');
            END IF;

            v_lines_tbl := 'sales_order_items';
            v_lines_key := 'order_id';
            v_before := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

            UPDATE public.sales_orders
            SET order_date       = COALESCE((v_header->>'order_date')::date, order_date),
                notes            = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                delivery_notes   = CASE WHEN v_header ? 'delivery_notes' THEN v_header->>'delivery_notes' ELSE delivery_notes END,
                shipping_address = CASE WHEN v_header ? 'shipping_address' THEN v_header->>'shipping_address' ELSE shipping_address END,
                tracking_number  = CASE WHEN v_header ? 'tracking_number' THEN v_header->>'tracking_number' ELSE tracking_number END,
                shipping_carrier = CASE WHEN v_header ? 'shipping_carrier' THEN v_header->>'shipping_carrier' ELSE shipping_carrier END,
                updated_at       = NOW()
            WHERE id = p_doc_id;

            SELECT * INTO v_doc FROM public.sales_orders WHERE id = p_doc_id;
            v_after := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

        -- ── أمر شراء (قبل-تنفيذي — منخفض الخطورة) ──
        ELSE
            SELECT * INTO v_doc FROM public.purchase_orders WHERE id = p_doc_id FOR UPDATE;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
            END IF;

            v_company := v_doc.company_id;
            v_tenant  := v_doc.tenant_id;
            IF v_user_id IS NOT NULL THEN
                PERFORM public.assert_can_access_company(v_company);
            END IF;

            IF COALESCE(v_doc.is_deleted, false) = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند محذوف');
            END IF;
            IF v_doc.status = 'cancelled' THEN
                RETURN jsonb_build_object('success', false, 'error', 'المستند ملغى');
            END IF;

            v_old_date := COALESCE(v_doc.order_date, v_doc.created_at::date);
            v_new_date := COALESCE((v_header->>'order_date')::date, v_old_date);
            IF public.journal_period_is_locked(v_company, v_old_date)
               OR public.journal_period_is_locked(v_company, v_new_date) THEN
                RETURN jsonb_build_object('success', false, 'error', 'period_locked');
            END IF;

            v_lines_tbl := 'purchase_order_items';
            v_lines_key := 'order_id';
            v_before := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));

            UPDATE public.purchase_orders
            SET order_date             = COALESCE((v_header->>'order_date')::date, order_date),
                expected_delivery_date = COALESCE((v_header->>'expected_delivery_date')::date, expected_delivery_date),
                notes                  = CASE WHEN v_header ? 'notes' THEN v_header->>'notes' ELSE notes END,
                terms_and_conditions   = CASE WHEN v_header ? 'terms_and_conditions' THEN v_header->>'terms_and_conditions' ELSE terms_and_conditions END,
                updated_at             = NOW()
            WHERE id = p_doc_id;

            SELECT * INTO v_doc FROM public.purchase_orders WHERE id = p_doc_id;
            v_after := jsonb_build_object('header', to_jsonb(v_doc),
                'lines', public.doc_lines_snapshot(v_lines_tbl, v_lines_key, p_doc_id));
        END IF;
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
--     عامّة على doc_type/doc_id — لا فروع أنواع فيها، فتغطي أنواع المرحلة
--     الثانية تلقائياً. يُعاد تثبيتها هنا مطابقة بايتاً لـ20260714120000
--     (لا تغيير وظيفي — توثيق عقد المرحلة فقط).
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
-- (6) لوحة «النشاط الأخير»: استبعاد مستندات المرحلة الثانية المحذوفة
--     الجسم نسخة مطابقة بايتاً للقسم (6) في 20260714120000 (أحدث حامل
--     للدالة — يتضمّن استثناءات المرحلة الأولى للفروع 1/2/3) + ثلاثة شروط فقط:
--       • فرع 4 purchase_orders → استبعاد is_deleted.
--       • فرع 5 sales_orders    → استبعاد is_deleted.
--       • فرع 6 delivery_notes  → استبعاد is_deleted.
--     (فرع القيود 7 يستبعد is_deleted منذ 20260714101000.)
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
      AND COALESCE(po.is_deleted, false) = false

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
      AND COALESCE(so.is_deleted, false) = false

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
      AND COALESCE(dn.is_deleted, false) = false

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
