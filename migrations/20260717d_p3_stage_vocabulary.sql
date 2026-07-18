-- ═══════════════════════════════════════════════════════════════════════════
-- P3 — توحيد مفردات مراحل المشتريات (Purchase Stage Vocabulary Unification)
-- ───────────────────────────────────────────────────────────────────────────
-- القاموس القانوني المعتمد للمشتريات (مفردات الواجهة/الشرائح):
--   request → quotation → draft → confirmed → (partially_received) → received → posted
--   + cancelled (من أي مرحلة مبكرة) ، + إعادة الفتح (cancelled → draft)
--   + تصحيحات كانبان المبكرة (request↔quotation↔draft)
--
-- ما يفعله هذا الملف:
--   1) توسيع قيد CHECK على purchase_transactions.stage ليقبل 'partially_received'
--      (القيمة الوحيدة الناقصة من القاموس القانوني).
--   2) إعادة تعريف is_valid_stage_transition:
--        • فرع المشتريات: القاموس القانوني الكامل + المرادفات القديمة
--          (order/approved/receipt/invoice/partial_paid/paid) كي لا تنكسر بيانات/مسارات قائمة.
--        • فرع المبيعات: منسوخ حرفياً كما هو — بلا أي تغيير.
--
-- كله idempotent (DROP … IF EXISTS + CREATE OR REPLACE).
-- يُطبَّق على الإنتاج عبر Supabase MCP execute_sql (لا psql على هذا الجهاز).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) قيد CHECK: إضافة partially_received إلى القاموس المقبول ──────────────
ALTER TABLE public.purchase_transactions
    DROP CONSTRAINT IF EXISTS purchase_transactions_stage_check;

ALTER TABLE public.purchase_transactions
    ADD CONSTRAINT purchase_transactions_stage_check
    CHECK (stage = ANY (ARRAY[
        'request'::text,
        'quotation'::text,
        'draft'::text,
        'confirmed'::text,
        'partially_received'::text,
        'received'::text,
        'posted'::text,
        'cancelled'::text
    ]));

-- ── 2) محرّك التحقّق من الانتقالات ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_valid_stage_transition(p_type text, p_from text, p_to text)
    RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
    BEGIN
        IF p_type = 'purchase' THEN
            RETURN (p_from, p_to) IN (
                -- ═══ القاموس القانوني (مفردات الشرائح) ═══
                -- طلب الشراء (request) — أول حلقة
                ('request', 'quotation'),
                ('request', 'draft'),
                ('request', 'cancelled'),
                -- عرض السعر (quotation)
                ('quotation', 'request'),        -- تصحيح كانبان
                ('quotation', 'draft'),
                ('quotation', 'cancelled'),
                -- مسودة الفاتورة (draft)
                ('draft', 'request'),            -- تصحيح كانبان
                ('draft', 'quotation'),          -- تصحيح كانبان
                ('draft', 'confirmed'),
                ('draft', 'cancelled'),
                -- مؤكدة (confirmed)
                ('confirmed', 'partially_received'),
                ('confirmed', 'received'),
                ('confirmed', 'posted'),
                ('confirmed', 'draft'),          -- إلغاء التأكيد
                ('confirmed', 'cancelled'),
                -- مستلمة جزئياً (partially_received)
                ('partially_received', 'received'),
                ('partially_received', 'posted'),
                ('partially_received', 'cancelled'),
                -- مستلمة (received)
                ('received', 'posted'),
                ('received', 'cancelled'),
                -- مُرحّلة (posted) → سداد
                ('posted', 'partial_paid'),
                ('posted', 'paid'),
                ('partial_paid', 'paid'),
                -- ملغاة → إعادة فتح
                ('cancelled', 'draft'),

                -- ═══ مرادفات قديمة (backward-compat: مسارات/بيانات قائمة) ═══
                ('draft', 'order'),
                ('draft', 'invoice'),
                ('confirmed', 'invoice'),
                ('confirmed', 'receipt'),
                ('quotation', 'order'),
                ('quotation', 'invoice'),
                ('order', 'approved'),
                ('order', 'cancelled'),
                ('approved', 'receipt'),
                ('approved', 'invoice'),
                ('approved', 'cancelled'),
                ('receipt', 'invoice'),
                ('receipt', 'cancelled'),
                ('invoice', 'posted'),
                ('invoice', 'cancelled')
            );
        END IF;

        IF p_type = 'sale' THEN
            RETURN (p_from, p_to) IN (
                ('draft', 'confirmed'),
                ('draft', 'quotation'),
                ('draft', 'order'),
                ('draft', 'invoice'),
                ('draft', 'cancelled'),
                ('confirmed', 'in_delivery'),
                ('confirmed', 'delivery'),
                ('confirmed', 'invoice'),
                ('confirmed', 'cancelled'),
                ('in_delivery', 'delivered'),
                ('in_delivery', 'confirmed'),
                ('in_delivery', 'cancelled'),
                ('in_delivery', 'posted'),
                ('in_delivery', 'in_transit'),
                ('in_transit', 'at_branch'),
                ('in_transit', 'confirmed'),
                ('at_branch', 'delivered'),
                ('at_branch', 'confirmed'),
                ('confirmed', 'sent_to_branch'),
                ('in_delivery', 'sent_to_branch'),
                ('sent_to_branch', 'delivered'),
                ('sent_to_branch', 'in_transit'),
                ('sent_to_branch', 'confirmed'),
                ('sent_to_branch', 'posted'),
                ('delivered', 'invoice'),
                ('delivered', 'posted'),
                ('delivered', 'cancelled'),
                ('quotation', 'reservation'),
                ('quotation', 'order'),
                ('quotation', 'cancelled'),
                ('reservation', 'order'),
                ('reservation', 'cancelled'),
                ('order', 'delivery'),
                ('order', 'in_delivery'),
                ('order', 'invoice'),
                ('order', 'cancelled'),
                ('delivery', 'invoice'),
                ('delivery', 'cancelled'),
                ('invoice', 'posted'),
                ('invoice', 'cancelled'),
                ('posted', 'partial_paid'),
                ('posted', 'paid'),
                ('partial_paid', 'paid'),
                ('cancelled', 'draft')
            );
        END IF;

        RETURN false;
    END;
    $function$;
