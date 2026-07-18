-- 20260717f: موديول التصنيع — P3a/Migration 3 — التعاقد الباطن (Subcontracting)
-- ═══════════════════════════════════════════════════════════════════════════
-- يبني على 20260717d/e (§4-ج/19 · §5-P3 · جدول القيود §3.4). يشمل:
--   • warehouses.subcontractor_id + warehouse_type='subcontractor' (مستودع افتراضي لكل مقاول) —
--     القرار: مستودع مُعلَّم بنوع subcontractor مرتبط بالمورّد (لا علم منفصل) — helper ينشئه عند اللزوم.
--   • mfg_settings.subcontract_accrual_account_id — حساب استحقاق تكلفة الخدمة (Dr WIP / Cr accrual).
--   • mfg_subcontract_shipments + _lines — عهدة مواد المقاول (مرسل/مستهلك/مُرجَع/مرفوض).
--   • RPCs: ship_to_subcontractor · receive_from_subcontractor · subcontractor_custody · helper.
-- قرار المحاسبة (AP): تكلفة الخدمة تُستحَقّ Dr WIP / Cr «استحقاق تعاقد باطن» فقط عند ضبط الحسابات
--   (تدريجي). **فاتورة الشراء تبقى مستند الذمم الرسمي** — لا نُرحّل ذمم دائنة هنا تفادياً للازدواج؛
--   حساب الاستحقاق يُسوّى مقابل الفاتورة عند إدخالها (خارج نطاق P3a — ملاحظة لـ P3b/المشتريات).
-- حركات المخزون: إرسال = transfer_out(source)+transfer_in(virtual)؛ استهلاك = out(virtual)؛
--   إرجاع/رفض = transfer_out(virtual)+transfer_in(source). (تريغر update_inventory_stock يتكفّل بالأرصدة.)
-- idempotent: CREATE TABLE/COLUMN IF NOT EXISTS + CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) أعمدة ──
ALTER TABLE public.warehouses
    ADD COLUMN IF NOT EXISTS subcontractor_id uuid;
CREATE INDEX IF NOT EXISTS idx_warehouses_subcontractor
    ON public.warehouses (subcontractor_id) WHERE subcontractor_id IS NOT NULL;

ALTER TABLE public.mfg_settings
    ADD COLUMN IF NOT EXISTS subcontract_accrual_account_id uuid;

-- توسعة قيد نوع المستودع ليقبل 'subcontractor' (مستودع عهدة افتراضي للمقاولين)
ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS chk_warehouse_type;
ALTER TABLE public.warehouses ADD CONSTRAINT chk_warehouse_type
    CHECK (warehouse_type::text = ANY (ARRAY['regular','offline_market','van','subcontractor']::text[]));

-- ── 1) جداول العهدة ──
CREATE TABLE IF NOT EXISTS public.mfg_subcontract_shipments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL,
    company_id        uuid NOT NULL,
    order_id          uuid REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    stage_id          uuid,
    subcontractor_id  uuid NOT NULL,
    warehouse_id      uuid,
    doc_number        text,
    ship_date         date DEFAULT CURRENT_DATE,
    status            text NOT NULL DEFAULT 'draft',
    service_cost      numeric DEFAULT 0,
    notes             text,
    created_by        uuid,
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfg_subcontract_shipments_status_chk') THEN
        ALTER TABLE public.mfg_subcontract_shipments
            ADD CONSTRAINT mfg_subcontract_shipments_status_chk
            CHECK (status IN ('draft','shipped','received','cancelled'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_subc_ship_order ON public.mfg_subcontract_shipments (order_id);
CREATE INDEX IF NOT EXISTS idx_subc_ship_vendor ON public.mfg_subcontract_shipments (subcontractor_id);

CREATE TABLE IF NOT EXISTS public.mfg_subcontract_shipment_lines (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL,
    company_id    uuid NOT NULL,
    shipment_id   uuid REFERENCES public.mfg_subcontract_shipments(id) ON DELETE CASCADE,
    product_id    uuid NOT NULL,
    qty_sent      numeric NOT NULL DEFAULT 0,
    unit_cost     numeric,
    batch_id      uuid,
    roll_id       uuid,
    qty_consumed  numeric DEFAULT 0,
    qty_returned  numeric DEFAULT 0,
    qty_rejected  numeric DEFAULT 0,
    created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subc_line_ship ON public.mfg_subcontract_shipment_lines (shipment_id);
CREATE INDEX IF NOT EXISTS idx_subc_line_prod ON public.mfg_subcontract_shipment_lines (product_id);

-- ── RLS قياسي على الجدولين (نموذج 20260716a) ──
DO $$
DECLARE tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['mfg_subcontract_shipments','mfg_subcontract_shipment_lines'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()))', tbl || '_select_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_insert_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_update_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_delete_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_delete_policy', tbl);
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) mfg_get_subcontractor_warehouse — يجد/ينشئ مستودعاً افتراضياً للمقاول
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mfg_get_subcontractor_warehouse(
    p_tenant uuid, p_company uuid, p_branch uuid, p_subcontractor_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_wh    uuid;
    v_sup   public.suppliers%ROWTYPE;
    v_br    uuid;
    v_name  text;
BEGIN
    SELECT id INTO v_wh FROM public.warehouses
     WHERE warehouse_type = 'subcontractor' AND subcontractor_id = p_subcontractor_id
       AND company_id = p_company LIMIT 1;
    IF v_wh IS NOT NULL THEN RETURN v_wh; END IF;

    SELECT * INTO v_sup FROM public.suppliers WHERE id = p_subcontractor_id;
    v_br := COALESCE(p_branch, (SELECT id FROM public.branches WHERE company_id = p_company ORDER BY created_at LIMIT 1));
    v_name := 'مقاول: ' || COALESCE(v_sup.name_ar, v_sup.name_en, v_sup.company_name, LEFT(p_subcontractor_id::text,8));

    INSERT INTO public.warehouses (
        tenant_id, company_id, branch_id, code, name, name_ar, name_en,
        warehouse_type, subcontractor_id, is_active)
    VALUES (p_tenant, p_company, v_br,
        'SUBC-' || COALESCE(v_sup.code, LEFT(p_subcontractor_id::text,8)), v_name, v_name,
        COALESCE(v_sup.name_en, v_name), 'subcontractor', p_subcontractor_id, true)
    RETURNING id INTO v_wh;
    RETURN v_wh;
END;
$fn$;
COMMENT ON FUNCTION public.mfg_get_subcontractor_warehouse(uuid,uuid,uuid,uuid) IS
  'يجد/ينشئ مستودعاً افتراضياً (warehouse_type=subcontractor) مرتبطاً بمورّد المقاول — لعهدة مواد التعاقد الباطن.';
GRANT EXECUTE ON FUNCTION public.mfg_get_subcontractor_warehouse(uuid,uuid,uuid,uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) ship_to_subcontractor — تحويل الخام من مستودع المصدر إلى مستودع المقاول الافتراضي (عهدة)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ship_to_subcontractor(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_sh    public.mfg_subcontract_shipments%ROWTYPE;
    v_ord   public.mfg_production_orders%ROWTYPE;
    v_ln    RECORD;
    v_wh    uuid;
    v_cost  numeric;
    v_idx   int := 0;
    v_num   text;
    v_src   uuid;
BEGIN
    SELECT * INTO v_sh FROM public.mfg_subcontract_shipments WHERE id = p_shipment_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الإرسال غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_sh.company_id); END IF;
    IF v_sh.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'الإرسال ليس بحالة مسودة (الحالة: ' || v_sh.status || ')');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_sh.order_id;
    v_src := v_ord.source_warehouse_id;
    IF v_src IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر بلا مستودع مصدر'); END IF;

    v_wh := COALESCE(v_sh.warehouse_id,
              public.mfg_get_subcontractor_warehouse(v_sh.tenant_id, v_sh.company_id, v_ord.branch_id, v_sh.subcontractor_id));

    FOR v_ln IN SELECT * FROM public.mfg_subcontract_shipment_lines WHERE shipment_id = p_shipment_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        IF COALESCE(v_ln.qty_sent,0) <= 0 THEN CONTINUE; END IF;
        SELECT COALESCE(NULLIF(average_cost,0), v_ln.unit_cost, 0) INTO v_cost
          FROM public.inventory_stock WHERE product_id = v_ln.product_id AND warehouse_id = v_src LIMIT 1;
        v_cost := COALESCE(v_cost, v_ln.unit_cost, 0);
        -- transfer_out من المصدر
        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, from_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_sh.tenant_id, v_sh.company_id, 'SUBS-' || LEFT(p_shipment_id::text,8) || '-O' || v_idx,
            v_sh.ship_date, 'transfer_out', v_ln.product_id, v_src, v_ln.qty_sent, v_cost, v_cost*v_ln.qty_sent,
            'subcontract_ship', p_shipment_id, v_sh.doc_number, 'إرسال خام لمقاول الباطن', auth.uid());
        -- transfer_in إلى مستودع المقاول الافتراضي
        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, to_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_sh.tenant_id, v_sh.company_id, 'SUBS-' || LEFT(p_shipment_id::text,8) || '-I' || v_idx,
            v_sh.ship_date, 'transfer_in', v_ln.product_id, v_wh, v_ln.qty_sent, v_cost, v_cost*v_ln.qty_sent,
            'subcontract_ship', p_shipment_id, v_sh.doc_number, 'استلام عهدة مقاول', auth.uid());
        UPDATE public.mfg_subcontract_shipment_lines SET unit_cost = v_cost WHERE id = v_ln.id;
    END LOOP;

    v_num := COALESCE(v_sh.doc_number, public.generate_mfg_number(v_sh.tenant_id, v_sh.company_id, 'SUBC'));
    UPDATE public.mfg_subcontract_shipments
       SET status = 'shipped', warehouse_id = v_wh, doc_number = v_num, updated_at = now()
     WHERE id = p_shipment_id;

    RETURN jsonb_build_object('success', true, 'shipment_id', p_shipment_id, 'doc_number', v_num,
        'warehouse_id', v_wh, 'lines', v_idx);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.ship_to_subcontractor(uuid) IS
  'إرسال خام لمقاول الباطن: تحويل من المصدر إلى مستودع المقاول الافتراضي (عهدة) + ترقيم المستند. ذرّي.';
GRANT EXECUTE ON FUNCTION public.ship_to_subcontractor(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) receive_from_subcontractor — استلام: تقدّم المرحلة + تكلفة خدمة + استهلاك مواد + إرجاع/رفض
--    p_receipt: {shipment_id, qty_good?, qty_reject?, service_cost?,
--                consumed:[{product_id, qty}], returns:[{product_id, qty}]}
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.receive_from_subcontractor(p_receipt jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_sh_id   uuid := (p_receipt->>'shipment_id')::uuid;
    v_sh      public.mfg_subcontract_shipments%ROWTYPE;
    v_ord     public.mfg_production_orders%ROWTYPE;
    v_set     public.mfg_settings%ROWTYPE;
    v_svc     numeric := COALESCE((p_receipt->>'service_cost')::numeric, 0);
    v_qgood   numeric := COALESCE((p_receipt->>'qty_good')::numeric, 0);
    v_qrej    numeric := COALESCE((p_receipt->>'qty_reject')::numeric, 0);
    v_el      jsonb;
    v_pid     uuid;
    v_qty     numeric;
    v_cost    numeric;
    v_cons_val numeric := 0;
    v_idx     int := 0;
    v_src     uuid;
    v_inv_acct uuid;
    v_je      uuid;
BEGIN
    SELECT * INTO v_sh FROM public.mfg_subcontract_shipments WHERE id = v_sh_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الإرسال غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_sh.company_id); END IF;
    IF v_sh.status <> 'shipped' THEN
        RETURN jsonb_build_object('success', false, 'error', 'لا يمكن الاستلام إلا من إرسال بحالة shipped');
    END IF;
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_sh.order_id FOR UPDATE;
    SELECT * INTO v_set FROM public.mfg_settings
     WHERE tenant_id = v_sh.tenant_id AND company_id = v_sh.company_id LIMIT 1;
    v_src := v_ord.source_warehouse_id;

    -- (أ) استهلاك المواد عند المقاول: OUT من مستودع المقاول → تدخل قيمتها WIP
    FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_receipt->'consumed','[]'::jsonb))
    LOOP
        v_pid := (v_el->>'product_id')::uuid;
        v_qty := COALESCE((v_el->>'qty')::numeric, 0);
        IF v_pid IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
        v_idx := v_idx + 1;
        SELECT COALESCE(NULLIF(average_cost,0),0) INTO v_cost
          FROM public.inventory_stock WHERE product_id = v_pid AND warehouse_id = v_sh.warehouse_id LIMIT 1;
        v_cost := COALESCE(v_cost, 0);
        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, from_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_sh.tenant_id, v_sh.company_id, 'SUBC-' || LEFT(v_sh_id::text,8) || '-C' || v_idx,
            CURRENT_DATE, 'out', v_pid, v_sh.warehouse_id, v_qty, v_cost, v_cost*v_qty,
            'subcontract_consume', v_sh_id, v_sh.doc_number, 'استهلاك عهدة عند المقاول', auth.uid());
        v_cons_val := v_cons_val + (v_cost * v_qty);
        -- إسناد الاستهلاك لأقدم سطر لهذا المنتج
        UPDATE public.mfg_subcontract_shipment_lines
           SET qty_consumed = COALESCE(qty_consumed,0) + v_qty
         WHERE id = (SELECT id FROM public.mfg_subcontract_shipment_lines
                      WHERE shipment_id = v_sh_id AND product_id = v_pid ORDER BY created_at LIMIT 1);
    END LOOP;

    -- (ب) إرجاع/رفض مواد: تحويل من مستودع المقاول إلى المصدر
    FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_receipt->'returns','[]'::jsonb))
    LOOP
        v_pid := (v_el->>'product_id')::uuid;
        v_qty := COALESCE((v_el->>'qty')::numeric, 0);
        IF v_pid IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
        v_idx := v_idx + 1;
        SELECT COALESCE(NULLIF(average_cost,0),0) INTO v_cost
          FROM public.inventory_stock WHERE product_id = v_pid AND warehouse_id = v_sh.warehouse_id LIMIT 1;
        v_cost := COALESCE(v_cost, 0);
        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, from_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_sh.tenant_id, v_sh.company_id, 'SUBC-' || LEFT(v_sh_id::text,8) || '-RO' || v_idx,
            CURRENT_DATE, 'transfer_out', v_pid, v_sh.warehouse_id, v_qty, v_cost, v_cost*v_qty,
            'subcontract_return', v_sh_id, v_sh.doc_number, 'إرجاع عهدة من المقاول', auth.uid());
        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, to_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_sh.tenant_id, v_sh.company_id, 'SUBC-' || LEFT(v_sh_id::text,8) || '-RI' || v_idx,
            CURRENT_DATE, 'transfer_in', v_pid, v_src, v_qty, v_cost, v_cost*v_qty,
            'subcontract_return', v_sh_id, v_sh.doc_number, 'استعادة خام مرتجع للمصدر', auth.uid());
        UPDATE public.mfg_subcontract_shipment_lines
           SET qty_returned = COALESCE(qty_returned,0) + v_qty
         WHERE id = (SELECT id FROM public.mfg_subcontract_shipment_lines
                      WHERE shipment_id = v_sh_id AND product_id = v_pid ORDER BY created_at LIMIT 1);
    END LOOP;

    -- (ج) تكلفة الخدمة على الأمر (تدخل مجمّع WIP عند استلام الناتج) + قيمة الاستهلاك على المواد الفعلية
    UPDATE public.mfg_production_orders
       SET subcontract_cost = COALESCE(subcontract_cost,0) + v_svc,
           actual_material_cost = COALESCE(actual_material_cost,0) + v_cons_val,
           status = CASE WHEN status = 'confirmed' THEN 'in_progress' ELSE status END,
           updated_at = now()
     WHERE id = v_ord.id;

    -- (د) تقدّم المرحلة الباطنة إن وُجدت
    IF v_sh.stage_id IS NOT NULL THEN
        UPDATE public.mfg_order_stages
           SET qty_good = COALESCE(qty_good,0) + v_qgood,
               qty_scrap = COALESCE(qty_scrap,0) + v_qrej,
               is_subcontracted = true, subcontractor_id = v_sh.subcontractor_id,
               subcontract_cost = COALESCE(subcontract_cost,0) + v_svc,
               updated_at = now()
         WHERE id = v_sh.stage_id;
    END IF;

    -- (هـ) GL تدريجي: Dr WIP / Cr استحقاق تعاقد باطن (تكلفة الخدمة) — الفاتورة تبقى مستند الذمم
    IF v_svc > 0 AND v_set.wip_account_id IS NOT NULL AND v_set.subcontract_accrual_account_id IS NOT NULL
       AND NOT public.journal_period_is_locked(v_sh.company_id, CURRENT_DATE) THEN
        v_je := public.mfg_create_and_post_je(
            v_sh.tenant_id, v_sh.company_id, v_ord.branch_id, CURRENT_DATE,
            'subcontract_receipt', v_sh_id, v_sh.doc_number, v_ord.id,
            'تكلفة خدمة تعاقد باطن — ' || COALESCE(v_sh.doc_number,''),
            jsonb_build_array(
                jsonb_build_object('account_id', v_set.wip_account_id, 'debit', v_svc, 'credit', 0, 'desc', 'خدمة تعاقد باطن إلى WIP'),
                jsonb_build_object('account_id', v_set.subcontract_accrual_account_id, 'debit', 0, 'credit', v_svc, 'desc', 'استحقاق تعاقد باطن')));
    END IF;

    -- (و) GL تدريجي للاستهلاك: Dr WIP / Cr المخزون
    IF v_cons_val > 0 AND v_set.wip_account_id IS NOT NULL
       AND NOT public.journal_period_is_locked(v_sh.company_id, CURRENT_DATE) THEN
        v_inv_acct := public.resolve_posting_account(v_sh.company_id, 'receipt_inventory');
        IF v_inv_acct IS NOT NULL THEN
            PERFORM public.mfg_create_and_post_je(
                v_sh.tenant_id, v_sh.company_id, v_ord.branch_id, CURRENT_DATE,
                'subcontract_consume', v_sh_id, v_sh.doc_number, v_ord.id,
                'استهلاك عهدة مقاول إلى WIP — ' || COALESCE(v_sh.doc_number,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_set.wip_account_id, 'debit', v_cons_val, 'credit', 0, 'desc', 'استهلاك خام (عهدة) إلى WIP'),
                    jsonb_build_object('account_id', v_inv_acct, 'debit', 0, 'credit', v_cons_val, 'desc', 'صرف مخزون خام (عهدة)')));
        END IF;
    END IF;

    UPDATE public.mfg_subcontract_shipments
       SET status = 'received', service_cost = COALESCE(service_cost,0) + v_svc, updated_at = now()
     WHERE id = v_sh_id;

    RETURN jsonb_build_object('success', true, 'shipment_id', v_sh_id,
        'service_cost', v_svc, 'consumed_value', round(v_cons_val,4),
        'qty_good', v_qgood, 'qty_reject', v_qrej, 'service_journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.receive_from_subcontractor(jsonb) IS
  'استلام من المقاول: استهلاك عهدة (OUT→WIP) + إرجاع/رفض (تحويل للمصدر) + تكلفة خدمة على الأمر + تقدّم المرحلة + GL تدريجي (Dr WIP/Cr استحقاق أو مخزون). الفاتورة تبقى مستند الذمم. ذرّي.';
GRANT EXECUTE ON FUNCTION public.receive_from_subcontractor(jsonb) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) subcontractor_custody — تقرير تسوية عهدة المقاول (مرسل − مستهلك − مُرجَع − مرفوض = رصيد لديه)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.subcontractor_custody(p_subcontractor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_rows jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT l.product_id,
               SUM(COALESCE(l.qty_sent,0))     AS sent,
               SUM(COALESCE(l.qty_consumed,0)) AS consumed,
               SUM(COALESCE(l.qty_returned,0)) AS returned,
               SUM(COALESCE(l.qty_rejected,0)) AS rejected,
               SUM(COALESCE(l.qty_sent,0) - COALESCE(l.qty_consumed,0)
                   - COALESCE(l.qty_returned,0) - COALESCE(l.qty_rejected,0)) AS balance_at_vendor
        FROM public.mfg_subcontract_shipment_lines l
        JOIN public.mfg_subcontract_shipments s ON s.id = l.shipment_id
        WHERE s.subcontractor_id = p_subcontractor_id
        GROUP BY l.product_id
    ) x;
    RETURN jsonb_build_object('success', true, 'subcontractor_id', p_subcontractor_id, 'custody', v_rows);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.subcontractor_custody(uuid) IS
  'تسوية عهدة المقاول لكل منتج: مرسل/مستهلك/مُرجَع/مرفوض + الرصيد المتبقّي لديه (§4-ج/19).';
GRANT EXECUTE ON FUNCTION public.subcontractor_custody(uuid) TO authenticated, service_role;
