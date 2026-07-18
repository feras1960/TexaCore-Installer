-- ════════════════════════════════════════════════════════════════
-- 🏭 20260718b — Per-bag unique serialized QR codes (Manufacturing)
-- ────────────────────────────────────────────────────────────────
-- كل كيس مُنتَج يحصل على رمزه الفريد القصير (يُطبع كـQR) → لاحقاً
-- يُشغّل حملات «امسح واربح»/كاش-باك داخل NexaLive (مرحلة 2) ومكافحة التزييف.
-- هذه الجولة = أساس جانب التصنيع: توليد + طباعة + دورة حالة + جاهزية تحقّق عام.
-- Idempotent · لا كسر لسلوك post_production_receipt القائم (استبدال كامل الجسم
-- انطلاقاً من نسخة حيّة md5=4f9ed462cb78f4b3b05143805d22603d).
-- ════════════════════════════════════════════════════════════════

-- ─── 1) بوابة الإعداد على mfg_settings ───────────────────────────
ALTER TABLE public.mfg_settings
    ADD COLUMN IF NOT EXISTS generate_bag_codes boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.mfg_settings.generate_bag_codes IS
    'توليد رمز فريد لكل كيس عند ترحيل الاستلام (per-bag serialized QR).';

-- ─── 2) جدول رموز الأكياس ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_bag_codes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL,
    company_id      uuid NOT NULL,
    batch_id        uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
    receipt_line_id uuid REFERENCES public.mfg_finished_receipt_lines(id) ON DELETE CASCADE,
    product_id      uuid,
    -- رمز قصير غير قابل للتخمين (crockford base32 من gen_random_bytes؛ ليس تسلسلياً).
    code            text NOT NULL UNIQUE,
    bag_seq         int  NOT NULL,                        -- 1..N داخل السطر
    status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','scanned','redeemed','void')),
    scanned_at      timestamptz,
    scanned_meta    jsonb,
    redeemed_at     timestamptz,
    campaign_id     uuid,                                 -- مستقبلي (مرحلة 2)
    created_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mfg_bag_codes IS
    'رمز QR فريد لكل كيس مُنتَج. التحقّق العام يتم عبر RPC SECURITY DEFINER (verify_bag_code) لا SELECT مباشر.';

CREATE INDEX IF NOT EXISTS mfg_bag_codes_line_idx    ON public.mfg_bag_codes(receipt_line_id);
CREATE INDEX IF NOT EXISTS mfg_bag_codes_batch_idx   ON public.mfg_bag_codes(batch_id);
CREATE INDEX IF NOT EXISTS mfg_bag_codes_tenant_idx  ON public.mfg_bag_codes(tenant_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS mfg_bag_codes_line_seq_uq
    ON public.mfg_bag_codes(receipt_line_id, bag_seq);

ALTER TABLE public.mfg_bag_codes ENABLE ROW LEVEL SECURITY;

-- RLS قانوني (نفس نمط mfg_finished_receipt_lines) + حارس الموديول.
-- ملاحظة: لا سياسة SELECT للـanon — التحقّق العام يمرّ حصراً عبر verify_bag_code (SECURITY DEFINER).
DROP POLICY IF EXISTS mfg_bag_codes_select_policy        ON public.mfg_bag_codes;
DROP POLICY IF EXISTS mfg_bag_codes_insert_policy        ON public.mfg_bag_codes;
DROP POLICY IF EXISTS mfg_bag_codes_update_policy        ON public.mfg_bag_codes;
DROP POLICY IF EXISTS mfg_bag_codes_delete_policy        ON public.mfg_bag_codes;
DROP POLICY IF EXISTS mfg_bag_codes_module_guard         ON public.mfg_bag_codes;
DROP POLICY IF EXISTS mfg_bag_codes_module_guard_insert  ON public.mfg_bag_codes;
DROP POLICY IF EXISTS mfg_bag_codes_module_guard_update  ON public.mfg_bag_codes;

CREATE POLICY mfg_bag_codes_select_policy ON public.mfg_bag_codes
    FOR SELECT TO public
    USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
CREATE POLICY mfg_bag_codes_insert_policy ON public.mfg_bag_codes
    FOR INSERT TO authenticated
    WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_bag_codes_update_policy ON public.mfg_bag_codes
    FOR UPDATE TO authenticated
    USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_bag_codes_delete_policy ON public.mfg_bag_codes
    FOR DELETE TO authenticated
    USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_bag_codes_module_guard ON public.mfg_bag_codes
    FOR SELECT TO public USING (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_bag_codes_module_guard_insert ON public.mfg_bag_codes
    FOR INSERT TO public WITH CHECK (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_bag_codes_module_guard_update ON public.mfg_bag_codes
    FOR UPDATE TO public USING (tenant_has_module('manufacturing'::text));

-- ─── 3) مولّد الرمز القصير (crockford base32, unbiased) ───────────
-- 12 حرفاً × 5 بت = 60 بت عشوائية؛ الأبجدية بلا I/L/O/U لتفادي اللبس.
-- byte & 31 غير متحيّز لأن 256 = 8×32.
CREATE OR REPLACE FUNCTION public.mfg_gen_bag_code(p_len int DEFAULT 12)
RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_alpha text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    v_bytes bytea := extensions.gen_random_bytes(GREATEST(p_len, 1));
    v_code  text := '';
    i       int;
BEGIN
    FOR i IN 0..GREATEST(p_len, 1) - 1 LOOP
        v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) & 31) + 1, 1);
    END LOOP;
    RETURN v_code;
END;
$function$;

-- ─── 4) مولّد رموز سطر واحد (idempotent؛ يتخطّى إن وُجدت رموز) ─────
CREATE OR REPLACE FUNCTION public.mfg_generate_bag_codes_for_line(p_line_id uuid, p_count int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_line     public.mfg_finished_receipt_lines%ROWTYPE;
    v_existing int;
    v_seq      int;
    v_code     text;
    v_made     int := 0;
BEGIN
    IF p_count IS NULL OR p_count <= 0 THEN RETURN 0; END IF;
    SELECT * INTO v_line FROM public.mfg_finished_receipt_lines WHERE id = p_line_id;
    IF NOT FOUND THEN RETURN 0; END IF;
    -- idempotent: لا نُكرّر التوليد لسطر لديه رموز مسبقاً.
    SELECT count(*) INTO v_existing FROM public.mfg_bag_codes WHERE receipt_line_id = p_line_id;
    IF v_existing > 0 THEN RETURN 0; END IF;

    FOR v_seq IN 1..p_count LOOP
        LOOP
            v_code := public.mfg_gen_bag_code(12);
            BEGIN
                INSERT INTO public.mfg_bag_codes (
                    tenant_id, company_id, batch_id, receipt_line_id, product_id, code, bag_seq, status)
                VALUES (v_line.tenant_id, v_line.company_id, v_line.batch_id, p_line_id,
                        v_line.product_id, v_code, v_seq, 'new');
                EXIT;  -- نجح الإدراج
            EXCEPTION WHEN unique_violation THEN
                -- تصادم نادر جداً (60 بت) → أعِد التوليد.
            END;
        END LOOP;
        v_made := v_made + 1;
    END LOOP;
    RETURN v_made;
END;
$function$;

-- ─── 5) backfill RPC للاستلامات المُرحّلة قبل هذه الميزة ──────────
CREATE OR REPLACE FUNCTION public.generate_bag_codes_for_receipt(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_rcp   public.mfg_finished_receipts%ROWTYPE;
    v_line  RECORD;
    v_total int := 0;
    v_lines int := 0;
    v_made  int;
BEGIN
    SELECT * INTO v_rcp FROM public.mfg_finished_receipts WHERE id = p_receipt_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الاستلام غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_rcp.company_id); END IF;

    FOR v_line IN
        SELECT id, qty, package_size FROM public.mfg_finished_receipt_lines
         WHERE receipt_id = p_receipt_id AND output_role = 'primary'
           AND COALESCE(package_size,0) > 0 AND COALESCE(qty,0) > 0
    LOOP
        v_made := public.mfg_generate_bag_codes_for_line(v_line.id, CEIL(v_line.qty / v_line.package_size)::int);
        IF v_made > 0 THEN v_lines := v_lines + 1; END IF;
        v_total := v_total + v_made;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'receipt_id', p_receipt_id,
        'bag_codes_generated', v_total, 'lines_processed', v_lines);
END;
$function$;

-- ─── 6) التحقّق العام (مستقبلي — يُستدعى من landing/NexaLive) ──────
-- SECURITY DEFINER يتجاوز RLS؛ يُمنح anon. لا تسريب بيانات مستأجر أبعد من
-- (اسم المنتج/رقم الدفعة/الانتهاء) وهي معلومات عامة على غلاف الكيس أصلاً.
-- rate-limit: يُطبَّق لاحقاً في طبقة Edge/الحافة (توكِن IP) — ليس هنا.
-- سلوك: new→scanned (مرة واحدة) + scanned_at؛ redeem = مرحلة 2 (لا يُلمس هنا).
CREATE OR REPLACE FUNCTION public.verify_bag_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_bag        public.mfg_bag_codes%ROWTYPE;
    v_first_scan boolean := false;
    v_pname      text;
    v_batch_no   text;
    v_expiry     date;
BEGIN
    IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
        RETURN jsonb_build_object('valid', false);
    END IF;
    SELECT * INTO v_bag FROM public.mfg_bag_codes WHERE code = upper(btrim(p_code)) FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false);
    END IF;

    SELECT COALESCE(p.name, p.name_en) INTO v_pname FROM public.products p WHERE p.id = v_bag.product_id;
    SELECT b.batch_number, b.expiry_date INTO v_batch_no, v_expiry
      FROM public.inventory_batches b WHERE b.id = v_bag.batch_id;

    IF v_bag.status = 'new' THEN
        v_first_scan := true;
        UPDATE public.mfg_bag_codes
           SET status = 'scanned', scanned_at = now()
         WHERE id = v_bag.id;
        v_bag.status := 'scanned';
    END IF;

    RETURN jsonb_build_object(
        'valid', v_bag.status <> 'void',
        'product_name', v_pname,
        'batch_number', v_batch_no,
        'expiry_date', v_expiry,
        'status', v_bag.status,
        'first_scan', v_first_scan);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('valid', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_bag_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_bag_code(text) TO anon, authenticated;

-- الدوال الداخلية (SECURITY DEFINER) لا يجوز أن يستدعيها anon —
-- verify_bag_code وحده هو نقطة الـanon العامة.
REVOKE ALL ON FUNCTION public.generate_bag_codes_for_receipt(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.generate_bag_codes_for_receipt(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mfg_generate_bag_codes_for_line(uuid, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.mfg_generate_bag_codes_for_line(uuid, int) TO authenticated;
REVOKE ALL ON FUNCTION public.mfg_gen_bag_code(int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.mfg_gen_bag_code(int) TO authenticated;

-- ─── 7) توسعة post_production_receipt: توليد رموز الأكياس ──────────
-- (استبدال كامل الجسم؛ الإضافة الوحيدة: v_bag_total + كتلة التوليد داخل
--  حلقة السطور + مفتاح bag_codes_generated في الإرجاع. لا تغيير آخر.)
CREATE OR REPLACE FUNCTION public.post_production_receipt(p_receipt_id uuid, p_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_rcp        public.mfg_finished_receipts%ROWTYPE;
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_has_stages boolean;
    v_last_done  boolean;
    v_good_qty   numeric := 0;
    v_scrap_qty  numeric := 0;
    v_pool       numeric;
    v_remaining  numeric;
    v_share      numeric;
    v_receipt_c  numeric;
    v_credit     numeric := 0;
    v_co_cost    numeric := 0;
    v_primary_q  numeric := 0;
    v_primary_c  numeric;
    v_unit_primary numeric := 0;
    v_line       RECORD;
    v_prod       public.products%ROWTYPE;
    v_settings   public.mfg_settings%ROWTYPE;
    v_uc         numeric;
    v_wh         uuid;
    v_batch_id   uuid;
    v_batch_no   text;
    v_expiry     date;
    v_mv_id      uuid;
    v_consumed   numeric := 0;
    v_idx        int := 0;
    v_num        text;
    v_fmt        text;
    v_bln        RECORD;
    v_issued     numeric;
    v_returned   numeric;
    v_remainder  numeric;
    v_avail_bf   numeric;
    v_allow_neg  boolean;
    v_shortage   jsonb := '[]'::jsonb;
    v_bf_issue   uuid;
    v_bf_lines   int := 0;
    v_bf_batch   uuid;
    v_post       jsonb;
    v_inv_acct   uuid;
    v_je         uuid;
    v_batch_status text;
    v_line_status  text;
    v_curing_days  int := 0;
    v_qc_template  jsonb;
    v_hold_until   timestamptz;
    v_held_reason  text;
    v_fg_batch_id  uuid;
    v_primary_recv numeric := 0;
    v_link         RECORD;
    v_take         numeric;
    v_rem_link     numeric;
    v_fg_reserved  numeric := 0;
    v_bag_total    int := 0;   -- 🏷️ 20260718b — عدّاد رموز الأكياس المولّدة
BEGIN
    IF NOT public.mfg_tenant_has_module() THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
    SELECT * INTO v_rcp FROM public.mfg_finished_receipts WHERE id = p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الاستلام غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_rcp.company_id); END IF;
    IF v_rcp.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'الاستلام ليس بحالة مسودة (الحالة: ' || v_rcp.status || ')');
    END IF;
    IF public.journal_period_is_locked(v_rcp.company_id, v_rcp.receipt_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_rcp.production_order_id FOR UPDATE;
    SELECT * INTO v_settings FROM public.mfg_settings
     WHERE tenant_id = v_ord.tenant_id AND company_id = v_ord.company_id LIMIT 1;
    v_fmt := COALESCE(v_settings.batch_number_format, '{product}-{yymmdd}-{seq}');
    v_allow_neg := COALESCE(v_settings.allow_negative_wip,false) OR p_override;

    SELECT COALESCE(curing_hold_days,0), deferred_qc_template
      INTO v_curing_days, v_qc_template
      FROM public.mfg_boms WHERE id = v_ord.bom_id;
    v_curing_days := COALESCE(v_curing_days,0);
    v_batch_status := COALESCE(v_settings.receipt_batch_status, 'available');
    IF v_curing_days > 0 THEN v_batch_status := 'on_hold'; END IF;
    v_hold_until := CASE WHEN v_curing_days > 0
                         THEN (v_rcp.receipt_date + (v_curing_days || ' days')::interval)::timestamptz ELSE NULL END;
    v_held_reason := CASE WHEN v_curing_days > 0 THEN 'معالجة/تجفيف زمني (' || v_curing_days || ' يوم)'
                          WHEN v_batch_status = 'on_hold' THEN 'حجر جودة عند الاستلام' ELSE NULL END;

    SELECT EXISTS (SELECT 1 FROM public.mfg_order_stages WHERE production_order_id = v_ord.id) INTO v_has_stages;
    IF v_has_stages THEN
        SELECT bool_and(status = 'done') INTO v_last_done FROM public.mfg_order_stages
         WHERE production_order_id = v_ord.id
           AND seq = (SELECT MAX(seq) FROM public.mfg_order_stages WHERE production_order_id = v_ord.id);
        IF NOT COALESCE(v_last_done,false) AND NOT p_override THEN
            RETURN jsonb_build_object('success', false, 'error', 'المرحلة الأخيرة لم تكتمل بعد');
        END IF;
    END IF;

    IF NOT v_has_stages AND v_ord.bom_snapshot IS NOT NULL THEN
        FOR v_bln IN
            SELECT (l->>'component_product_id')::uuid AS pid,
                   (l->>'line_id')::uuid AS bl_id,
                   (l->>'required_qty')::numeric AS req,
                   COALESCE((l->>'requires_batch')::boolean,false) AS req_batch
            FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
            WHERE COALESCE(l->>'issue_method','backflush') = 'backflush'
              AND (l->>'component_product_id') IS NOT NULL
        LOOP
            SELECT COALESCE(SUM(il.qty),0) INTO v_issued
              FROM public.mfg_material_issue_lines il JOIN public.mfg_material_issues i ON i.id = il.issue_id
             WHERE i.production_order_id = v_ord.id AND i.status = 'posted' AND il.bom_line_id = v_bln.bl_id;
            SELECT COALESCE(SUM(rl.qty),0) INTO v_returned
              FROM public.mfg_material_return_lines rl JOIN public.mfg_material_returns r ON r.id = rl.return_id
              JOIN public.mfg_material_issue_lines il2 ON il2.id = rl.issue_line_id
             WHERE r.status = 'posted' AND il2.bom_line_id = v_bln.bl_id;
            v_remainder := COALESCE(v_bln.req,0) - (COALESCE(v_issued,0) - COALESCE(v_returned,0));
            IF v_remainder <= 0.0001 THEN CONTINUE; END IF;
            SELECT COALESCE(quantity_on_hand,0) INTO v_avail_bf
              FROM public.inventory_stock WHERE product_id = v_bln.pid AND warehouse_id = v_ord.source_warehouse_id LIMIT 1;
            IF COALESCE(v_avail_bf,0) < v_remainder - 0.01 AND NOT v_allow_neg THEN
                v_shortage := v_shortage || jsonb_build_object('product_id', v_bln.pid,
                    'required', round(v_remainder,6), 'available', COALESCE(v_avail_bf,0));
            END IF;
        END LOOP;

        IF jsonb_array_length(v_shortage) > 0 THEN
            PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
                'نقص مواد يمنع استلام الإنتاج', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' (backflush الاستلام)',
                '/manufacturing?order=' || v_ord.id, 'mfg_shortage', '⛔');
            RETURN jsonb_build_object('success', false, 'error', 'نقص مواد للـBackflush عند الاستلام', 'shortage', v_shortage);
        END IF;

        INSERT INTO public.mfg_material_issues (
            tenant_id, company_id, production_order_id, issue_date, status, is_backflush)
        VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.id, v_rcp.receipt_date, 'draft', true)
        RETURNING id INTO v_bf_issue;

        FOR v_bln IN
            SELECT (l->>'component_product_id')::uuid AS pid,
                   (l->>'line_id')::uuid AS bl_id,
                   (l->>'required_qty')::numeric AS req,
                   COALESCE((l->>'requires_batch')::boolean,false) AS req_batch
            FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
            WHERE COALESCE(l->>'issue_method','backflush') = 'backflush'
              AND (l->>'component_product_id') IS NOT NULL
        LOOP
            SELECT COALESCE(SUM(il.qty),0) INTO v_issued
              FROM public.mfg_material_issue_lines il JOIN public.mfg_material_issues i ON i.id = il.issue_id
             WHERE i.production_order_id = v_ord.id AND i.status = 'posted' AND il.bom_line_id = v_bln.bl_id;
            SELECT COALESCE(SUM(rl.qty),0) INTO v_returned
              FROM public.mfg_material_return_lines rl JOIN public.mfg_material_returns r ON r.id = rl.return_id
              JOIN public.mfg_material_issue_lines il2 ON il2.id = rl.issue_line_id
             WHERE r.status = 'posted' AND il2.bom_line_id = v_bln.bl_id;
            v_remainder := COALESCE(v_bln.req,0) - (COALESCE(v_issued,0) - COALESCE(v_returned,0));
            IF v_remainder <= 0.0001 THEN CONTINUE; END IF;
            v_bf_batch := NULL;
            IF v_bln.req_batch THEN
                SELECT id INTO v_bf_batch FROM public.inventory_batches
                 WHERE product_id = v_bln.pid AND warehouse_id = v_ord.source_warehouse_id AND COALESCE(current_quantity,0) > 0
                   AND COALESCE(status,'available') IN ('available','released')
                   AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
                 ORDER BY expiry_date NULLS LAST, received_date NULLS LAST LIMIT 1;
            END IF;
            INSERT INTO public.mfg_material_issue_lines (
                tenant_id, company_id, issue_id, product_id, bom_line_id, qty, warehouse_id, batch_id)
            VALUES (v_ord.tenant_id, v_ord.company_id, v_bf_issue, v_bln.pid, v_bln.bl_id, round(v_remainder,6), v_ord.source_warehouse_id, v_bf_batch);
            v_bf_lines := v_bf_lines + 1;
        END LOOP;

        IF v_bf_lines > 0 THEN
            v_post := public.post_material_issue(v_bf_issue, p_override);
            IF NOT COALESCE((v_post->>'success')::boolean,false) THEN
                RAISE EXCEPTION 'فشل Backflush الاستلام: %', COALESCE(v_post->>'error','غير معروف');
            END IF;
            SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_ord.id FOR UPDATE;
        ELSE
            DELETE FROM public.mfg_material_issues WHERE id = v_bf_issue;
            v_bf_issue := NULL;
        END IF;
    END IF;

    SELECT COALESCE(SUM(qty) FILTER (WHERE output_role IN ('primary','co_product')),0),
           COALESCE(SUM(qty) FILTER (WHERE output_role = 'scrap'),0)
      INTO v_good_qty, v_scrap_qty
      FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id;

    IF (COALESCE(v_ord.qty_produced,0) + v_good_qty) > v_ord.qty_planned * (1 + COALESCE(v_ord.overproduction_pct,0)/100.0) + 0.01
       AND NOT p_override THEN
        RETURN jsonb_build_object('success', false, 'error',
            'تجاوز الكمية المخطّطة + سماحية الفائض (' || v_ord.overproduction_pct || '%)');
    END IF;

    v_pool := GREATEST(0, COALESCE(v_ord.actual_material_cost,0) + COALESCE(v_ord.actual_labor_cost,0)
              + COALESCE(v_ord.actual_overhead_cost,0) + COALESCE(v_ord.subcontract_cost,0)
              - COALESCE(v_ord.received_cost,0));
    v_remaining := GREATEST(v_ord.qty_planned - COALESCE(v_ord.qty_produced,0), v_good_qty);
    v_share := CASE WHEN v_remaining > 0 THEN LEAST(v_good_qty / v_remaining, 1) ELSE 1 END;
    v_receipt_c := CASE WHEN v_good_qty > 0 THEN v_pool * v_share ELSE 0 END;

    SELECT COALESCE(SUM(COALESCE(rl.unit_cost,
              (SELECT o.recovery_rate FROM public.mfg_bom_outputs o
                WHERE o.bom_id = v_ord.bom_id AND o.product_id = rl.product_id AND o.output_role = rl.output_role LIMIT 1),
              0) * COALESCE(rl.qty,0)), 0)
      INTO v_credit FROM public.mfg_finished_receipt_lines rl
     WHERE rl.receipt_id = p_receipt_id AND rl.output_role IN ('byproduct','scrap');

    SELECT COALESCE(SUM(v_receipt_c * COALESCE(rl.cost_share_pct,
              (SELECT o.cost_share_pct FROM public.mfg_bom_outputs o
                WHERE o.bom_id = v_ord.bom_id AND o.product_id = rl.product_id AND o.output_role='co_product' LIMIT 1),
              0) / 100.0), 0)
      INTO v_co_cost
      FROM public.mfg_finished_receipt_lines rl
     WHERE rl.receipt_id = p_receipt_id AND rl.output_role = 'co_product';
    SELECT COALESCE(SUM(qty) FILTER (WHERE output_role='primary'),0) INTO v_primary_q
      FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id;

    v_primary_c := GREATEST(0, v_receipt_c - v_co_cost - v_credit);
    v_unit_primary := CASE WHEN v_primary_q > 0 THEN v_primary_c / v_primary_q ELSE 0 END;

    FOR v_line IN SELECT * FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        SELECT * INTO v_prod FROM public.products WHERE id = v_line.product_id;
        v_wh := COALESCE(v_line.warehouse_id,
                  CASE WHEN v_line.output_role IN ('scrap','byproduct')
                       THEN COALESCE(v_ord.scrap_warehouse_id, v_ord.fg_warehouse_id)
                       ELSE v_ord.fg_warehouse_id END);
        IF v_wh IS NULL THEN RAISE EXCEPTION 'لا يوجد مستودع لسطر الاستلام % (المنتج %)', v_idx, v_line.product_id; END IF;

        v_uc := CASE
            WHEN v_line.output_role = 'primary' THEN v_unit_primary
            WHEN v_line.output_role = 'co_product' THEN
                (v_receipt_c * COALESCE(v_line.cost_share_pct,
                   (SELECT o.cost_share_pct FROM public.mfg_bom_outputs o
                     WHERE o.bom_id = v_ord.bom_id AND o.product_id = v_line.product_id AND o.output_role='co_product' LIMIT 1),
                   0) / 100.0) / NULLIF(v_line.qty,0)
            ELSE COALESCE(v_line.unit_cost,
                   (SELECT o.recovery_rate FROM public.mfg_bom_outputs o
                     WHERE o.bom_id = v_ord.bom_id AND o.product_id = v_line.product_id AND o.output_role = v_line.output_role LIMIT 1),
                   0)
        END;
        v_uc := COALESCE(v_uc, 0);

        IF (COALESCE(v_prod.track_batch,false) OR v_prod.shelf_life_days IS NOT NULL OR v_line.batch_id IS NOT NULL)
           AND v_line.output_role IN ('primary','co_product','byproduct') THEN
            IF v_line.batch_id IS NULL THEN
                v_batch_no := replace(replace(replace(v_fmt,
                    '{product}', COALESCE(v_prod.sku, LEFT(v_line.product_id::text,8))),
                    '{yymmdd}', to_char(v_rcp.receipt_date,'YYMMDD')),
                    '{seq}', lpad(public.mfg_next_batch_seq(v_ord.tenant_id, v_ord.company_id, v_line.product_id, v_rcp.receipt_date)::text, 3, '0'));
                v_expiry := CASE WHEN v_prod.shelf_life_days IS NOT NULL
                                 THEN v_rcp.receipt_date + (v_prod.shelf_life_days || ' days')::interval ELSE NULL END;
                v_line_status := CASE WHEN v_line.output_role IN ('primary','co_product') THEN v_batch_status ELSE 'available' END;
                INSERT INTO public.inventory_batches (
                    tenant_id, company_id, product_id, warehouse_id, batch_number,
                    manufacturing_date, expiry_date, received_date,
                    initial_quantity, current_quantity, unit_cost, status,
                    hold_until, held_reason, production_order_id)
                VALUES (v_ord.tenant_id, v_ord.company_id, v_line.product_id, v_wh, v_batch_no,
                    v_rcp.receipt_date, v_expiry, v_rcp.receipt_date,
                    v_line.qty, v_line.qty, v_uc, v_line_status,
                    CASE WHEN v_line_status = 'on_hold' THEN v_hold_until ELSE NULL END,
                    CASE WHEN v_line_status = 'on_hold' THEN v_held_reason ELSE NULL END,
                    v_ord.id)
                RETURNING id INTO v_batch_id;
                IF v_qc_template IS NOT NULL AND jsonb_typeof(v_qc_template) = 'array'
                   AND jsonb_array_length(v_qc_template) > 0
                   AND v_line.output_role IN ('primary','co_product') THEN
                    PERFORM public.schedule_batch_qc_tests(v_batch_id, v_qc_template);
                END IF;
            ELSE
                v_batch_id := v_line.batch_id;
            END IF;
        ELSE
            v_batch_id := v_line.batch_id;
        END IF;

        IF v_line.output_role = 'primary' AND v_line.product_id = v_ord.product_id THEN
            v_fg_batch_id := v_batch_id;
            v_primary_recv := v_primary_recv + COALESCE(v_line.qty,0);
        END IF;

        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, to_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_ord.tenant_id, v_ord.company_id,
            'MRCT-' || LEFT(p_receipt_id::text,8) || '-' || v_idx, v_rcp.receipt_date, 'receipt',
            v_line.product_id, v_wh, v_line.qty, v_uc, v_uc * COALESCE(v_line.qty,0),
            'production_receipt', p_receipt_id, v_rcp.receipt_number, 'استلام إنتاج (' || v_line.output_role || ')', auth.uid())
        RETURNING id INTO v_mv_id;

        UPDATE public.mfg_finished_receipt_lines
           SET unit_cost = v_uc, batch_id = v_batch_id, movement_id = v_mv_id WHERE id = v_line.id;
        v_consumed := v_consumed + (v_uc * COALESCE(v_line.qty,0));

        -- 🏷️ 20260718b — توليد رمز فريد لكل كيس (السطر الرئيسي + تعبئة + بوابة الإعداد).
        IF COALESCE(v_settings.generate_bag_codes, true)
           AND v_line.output_role = 'primary'
           AND COALESCE(v_line.package_size,0) > 0
           AND COALESCE(v_line.qty,0) > 0 THEN
            v_bag_total := v_bag_total + public.mfg_generate_bag_codes_for_line(
                v_line.id, CEIL(v_line.qty / v_line.package_size)::int);
        END IF;
    END LOOP;

    UPDATE public.mfg_production_orders SET
        qty_produced = COALESCE(qty_produced,0) + v_good_qty,
        qty_scrapped = COALESCE(qty_scrapped,0) + v_scrap_qty,
        received_cost = COALESCE(received_cost,0) + v_consumed,
        status = CASE WHEN (COALESCE(qty_produced,0) + v_good_qty + COALESCE(qty_scrapped,0) + v_scrap_qty)
                           >= qty_planned - 0.01 THEN 'completed' ELSE 'in_progress' END,
        actual_end_date = CASE WHEN (COALESCE(qty_produced,0) + v_good_qty + COALESCE(qty_scrapped,0) + v_scrap_qty)
                               >= qty_planned - 0.01 THEN v_rcp.receipt_date ELSE actual_end_date END,
        updated_at = now()
    WHERE id = v_ord.id;

    v_num := COALESCE(v_rcp.receipt_number, public.generate_mfg_number(v_rcp.tenant_id, v_rcp.company_id, 'RCT'));
    UPDATE public.mfg_finished_receipts SET
        status = 'posted', posted_at = now(), receipt_number = v_num, total_cost = v_consumed,
        cost_breakdown = jsonb_build_object(
            'pool', v_pool, 'share', v_share, 'receipt_cost', v_receipt_c,
            'co_product_cost', v_co_cost, 'recovery_credit', v_credit,
            'primary_cost', v_primary_c, 'consumed', v_consumed),
        updated_at = now()
    WHERE id = p_receipt_id;

    IF v_primary_recv > 0.000001 AND v_ord.fg_warehouse_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.mfg_order_sales_links WHERE order_id = v_ord.id) THEN
        v_take := v_primary_recv;
        FOR v_link IN
            SELECT sl.sales_transaction_id, COALESCE(sl.qty_allocated,0) AS qty_allocated
              FROM public.mfg_order_sales_links sl WHERE sl.order_id = v_ord.id ORDER BY sl.created_at
        LOOP
            IF v_take <= 0.000001 THEN EXIT; END IF;
            SELECT COALESCE(SUM(qty_reserved),0) INTO v_fg_reserved
              FROM public.mfg_material_reservations
             WHERE production_order_id = v_ord.id AND reservation_kind = 'fg_for_sale'
               AND sales_transaction_id IS NOT DISTINCT FROM v_link.sales_transaction_id AND status = 'active';
            v_rem_link := LEAST(v_take, v_link.qty_allocated - v_fg_reserved);
            IF v_rem_link <= 0.000001 THEN CONTINUE; END IF;
            INSERT INTO public.mfg_material_reservations (
                tenant_id, company_id, production_order_id, product_id, warehouse_id,
                qty_reserved, batch_id, status, reservation_kind, sales_transaction_id)
            VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.id, v_ord.product_id, v_ord.fg_warehouse_id,
                round(v_rem_link,6), v_fg_batch_id, 'active', 'fg_for_sale', v_link.sales_transaction_id);
            UPDATE public.inventory_stock
               SET reserved_quantity = COALESCE(reserved_quantity,0) + round(v_rem_link,6), updated_at = now()
             WHERE product_id = v_ord.product_id AND warehouse_id = v_ord.fg_warehouse_id;
            IF NOT FOUND THEN
                INSERT INTO public.inventory_stock (tenant_id, company_id, product_id, warehouse_id, quantity_on_hand, reserved_quantity)
                VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.product_id, v_ord.fg_warehouse_id, 0, round(v_rem_link,6));
            END IF;
            v_take := v_take - v_rem_link;
        END LOOP;
        IF v_primary_recv - v_take > 0.000001 THEN
            PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['sales_manager','production_manager'],
                'حجز إنتاج لأمر بيع', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' — حُجز '
                    || round(v_primary_recv - v_take,3) || ' للبيع المرتبط',
                '/manufacturing?order=' || v_ord.id, 'mfg_mto_reserved', '🔒');
        END IF;
    END IF;

    IF v_consumed > 0 THEN
        v_inv_acct := public.resolve_posting_account(v_ord.company_id, 'receipt_inventory');
        IF v_settings.wip_account_id IS NOT NULL AND v_inv_acct IS NOT NULL THEN
            v_je := public.mfg_create_and_post_je(
                v_ord.tenant_id, v_ord.company_id, v_ord.branch_id, v_rcp.receipt_date,
                'production_receipt', p_receipt_id, v_num, v_ord.id,
                'استلام إنتاج تام — ' || COALESCE(v_num,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_inv_acct, 'debit', v_consumed, 'credit', 0, 'desc', 'مخزون تام الصنع'),
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', 0, 'credit', v_consumed, 'desc', 'تحويل من WIP')));
            IF v_je IS NOT NULL THEN
                UPDATE public.mfg_finished_receipts SET journal_entry_id = v_je WHERE id = p_receipt_id;
                UPDATE public.mfg_production_orders SET completion_journal_entry_id = v_je WHERE id = v_ord.id;
            END IF;
        END IF;
    END IF;

    IF (SELECT status FROM public.mfg_production_orders WHERE id = v_ord.id) = 'completed' THEN
        PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
            'اكتمل أمر الإنتاج', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' اكتمل — جاهز للإقفال',
            '/manufacturing?order=' || v_ord.id, 'mfg_completed', '✅');
    END IF;

    RETURN jsonb_build_object('success', true, 'receipt_id', p_receipt_id, 'receipt_number', v_num,
        'total_cost', v_consumed, 'primary_unit_cost', v_unit_primary, 'pool', v_pool, 'share', v_share,
        'backflush_issue_id', v_bf_issue, 'journal_entry_id', v_je,
        'batch_status', v_batch_status, 'fg_reserved', round(GREATEST(0, v_primary_recv - COALESCE(v_take, v_primary_recv)),6),
        'bag_codes_generated', v_bag_total);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
