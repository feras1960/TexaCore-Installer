-- 20260717a: موديول التصنيع — طبقة المحاسبة (GL) + إصلاحات P1 الإلزامية — P2 (طبقة القاعدة)
-- ═══════════════════════════════════════════════════════════════════════════
-- يبني على 20260716f/g. يشمل:
--   • إصلاح B1 (تصادم رقم الدفعة): mfg_next_batch_seq — تسلسل آمن للتزامن لكل (مستأجر,منتج,يوم).
--   • إصلاح Backflush عند الاستلام للأوامر بلا مراحل (§4-ج/2).
--   • مساعدات: mfg_create_and_post_je (بناء+ترحيل قيد متوازن) · mfg_notify (إشعارات الأدوار).
--   • حقن القيود المحاسبية داخل post_material_issue/return · post_production_receipt ·
--     complete_order_stage (أوفرهيد) — كلها progressive: تُتخطّى بصمت إن غابت الحسابات (يبقى سلوك P1).
--   • close_production_order (انحرافات + ثابت الإقفال) · reverse_production_document (عكس مخفي) ·
--     ensure_mfg_accounts (زرع الحسابات الأربعة تدريجياً).
--   • أعمدة: mfg_production_orders.variance_amount/closed_at · mfg_labor_logs.status/journal_entry_id/notes ·
--     journal_entries.production_order_id (تتبّع §4-د/12).
-- كل الدوال: SECURITY DEFINER + SET search_path + GRANT · RETURNS jsonb {success,error?} · ذرّية.
-- نموذج القيد: journal_entries(draft) + journal_entry_lines ثم PERFORM post_journal_entry (النمط الموحّد
--   لـ post_sales_invoice/post_purchase_invoice — trg_check_journal_balance يضبط الإجماليات، والترحيل يحدّث الأرصدة).
-- حلّ حساب المخزون: resolve_posting_account(company,'receipt_inventory') (نفس مصدر بقية النظام).
-- idempotent: CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- (المعاملة يديرها مطبّق المايجريشن)

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) أعمدة جديدة (P2)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.mfg_production_orders
    ADD COLUMN IF NOT EXISTS variance_amount numeric,
    ADD COLUMN IF NOT EXISTS closed_at       timestamptz;

ALTER TABLE public.mfg_labor_logs
    ADD COLUMN IF NOT EXISTS status           text DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS journal_entry_id uuid,
    ADD COLUMN IF NOT EXISTS notes            text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfg_labor_logs_status_chk') THEN
        ALTER TABLE public.mfg_labor_logs
            ADD CONSTRAINT mfg_labor_logs_status_chk CHECK (status IN ('pending','approved','swept'));
    END IF;
END $$;

-- مرجع أمر الإنتاج على ترويسة القيد (تتبّع §4-د/12 — مقابل reference_type/id للمستند نفسه)
ALTER TABLE public.journal_entries
    ADD COLUMN IF NOT EXISTS production_order_id uuid;
CREATE INDEX IF NOT EXISTS idx_journal_entries_production_order
    ON public.journal_entries (production_order_id) WHERE production_order_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) mfg_next_batch_seq — تسلسل رقم دفعة آمن للتزامن (إصلاح B1)
--    السقف على (tenant,company,'BATCH-'||product,YYYYMMDD) عبر upsert بقفل صف → لا تصادم
--    حتى مع استلامَين متزامنَين لنفس المنتج في نفس اليوم.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mfg_next_batch_seq(
    p_tenant uuid, p_company uuid, p_product_id uuid, p_date date
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_seq int;
    v_day int := to_char(COALESCE(p_date, CURRENT_DATE), 'YYYYMMDD')::int;
BEGIN
    INSERT INTO public.mfg_number_sequences (tenant_id, company_id, doc_type, year, last_seq)
    VALUES (p_tenant, p_company, 'BATCH-' || p_product_id::text, v_day, 1)
    ON CONFLICT (tenant_id, company_id, doc_type, year)
    DO UPDATE SET last_seq = public.mfg_number_sequences.last_seq + 1, updated_at = now()
    RETURNING last_seq INTO v_seq;
    RETURN v_seq;
END;
$fn$;
COMMENT ON FUNCTION public.mfg_next_batch_seq(uuid,uuid,uuid,date) IS
  'تسلسل رقم دفعة آمن للتزامن لكل (مستأجر,شركة,منتج,يوم) عبر mfg_number_sequences (upsert بقفل صف). إصلاح تصادم B1.';
GRANT EXECUTE ON FUNCTION public.mfg_next_batch_seq(uuid,uuid,uuid,date) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) mfg_create_and_post_je — بناء قيد متوازن وترحيله (مساعد GL موحّد)
--    p_lines: مصفوفة {account_id, debit, credit, desc}. يعيد NULL بصمت إن كان غير متوازن/صفرياً
--    (progressive disclosure — لا يُفشل العملية). يحترم المستدعي قفل الفترة قبل النداء.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mfg_create_and_post_je(
    p_tenant uuid, p_company uuid, p_branch uuid, p_date date,
    p_ref_type text, p_ref_id uuid, p_ref_number text, p_order_id uuid,
    p_desc text, p_lines jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_je uuid;
    v_no text;
    v_ln jsonb;
    v_i  int := 0;
    v_td numeric := 0;
    v_tc numeric := 0;
BEGIN
    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN RETURN NULL; END IF;
    SELECT COALESCE(SUM((l->>'debit')::numeric),0), COALESCE(SUM((l->>'credit')::numeric),0)
      INTO v_td, v_tc FROM jsonb_array_elements(p_lines) l;
    IF v_td <= 0 OR abs(v_td - v_tc) > 0.01 THEN RETURN NULL; END IF;  -- لا نرحّل صفرياً/غير متوازن

    v_no := 'JE-MFG-' || to_char(now(),'YYMMDD') || '-' || lpad(nextval('journal_entry_number_seq')::text, 5, '0');
    INSERT INTO public.journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date, entry_type,
        description, description_ar, reference_type, reference_id, reference_number,
        production_order_id, total_debit, total_credit, status, is_posted, created_by)
    VALUES (p_tenant, p_company, p_branch, v_no, COALESCE(p_date,CURRENT_DATE), 'auto',
        p_desc, p_desc, p_ref_type, p_ref_id, p_ref_number,
        p_order_id, v_td, v_tc, 'draft', false, auth.uid())
    RETURNING id INTO v_je;

    FOR v_ln IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_i := v_i + 1;
        INSERT INTO public.journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc)
        VALUES (p_tenant, v_je, v_i, (v_ln->>'account_id')::uuid, v_ln->>'desc',
            COALESCE((v_ln->>'debit')::numeric,0), COALESCE((v_ln->>'credit')::numeric,0),
            COALESCE((v_ln->>'debit')::numeric,0), COALESCE((v_ln->>'credit')::numeric,0));
    END LOOP;

    PERFORM public.post_journal_entry(v_je, auth.uid());
    RETURN v_je;
END;
$fn$;
COMMENT ON FUNCTION public.mfg_create_and_post_je(uuid,uuid,uuid,date,text,uuid,text,uuid,text,jsonb) IS
  'بناء قيد يومية متوازن (draft) + أسطره ثم ترحيله عبر post_journal_entry. يعيد NULL بصمت إن غير متوازن/صفري.';
GRANT EXECUTE ON FUNCTION public.mfg_create_and_post_je(uuid,uuid,uuid,date,text,uuid,text,uuid,text,jsonb) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) mfg_notify — إشعارات in_app_notifications لمستخدمي أدوار محددة بالشركة (§4-ج/20)
--    best-effort: يبتلع أي خطأ فلا يُفشل عملية الإنتاج.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mfg_notify(
    p_tenant uuid, p_company uuid, p_role_codes text[],
    p_title text, p_message text, p_action_url text DEFAULT NULL,
    p_type text DEFAULT 'manufacturing', p_icon text DEFAULT '🏭'
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_n int := 0;
BEGIN
    INSERT INTO public.in_app_notifications (
        tenant_id, user_id, title, message, notification_type, priority, action_url, icon, is_read)
    SELECT DISTINCT p_tenant, ur.user_id, p_title, p_message, p_type, 'high', p_action_url, p_icon, false
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.user_profiles up ON up.id = ur.user_id AND up.company_id = p_company
    WHERE r.code = ANY(p_role_codes);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
EXCEPTION WHEN OTHERS THEN
    RETURN 0;  -- الإشعارات لا تُفشل الترحيل
END;
$fn$;
COMMENT ON FUNCTION public.mfg_notify(uuid,uuid,text[],text,text,text,text,text) IS
  'إشعار in_app_notifications لكل مستخدمي أدوار محددة بالشركة (نمط confirmationService). best-effort.';
GRANT EXECUTE ON FUNCTION public.mfg_notify(uuid,uuid,text[],text,text,text,text,text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) post_material_issue — (P1 كما هو) + GL: مدين WIP / دائن المخزون
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_material_issue(
    p_issue_id uuid, p_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_iss        public.mfg_material_issues%ROWTYPE;
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_line       RECORD;
    v_roll       public.fabric_rolls%ROWTYPE;
    v_batch      public.inventory_batches%ROWTYPE;
    v_wh         uuid;
    v_cost       numeric;
    v_qty        numeric;
    v_mv_id      uuid;
    v_mv_ids     uuid[] := '{}';
    v_total      numeric := 0;
    v_idx        int := 0;
    v_warn       jsonb := '[]'::jsonb;
    v_req        numeric;
    v_tol        numeric;
    v_dev        numeric;
    v_num        text;
    v_settings   public.mfg_settings%ROWTYPE;
    v_inv_acct   uuid;
    v_je         uuid;
BEGIN
    SELECT * INTO v_iss FROM public.mfg_material_issues WHERE id = p_issue_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الصرف غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_iss.company_id); END IF;
    IF v_iss.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'الصرف ليس بحالة مسودة (الحالة: ' || v_iss.status || ')');
    END IF;
    IF public.journal_period_is_locked(v_iss.company_id, v_iss.issue_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_iss.production_order_id FOR UPDATE;

    FOR v_line IN SELECT * FROM public.mfg_material_issue_lines WHERE issue_id = p_issue_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        v_wh  := COALESCE(v_line.warehouse_id, v_ord.source_warehouse_id);
        IF v_wh IS NULL THEN RAISE EXCEPTION 'لا يوجد مستودع للسطر % (المنتج %)', v_idx, v_line.product_id; END IF;

        IF v_line.roll_id IS NOT NULL THEN
            SELECT * INTO v_roll FROM public.fabric_rolls WHERE id = v_line.roll_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'الرول غير موجود: %', v_line.roll_id; END IF;
            v_qty  := COALESCE(v_line.cut_length, v_line.qty, v_roll.current_length);
            IF v_qty <= 0 OR v_qty > COALESCE(v_roll.current_length,0) + 0.01 THEN
                RAISE EXCEPTION 'طول القصّ % غير صالح للرول % (المتاح %)', v_qty, v_roll.roll_number, v_roll.current_length;
            END IF;
            v_cost := COALESCE(v_roll.cost_per_meter, 0);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, material_id, roll_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id,
                'MISS-' || LEFT(p_issue_id::text,8) || '-' || v_idx, v_iss.issue_date, 'issue',
                v_roll.product_id, v_roll.material_id, v_roll.id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_issue', p_issue_id, v_iss.issue_number, 'صرف رول للإنتاج', auth.uid())
            RETURNING id INTO v_mv_id;
            INSERT INTO public.roll_movements (
                tenant_id, company_id, roll_id, movement_number, movement_date, movement_type,
                quantity, length_before, length_after, from_warehouse_id,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id, v_roll.id,
                'MISS-' || LEFT(p_issue_id::text,8) || '-R' || v_idx, v_iss.issue_date, 'production_issue',
                v_qty, COALESCE(v_roll.current_length,0), COALESCE(v_roll.current_length,0) - v_qty, v_wh,
                'production_issue', p_issue_id, v_iss.issue_number, 'قصّ رول للإنتاج', auth.uid());
            UPDATE public.fabric_rolls
               SET current_length = COALESCE(current_length,0) - v_qty,
                   status = CASE WHEN COALESCE(current_length,0) - v_qty <= 0.01 THEN 'consumed' ELSE status END,
                   updated_at = now()
             WHERE id = v_roll.id;

        ELSIF v_line.batch_id IS NOT NULL THEN
            SELECT * INTO v_batch FROM public.inventory_batches WHERE id = v_line.batch_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة غير موجودة: %', v_line.batch_id; END IF;
            IF v_batch.product_id IS DISTINCT FROM v_line.product_id THEN
                RAISE EXCEPTION 'الدفعة % لا تخصّ المنتج المطلوب', v_batch.batch_number;
            END IF;
            v_qty  := COALESCE(v_line.qty, 0);
            SELECT COALESCE(NULLIF(average_cost,0), v_batch.unit_cost, 0) INTO v_cost
              FROM public.inventory_stock WHERE product_id = v_line.product_id AND warehouse_id = v_wh LIMIT 1;
            v_cost := COALESCE(v_cost, v_batch.unit_cost, 0);
            IF COALESCE(v_batch.current_quantity,0) < v_qty - 0.01 AND NOT p_override THEN
                RAISE EXCEPTION 'كمية الدفعة % غير كافية: المتاح %، المطلوب %', v_batch.batch_number, v_batch.current_quantity, v_qty;
            END IF;
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id,
                'MISS-' || LEFT(p_issue_id::text,8) || '-' || v_idx, v_iss.issue_date, 'issue',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_issue', p_issue_id, v_iss.issue_number, 'صرف دفعة للإنتاج', auth.uid())
            RETURNING id INTO v_mv_id;
            UPDATE public.inventory_batches
               SET current_quantity = COALESCE(current_quantity,0) - v_qty WHERE id = v_batch.id;

        ELSE
            v_qty := COALESCE(v_line.qty, 0);
            SELECT COALESCE(average_cost,0) INTO v_cost
              FROM public.inventory_stock WHERE product_id = v_line.product_id AND warehouse_id = v_wh LIMIT 1;
            v_cost := COALESCE(v_cost, 0);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id,
                'MISS-' || LEFT(p_issue_id::text,8) || '-' || v_idx, v_iss.issue_date, 'issue',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_issue', p_issue_id, v_iss.issue_number, 'صرف مواد للإنتاج', auth.uid())
            RETURNING id INTO v_mv_id;
        END IF;

        UPDATE public.mfg_material_issue_lines
           SET unit_cost = v_cost, qty = v_qty, movement_id = v_mv_id WHERE id = v_line.id;
        v_mv_ids := array_append(v_mv_ids, v_mv_id);
        v_total  := v_total + (v_cost * v_qty);

        IF v_line.bom_line_id IS NOT NULL AND v_ord.bom_snapshot IS NOT NULL THEN
            SELECT (l->>'required_qty')::numeric, (l->>'consumption_tolerance_pct')::numeric
              INTO v_req, v_tol
              FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
             WHERE (l->>'line_id')::uuid = v_line.bom_line_id LIMIT 1;
            IF v_tol IS NOT NULL AND COALESCE(v_req,0) > 0 THEN
                v_dev := abs(v_qty - v_req) / v_req * 100.0;
                IF v_dev > v_tol THEN
                    v_warn := v_warn || jsonb_build_object('line_id', v_line.id, 'product_id', v_line.product_id,
                                'required', v_req, 'issued', v_qty, 'deviation_pct', round(v_dev,2), 'tolerance_pct', v_tol);
                    IF v_dev > 2 * v_tol AND NOT p_override THEN
                        RAISE EXCEPTION 'انحراف استهلاك %٪ يتجاوز ضعف حدّ السماح %٪ للمنتج % — يلزم تجاوز مشرف', round(v_dev,2), v_tol, v_line.product_id;
                    END IF;
                END IF;
            END IF;
        END IF;

        UPDATE public.inventory_stock
           SET reserved_quantity = GREATEST(0, COALESCE(reserved_quantity,0) - v_qty), updated_at = now()
         WHERE product_id = v_line.product_id AND warehouse_id = v_wh
           AND EXISTS (SELECT 1 FROM public.mfg_material_reservations r
                       WHERE r.production_order_id = v_ord.id AND r.product_id = v_line.product_id AND r.status='active');
        UPDATE public.mfg_material_reservations
           SET status = 'consumed', released_at = now()
         WHERE production_order_id = v_ord.id AND product_id = v_line.product_id AND status = 'active';
    END LOOP;

    v_num := COALESCE(v_iss.issue_number, public.generate_mfg_number(v_iss.tenant_id, v_iss.company_id, 'ISS'));
    UPDATE public.mfg_material_issues
       SET status = 'posted', posted_at = now(), issue_number = v_num, updated_at = now()
     WHERE id = p_issue_id;

    UPDATE public.mfg_production_orders
       SET actual_material_cost = COALESCE(actual_material_cost,0) + v_total,
           status = CASE WHEN status = 'confirmed' THEN 'in_progress' ELSE status END,
           actual_start_date = COALESCE(actual_start_date, v_iss.issue_date),
           updated_at = now()
     WHERE id = v_ord.id;

    -- ── GL: مدين WIP / دائن المخزون (progressive: يُتخطّى إن لم تُضبط الحسابات) ──
    IF v_total > 0 THEN
        SELECT * INTO v_settings FROM public.mfg_settings
         WHERE tenant_id = v_iss.tenant_id AND company_id = v_iss.company_id LIMIT 1;
        v_inv_acct := public.resolve_posting_account(v_iss.company_id, 'receipt_inventory');
        IF v_settings.wip_account_id IS NOT NULL AND v_inv_acct IS NOT NULL THEN
            v_je := public.mfg_create_and_post_je(
                v_iss.tenant_id, v_iss.company_id, v_ord.branch_id, v_iss.issue_date,
                'production_issue', p_issue_id, v_num, v_ord.id,
                'صرف مواد للإنتاج — ' || COALESCE(v_num,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', v_total, 'credit', 0, 'desc', 'أعمال تحت التنفيذ (WIP)'),
                    jsonb_build_object('account_id', v_inv_acct, 'debit', 0, 'credit', v_total, 'desc', 'صرف مخزون خام')));
            IF v_je IS NOT NULL THEN
                UPDATE public.mfg_material_issues SET journal_entry_id = v_je WHERE id = p_issue_id;
                UPDATE public.mfg_production_orders SET wip_journal_entry_id = COALESCE(wip_journal_entry_id, v_je) WHERE id = v_ord.id;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'issue_id', p_issue_id, 'issue_number', v_num,
        'movement_ids', to_jsonb(v_mv_ids), 'material_cost', v_total, 'warnings', v_warn, 'journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_material_issue(uuid,boolean) IS
  'ترحيل صرف مواد الإنتاج (OUT) + قصّ رولونات/دفعات + استهلاك الحجوزات + سماحية الاستهلاك + قفل الفترة + GL مدين WIP/دائن المخزون (تدريجي). ذرّي.';
GRANT EXECUTE ON FUNCTION public.post_material_issue(uuid,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) post_material_return — (P1 كما هو) + GL: مدين المخزون / دائن WIP بتكلفة الصرف
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_material_return(
    p_return_id uuid, p_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_ret     public.mfg_material_returns%ROWTYPE;
    v_ord     public.mfg_production_orders%ROWTYPE;
    v_line    RECORD;
    v_iline   public.mfg_material_issue_lines%ROWTYPE;
    v_already numeric;
    v_cost    numeric;
    v_wh      uuid;
    v_qty     numeric;
    v_mv_id   uuid;
    v_mv_ids  uuid[] := '{}';
    v_total   numeric := 0;
    v_idx     int := 0;
    v_num     text;
    v_settings public.mfg_settings%ROWTYPE;
    v_inv_acct uuid;
    v_je       uuid;
BEGIN
    SELECT * INTO v_ret FROM public.mfg_material_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند المرتجع غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ret.company_id); END IF;
    IF v_ret.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرتجع ليس بحالة مسودة (الحالة: ' || v_ret.status || ')');
    END IF;
    IF public.journal_period_is_locked(v_ret.company_id, v_ret.return_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_ret.production_order_id FOR UPDATE;

    FOR v_line IN SELECT * FROM public.mfg_material_return_lines WHERE return_id = p_return_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        IF v_line.issue_line_id IS NULL THEN RAISE EXCEPTION 'سطر المرتجع % بلا مرجع سطر صرف', v_idx; END IF;
        SELECT * INTO v_iline FROM public.mfg_material_issue_lines WHERE id = v_line.issue_line_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'سطر الصرف المرجعي غير موجود'; END IF;

        SELECT COALESCE(SUM(rl.qty),0) INTO v_already
          FROM public.mfg_material_return_lines rl
          JOIN public.mfg_material_returns r ON r.id = rl.return_id
         WHERE rl.issue_line_id = v_line.issue_line_id AND r.status = 'posted' AND r.id <> p_return_id;
        v_qty := COALESCE(v_line.qty, 0);
        IF v_qty > COALESCE(v_iline.qty,0) - v_already + 0.01 THEN
            RAISE EXCEPTION 'كمية المرتجع % تتجاوز المتبقي (مصروف %، مُرجَع %)', v_qty, v_iline.qty, v_already;
        END IF;

        v_cost := COALESCE(v_line.unit_cost, v_iline.unit_cost, 0);
        v_wh   := COALESCE(v_line.warehouse_id, v_iline.warehouse_id, v_ord.source_warehouse_id);

        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, to_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_ret.tenant_id, v_ret.company_id,
            'MRET-' || LEFT(p_return_id::text,8) || '-' || v_idx, v_ret.return_date, 'return_in',
            v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
            'production_return', p_return_id, v_ret.return_number, 'مرتجع مواد إنتاج (بتكلفة الصرف)', auth.uid())
        RETURNING id INTO v_mv_id;

        IF COALESCE(v_line.roll_id, v_iline.roll_id) IS NOT NULL THEN
            UPDATE public.fabric_rolls
               SET current_length = COALESCE(current_length,0) + v_qty,
                   status = CASE WHEN status = 'consumed' THEN 'available' ELSE status END, updated_at = now()
             WHERE id = COALESCE(v_line.roll_id, v_iline.roll_id);
            INSERT INTO public.roll_movements (
                tenant_id, company_id, roll_id, movement_number, movement_date, movement_type,
                quantity, from_warehouse_id, reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_ret.tenant_id, v_ret.company_id, COALESCE(v_line.roll_id, v_iline.roll_id),
                'MRET-' || LEFT(p_return_id::text,8) || '-R' || v_idx, v_ret.return_date, 'production_return',
                v_qty, v_wh, 'production_return', p_return_id, v_ret.return_number, 'استعادة رول من مرتجع إنتاج', auth.uid());
        END IF;
        IF COALESCE(v_line.batch_id, v_iline.batch_id) IS NOT NULL THEN
            UPDATE public.inventory_batches
               SET current_quantity = COALESCE(current_quantity,0) + v_qty WHERE id = COALESCE(v_line.batch_id, v_iline.batch_id);
        END IF;

        UPDATE public.mfg_material_return_lines SET unit_cost = v_cost, movement_id = v_mv_id WHERE id = v_line.id;
        v_mv_ids := array_append(v_mv_ids, v_mv_id);
        v_total  := v_total + (v_cost * v_qty);
    END LOOP;

    v_num := COALESCE(v_ret.return_number, public.generate_mfg_number(v_ret.tenant_id, v_ret.company_id, 'RET'));
    UPDATE public.mfg_material_returns
       SET status = 'posted', posted_at = now(), return_number = v_num, updated_at = now() WHERE id = p_return_id;
    UPDATE public.mfg_production_orders
       SET actual_material_cost = GREATEST(0, COALESCE(actual_material_cost,0) - v_total), updated_at = now()
     WHERE id = v_ord.id;

    -- ── GL: مدين المخزون / دائن WIP (عكس الصرف بتكلفة الصرف) ──
    IF v_total > 0 THEN
        SELECT * INTO v_settings FROM public.mfg_settings
         WHERE tenant_id = v_ret.tenant_id AND company_id = v_ret.company_id LIMIT 1;
        v_inv_acct := public.resolve_posting_account(v_ret.company_id, 'receipt_inventory');
        IF v_settings.wip_account_id IS NOT NULL AND v_inv_acct IS NOT NULL THEN
            v_je := public.mfg_create_and_post_je(
                v_ret.tenant_id, v_ret.company_id, v_ord.branch_id, v_ret.return_date,
                'production_return', p_return_id, v_num, v_ord.id,
                'مرتجع مواد إنتاج — ' || COALESCE(v_num,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_inv_acct, 'debit', v_total, 'credit', 0, 'desc', 'إرجاع مخزون خام'),
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', 0, 'credit', v_total, 'desc', 'تخفيض WIP')));
            IF v_je IS NOT NULL THEN
                UPDATE public.mfg_material_returns SET journal_entry_id = v_je WHERE id = p_return_id;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'return_id', p_return_id, 'return_number', v_num,
        'movement_ids', to_jsonb(v_mv_ids), 'credited', v_total, 'journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_material_return(uuid,boolean) IS
  'ترحيل مرتجع مواد الإنتاج (IN) بتكلفة وقت الصرف + استعادة الرول/الدفعة + GL مدين المخزون/دائن WIP (تدريجي). ذرّي.';
GRANT EXECUTE ON FUNCTION public.post_material_return(uuid,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) complete_order_stage — (P1: Backflush) + استيعاب أوفرهيد (§4-ج/15) + إشعارات
--    أوفرهيد = (دقائق العمل الفعلية إن وُجدت سجلات، وإلا: للسلبية زمن منقضٍ، للنشطة
--    زمن متوقع) ÷ 60 × معدل ساعة المحطة + (مكوّنات per_cycle × qty_good).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.complete_order_stage(
    p_stage_id uuid, p_qty_good numeric, p_qty_scrap numeric DEFAULT 0,
    p_override_shortage boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_stage      public.mfg_order_stages%ROWTYPE;
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_is_last    boolean;
    v_allow_neg  boolean := false;
    v_ln         RECORD;
    v_need       numeric;
    v_avail      numeric;
    v_batch_id   uuid;
    v_shortage   jsonb := '[]'::jsonb;
    v_issue_id   uuid;
    v_lines_cnt  int := 0;
    v_post       jsonb;
    v_next       public.mfg_order_stages%ROWTYPE;
    v_wh         uuid;
    v_settings   public.mfg_settings%ROWTYPE;
    v_je         uuid;
    v_lab_min    numeric;
    v_oh_min     numeric := 0;
    v_hour_rate  numeric := 0;
    v_cycle_rate numeric := 0;
    v_overhead   numeric := 0;
    v_next_ready boolean := false;
BEGIN
    SELECT * INTO v_stage FROM public.mfg_order_stages WHERE id = p_stage_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'المرحلة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_stage.company_id); END IF;
    IF v_stage.status NOT IN ('ready','in_progress') THEN
        RETURN jsonb_build_object('success', false, 'error', 'لا يمكن إكمال مرحلة إلا من ready/in_progress (الحالة: ' || v_stage.status || ')');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_stage.production_order_id FOR UPDATE;
    v_wh := v_ord.source_warehouse_id;

    IF COALESCE(v_stage.qty_in,0) > 0 AND (COALESCE(p_qty_good,0) + COALESCE(p_qty_scrap,0)) > v_stage.qty_in + 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'مجموع (جيّد+خردة) يتجاوز الداخل للمرحلة (qty_in=' || v_stage.qty_in || ')');
    END IF;

    SELECT NOT EXISTS (
        SELECT 1 FROM public.mfg_order_stages
        WHERE production_order_id = v_ord.id AND seq > v_stage.seq) INTO v_is_last;

    SELECT COALESCE(allow_negative_wip,false) INTO v_allow_neg
      FROM public.mfg_settings WHERE tenant_id = v_ord.tenant_id AND company_id = v_ord.company_id LIMIT 1;
    v_allow_neg := COALESCE(v_allow_neg,false) OR p_override_shortage;

    IF v_ord.bom_snapshot IS NOT NULL THEN
        FOR v_ln IN
            SELECT (l->>'component_product_id')::uuid AS pid,
                   (l->>'required_per_unit')::numeric AS rpu,
                   COALESCE((l->>'requires_batch')::boolean,false) AS req_batch,
                   (l->>'line_id')::uuid AS bl_id
            FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
            WHERE COALESCE(l->>'issue_method','backflush') = 'backflush'
              AND (l->>'component_product_id') IS NOT NULL
              AND ( (l->>'stage_id') IS NOT NULL AND (l->>'stage_id')::uuid = v_stage.template_stage_id
                    OR (l->>'stage_id') IS NULL AND v_is_last )
        LOOP
            v_need := COALESCE(v_ln.rpu,0) * COALESCE(p_qty_good,0);
            IF v_need <= 0 THEN CONTINUE; END IF;
            SELECT COALESCE(quantity_on_hand,0) INTO v_avail
              FROM public.inventory_stock WHERE product_id = v_ln.pid AND warehouse_id = v_wh LIMIT 1;
            IF COALESCE(v_avail,0) < v_need - 0.01 AND NOT v_allow_neg THEN
                v_shortage := v_shortage || jsonb_build_object('product_id', v_ln.pid,
                    'required', round(v_need,6), 'available', COALESCE(v_avail,0));
            END IF;
        END LOOP;

        IF jsonb_array_length(v_shortage) > 0 THEN
            PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
                'نقص مواد يمنع إكمال المرحلة', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' — المرحلة ' || COALESCE(v_stage.name_ar,''),
                '/manufacturing?order=' || v_ord.id, 'mfg_shortage', '⛔');
            RETURN jsonb_build_object('success', false, 'error', 'نقص مواد للـBackflush', 'shortage', v_shortage);
        END IF;

        INSERT INTO public.mfg_material_issues (
            tenant_id, company_id, production_order_id, order_stage_id, issue_date, status, is_backflush)
        VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.id, p_stage_id, CURRENT_DATE, 'draft', true)
        RETURNING id INTO v_issue_id;

        FOR v_ln IN
            SELECT (l->>'component_product_id')::uuid AS pid,
                   (l->>'required_per_unit')::numeric AS rpu,
                   COALESCE((l->>'requires_batch')::boolean,false) AS req_batch,
                   (l->>'line_id')::uuid AS bl_id
            FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
            WHERE COALESCE(l->>'issue_method','backflush') = 'backflush'
              AND (l->>'component_product_id') IS NOT NULL
              AND ( (l->>'stage_id') IS NOT NULL AND (l->>'stage_id')::uuid = v_stage.template_stage_id
                    OR (l->>'stage_id') IS NULL AND v_is_last )
        LOOP
            v_need := COALESCE(v_ln.rpu,0) * COALESCE(p_qty_good,0);
            IF v_need <= 0 THEN CONTINUE; END IF;
            v_batch_id := NULL;
            IF v_ln.req_batch THEN
                SELECT id INTO v_batch_id FROM public.inventory_batches
                 WHERE product_id = v_ln.pid AND warehouse_id = v_wh AND COALESCE(current_quantity,0) > 0
                   AND COALESCE(status,'available') = 'available'
                 ORDER BY expiry_date NULLS LAST, received_date NULLS LAST LIMIT 1;
            END IF;
            INSERT INTO public.mfg_material_issue_lines (
                tenant_id, company_id, issue_id, product_id, bom_line_id, qty, warehouse_id, batch_id)
            VALUES (v_ord.tenant_id, v_ord.company_id, v_issue_id, v_ln.pid, v_ln.bl_id, v_need, v_wh, v_batch_id);
            v_lines_cnt := v_lines_cnt + 1;
        END LOOP;

        IF v_lines_cnt > 0 THEN
            v_post := public.post_material_issue(v_issue_id, p_override_shortage);
            IF NOT COALESCE((v_post->>'success')::boolean,false) THEN
                RAISE EXCEPTION 'فشل Backflush: %', COALESCE(v_post->>'error','غير معروف');
            END IF;
        ELSE
            DELETE FROM public.mfg_material_issues WHERE id = v_issue_id;
            v_issue_id := NULL;
        END IF;
    END IF;

    UPDATE public.mfg_order_stages SET
        status = 'done', qty_good = p_qty_good, qty_scrap = COALESCE(p_qty_scrap,0),
        started_at = COALESCE(started_at, now()), completed_at = now(), updated_at = now()
    WHERE id = p_stage_id;

    -- ── استيعاب الأوفرهيد للمرحلة (§4-ج/15 + §4-د/13) ──
    SELECT COALESCE(SUM(minutes),0) INTO v_lab_min
      FROM public.mfg_labor_logs WHERE order_stage_id = p_stage_id AND COALESCE(minutes,0) > 0;
    IF v_lab_min > 0 THEN
        v_oh_min := v_lab_min;
    ELSIF COALESCE(v_stage.is_passive,false) AND v_stage.started_at IS NOT NULL THEN
        v_oh_min := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_stage.started_at)) / 60.0);
    ELSE
        v_oh_min := COALESCE(v_stage.expected_minutes_per_unit,0) * COALESCE(p_qty_good,0) + COALESCE(v_stage.fixed_minutes,0);
    END IF;

    IF v_stage.work_center_id IS NOT NULL THEN
        SELECT COALESCE(hour_rate,0),
               COALESCE((SELECT SUM((c->>'rate_per_cycle')::numeric)
                          FROM jsonb_array_elements(COALESCE(cost_components,'[]'::jsonb)) c
                         WHERE c->>'type' = 'per_cycle'), 0)
          INTO v_hour_rate, v_cycle_rate
          FROM public.mfg_work_centers WHERE id = v_stage.work_center_id;
    END IF;
    v_overhead := round(((COALESCE(v_oh_min,0) / 60.0) * COALESCE(v_hour_rate,0)
                  + COALESCE(v_cycle_rate,0) * COALESCE(p_qty_good,0))::numeric, 4);

    UPDATE public.mfg_order_stages SET actual_minutes = v_oh_min WHERE id = p_stage_id;

    IF v_overhead > 0 THEN
        UPDATE public.mfg_production_orders
           SET actual_overhead_cost = COALESCE(actual_overhead_cost,0) + v_overhead, updated_at = now()
         WHERE id = v_ord.id;
        SELECT * INTO v_settings FROM public.mfg_settings
         WHERE tenant_id = v_ord.tenant_id AND company_id = v_ord.company_id LIMIT 1;
        IF v_settings.wip_account_id IS NOT NULL AND v_settings.overhead_absorption_account_id IS NOT NULL
           AND NOT public.journal_period_is_locked(v_ord.company_id, CURRENT_DATE) THEN
            v_je := public.mfg_create_and_post_je(
                v_ord.tenant_id, v_ord.company_id, v_ord.branch_id, CURRENT_DATE,
                'production_overhead', p_stage_id, v_ord.order_number, v_ord.id,
                'استيعاب أوفرهيد مرحلة — ' || COALESCE(v_stage.name_ar,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', v_overhead, 'credit', 0, 'desc', 'أوفرهيد إلى WIP'),
                    jsonb_build_object('account_id', v_settings.overhead_absorption_account_id, 'debit', 0, 'credit', v_overhead, 'desc', 'أوفرهيد إنتاج مستوعب')));
        END IF;
    END IF;

    -- ── تحرير المرحلة التالية (باحترام زمن الانتظار) ──
    SELECT * INTO v_next FROM public.mfg_order_stages
     WHERE production_order_id = v_ord.id AND seq > v_stage.seq ORDER BY seq LIMIT 1;
    IF FOUND THEN
        IF COALESCE(v_stage.min_wait_hours,0) > 0 THEN
            UPDATE public.mfg_order_stages
               SET qty_in = p_qty_good, status = 'blocked',
                   wait_until = now() + (v_stage.min_wait_hours || ' hours')::interval, updated_at = now()
             WHERE id = v_next.id;
        ELSE
            UPDATE public.mfg_order_stages
               SET qty_in = p_qty_good, status = 'ready', updated_at = now() WHERE id = v_next.id;
            v_next_ready := true;
        END IF;
    END IF;

    UPDATE public.mfg_production_orders
       SET status = CASE WHEN status = 'confirmed' THEN 'in_progress' ELSE status END,
           actual_start_date = COALESCE(actual_start_date, CURRENT_DATE), updated_at = now()
     WHERE id = v_ord.id;

    IF v_next_ready THEN
        PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
            'مرحلة جاهزة للبدء', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' — ' || COALESCE(v_next.name_ar,''),
            '/manufacturing?order=' || v_ord.id, 'mfg_stage_ready', '▶️');
    END IF;

    RETURN jsonb_build_object('success', true, 'stage_id', p_stage_id,
        'next_stage_id', v_next.id, 'is_last', v_is_last, 'backflush_issue_id', v_issue_id,
        'overhead_absorbed', v_overhead, 'overhead_minutes', v_oh_min, 'overhead_journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.complete_order_stage(uuid,numeric,numeric,boolean) IS
  'إكمال مرحلة: Backflush (FEFO/حظر النقص) + استيعاب أوفرهيد (دقائق فعلية/سلبية بالمنقضي/متوقعة × معدل المحطة + per_cycle) + GL مدين WIP/دائن أوفرهيد + إشعار الجاهزية/النقص. ذرّي.';
GRANT EXECUTE ON FUNCTION public.complete_order_stage(uuid,numeric,numeric,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) post_production_receipt — (P1) + إصلاح B1 (رقم دفعة آمن) + إصلاح Backflush
--    للأوامر بلا مراحل عند الاستلام (§4-ج/2) + GL مدين المخزون التام/دائن WIP + إشعار الاكتمال.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_production_receipt(
    p_receipt_id uuid, p_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
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
    -- إصلاح Backflush بلا مراحل:
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
    -- GL:
    v_inv_acct   uuid;
    v_je         uuid;
BEGIN
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

    SELECT EXISTS (SELECT 1 FROM public.mfg_order_stages WHERE production_order_id = v_ord.id) INTO v_has_stages;
    IF v_has_stages THEN
        SELECT bool_and(status = 'done') INTO v_last_done FROM public.mfg_order_stages
         WHERE production_order_id = v_ord.id
           AND seq = (SELECT MAX(seq) FROM public.mfg_order_stages WHERE production_order_id = v_ord.id);
        IF NOT COALESCE(v_last_done,false) AND NOT p_override THEN
            RETURN jsonb_build_object('success', false, 'error', 'المرحلة الأخيرة لم تكتمل بعد');
        END IF;
    END IF;

    -- ── إصلاح: Backflush عند الاستلام للأوامر بلا مراحل (§4-ج/2) ──
    -- يصرف المتبقّي غير المصروف من بنود backflush = required − (صافي المصروف = مصروف − مُرجَع).
    -- يحافظ على مسار الصرف اليدوي (المتبقّي فقط). النقص يُرجَع {success:false, shortage:[...]}.
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
                   AND COALESCE(status,'available') = 'available'
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
            -- إعادة قراءة تكاليف الأمر بعد الصرف الآلي
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
                -- إصلاح B1: تسلسل رقم دفعة آمن للتزامن لكل (مستأجر,منتج,يوم) — لا يعتمد على فهرس السطر
                v_batch_no := replace(replace(replace(v_fmt,
                    '{product}', COALESCE(v_prod.sku, LEFT(v_line.product_id::text,8))),
                    '{yymmdd}', to_char(v_rcp.receipt_date,'YYMMDD')),
                    '{seq}', lpad(public.mfg_next_batch_seq(v_ord.tenant_id, v_ord.company_id, v_line.product_id, v_rcp.receipt_date)::text, 3, '0'));
                v_expiry := CASE WHEN v_prod.shelf_life_days IS NOT NULL
                                 THEN v_rcp.receipt_date + (v_prod.shelf_life_days || ' days')::interval ELSE NULL END;
                INSERT INTO public.inventory_batches (
                    tenant_id, company_id, product_id, warehouse_id, batch_number,
                    manufacturing_date, expiry_date, received_date,
                    initial_quantity, current_quantity, unit_cost, status)
                VALUES (v_ord.tenant_id, v_ord.company_id, v_line.product_id, v_wh, v_batch_no,
                    v_rcp.receipt_date, v_expiry, v_rcp.receipt_date,
                    v_line.qty, v_line.qty, v_uc, 'available')
                RETURNING id INTO v_batch_id;
            ELSE
                v_batch_id := v_line.batch_id;
            END IF;
        ELSE
            v_batch_id := v_line.batch_id;
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

    -- ── GL: مدين المخزون التام / دائن WIP ──
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
        'backflush_issue_id', v_bf_issue, 'journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_production_receipt(uuid,boolean) IS
  'استلام مخرجات الإنتاج (IN): backflush الأوامر بلا مراحل عند الاستلام (المتبقّي فقط) + تقييم من WIP + إنشاء دفعات برقم آمن للتزامن (إصلاح B1) + GL مدين المخزون/دائن WIP + إشعار الاكتمال. ذرّي.';
GRANT EXECUTE ON FUNCTION public.post_production_receipt(uuid,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) close_production_order — إقفال الأمر + قيد الانحرافات + ثابت الإقفال (§4-ج/4)
--    residual = (مواد+أجور+أوفرهيد+باطن فعلي) − المستلَم؛ residual>0: مدين انحراف/دائن WIP.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.close_production_order(
    p_order_id uuid, p_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_settings   public.mfg_settings%ROWTYPE;
    v_wip_debits numeric;
    v_received   numeric;
    v_residual   numeric;
    v_je         uuid;
BEGIN
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ord.company_id); END IF;
    IF v_ord.status = 'closed' THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر مقفل مسبقاً'); END IF;
    IF v_ord.status NOT IN ('completed','terminated') AND NOT (p_override AND v_ord.status = 'in_progress') THEN
        RETURN jsonb_build_object('success', false, 'error',
            'الإقفال متاح من completed/terminated فقط (الحالة: ' || v_ord.status || ')');
    END IF;
    IF public.journal_period_is_locked(v_ord.company_id, COALESCE(v_ord.actual_end_date, CURRENT_DATE)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    v_wip_debits := round((COALESCE(v_ord.actual_material_cost,0) + COALESCE(v_ord.actual_labor_cost,0)
                    + COALESCE(v_ord.actual_overhead_cost,0) + COALESCE(v_ord.subcontract_cost,0))::numeric, 2);
    v_received   := round(COALESCE(v_ord.received_cost,0)::numeric, 2);
    v_residual   := round((v_wip_debits - v_received)::numeric, 2);

    SELECT * INTO v_settings FROM public.mfg_settings
     WHERE tenant_id = v_ord.tenant_id AND company_id = v_ord.company_id LIMIT 1;

    IF abs(v_residual) > 0.005 AND v_settings.wip_account_id IS NOT NULL AND v_settings.production_variance_account_id IS NOT NULL THEN
        IF v_residual > 0 THEN
            v_je := public.mfg_create_and_post_je(
                v_ord.tenant_id, v_ord.company_id, v_ord.branch_id, COALESCE(v_ord.actual_end_date, CURRENT_DATE),
                'production_close', p_order_id, v_ord.order_number, p_order_id,
                'إقفال أمر إنتاج (انحراف مدين) — ' || COALESCE(v_ord.order_number,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_settings.production_variance_account_id, 'debit', v_residual, 'credit', 0, 'desc', 'انحرافات الإنتاج'),
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', 0, 'credit', v_residual, 'desc', 'إقفال بقايا WIP')));
        ELSE
            v_je := public.mfg_create_and_post_je(
                v_ord.tenant_id, v_ord.company_id, v_ord.branch_id, COALESCE(v_ord.actual_end_date, CURRENT_DATE),
                'production_close', p_order_id, v_ord.order_number, p_order_id,
                'إقفال أمر إنتاج (انحراف دائن) — ' || COALESCE(v_ord.order_number,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', abs(v_residual), 'credit', 0, 'desc', 'تسوية WIP'),
                    jsonb_build_object('account_id', v_settings.production_variance_account_id, 'debit', 0, 'credit', abs(v_residual), 'desc', 'انحرافات الإنتاج (دائن)')));
        END IF;
    END IF;

    -- ثابت الإقفال: المستلَم + الانحراف = مدينات WIP
    IF abs((v_received + v_residual) - v_wip_debits) > 0.01 THEN
        RAISE EXCEPTION 'خلل ثابت الإقفال: المستلَم(%) + الانحراف(%) ≠ مدينات WIP(%)', v_received, v_residual, v_wip_debits;
    END IF;

    UPDATE public.mfg_production_orders
       SET status = 'closed', closed_at = now(), variance_amount = v_residual, updated_at = now()
     WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'closed',
        'variance_amount', v_residual, 'variance_journal_entry_id', v_je,
        'reconciliation', jsonb_build_object(
            'wip_debits', v_wip_debits, 'received_cost', v_received, 'variance', v_residual,
            'received_plus_variance', round(v_received + v_residual, 2),
            'balanced', abs((v_received + v_residual) - v_wip_debits) < 0.01));
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.close_production_order(uuid,boolean) IS
  'إقفال أمر إنتاج من completed/terminated: قيد انحرافات (مدين انحراف/دائن WIP وبالعكس) + تحقّق ثابت (المستلَم+الانحراف=مدينات WIP) + variance_amount/closed_at. ذرّي.';
GRANT EXECUTE ON FUNCTION public.close_production_order(uuid,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9) reverse_production_document — عكس مخفي لمستند صرف/مرتجع/استلام مُرحَّل (§4-د/12)
--    حركات مخزون عكسية + استعادة الرول/الدفعة + عكس القيد (delete_journal_entry_soft) +
--    حالة 'reversed' + تعديل تكاليف الأمر. حارس: عكس الاستلام يُحظر لو استُهلكت دفعته لاحقاً.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reverse_production_document(
    p_doc_type text, p_doc_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_ord     public.mfg_production_orders%ROWTYPE;
    v_iss     public.mfg_material_issues%ROWTYPE;
    v_ret     public.mfg_material_returns%ROWTYPE;
    v_rcp     public.mfg_finished_receipts%ROWTYPE;
    v_line    RECORD;
    v_idx     int := 0;
    v_total   numeric := 0;
    v_good    numeric := 0;
    v_scrap   numeric := 0;
    v_wh      uuid;
    v_qty     numeric;
    v_cost    numeric;
    v_je      uuid;
BEGIN
    IF p_doc_type = 'issue' THEN
        SELECT * INTO v_iss FROM public.mfg_material_issues WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الصرف غير موجود'); END IF;
        IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_iss.company_id); END IF;
        IF v_iss.status <> 'posted' THEN RETURN jsonb_build_object('success', false, 'error', 'الصرف ليس مُرحَّلاً'); END IF;
        IF public.journal_period_is_locked(v_iss.company_id, v_iss.issue_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked'); END IF;
        SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_iss.production_order_id FOR UPDATE;

        FOR v_line IN SELECT * FROM public.mfg_material_issue_lines WHERE issue_id = p_doc_id ORDER BY created_at
        LOOP
            v_idx := v_idx + 1;
            v_qty := COALESCE(v_line.qty,0); v_cost := COALESCE(v_line.unit_cost,0);
            v_wh  := COALESCE(v_line.warehouse_id, v_ord.source_warehouse_id);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, to_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id,
                'MREV-I-' || LEFT(p_doc_id::text,8) || '-' || v_idx, CURRENT_DATE, 'return_in',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_issue_reversal', p_doc_id, v_iss.issue_number, 'عكس صرف إنتاج', auth.uid());
            IF v_line.roll_id IS NOT NULL THEN
                UPDATE public.fabric_rolls
                   SET current_length = COALESCE(current_length,0) + v_qty,
                       status = CASE WHEN status='consumed' THEN 'available' ELSE status END, updated_at = now()
                 WHERE id = v_line.roll_id;
            END IF;
            IF v_line.batch_id IS NOT NULL THEN
                UPDATE public.inventory_batches SET current_quantity = COALESCE(current_quantity,0) + v_qty WHERE id = v_line.batch_id;
            END IF;
            v_total := v_total + (v_cost * v_qty);
        END LOOP;

        IF v_iss.journal_entry_id IS NOT NULL THEN PERFORM public.delete_journal_entry_soft(v_iss.journal_entry_id, 'عكس صرف إنتاج'); END IF;
        UPDATE public.mfg_material_issues SET status = 'reversed', updated_at = now() WHERE id = p_doc_id;
        UPDATE public.mfg_production_orders SET actual_material_cost = GREATEST(0, COALESCE(actual_material_cost,0) - v_total), updated_at = now() WHERE id = v_ord.id;
        RETURN jsonb_build_object('success', true, 'doc_type','issue', 'doc_id', p_doc_id, 'reversed_amount', v_total);

    ELSIF p_doc_type = 'return' THEN
        SELECT * INTO v_ret FROM public.mfg_material_returns WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند المرتجع غير موجود'); END IF;
        IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ret.company_id); END IF;
        IF v_ret.status <> 'posted' THEN RETURN jsonb_build_object('success', false, 'error', 'المرتجع ليس مُرحَّلاً'); END IF;
        IF public.journal_period_is_locked(v_ret.company_id, v_ret.return_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked'); END IF;
        SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_ret.production_order_id FOR UPDATE;

        FOR v_line IN SELECT * FROM public.mfg_material_return_lines WHERE return_id = p_doc_id ORDER BY created_at
        LOOP
            v_idx := v_idx + 1;
            v_qty := COALESCE(v_line.qty,0); v_cost := COALESCE(v_line.unit_cost,0);
            v_wh  := COALESCE(v_line.warehouse_id, v_ord.source_warehouse_id);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_ret.tenant_id, v_ret.company_id,
                'MREV-R-' || LEFT(p_doc_id::text,8) || '-' || v_idx, CURRENT_DATE, 'issue',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_return_reversal', p_doc_id, v_ret.return_number, 'عكس مرتجع إنتاج', auth.uid());
            IF v_line.roll_id IS NOT NULL THEN
                UPDATE public.fabric_rolls SET current_length = GREATEST(0, COALESCE(current_length,0) - v_qty), updated_at = now() WHERE id = v_line.roll_id;
            END IF;
            IF v_line.batch_id IS NOT NULL THEN
                UPDATE public.inventory_batches SET current_quantity = GREATEST(0, COALESCE(current_quantity,0) - v_qty) WHERE id = v_line.batch_id;
            END IF;
            v_total := v_total + (v_cost * v_qty);
        END LOOP;

        IF v_ret.journal_entry_id IS NOT NULL THEN PERFORM public.delete_journal_entry_soft(v_ret.journal_entry_id, 'عكس مرتجع إنتاج'); END IF;
        UPDATE public.mfg_material_returns SET status = 'reversed', updated_at = now() WHERE id = p_doc_id;
        UPDATE public.mfg_production_orders SET actual_material_cost = COALESCE(actual_material_cost,0) + v_total, updated_at = now() WHERE id = v_ord.id;
        RETURN jsonb_build_object('success', true, 'doc_type','return', 'doc_id', p_doc_id, 'reversed_amount', v_total);

    ELSIF p_doc_type = 'receipt' THEN
        SELECT * INTO v_rcp FROM public.mfg_finished_receipts WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الاستلام غير موجود'); END IF;
        IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_rcp.company_id); END IF;
        IF v_rcp.status <> 'posted' THEN RETURN jsonb_build_object('success', false, 'error', 'الاستلام ليس مُرحَّلاً'); END IF;
        IF public.journal_period_is_locked(v_rcp.company_id, v_rcp.receipt_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked'); END IF;
        -- حارس: منع العكس إن استُهلكت أي دفعة منتَجة لاحقاً (استهلاك أسفل السلسلة)
        IF EXISTS (
            SELECT 1 FROM public.mfg_finished_receipt_lines rl
            JOIN public.inventory_batches b ON b.id = rl.batch_id
            WHERE rl.receipt_id = p_doc_id AND COALESCE(b.current_quantity,0) < COALESCE(b.initial_quantity,0) - 0.0001
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'لا يمكن عكس الاستلام: الدفعة المنتَجة استُهلكت جزئياً لاحقاً');
        END IF;
        SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_rcp.production_order_id FOR UPDATE;

        FOR v_line IN SELECT * FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_doc_id ORDER BY created_at
        LOOP
            v_idx := v_idx + 1;
            v_qty := COALESCE(v_line.qty,0); v_cost := COALESCE(v_line.unit_cost,0);
            v_wh  := COALESCE(v_line.warehouse_id,
                        CASE WHEN v_line.output_role IN ('scrap','byproduct')
                             THEN COALESCE(v_ord.scrap_warehouse_id, v_ord.fg_warehouse_id) ELSE v_ord.fg_warehouse_id END);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_rcp.tenant_id, v_rcp.company_id,
                'MREV-C-' || LEFT(p_doc_id::text,8) || '-' || v_idx, CURRENT_DATE, 'issue',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_receipt_reversal', p_doc_id, v_rcp.receipt_number, 'عكس استلام إنتاج', auth.uid());
            IF v_line.batch_id IS NOT NULL THEN
                UPDATE public.inventory_batches
                   SET current_quantity = GREATEST(0, COALESCE(current_quantity,0) - v_qty), status = 'rejected'
                 WHERE id = v_line.batch_id;
            END IF;
            v_total := v_total + (v_cost * v_qty);
            IF v_line.output_role IN ('primary','co_product') THEN v_good := v_good + v_qty;
            ELSIF v_line.output_role = 'scrap' THEN v_scrap := v_scrap + v_qty; END IF;
        END LOOP;

        IF v_rcp.journal_entry_id IS NOT NULL THEN PERFORM public.delete_journal_entry_soft(v_rcp.journal_entry_id, 'عكس استلام إنتاج'); END IF;
        UPDATE public.mfg_finished_receipts SET status = 'reversed', updated_at = now() WHERE id = p_doc_id;
        UPDATE public.mfg_production_orders SET
            received_cost = GREATEST(0, COALESCE(received_cost,0) - v_total),
            qty_produced  = GREATEST(0, COALESCE(qty_produced,0) - v_good),
            qty_scrapped  = GREATEST(0, COALESCE(qty_scrapped,0) - v_scrap),
            status = CASE WHEN status IN ('completed','closed') THEN 'in_progress' ELSE status END,
            updated_at = now()
        WHERE id = v_ord.id;
        RETURN jsonb_build_object('success', true, 'doc_type','receipt', 'doc_id', p_doc_id, 'reversed_amount', v_total);
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'نوع مستند غير مدعوم (issue|return|receipt)');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.reverse_production_document(text,uuid) IS
  'عكس مخفي لمستند إنتاج مُرحَّل (issue/return/receipt): حركات مخزون عكسية + استعادة رول/دفعة + عكس القيد + حالة reversed + تعديل تكاليف الأمر. حارس استهلاك أسفل السلسلة للاستلام + قفل الفترة. ذرّي.';
GRANT EXECUTE ON FUNCTION public.reverse_production_document(text,uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10) ensure_mfg_accounts — زرع حسابات التصنيع الأربعة تدريجياً + وسمها في mfg_settings
--     (يُستدعى من شاشة الإعدادات P2b — لا تلقائياً). لا يكرّر الموجود.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mfg_ensure_one_account(
    p_tenant uuid, p_company uuid, p_existing uuid,
    p_base_code text, p_name_ar text, p_name_en text, p_type uuid, p_parent uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_id uuid; v_code text; v_n int := 0;
BEGIN
    IF p_existing IS NOT NULL THEN
        PERFORM 1 FROM public.chart_of_accounts
         WHERE id = p_existing AND company_id = p_company AND COALESCE(is_active,true) AND COALESCE(is_group,false) = false;
        IF FOUND THEN RETURN p_existing; END IF;
    END IF;
    SELECT id INTO v_id FROM public.chart_of_accounts
     WHERE company_id = p_company AND name_ar = p_name_ar AND COALESCE(is_group,false) = false LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    v_code := p_base_code;
    WHILE EXISTS (SELECT 1 FROM public.chart_of_accounts
                   WHERE tenant_id = p_tenant AND company_id = p_company AND account_code = v_code) LOOP
        v_n := v_n + 1; v_code := (p_base_code::int + v_n)::text;
    END LOOP;

    INSERT INTO public.chart_of_accounts (
        tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_group, is_active, current_balance)
    VALUES (p_tenant, p_company, v_code, p_name_ar, p_name_en, p_type, p_parent, false, true, 0)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.mfg_ensure_one_account(uuid,uuid,uuid,text,text,text,uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_mfg_accounts(
    p_tenant_id uuid, p_company_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_asset_type uuid;
    v_exp_type   uuid;
    v_inv_acct   uuid;
    v_inv_parent uuid;
    v_set        public.mfg_settings%ROWTYPE;
    v_wip uuid; v_lab uuid; v_oh uuid; v_var uuid;
BEGIN
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(p_company_id); END IF;

    -- أنواع الحسابات: تُفضَّل الأنواع المستعملة فعلاً بالشركة (تكافؤ متعدّد المستأجرين)
    SELECT at.id INTO v_asset_type FROM public.account_types at
     WHERE at.classification = 'assets' ORDER BY (at.code = 'CURRENT_ASSET') DESC NULLS LAST LIMIT 1;
    SELECT at.id INTO v_exp_type FROM public.account_types at
     WHERE at.classification = 'expenses' ORDER BY (at.code = 'EXPENSE') DESC NULLS LAST LIMIT 1;
    IF v_asset_type IS NULL OR v_exp_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'أنواع الحسابات (أصول/مصروفات) غير معرّفة');
    END IF;

    v_inv_acct := public.resolve_posting_account(p_company_id, 'receipt_inventory');
    IF v_inv_acct IS NOT NULL THEN SELECT parent_id INTO v_inv_parent FROM public.chart_of_accounts WHERE id = v_inv_acct; END IF;

    SELECT * INTO v_set FROM public.mfg_settings WHERE tenant_id = p_tenant_id AND company_id = p_company_id LIMIT 1;

    v_wip := public.mfg_ensure_one_account(p_tenant_id, p_company_id, v_set.wip_account_id,
              '1450', 'أعمال تحت التنفيذ', 'Work In Progress', v_asset_type, v_inv_parent);
    v_lab := public.mfg_ensure_one_account(p_tenant_id, p_company_id, v_set.labor_absorption_account_id,
              '5410', 'أجور إنتاج مستوعبة', 'Absorbed Production Labor', v_exp_type, NULL);
    v_oh  := public.mfg_ensure_one_account(p_tenant_id, p_company_id, v_set.overhead_absorption_account_id,
              '5420', 'أوفرهيد إنتاج مستوعب', 'Absorbed Production Overhead', v_exp_type, NULL);
    v_var := public.mfg_ensure_one_account(p_tenant_id, p_company_id, v_set.production_variance_account_id,
              '5430', 'انحرافات الإنتاج', 'Production Variance', v_exp_type, NULL);

    INSERT INTO public.mfg_settings (
        tenant_id, company_id, wip_account_id, labor_absorption_account_id,
        overhead_absorption_account_id, production_variance_account_id)
    VALUES (p_tenant_id, p_company_id, v_wip, v_lab, v_oh, v_var)
    ON CONFLICT (tenant_id, company_id) DO UPDATE SET
        wip_account_id                 = COALESCE(mfg_settings.wip_account_id, EXCLUDED.wip_account_id),
        labor_absorption_account_id    = COALESCE(mfg_settings.labor_absorption_account_id, EXCLUDED.labor_absorption_account_id),
        overhead_absorption_account_id = COALESCE(mfg_settings.overhead_absorption_account_id, EXCLUDED.overhead_absorption_account_id),
        production_variance_account_id = COALESCE(mfg_settings.production_variance_account_id, EXCLUDED.production_variance_account_id),
        updated_at = now();

    RETURN jsonb_build_object('success', true,
        'wip_account_id', v_wip, 'labor_absorption_account_id', v_lab,
        'overhead_absorption_account_id', v_oh, 'production_variance_account_id', v_var);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.ensure_mfg_accounts(uuid,uuid) IS
  'زرع حسابات التصنيع الأربعة (WIP أصل، أجور/أوفرهيد مستوعبان + انحرافات مصروف) إن غابت + وسمها في mfg_settings. لا يكرّر الموجود. يُستدعى من الإعدادات (P2b) لا تلقائياً.';
GRANT EXECUTE ON FUNCTION public.ensure_mfg_accounts(uuid,uuid) TO authenticated, service_role;
