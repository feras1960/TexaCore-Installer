-- ════════════════════════════════════════════════════════════════
-- 🏭 20260718d — Pallets (رصّ الأكياس/الخام على باليتات) — Manufacturing
-- ────────────────────────────────────────────────────────────────
-- المالك: رصّ أكياس اللواصق المُنتَجة على باليتات (مدى تسلسلي متّصل من الأكياس)
--   + باليتات خام (كمية حرّة). كل باليت رقمه الفريد PLT-YYYY-NNNNN + QR
--   (رابط تحقّق عام مستقبلي /q/p/<pallet>). يبني على رموز الأكياس (20260718b).
-- Idempotent · RLS قانوني (نمط mfg_bag_codes) + حارس الموديول · doc_type 'PLT'.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0) توسعة generate_mfg_number لدعم بادئة PLT (PLT-YYYY-NNNNN) ──
-- (استبدال كامل؛ الإضافة الوحيدة WHEN 'PLT' THEN 'PLT'.)
CREATE OR REPLACE FUNCTION public.generate_mfg_number(
    p_tenant_id uuid, p_company_id uuid, p_doc_type text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_year   int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
    v_seq    int;
    v_type   text := upper(COALESCE(p_doc_type,'DOC'));
    v_prefix text;
BEGIN
    v_prefix := CASE v_type
        WHEN 'ORD' THEN 'MFG-ORD' WHEN 'ISS' THEN 'MFG-ISS'
        WHEN 'RET' THEN 'MFG-RET' WHEN 'RCT' THEN 'MFG-RCT'
        WHEN 'PLT' THEN 'PLT'
        ELSE 'MFG-' || v_type END;
    INSERT INTO public.mfg_number_sequences (tenant_id, company_id, doc_type, year, last_seq)
    VALUES (p_tenant_id, p_company_id, v_type, v_year, 1)
    ON CONFLICT (tenant_id, company_id, doc_type, year)
    DO UPDATE SET last_seq = public.mfg_number_sequences.last_seq + 1, updated_at = now()
    RETURNING last_seq INTO v_seq;
    RETURN v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');
END;
$fn$;

-- ─── 1) بوابة الإعداد لكل مخرَج: كم كيساً لكل باليت (config افتراضي) ──
ALTER TABLE public.mfg_bom_outputs
    ADD COLUMN IF NOT EXISTS bags_per_pallet int;
COMMENT ON COLUMN public.mfg_bom_outputs.bags_per_pallet IS
    'العدد الافتراضي للأكياس على الباليت الواحد لهذا المخرَج (يُملأ به حوار التوزيع مسبقاً).';

-- ─── 2) جدول الباليتات ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_pallets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL,
    company_id      uuid NOT NULL,
    pallet_number   text NOT NULL,
    content_type    text NOT NULL DEFAULT 'bags'
                    CHECK (content_type IN ('bags','bulk')),
    product_id      uuid,
    batch_id        uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
    receipt_line_id uuid REFERENCES public.mfg_finished_receipt_lines(id) ON DELETE SET NULL,
    bag_count       int,                        -- عدد أكياس الباليت (content=bags)
    bag_from_seq    int,                        -- أول تسلسل كيس على الباليت
    bag_to_seq      int,                        -- آخر تسلسل كيس على الباليت
    qty             numeric,                    -- كمية الخام (content=bulk)
    warehouse_id    uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
    status          text NOT NULL DEFAULT 'closed'
                    CHECK (status IN ('open','closed','shipped')),
    qr_payload      text,
    notes           text,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, pallet_number)
);
COMMENT ON TABLE public.mfg_pallets IS
    'باليت مُرقّم (PLT-YYYY-NNNNN): إمّا مدى أكياس متّصل (content=bags) أو كمية خام (content=bulk). QR للتحقّق العام مستقبلاً.';

CREATE INDEX IF NOT EXISTS mfg_pallets_tenant_idx  ON public.mfg_pallets(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS mfg_pallets_line_idx    ON public.mfg_pallets(receipt_line_id);
CREATE INDEX IF NOT EXISTS mfg_pallets_batch_idx   ON public.mfg_pallets(batch_id);
CREATE INDEX IF NOT EXISTS mfg_pallets_product_idx ON public.mfg_pallets(product_id);

ALTER TABLE public.mfg_pallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfg_pallets_select_policy       ON public.mfg_pallets;
DROP POLICY IF EXISTS mfg_pallets_insert_policy       ON public.mfg_pallets;
DROP POLICY IF EXISTS mfg_pallets_update_policy       ON public.mfg_pallets;
DROP POLICY IF EXISTS mfg_pallets_delete_policy       ON public.mfg_pallets;
DROP POLICY IF EXISTS mfg_pallets_module_guard        ON public.mfg_pallets;
DROP POLICY IF EXISTS mfg_pallets_module_guard_insert ON public.mfg_pallets;
DROP POLICY IF EXISTS mfg_pallets_module_guard_update ON public.mfg_pallets;

CREATE POLICY mfg_pallets_select_policy ON public.mfg_pallets
    FOR SELECT TO public
    USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
CREATE POLICY mfg_pallets_insert_policy ON public.mfg_pallets
    FOR INSERT TO authenticated
    WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_pallets_update_policy ON public.mfg_pallets
    FOR UPDATE TO authenticated
    USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_pallets_delete_policy ON public.mfg_pallets
    FOR DELETE TO authenticated
    USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_pallets_module_guard ON public.mfg_pallets
    FOR SELECT TO public USING (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_pallets_module_guard_insert ON public.mfg_pallets
    FOR INSERT TO public WITH CHECK (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_pallets_module_guard_update ON public.mfg_pallets
    FOR UPDATE TO public USING (tenant_has_module('manufacturing'::text));

-- ─── 3) ربط رموز الأكياس بالباليت ─────────────────────────────────
ALTER TABLE public.mfg_bag_codes
    ADD COLUMN IF NOT EXISTS pallet_id uuid REFERENCES public.mfg_pallets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS mfg_bag_codes_pallet_idx ON public.mfg_bag_codes(pallet_id);

-- ─── 4) RPC: توزيع أكياس سطر استلام على باليتات ───────────────────
-- يقسّم أكياس السطر (بترتيب bag_seq المتّصل) إلى مجموعات بحجم N، وينشئ باليتاً
-- لكل مجموعة (بما فيها الأخيرة الجزئية) ويختم pallet_id على كل رمز.
-- idempotent: يتخطّى الأكياس المرصوصة سلفاً (pallet_id IS NOT NULL).
-- N = الوسيط || config المخرَج (bags_per_pallet) || خطأ.
CREATE OR REPLACE FUNCTION public.palletize_receipt_line(
    p_line_id uuid, p_bags_per_pallet int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_line     public.mfg_finished_receipt_lines%ROWTYPE;
    v_rcp      public.mfg_finished_receipts%ROWTYPE;
    v_ord      public.mfg_production_orders%ROWTYPE;
    v_n        int;
    v_wh       uuid;
    v_pending  int;
    v_made     int := 0;
    v_remainder int := 0;
    v_bag      RECORD;
    v_pallet_id uuid;
    v_pallet_no text;
    v_chunk    int := 0;
    v_from     int;
    v_to       int;
BEGIN
    SELECT * INTO v_line FROM public.mfg_finished_receipt_lines WHERE id = p_line_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'سطر الاستلام غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_line.company_id); END IF;

    SELECT * INTO v_rcp FROM public.mfg_finished_receipts WHERE id = v_line.receipt_id;
    SELECT * INTO v_ord FROM public.mfg_production_orders   WHERE id = v_rcp.production_order_id;

    -- N: الوسيط ثم config المخرَج (bags_per_pallet لنفس المنتج/الدور) ثم خطأ.
    v_n := p_bags_per_pallet;
    IF v_n IS NULL OR v_n <= 0 THEN
        SELECT bags_per_pallet INTO v_n FROM public.mfg_bom_outputs
         WHERE bom_id = v_ord.bom_id AND product_id = v_line.product_id
           AND output_role = v_line.output_role LIMIT 1;
    END IF;
    IF v_n IS NULL OR v_n <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'عدد الأكياس لكل باليت غير محدّد (لا وسيط ولا إعداد على المخرَج)');
    END IF;

    v_wh := COALESCE(v_line.warehouse_id, v_ord.fg_warehouse_id);

    SELECT count(*) INTO v_pending FROM public.mfg_bag_codes
     WHERE receipt_line_id = p_line_id AND pallet_id IS NULL;
    IF v_pending = 0 THEN
        RETURN jsonb_build_object('success', true, 'pallets_created', 0, 'remainder_bags', 0,
            'note', 'لا أكياس غير مرصوصة');
    END IF;

    v_remainder := v_pending % v_n;   -- حجم الباليت الأخير الجزئي (0 إن قَسَم تماماً)

    FOR v_bag IN
        SELECT id, bag_seq FROM public.mfg_bag_codes
         WHERE receipt_line_id = p_line_id AND pallet_id IS NULL
         ORDER BY bag_seq
    LOOP
        IF v_chunk = 0 THEN
            -- افتح باليتاً جديداً.
            v_pallet_no := public.generate_mfg_number(v_line.tenant_id, v_line.company_id, 'PLT');
            INSERT INTO public.mfg_pallets (
                tenant_id, company_id, pallet_number, content_type, product_id,
                batch_id, receipt_line_id, warehouse_id, status, qr_payload, created_by)
            VALUES (v_line.tenant_id, v_line.company_id, v_pallet_no, 'bags', v_line.product_id,
                v_line.batch_id, p_line_id, v_wh, 'closed',
                'https://eurofix.info/q/p/' || v_pallet_no, auth.uid())
            RETURNING id INTO v_pallet_id;
            v_from := v_bag.bag_seq;
            v_made := v_made + 1;
        END IF;

        UPDATE public.mfg_bag_codes SET pallet_id = v_pallet_id WHERE id = v_bag.id;
        v_to := v_bag.bag_seq;
        v_chunk := v_chunk + 1;

        IF v_chunk >= v_n THEN
            UPDATE public.mfg_pallets
               SET bag_count = v_chunk, bag_from_seq = v_from, bag_to_seq = v_to
             WHERE id = v_pallet_id;
            v_chunk := 0;
        END IF;
    END LOOP;

    -- ختم الباليت الأخير الجزئي (إن بقي).
    IF v_chunk > 0 THEN
        UPDATE public.mfg_pallets
           SET bag_count = v_chunk, bag_from_seq = v_from, bag_to_seq = v_to
         WHERE id = v_pallet_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'pallets_created', v_made,
        'remainder_bags', v_remainder, 'bags_per_pallet', v_n);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.palletize_receipt_line(uuid, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.palletize_receipt_line(uuid, int) TO authenticated;

-- ─── 5) بذرة قالب مطبوعة ملصق الباليت (doc_type: pallet_label) ─────
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'pallet_label', 'manufacturing', 'ملصق باليت', 'Pallet Label', true, true, 13, true,
'[{"key":"pallet.number","label_ar":"رقم الباليت","label_en":"Pallet No.","type":"text","group":"document"},
  {"key":"product.name","label_ar":"المنتج","label_en":"Product","type":"text","group":"document"},
  {"key":"batch.number","label_ar":"رقم الدفعة","label_en":"Batch No.","type":"text","group":"document"},
  {"key":"pallet.bag_count","label_ar":"عدد الأكياس","label_en":"Bag count","type":"number","group":"document"},
  {"key":"pallet.seq_range","label_ar":"مدى التسلسل","label_en":"Seq range","type":"text","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} .label{padding:6mm;border:1px dashed #cbd5e1} .bn{font-family:monospace;font-weight:700;color:#0f766e}',
'<div class="label"><h1>{{doc_title}}</h1><div class="bn">{{pallet.number}}</div><div>{{product.name}} — {{batch.number}}</div><div>{{pallet.bag_count}} — {{pallet.seq_range}}</div></div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'pallet_label' AND tenant_id IS NULL);

COMMIT;
