-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: تعميم الحذف الناعم — المرحلة الثالثة: تناظر الرولونات والحجوزات
--            (Document soft-delete — Phase 3: ROLL + RESERVATION symmetry)
-- Date: 2026-07-14
-- ═══════════════════════════════════════════════════════════════════════════
-- يمدّد delete_document_soft (المرحلة الثانية 20260714150000) بحقن معالجة
-- الرولونات والحجوزات داخل الفروع القائمة — دون المساس بأي منطق قيود/مخزون
-- سابق. فروع/أسطر المرحلتين 1+2 مُعادة هنا مطابقة بايتاً (CREATE OR REPLACE
-- للدالة كاملة)؛ التغيير الوحيد = حقن كتل الرولونات/الحجوزات في الفروع الأربعة:
--   purchase_receipt / sales_delivery / delivery_note / sales_order.
--
-- ┌─ الاستكشاف (تحقّق فعلي من السحابة wzkklenfsaepegymfxfz — لا افتراض) ─────────
-- │ • fabric_rolls (الحيّ ≠ 00009): id, tenant_id, company_id, material_id,
-- │     product_id, color_id, roll_number, roll_code, status, current_length,
-- │     initial_length, reserved_length, available_length(مُولَّد=current-reserved),
-- │     warehouse_id, bin_location_id, source_type, source_document_id,
-- │     source_document_number, cost_per_meter, notes, created_at, updated_at.
-- │     — لا عمود is_deleted (يُضاف دفاعياً هنا).
-- │     — لا عمود ربط أمر/حجز على الرول نفسه (فقط reserved_length + status).
-- │ • مفردات الحالة (autoRollService): 'available'/'in_stock'/'reserved' = بالمخزن،
-- │     'sold'/'delivered' = خرج، 'draft' = مسودة استلام. الطازج المستلَم='available'.
-- │ • جدول سجل الرول القانوني = roll_movements (00009): roll_id, movement_type,
-- │     quantity, length_before, length_after, reference_type, reference_id,
-- │     reference_number, from/to_warehouse_id, notes, created_by, tenant_id,
-- │     company_id, movement_date. — غائب عن السحابة اليوم ⇒ يُنشأ دفاعياً
-- │     (أعمدة متسامحة مع NULL). التسجيل insert-only بمرجع 'deletion_reversal'.
-- │     (ملاحظة: RollMovementsTab يقرأ inventory_movements بالمادة للـtimeline؛
-- │      لا نلوّث inventory_stock بتسجيل حالة الرول — عكس المخزون للتسليم يتكفّل
-- │      به doc_reverse_stock_movements القائم في فرع التسليم أصلاً.)
-- │ • ربط التسليم←رول (source_document_id فارغ حتى للرولونات الـ13 الحيّة) ⇒
-- │     التقاط متعدّد القنوات: delivery_note_items.roll_id (لإذن التسليم) +
-- │     inventory_movements.roll_id حيث reference_id=معرّف المستند +
-- │     fabric_rolls.source_document_id=معرّف المستند (ديناميكي، احتياطي).
-- │     sales_delivery_items بلا roll_id — لذا تسليم المبيعات يعتمد القناتين 2+3.
-- │     المستودع المصدر = COALESCE(بند التسليم.warehouse_id, الرول.warehouse_id)؛
-- │     الموقع = بند التسليم.location_id أو الرول.bin_location_id (لا يتغيّران).
-- │ • ربط الأمر: delivery_notes.sales_order_id ، sales_deliveries.order_id.
-- │ • ربط الاستلام←رول: fabric_rolls.source_document_id = معرّف السند (ديناميكي).
-- │ • آلية حجز الكمية (غير الرولونات): ecommerce_stock_reservations
-- │     (order_id, material_id, product_id, warehouse_id, quantity, status) —
-- │     التحرير كما في cancel_ecom_order_cascade: status→'released'+released_at
-- │     حيث status NOT IN ('released','deducted'). (لا نخترع inventory_stock
-- │     .reserved_quantity — نعكس آلية الكاسكيد القائمة حرفياً.)
-- └────────────────────────────────────────────────────────────────────────────
--
-- التصميم (معتمَد من المالك — يُنفَّذ حرفياً):
--  1) حذف تسليم (sales_delivery + delivery_note): الرولونات التي أخرجها المستند
--     تعود — نفس المعرّفات، نفس المستودع/الموقع المصدر. قاعدة الحالة: إن كان
--     التسليم ينفّذ أمر بيع لا يزال نشطاً (غير ملغى/محذوف) ⇒ الرول يعود 'reserved'
--     لذلك الأمر (وإعادة ربط أي أعمدة حجز موجودة)؛ وإلا ⇒ 'available'. كل تغيّر
--     حالة يُسجَّل صفّاً insert-only في roll_movements بمرجع 'deletion_reversal'.
--  2) حذف أمر بيع (sales_order): تحرير حجوزات الرولونات (reserved→available + فكّ
--     ربط الأمر) وتحرير حجوزات الكمية للبضائع غير الرولونية (عبر آلية
--     ecommerce_stock_reservations نفسها) — بعد اجتياز حارس التبعيات القائم.
--  3) حذف سند استلام (purchase_receipt): الرولونات التي أنشأها هذا السند
--     (source_document_id=معرّف السند) تُبطَل (is_deleted + status='voided').
--     حارس أولاً: إن كان أيٌّ منها محجوزاً/مباعاً/مسلَّماً/مقصوصاً/مستهلكاً (أي
--     حالة تتجاوز الطازج المستلَم) ⇒ رفض كامل 'has_dependents' بعناصر
--     {type:'fabric_roll', doc_number:<roll_number>} (سقف 10 + عدد).
--  4) حارس سلامة الحالة (كل الحالات): قبل عكس أي رول، يُتحقَّق أنه في الحالة التي
--     تركه فيها تنفيذ المستند؛ إن انتقل (عاد/بيع ثانية/قُصّ) ⇒ رفض 'rolls_state_changed'
--     بقائمة الرولونات المخالفة (نفس شكل blocking_dependents). لا إصلاح أعمى.
--
-- مفاتيح إرجاع delete_document_soft الجديدة (اختيارية):
--   rolls_returned، rolls_rereserved، rolls_voided، reservations_released.
--
-- القواعد (كالمرحلتين 1+2): تسامح NULL-auth، منطق القيد inline بلا مساس،
--   DDL دفاعي، غلاف EXCEPTION، FOR UPDATE، تاريخ insert-only (لا UPDATE/DELETE
--   لأي صفّ حركة/سجل رول — أعمدة حالة fabric_rolls نفسها قابلة للتحديث وهذا هو
--   المقصود)، أنواع صريحة للدوال المثقلة، قفل الفترة على تاريخ المستند.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- (0) DDL دفاعي: أعلام الحذف على fabric_rolls + جدول سجل الرول +
--     فهارس الالتقاط (كله داخل حرّاس to_regclass — الجداول قد تغيب محلياً)
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF to_regclass('public.fabric_rolls') IS NOT NULL THEN
        ALTER TABLE public.fabric_rolls
            ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS deleted_by    UUID,
            ADD COLUMN IF NOT EXISTS delete_reason TEXT,
            -- أعمدة ربط المصدر: موجودة على السحابة، غائبة عن مخطط 00009 المحلي —
            -- تُضاف دفاعياً كي لا تفشل قنوات الالتقاط الساكنة على النسخة المحلية
            ADD COLUMN IF NOT EXISTS source_type            TEXT,
            ADD COLUMN IF NOT EXISTS source_document_id     UUID,
            ADD COLUMN IF NOT EXISTS source_document_number TEXT;

        CREATE INDEX IF NOT EXISTS idx_fabric_rolls_active
            ON public.fabric_rolls (company_id, status)
            WHERE is_deleted = false;

        CREATE INDEX IF NOT EXISTS idx_fabric_rolls_source_doc
            ON public.fabric_rolls (source_document_id)
            WHERE source_document_id IS NOT NULL;
    END IF;
END $$;

-- جدول سجل الرول القانوني (غائب عن السحابة) — يُنشأ بأعمدة متسامحة مع NULL كي
-- يعمل التسجيل تحت installer (auth.uid()=NULL). إن وُجد سلفاً (نسخة محلية من
-- 00009) فـIF NOT EXISTS يتخطّاه ويُستخدم كما هو (التسجيل best-effort يحتمل صرامته).
CREATE TABLE IF NOT EXISTS public.roll_movements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID,
    company_id       UUID,
    roll_id          UUID,
    movement_number  VARCHAR(50),
    movement_date    DATE DEFAULT CURRENT_DATE,
    movement_time    TIME DEFAULT CURRENT_TIME,
    movement_type    VARCHAR(30),
    quantity         DECIMAL(10,2) DEFAULT 0,
    length_before    DECIMAL(10,2) DEFAULT 0,
    length_after     DECIMAL(10,2) DEFAULT 0,
    from_warehouse_id UUID,
    to_warehouse_id  UUID,
    reference_type   VARCHAR(50),
    reference_id     UUID,
    reference_number VARCHAR(100),
    notes            TEXT,
    created_by       UUID,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roll_movements_ref_p3
    ON public.roll_movements (reference_type, reference_id);


-- ═══════════════════════════════════════════════════════════════
-- (1) مساعد داخلي: doc_log_roll_movement
--     يُسجّل تغيّر حالة رولٍ صفّاً insert-only في roll_movements (best-effort:
--     أي فشل تسجيل — عمود NOT NULL على نسخة صارمة، جدول غائب — يُبتلع كي لا
--     يُجهض الحذف الذرّي؛ السجل تدقيقي لا محاسبي). لا يمسّ inventory_stock.
--     داخلي فقط — لا GRANT لأحد.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_log_roll_movement(
    p_roll_id    UUID,
    p_mv_type    TEXT,
    p_ref_type   TEXT,
    p_ref_id     UUID,
    p_ref_number TEXT,
    p_reason     TEXT,
    p_user_id    UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_roll RECORD;
BEGIN
    IF p_roll_id IS NULL OR to_regclass('public.roll_movements') IS NULL THEN
        RETURN;
    END IF;

    BEGIN
        SELECT tenant_id, company_id, warehouse_id,
               COALESCE(current_length, 0) AS len, roll_number
          INTO v_roll
          FROM public.fabric_rolls WHERE id = p_roll_id;

        INSERT INTO public.roll_movements (
            tenant_id, company_id, roll_id,
            movement_number, movement_date, movement_type,
            quantity, length_before, length_after,
            from_warehouse_id, to_warehouse_id,
            reference_type, reference_id, reference_number,
            notes, created_by
        ) VALUES (
            v_roll.tenant_id, v_roll.company_id, p_roll_id,
            'RDEL-' || LEFT(p_roll_id::text, 8), CURRENT_DATE, COALESCE(p_mv_type, 'status_change'),
            0, v_roll.len, v_roll.len,
            v_roll.warehouse_id, v_roll.warehouse_id,
            p_ref_type, p_ref_id, COALESCE(p_ref_number, v_roll.roll_number),
            'عكس تلقائي للحذف: ' || COALESCE(p_reason, ''), p_user_id
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;  -- best-effort: لا يُجهض الحذف الذرّي لأجل صفّ سجل
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_log_roll_movement(UUID, TEXT, TEXT, UUID, TEXT, TEXT, UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (2) مساعد داخلي: doc_collect_delivery_rolls — قراءة فقط
--     يجمع رولونات مستند تسليم عبر ثلاث قنوات (dedup) ويطبّق حارس سلامة الحالة:
--     رول «أخرجه» التسليم يجب أن يكون status IN ('sold','delivered')؛ أي رول
--     انتقل عن ذلك (عاد/متاح/محجوز/مقصوص) = مخالف. الرولونات المحذوفة سلفاً
--     تُتجاهَل (idempotent). يعيد:
--       { total, roll_ids:[uuid...], bad_rolls:[{type,doc_number}], bad_count }
--     bad_rolls مسقوفة بـ10 (+ bad_count الكلّي) كنمط blocking_dependents.
--     داخلي فقط — لا GRANT لأحد.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_collect_delivery_rolls(
    p_doc_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_ids      UUID[] := '{}';
    v_rec      RECORD;
    v_roll_ids JSONB := '[]'::jsonb;
    v_bad      JSONB := '[]'::jsonb;
    v_bad_cnt  INT := 0;
    v_total    INT := 0;
BEGIN
    IF p_doc_id IS NULL OR to_regclass('public.fabric_rolls') IS NULL THEN
        RETURN jsonb_build_object('total', 0, 'roll_ids', '[]'::jsonb,
                                  'bad_rolls', '[]'::jsonb, 'bad_count', 0);
    END IF;

    -- القناة 1: بنود إذن التسليم (delivery_note_items.roll_id)
    IF to_regclass('public.delivery_note_items') IS NOT NULL THEN
        SELECT array_agg(DISTINCT roll_id) INTO v_ids
        FROM (
            SELECT roll_id FROM public.delivery_note_items
            WHERE delivery_note_id = p_doc_id AND roll_id IS NOT NULL
            UNION
            SELECT unnest(COALESCE(v_ids, '{}'::uuid[]))
        ) q WHERE roll_id IS NOT NULL;
    END IF;

    -- القناة 2: حركات المخزون بمرجع المستند (inventory_movements.roll_id)
    IF to_regclass('public.inventory_movements') IS NOT NULL THEN
        SELECT array_agg(DISTINCT roll_id) INTO v_ids
        FROM (
            SELECT roll_id FROM public.inventory_movements
            WHERE reference_id = p_doc_id AND roll_id IS NOT NULL
              AND COALESCE(reference_type, '') NOT LIKE '%deletion_reversal'
            UNION
            SELECT unnest(COALESCE(v_ids, '{}'::uuid[]))
        ) q WHERE roll_id IS NOT NULL;
    END IF;

    -- القناة 3: ربط المصدر على الرول نفسه (fabric_rolls.source_document_id)
    SELECT array_agg(DISTINCT roll_id) INTO v_ids
    FROM (
        SELECT id AS roll_id FROM public.fabric_rolls
        WHERE source_document_id = p_doc_id
        UNION
        SELECT unnest(COALESCE(v_ids, '{}'::uuid[]))
    ) q WHERE roll_id IS NOT NULL;

    IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('total', 0, 'roll_ids', '[]'::jsonb,
                                  'bad_rolls', '[]'::jsonb, 'bad_count', 0);
    END IF;

    -- فحص كل رول غير محذوف: يجب أن يكون خارجاً (sold/delivered)
    FOR v_rec IN
        SELECT id, roll_number, status
        FROM public.fabric_rolls
        WHERE id = ANY(v_ids)
          AND COALESCE(is_deleted, false) = false
        ORDER BY roll_number
    LOOP
        v_total := v_total + 1;
        IF lower(COALESCE(v_rec.status, '')) NOT IN ('sold', 'delivered') THEN
            v_bad_cnt := v_bad_cnt + 1;
            IF jsonb_array_length(v_bad) < 10 THEN
                v_bad := v_bad || jsonb_build_object(
                    'type', 'fabric_roll',
                    'doc_number', COALESCE(v_rec.roll_number, LEFT(v_rec.id::text, 8)));
            END IF;
        ELSE
            v_roll_ids := v_roll_ids || to_jsonb(v_rec.id);
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'total', v_total,
        'roll_ids', v_roll_ids,
        'bad_rolls', v_bad,
        'bad_count', v_bad_cnt);
END;
$$;

REVOKE ALL ON FUNCTION public.doc_collect_delivery_rolls(UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (3) مساعد داخلي: doc_return_delivery_rolls — كتابة
--     يُعيد رولونات التسليم (التي اجتازت حارس الحالة) إلى p_target_status
--     ('reserved' إن كان الأمر نشطاً، وإلا 'available')، نفس المستودع/الموقع
--     (لا نلمس warehouse_id/bin_location_id). يُسجّل كل تغيّر صفّاً في
--     roll_movements بمرجع 'deletion_reversal'. إن كان الهدف 'reserved' وجدول
--     roll_reservations يملك عمودَي ربط (reference_type/reference_id) — يُعاد
--     تنشيط/إدراج حجزٍ ديناميكياً (best-effort؛ غائب عن السحابة). يعيد عدد
--     الرولونات المُعادة. داخلي فقط — لا GRANT لأحد.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_return_delivery_rolls(
    p_doc_id        UUID,
    p_target_status TEXT,
    p_order_id      UUID,
    p_reason        TEXT,
    p_user_id       UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_ids   UUID[] := '{}';
    v_rec   RECORD;
    v_count INT := 0;
    v_has_ref_cols BOOLEAN := false;
BEGIN
    IF p_doc_id IS NULL OR to_regclass('public.fabric_rolls') IS NULL THEN
        RETURN 0;
    END IF;

    -- إعادة الجمع بنفس القنوات الثلاث (نفس منطق doc_collect_delivery_rolls)
    IF to_regclass('public.delivery_note_items') IS NOT NULL THEN
        SELECT array_agg(DISTINCT roll_id) INTO v_ids FROM (
            SELECT roll_id FROM public.delivery_note_items
            WHERE delivery_note_id = p_doc_id AND roll_id IS NOT NULL
            UNION SELECT unnest(COALESCE(v_ids, '{}'::uuid[]))
        ) q WHERE roll_id IS NOT NULL;
    END IF;
    IF to_regclass('public.inventory_movements') IS NOT NULL THEN
        SELECT array_agg(DISTINCT roll_id) INTO v_ids FROM (
            SELECT roll_id FROM public.inventory_movements
            WHERE reference_id = p_doc_id AND roll_id IS NOT NULL
              AND COALESCE(reference_type, '') NOT LIKE '%deletion_reversal'
            UNION SELECT unnest(COALESCE(v_ids, '{}'::uuid[]))
        ) q WHERE roll_id IS NOT NULL;
    END IF;
    SELECT array_agg(DISTINCT roll_id) INTO v_ids FROM (
        SELECT id AS roll_id FROM public.fabric_rolls WHERE source_document_id = p_doc_id
        UNION SELECT unnest(COALESCE(v_ids, '{}'::uuid[]))
    ) q WHERE roll_id IS NOT NULL;

    IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
        RETURN 0;
    END IF;

    v_has_ref_cols := EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='roll_reservations'
          AND column_name='reference_id')
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='roll_reservations'
          AND column_name='reference_type');

    -- إعادة الحالة (خارج فقط: sold/delivered) — القفل ثم التحديث ثم التسجيل
    FOR v_rec IN
        SELECT id, roll_number FROM public.fabric_rolls
        WHERE id = ANY(v_ids)
          AND COALESCE(is_deleted, false) = false
          AND lower(COALESCE(status, '')) IN ('sold', 'delivered')
        FOR UPDATE
    LOOP
        UPDATE public.fabric_rolls
        SET status = p_target_status, updated_at = NOW()
        WHERE id = v_rec.id;

        PERFORM public.doc_log_roll_movement(
            v_rec.id, 'status_change', 'deletion_reversal', p_doc_id,
            v_rec.roll_number, p_reason, p_user_id);

        -- إعادة تنشيط حجز الرول للأمر (ديناميكي؛ فقط إن كان الهدف محجوزاً وأمكن الربط)
        IF p_target_status = 'reserved' AND v_has_ref_cols AND p_order_id IS NOT NULL THEN
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema='public' AND table_name='roll_reservations'
                             AND column_name='reserved_length') THEN
                    -- مخطط 00009 المحلي: reserved_length NOT NULL — طول الرول كاملاً
                    EXECUTE 'INSERT INTO public.roll_reservations
                                (tenant_id, company_id, roll_id, reserved_length, status,
                                 reference_type, reference_id, reserved_at, reserved_by)
                             SELECT fr.tenant_id, fr.company_id, fr.id,
                                    COALESCE(fr.current_length, 0), ''active'',
                                    ''sales_order'', $2, NOW(), $3
                             FROM public.fabric_rolls fr WHERE fr.id = $1'
                    USING v_rec.id, p_order_id, p_user_id;
                ELSE
                    EXECUTE 'INSERT INTO public.roll_reservations
                                (tenant_id, company_id, material_id, roll_id, status,
                                 reference_type, reference_id, reserved_at, created_by)
                             SELECT fr.tenant_id, fr.company_id, fr.material_id, fr.id, ''active'',
                                    ''sales_order'', $2, NOW(), $3
                             FROM public.fabric_rolls fr WHERE fr.id = $1'
                    USING v_rec.id, p_order_id, p_user_id;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;  -- best-effort: اختلاف مخطط roll_reservations لا يُجهض الحذف
            END;
        END IF;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_return_delivery_rolls(UUID, TEXT, UUID, TEXT, UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (4) مساعد داخلي: doc_collect_receipt_rolls — قراءة فقط
--     رولونات أنشأها سند الاستلام (fabric_rolls.source_document_id=السند).
--     «الطازج المستلَم» = status IN ('available','in_stock','draft')
--        AND reserved_length=0 AND current_length >= initial_length.
--     أي رول تجاوز ذلك (محجوز/مباع/مسلَّم/مقصوص/مستهلك) ⇒ مخالف يمنع الحذف كلّه.
--     يعيد { total, roll_ids:[uuid...voidable], bad_rolls:[{type,doc_number}], bad_count }.
--     داخلي فقط — لا GRANT لأحد.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_collect_receipt_rolls(
    p_doc_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_rec      RECORD;
    v_roll_ids JSONB := '[]'::jsonb;
    v_bad      JSONB := '[]'::jsonb;
    v_bad_cnt  INT := 0;
    v_total    INT := 0;
BEGIN
    IF p_doc_id IS NULL OR to_regclass('public.fabric_rolls') IS NULL THEN
        RETURN jsonb_build_object('total', 0, 'roll_ids', '[]'::jsonb,
                                  'bad_rolls', '[]'::jsonb, 'bad_count', 0);
    END IF;

    FOR v_rec IN
        SELECT id, roll_number, status,
               COALESCE(reserved_length, 0) AS rl,
               COALESCE(current_length, 0)  AS cl,
               COALESCE(initial_length, 0)  AS il
        FROM public.fabric_rolls
        WHERE source_document_id = p_doc_id
          AND COALESCE(is_deleted, false) = false
        ORDER BY roll_number
    LOOP
        v_total := v_total + 1;
        IF lower(COALESCE(v_rec.status, '')) NOT IN ('available', 'in_stock', 'draft')
           OR v_rec.rl > 0
           OR v_rec.cl < v_rec.il THEN
            v_bad_cnt := v_bad_cnt + 1;
            IF jsonb_array_length(v_bad) < 10 THEN
                v_bad := v_bad || jsonb_build_object(
                    'type', 'fabric_roll',
                    'doc_number', COALESCE(v_rec.roll_number, LEFT(v_rec.id::text, 8)));
            END IF;
        ELSE
            v_roll_ids := v_roll_ids || to_jsonb(v_rec.id);
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'total', v_total, 'roll_ids', v_roll_ids,
        'bad_rolls', v_bad, 'bad_count', v_bad_cnt);
END;
$$;

REVOKE ALL ON FUNCTION public.doc_collect_receipt_rolls(UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (5) مساعد داخلي: doc_void_receipt_rolls — كتابة
--     يُبطِل رولونات السند الطازجة (is_deleted=true + status='voided') ويُسجّل
--     كل إبطال صفّاً في roll_movements. يعيد العدد. داخلي فقط — لا GRANT.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_void_receipt_rolls(
    p_doc_id  UUID,
    p_reason  TEXT,
    p_user_id UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_rec   RECORD;
    v_count INT := 0;
BEGIN
    IF p_doc_id IS NULL OR to_regclass('public.fabric_rolls') IS NULL THEN
        RETURN 0;
    END IF;

    FOR v_rec IN
        SELECT id, roll_number FROM public.fabric_rolls
        WHERE source_document_id = p_doc_id
          AND COALESCE(is_deleted, false) = false
        FOR UPDATE
    LOOP
        UPDATE public.fabric_rolls
        SET status = 'voided', is_deleted = true, deleted_at = NOW(),
            deleted_by = p_user_id, delete_reason = p_reason, updated_at = NOW()
        WHERE id = v_rec.id;

        PERFORM public.doc_log_roll_movement(
            v_rec.id, 'status_change', 'deletion_reversal', p_doc_id,
            v_rec.roll_number, p_reason, p_user_id);

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_void_receipt_rolls(UUID, TEXT, UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (6) مساعد داخلي: doc_release_order_reservations — كتابة
--     عند حذف أمر بيع (بعد اجتياز حارس التبعيات): يحرّر حجوزات الرولونات
--     (reserved→available + فكّ ربط الأمر) وحجوزات الكمية (غير الرولونية) عبر
--     آلية cancel_ecom_order_cascade نفسها (ecommerce_stock_reservations
--     status→'released'). يعيد { rolls_released, reservations_released }.
--     • رولونات محجوزة للأمر: (أ) fabric_rolls.source_document_id=الأمر و
--       status='reserved' ⇒ available؛ (ب) عبر roll_reservations إن ملك
--       عمودَي ربط (ديناميكي): حجوزات نشطة تشير للأمر ⇒ status='released' +
--       الرول reserved→available. كل تحرير يُسجَّل صفّاً في roll_movements.
--     • حجوزات الكمية: ecommerce_stock_reservations — الربط بالأمر ديناميكي:
--       عمود sales_order_id إن وُجد، وإلا عبر ecommerce_orders.sales_order_id
--       (مسار الإيكوم مُستبعَد فعلاً بأعلى الفرع فيعطي 0 للأوامر العادية —
--       لكنه صحيح دفاعياً). status NOT IN ('released','deducted') ⇒ 'released'.
--     داخلي فقط — لا GRANT لأحد.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.doc_release_order_reservations(
    p_doc_id  UUID,
    p_reason  TEXT,
    p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_rec       RECORD;
    v_rolls     INT := 0;
    v_resv      INT := 0;
    v_n         INT := 0;
    v_has_ref   BOOLEAN := false;
    v_has_esr_so BOOLEAN := false;
BEGIN
    IF p_doc_id IS NULL THEN
        RETURN jsonb_build_object('rolls_released', 0, 'reservations_released', 0);
    END IF;

    -- (أ) رولونات محجوزة عبر ربط المصدر المباشر
    IF to_regclass('public.fabric_rolls') IS NOT NULL THEN
        FOR v_rec IN
            SELECT id, roll_number FROM public.fabric_rolls
            WHERE source_document_id = p_doc_id
              AND lower(COALESCE(status, '')) = 'reserved'
              AND COALESCE(is_deleted, false) = false
            FOR UPDATE
        LOOP
            UPDATE public.fabric_rolls
            SET status = 'available', updated_at = NOW() WHERE id = v_rec.id;
            PERFORM public.doc_log_roll_movement(
                v_rec.id, 'status_change', 'deletion_reversal', p_doc_id,
                v_rec.roll_number, p_reason, p_user_id);
            v_rolls := v_rolls + 1;
        END LOOP;
    END IF;

    -- (ب) رولونات محجوزة عبر جدول roll_reservations (إن ملك عمودَي ربط)
    v_has_ref := to_regclass('public.roll_reservations') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='roll_reservations'
                    AND column_name='reference_id');
    IF v_has_ref THEN
        BEGIN
            FOR v_rec IN EXECUTE
                'SELECT rr.id AS resv_id, rr.roll_id, fr.roll_number
                 FROM public.roll_reservations rr
                 JOIN public.fabric_rolls fr ON fr.id = rr.roll_id
                 WHERE rr.reference_id = $1
                   AND COALESCE(rr.status, ''active'') = ''active'''
                USING p_doc_id
            LOOP
                EXECUTE 'UPDATE public.roll_reservations
                         SET status = ''released'' WHERE id = $1' USING v_rec.resv_id;
                UPDATE public.fabric_rolls
                SET status = 'available', updated_at = NOW()
                WHERE id = v_rec.roll_id
                  AND lower(COALESCE(status, '')) = 'reserved'
                  AND COALESCE(is_deleted, false) = false;
                PERFORM public.doc_log_roll_movement(
                    v_rec.roll_id, 'status_change', 'deletion_reversal', p_doc_id,
                    v_rec.roll_number, p_reason, p_user_id);
                v_rolls := v_rolls + 1;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            NULL;  -- اختلاف مخطط roll_reservations لا يُجهض الحذف
        END;
    END IF;

    -- (ج) حجوزات الكمية (غير الرولونية) — نفس آلية cancel_ecom_order_cascade
    IF to_regclass('public.ecommerce_stock_reservations') IS NOT NULL THEN
        v_has_esr_so := EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='public'
                                  AND table_name='ecommerce_stock_reservations'
                                  AND column_name='sales_order_id');
        BEGIN
            IF v_has_esr_so THEN
                EXECUTE
                    'UPDATE public.ecommerce_stock_reservations
                     SET status = ''released'', released_at = NOW()
                     WHERE sales_order_id = $1
                       AND COALESCE(status, '''') NOT IN (''released'', ''deducted'')'
                USING p_doc_id;
                GET DIAGNOSTICS v_n = ROW_COUNT;
                v_resv := v_resv + v_n;
            END IF;
            IF to_regclass('public.ecommerce_orders') IS NOT NULL
               AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema='public' AND table_name='ecommerce_orders'
                             AND column_name='sales_order_id') THEN
                EXECUTE
                    'UPDATE public.ecommerce_stock_reservations esr
                     SET status = ''released'', released_at = NOW()
                     FROM public.ecommerce_orders eo
                     WHERE eo.sales_order_id = $1 AND esr.order_id = eo.id
                       AND COALESCE(esr.status, '''') NOT IN (''released'', ''deducted'')'
                USING p_doc_id;
                GET DIAGNOSTICS v_n = ROW_COUNT;
                v_resv := v_resv + v_n;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;  -- اختلاف مخطط الحجوزات لا يُجهض الحذف
        END;
    END IF;

    RETURN jsonb_build_object('rolls_released', v_rolls, 'reservations_released', v_resv);
END;
$$;

REVOKE ALL ON FUNCTION public.doc_release_order_reservations(UUID, TEXT, UUID) FROM public;


-- ═══════════════════════════════════════════════════════════════
-- (7) الحذف الناعم: delete_document_soft — موسَّعة بمعالجة الرولونات/الحجوزات
--     العقد: RETURNS jsonb →
--            {success, error?, reversal_je_id?, cogs_reversal_je_id?,
--             reversing_movements?, blocking_dependents?,
--             rolls_returned?, rolls_rereserved?, rolls_voided?,
--             reservations_released?}
--     فروع المرحلتين 1+2 مطابقة بايتاً لـ20260714150000؛ الحقن فقط في:
--     purchase_receipt / sales_delivery / delivery_note / sales_order.
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
    -- Phase-3 (رولونات/حجوزات)
    v_roll_scan JSONB;
    v_roll_res  JSONB;
    v_rolls_returned    INT := 0;
    v_rolls_rereserved  INT := 0;
    v_rolls_voided      INT := 0;
    v_resv_released     INT := 0;
    v_roll_target       TEXT;
    v_order_id          UUID;
    v_order_active      BOOLEAN := false;
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

        -- ── [Phase-3] حارس الرولونات أولاً: رولونات أنشأها هذا السند خرجت عن
        --    «الطازج المستلَم» (محجوز/مباع/مسلَّم/مقصوص/مستهلك) ⇒ منع الحذف كلّه.
        --    القائمة مسقوفة بـ10 + blocking_dependents_count الكلّي.
        v_roll_scan := public.doc_collect_receipt_rolls(p_doc_id);
        IF COALESCE((v_roll_scan->>'bad_count')::int, 0) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'has_dependents',
                                      'blocking_dependents', v_roll_scan->'bad_rolls',
                                      'blocking_dependents_count', (v_roll_scan->>'bad_count')::int);
        END IF;

        IF jsonb_array_length(v_deps) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'has_dependents',
                                      'blocking_dependents', v_deps);
        END IF;

        -- ── الحالة (أ): غير مُرحَّل (لا حركات ولا قيد) → تعليم فقط ──
        --    [Phase-3] رولونات مسودة أنشأتها جلسة الاستلام تُبطَل أيضاً (طازجة
        --    بحكم الحارس أعلاه — draft ضمن المفردات المسموحة).
        IF NOT v_posted THEN
            v_rolls_voided := public.doc_void_receipt_rolls(
                                  p_doc_id,
                                  'حذف سند استلام مشتريات ' || v_label || ' — ' || v_reason,
                                  v_user_id);

            UPDATE public.purchase_receipts
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason, updated_at = NOW()
            WHERE id = p_doc_id;
            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL,
                                      'rolls_voided', v_rolls_voided);
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

        -- [Phase-3] إبطال الرولونات التي أنشأها السند (كلها طازجة بحكم الحارس):
        -- is_deleted=true + status='voided' + صف سجل insert-only لكل رول.
        v_rolls_voided := public.doc_void_receipt_rolls(
                              p_doc_id,
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
                                  'reversing_movements', v_mov_count,
                                  'rolls_voided', v_rolls_voided);
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
        --    (لم يخرج شيء ⇒ لا إرجاع رولونات؛ حارس الحالة لا ينطبق على المسودة —
        --     رولونات auto reserved أنشأتها الجلسة تبقى لمسار autoRollService)
        IF NOT v_posted THEN
            UPDATE public.sales_deliveries
            SET is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
                delete_reason = v_reason, updated_at = NOW()
            WHERE id = p_doc_id;
            RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL);
        END IF;

        -- ── [Phase-3] حارس سلامة حالة الرولونات (للمنفَّذ فقط): رول أخرجه هذا
        --    التسليم يجب أن يكون sold/delivered؛ إن انتقل (عاد/قُصّ/أعيد بيعه
        --    بحالة أخرى) ⇒ رفض كامل قبل أي عكس. لا إصلاح أعمى.
        v_roll_scan := public.doc_collect_delivery_rolls(p_doc_id);
        IF COALESCE((v_roll_scan->>'bad_count')::int, 0) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'rolls_state_changed',
                                      'blocking_dependents', v_roll_scan->'bad_rolls',
                                      'blocking_dependents_count', (v_roll_scan->>'bad_count')::int);
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

        -- ── [Phase-3] إرجاع الرولونات: نفس المعرّفات، نفس المستودع/الموقع
        --    (warehouse_id/bin_location_id لا يُمسّان). قاعدة الحالة: أمر البيع
        --    المنفَّذ (sales_deliveries.order_id) لا يزال نشطاً ⇒ 'reserved' له؛
        --    وإلا ⇒ 'available'. كل تغيّر يُسجَّل صفّاً insert-only في
        --    roll_movements بمرجع 'deletion_reversal'.
        v_order_id     := v_sd.order_id;
        v_order_active := false;
        IF v_order_id IS NOT NULL AND to_regclass('public.sales_orders') IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM public.sales_orders
                WHERE id = v_order_id
                  AND COALESCE(is_deleted, false) = false
                  AND COALESCE(status, '') <> 'cancelled'
            ) INTO v_order_active;
        END IF;
        v_roll_target := CASE WHEN v_order_active THEN 'reserved' ELSE 'available' END;

        IF v_order_active THEN
            v_rolls_rereserved := public.doc_return_delivery_rolls(
                                      p_doc_id, v_roll_target, v_order_id,
                                      'حذف تسليم مبيعات ' || v_label || ' — ' || v_reason,
                                      v_user_id);
        ELSE
            v_rolls_returned := public.doc_return_delivery_rolls(
                                    p_doc_id, v_roll_target, NULL,
                                    'حذف تسليم مبيعات ' || v_label || ' — ' || v_reason,
                                    v_user_id);
        END IF;

        UPDATE public.sales_deliveries
        SET status = 'cancelled',
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id,
                                  'cogs_reversal_je_id', v_rev_cogs,
                                  'reversing_movements', v_mov_count,
                                  'rolls_returned', v_rolls_returned,
                                  'rolls_rereserved', v_rolls_rereserved);
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

        -- ── [Phase-3] حارس سلامة حالة الرولونات (للمنفَّذ فقط) — القنوات:
        --    delivery_note_items.roll_id + الحركات + source_document_id؛
        --    المخالف ⇒ رفض 'rolls_state_changed' قبل أي عكس. لا إصلاح أعمى.
        v_roll_scan := public.doc_collect_delivery_rolls(p_doc_id);
        IF COALESCE((v_roll_scan->>'bad_count')::int, 0) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'rolls_state_changed',
                                      'blocking_dependents', v_roll_scan->'bad_rolls',
                                      'blocking_dependents_count', (v_roll_scan->>'bad_count')::int);
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

        -- ── [Phase-3] إرجاع الرولونات — نفس قاعدة تسليم المبيعات؛ ربط الأمر هنا
        --    delivery_notes.sales_order_id (قد يشير لأمر بيع أو لفاتورة موحّدة —
        --    يُفحص الجدولان، النشط في أيّهما يكفي لإعادة الحجز).
        v_order_id     := v_dn.sales_order_id;
        v_order_active := false;
        IF v_order_id IS NOT NULL THEN
            IF to_regclass('public.sales_orders') IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.sales_orders
                    WHERE id = v_order_id
                      AND COALESCE(is_deleted, false) = false
                      AND COALESCE(status, '') <> 'cancelled'
                ) INTO v_order_active;
            END IF;
            IF NOT v_order_active THEN
                -- sales_order_id في هذا النظام يحمل أحياناً معرّف sales_transactions
                SELECT EXISTS (
                    SELECT 1 FROM public.sales_transactions
                    WHERE id = v_order_id
                      AND COALESCE(is_deleted, false) = false
                      AND stage <> 'cancelled'
                ) INTO v_order_active;
            END IF;
        END IF;
        v_roll_target := CASE WHEN v_order_active THEN 'reserved' ELSE 'available' END;

        IF v_order_active THEN
            v_rolls_rereserved := public.doc_return_delivery_rolls(
                                      p_doc_id, v_roll_target, v_order_id,
                                      'حذف إذن تسليم ' || v_label || ' — ' || v_reason,
                                      v_user_id);
        ELSE
            v_rolls_returned := public.doc_return_delivery_rolls(
                                    p_doc_id, v_roll_target, NULL,
                                    'حذف إذن تسليم ' || v_label || ' — ' || v_reason,
                                    v_user_id);
        END IF;

        UPDATE public.delivery_notes
        SET status = 'cancelled',
            cancelled_at = NOW(), cancelled_by = v_user_id, cancel_reason = v_reason,
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', v_rev_id,
                                  'cogs_reversal_je_id', v_rev_cogs,
                                  'reversing_movements', v_mov_count,
                                  'rolls_returned', v_rolls_returned,
                                  'rolls_rereserved', v_rolls_rereserved);
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

        -- ── [Phase-3] تحرير الحجوزات (بعد اجتياز حارس التبعيات):
        --    رولونات reserved→available + فكّ ربط الأمر (roll_reservations إن
        --    وُجد الربط) + حجوزات الكمية غير الرولونية عبر آلية
        --    cancel_ecom_order_cascade نفسها (ecommerce_stock_reservations).
        v_roll_res := public.doc_release_order_reservations(
                          p_doc_id,
                          'حذف أمر بيع ' || v_label || ' — ' || v_reason,
                          v_user_id);
        v_rolls_returned := COALESCE((v_roll_res->>'rolls_released')::int, 0);
        v_resv_released  := COALESCE((v_roll_res->>'reservations_released')::int, 0);

        -- ── نظيف (لا قيود ولا مخزون للأوامر) → إلغاء + تعليم ──
        UPDATE public.sales_orders
        SET status = 'cancelled',
            is_deleted = true, deleted_at = NOW(), deleted_by = v_user_id,
            delete_reason = v_reason, updated_at = NOW()
        WHERE id = p_doc_id;

        RETURN jsonb_build_object('success', true, 'reversal_je_id', NULL,
                                  'rolls_returned', v_rolls_returned,
                                  'reservations_released', v_resv_released);
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
