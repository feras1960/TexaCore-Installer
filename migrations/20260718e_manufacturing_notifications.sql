-- ============================================================================
-- 20260718e — إشعارات داخل التطبيق لموديول التصنيع
-- ============================================================================
-- 1) mfg_notify_work_center: إشعار موظفي مركز العمل (عبر mfg_work_center_employees
--    → employees.user_profile_id) مع فولباك اختياري بالأدوار إذا كان الربط فارغاً.
-- 2) confirm_production_order: عند نجاح التأكيد — إشعار أمين المستودع (جهّز المواد)
--    + إشعار موظفي مركز عمل أول مرحلة جاهزة. كتلة الإشعارات معزولة الفشل.
-- 3) complete_order_stage: عند جاهزية مراحل تالية — إشعار موظفي مركز عملها
--    (إضافة لإشعار مدير الإنتاج القائم)، وعند اكتمال كل المراحل — إشعار
--    «الإنتاج مكتمل — جاهز للاستلام بالمستودع». كل الإضافات معزولة الفشل.
-- ملاحظة: تعييل الموظف→المستخدم عبر employees.user_profile_id (id بجدول
-- user_profiles = auth.uid). إذا لا ربط، فولباك بالأدوار عبر mfg_notify.
-- آمنة لإعادة التطبيق (CREATE OR REPLACE).
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) الدالة المساعدة: إشعار موظفي مركز عمل
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mfg_notify_work_center(
    p_tenant uuid,
    p_company uuid,
    p_work_center_id uuid,
    p_title text,
    p_message text,
    p_action_url text DEFAULT NULL,
    p_type text DEFAULT 'manufacturing',
    p_icon text DEFAULT '🏭',
    p_fallback_roles text[] DEFAULT ARRAY['production_manager'])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_n int := 0;
BEGIN
    IF p_work_center_id IS NOT NULL THEN
        INSERT INTO public.in_app_notifications (
            tenant_id, user_id, title, message, notification_type, priority, action_url, icon, is_read)
        SELECT DISTINCT p_tenant, e.user_profile_id, p_title, p_message, p_type, 'high', p_action_url, p_icon, false
        FROM public.mfg_work_center_employees wce
        JOIN public.employees e ON e.id = wce.employee_id
        WHERE wce.work_center_id = p_work_center_id
          AND wce.tenant_id = p_tenant
          AND wce.company_id = p_company
          AND e.user_profile_id IS NOT NULL
          AND COALESCE(e.is_active, true);
        GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    -- فولباك بالأدوار إذا لا موظفين مربوطين بمستخدمين
    IF v_n = 0 AND p_fallback_roles IS NOT NULL AND COALESCE(array_length(p_fallback_roles,1),0) > 0 THEN
        v_n := public.mfg_notify(p_tenant, p_company, p_fallback_roles, p_title, p_message, p_action_url, p_type, p_icon);
    END IF;
    RETURN v_n;
EXCEPTION WHEN OTHERS THEN
    RETURN 0;  -- الإشعارات لا تُفشل العملية
END;
$function$;

-- تشديد: لا تنفيذ لanon/PUBLIC (النداء الداخلي عبر دوال SECURITY DEFINER لا يتأثر)
REVOKE EXECUTE ON FUNCTION public.mfg_notify_work_center(uuid,uuid,uuid,text,text,text,text,text,text[]) FROM PUBLIC, anon;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) confirm_production_order — نص حي + كتلة إشعارات قبل الإرجاع
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_production_order(p_order_id uuid, p_reserve boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_ord public.mfg_production_orders%ROWTYPE; v_bom public.mfg_boms%ROWTYPE; v_tmpl_id uuid;
    v_yield numeric; v_sum_pct numeric; v_lines jsonb; v_outputs jsonb; v_snapshot jsonb;
    v_stages int := 0; v_reserved int := 0; v_plan_cost numeric := 0; v_ln RECORD; v_first_seq int; v_num text;
    v_dag jsonb; v_dep_edges int := 0; v_lim jsonb;   -- P4a
    v_warnings jsonb := '[]'::jsonb;                   -- P4c/B3
BEGIN
    IF NOT public.mfg_tenant_has_module() THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ord.company_id); END IF;
    IF v_ord.status <> 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'لا يمكن تأكيد أمر إلا من حالة مسودة (الحالة: '||v_ord.status||')'); END IF;
    v_lim := public.mfg_check_limit(v_ord.tenant_id, v_ord.company_id, 'mfg_orders_per_month');
    IF NOT COALESCE((v_lim->>'allowed')::boolean, true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'MFG_LIMIT_ORDERS', 'used', v_lim->'used', 'limit', v_lim->'limit');
    END IF;
    IF v_ord.bom_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر بلا قائمة مواد'); END IF;
    SELECT * INTO v_bom FROM public.mfg_boms WHERE id = v_ord.bom_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد غير موجودة'); END IF;
    IF v_bom.status <> 'approved' THEN RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد غير معتمدة — لا يُنتَج إلا من BOM معتمدة'); END IF;
    IF (v_bom.effective_from IS NOT NULL AND v_bom.effective_from > CURRENT_DATE) OR (v_bom.effective_to IS NOT NULL AND v_bom.effective_to < CURRENT_DATE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد خارج فترة السريان'); END IF;

    -- P4c/B3: soft batch-size warnings (never block — lab/pilot batches allowed).
    IF v_bom.batch_min IS NOT NULL AND COALESCE(v_ord.qty_planned,0) < v_bom.batch_min THEN
        v_warnings := v_warnings || jsonb_build_object('code','BATCH_BELOW_MIN','batch_min',v_bom.batch_min,'qty_planned',v_ord.qty_planned);
    END IF;
    IF v_bom.batch_max IS NOT NULL AND COALESCE(v_ord.qty_planned,0) > v_bom.batch_max THEN
        v_warnings := v_warnings || jsonb_build_object('code','BATCH_ABOVE_MAX','batch_max',v_bom.batch_max,'qty_planned',v_ord.qty_planned);
    END IF;

    v_yield := COALESCE(NULLIF(v_bom.yield_pct,0),100)/100.0;
    v_tmpl_id := COALESCE(v_ord.workflow_template_id, v_bom.workflow_template_id);
    SELECT COALESCE(SUM(formula_pct),0) INTO v_sum_pct FROM public.mfg_bom_lines WHERE bom_id = v_bom.id AND formula_pct IS NOT NULL;
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'line_id', t.id, 'component_product_id', t.component_product_id, 'component_bom_id', t.component_bom_id,
        'qty_per_unit', t.qty_per_unit, 'formula_pct', t.formula_pct, 'unit_id', t.unit_id, 'stage_id', t.stage_id,
        'issue_method', t.issue_method, 'scrap_pct', COALESCE(t.scrap_pct,0), 'consumption_tolerance_pct', t.consumption_tolerance_pct,
        'weigh_tolerance_pct', t.weigh_tolerance_pct,
        'is_roll_tracked', t.is_roll_tracked, 'requires_batch', t.requires_batch,
        'required_qty', round(t.req::numeric,6), 'required_per_unit', round((t.req / NULLIF(v_ord.qty_planned,0))::numeric,8)
      ) ORDER BY t.sort_order), '[]'::jsonb),
      COALESCE(SUM(t.req * COALESCE(st.average_cost,0)),0)
    INTO v_lines, v_plan_cost
    FROM (
      SELECT bl.*, CASE
          WHEN v_bom.bom_basis='formula' AND bl.formula_pct IS NOT NULL THEN (bl.formula_pct / NULLIF(v_sum_pct,0)) * (v_ord.qty_planned / v_yield) * (1 + COALESCE(bl.scrap_pct,0)/100.0)
          WHEN v_bom.bom_basis='formula' AND bl.qty_per_unit IS NOT NULL THEN bl.qty_per_unit * (v_ord.qty_planned / NULLIF(v_bom.quantity,0)) * (1 + COALESCE(bl.scrap_pct,0)/100.0)
          ELSE COALESCE(bl.qty_per_unit,0) * v_ord.qty_planned * (1 + COALESCE(bl.scrap_pct,0)/100.0) / v_yield END AS req
      FROM public.mfg_bom_lines bl WHERE bl.bom_id = v_bom.id
    ) t
    LEFT JOIN public.inventory_stock st ON st.product_id = t.component_product_id AND st.warehouse_id = v_ord.source_warehouse_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('output_id', o.id, 'product_id', o.product_id, 'output_role', o.output_role,
        'qty_per_batch', o.qty_per_batch, 'cost_share_pct', o.cost_share_pct, 'recovery_rate', o.recovery_rate,
        'default_package_size', o.default_package_size, 'stage_id', o.stage_id) ORDER BY o.sort_order), '[]'::jsonb)
    INTO v_outputs FROM public.mfg_bom_outputs o WHERE o.bom_id = v_bom.id;
    v_snapshot := jsonb_build_object('bom_id', v_bom.id, 'bom_version', v_bom.version, 'bom_basis', v_bom.bom_basis,
        'yield_pct', v_bom.yield_pct, 'quantity', v_bom.quantity, 'lines', v_lines, 'outputs', v_outputs);
    IF v_tmpl_id IS NOT NULL THEN
        SELECT MIN(seq) INTO v_first_seq FROM public.mfg_workflow_stages WHERE template_id = v_tmpl_id;
        INSERT INTO public.mfg_order_stages (tenant_id, company_id, production_order_id, template_stage_id, seq,
            name_ar, name_en, work_center_id, status, qty_in, is_passive, min_wait_hours, pay_type, piece_rate,
            expected_minutes_per_unit, fixed_minutes, qc_checklist)
        SELECT v_ord.tenant_id, v_ord.company_id, v_ord.id, ws.id, ws.seq, ws.name_ar, ws.name_en, ws.work_center_id,
            CASE WHEN ws.seq = v_first_seq THEN 'ready' ELSE 'blocked' END,
            CASE WHEN ws.seq = v_first_seq THEN v_ord.qty_planned ELSE 0 END,
            COALESCE(ws.is_passive,false), COALESCE(ws.min_wait_hours,0), ws.pay_type, ws.piece_rate,
            ws.expected_minutes_per_unit, ws.fixed_minutes, COALESCE(ws.qc_checklist,'[]'::jsonb)
        FROM public.mfg_workflow_stages ws WHERE ws.template_id = v_tmpl_id;
        GET DIAGNOSTICS v_stages = ROW_COUNT;

        -- ── P4a: DAG dependencies ────────────────────────────────────────────
        SELECT count(*) INTO v_dep_edges
          FROM public.mfg_stage_dependencies sd
          JOIN public.mfg_workflow_stages s ON s.id = sd.stage_id
         WHERE s.template_id = v_tmpl_id;
        IF v_dep_edges > 0 THEN
            v_dag := public.validate_template_dag(v_tmpl_id);
            IF NOT COALESCE((v_dag->>'acyclic')::boolean, true) THEN
                RAISE EXCEPTION 'قالب المراحل يحوي تبعيات دائرية — لا يمكن التأكيد';
            END IF;
            INSERT INTO public.mfg_order_stage_dependencies (tenant_id, company_id, order_stage_id, depends_on_order_stage_id)
            SELECT v_ord.tenant_id, v_ord.company_id, os.id, od.id
              FROM public.mfg_stage_dependencies sd
              JOIN public.mfg_order_stages os ON os.production_order_id = v_ord.id AND os.template_stage_id = sd.stage_id
              JOIN public.mfg_order_stages od ON od.production_order_id = v_ord.id AND od.template_stage_id = sd.depends_on_stage_id;
            UPDATE public.mfg_order_stages os SET
                status = CASE WHEN NOT EXISTS (SELECT 1 FROM public.mfg_order_stage_dependencies d WHERE d.order_stage_id = os.id)
                              THEN 'ready' ELSE 'blocked' END,
                qty_in = CASE WHEN NOT EXISTS (SELECT 1 FROM public.mfg_order_stage_dependencies d WHERE d.order_stage_id = os.id)
                              THEN v_ord.qty_planned ELSE 0 END,
                updated_at = now()
            WHERE os.production_order_id = v_ord.id;
        END IF;
    END IF;
    IF p_reserve THEN
        FOR v_ln IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(component_product_id uuid, required_qty numeric) LOOP
            IF v_ln.component_product_id IS NOT NULL AND COALESCE(v_ln.required_qty,0) > 0 THEN
                INSERT INTO public.mfg_material_reservations (tenant_id, company_id, production_order_id, product_id, warehouse_id, qty_reserved, status)
                VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.id, v_ln.component_product_id, v_ord.source_warehouse_id, v_ln.required_qty, 'active');
                UPDATE public.inventory_stock SET reserved_quantity = COALESCE(reserved_quantity,0) + v_ln.required_qty, updated_at=now()
                 WHERE product_id = v_ln.component_product_id AND warehouse_id = v_ord.source_warehouse_id;
                v_reserved := v_reserved + 1;
            END IF;
        END LOOP;
    END IF;
    v_num := COALESCE(v_ord.order_number, public.generate_mfg_number(v_ord.tenant_id, v_ord.company_id, 'ORD'));
    UPDATE public.mfg_production_orders SET status='confirmed', order_number=v_num, bom_version=v_bom.version, bom_snapshot=v_snapshot,
        workflow_template_id=COALESCE(workflow_template_id, v_tmpl_id), overproduction_pct=COALESCE(NULLIF(overproduction_pct,0), v_bom.overproduction_pct, 0),
        planned_material_cost=v_plan_cost, confirmed_at=now(), updated_at=now() WHERE id = p_order_id;

    -- ── إشعارات التأكيد (معزولة الفشل — لا تُفشل التأكيد أبداً) ──────────────
    BEGIN
        DECLARE
            v_prod_name   text;
            v_first_stage RECORD;
            v_notif       int := 0;
        BEGIN
            SELECT COALESCE(name_ar, name, name_en) INTO v_prod_name
              FROM public.products WHERE id = v_ord.product_id;
            -- (أ) أمين المستودع: جهّز المواد (فولباك لأدوار الإدارة إذا لا أمين مستودع)
            v_notif := public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['warehouse_keeper'],
                'أمر إنتاج مؤكّد — جهّز المواد',
                'الأمر ' || v_num || ' — المنتج: ' || COALESCE(v_prod_name,'غير محدد')
                    || ' — الكمية: ' || COALESCE(trim_scale(v_ord.qty_planned)::text,'0') || ' كغ',
                '/manufacturing/orders', 'mfg_order_confirmed', '📦');
            IF v_notif = 0 THEN
                PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['company_admin','tenant_admin','company_owner'],
                    'أمر إنتاج مؤكّد — جهّز المواد',
                    'الأمر ' || v_num || ' — المنتج: ' || COALESCE(v_prod_name,'غير محدد')
                        || ' — الكمية: ' || COALESCE(trim_scale(v_ord.qty_planned)::text,'0') || ' كغ',
                    '/manufacturing/orders', 'mfg_order_confirmed', '📦');
            END IF;
            -- (ب) موظفو مركز عمل أول مرحلة جاهزة (بلا فولباك — أمين المستودع أُشعر أعلاه)
            SELECT s.work_center_id, s.name_ar INTO v_first_stage
              FROM public.mfg_order_stages s
             WHERE s.production_order_id = v_ord.id AND s.status = 'ready'
               AND s.work_center_id IS NOT NULL AND NOT COALESCE(s.is_passive,false)
             ORDER BY s.seq LIMIT 1;
            IF FOUND THEN
                PERFORM public.mfg_notify_work_center(v_ord.tenant_id, v_ord.company_id, v_first_stage.work_center_id,
                    'مرحلتك جاهزة للبدء',
                    'مرحلة ' || COALESCE(v_first_stage.name_ar,'') || ' جاهزة — أمر ' || v_num,
                    '/manufacturing?order=' || v_ord.id, 'mfg_stage_ready', '▶️',
                    NULL);
            END IF;
        END;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'order_number', v_num, 'stages_created', v_stages,
        'dependency_edges', v_dep_edges, 'reserved_lines', v_reserved, 'planned_material_cost', v_plan_cost,
        'warnings', v_warnings);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) complete_order_stage — نص حي + إشعارات مركز العمل + إشعار الاكتمال
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_order_stage(p_stage_id uuid, p_qty_good numeric, p_qty_scrap numeric DEFAULT 0, p_override_shortage boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
    v_bundle_floor numeric := 0;
    v_is_dag       boolean := false;
    v_dep          RECORD;
    v_min_qty      numeric;
    v_wait_ts      timestamptz;
    v_readied      jsonb := '[]'::jsonb;
    v_first_ready  uuid;
    v_new_units       numeric := 0;
    v_is_recompletion boolean := false;
    v_ready_rec    RECORD;              -- إشعارات: مرحلة صارت جاهزة
    v_all_done     boolean := false;    -- إشعارات: اكتمال كل المراحل
    v_notif        int := 0;            -- إشعارات: عدّاد الإدراج
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

    SELECT COALESCE(SUM(qty_good),0) INTO v_bundle_floor
      FROM public.mfg_labor_logs WHERE order_stage_id = p_stage_id AND bundle_id IS NOT NULL;
    IF v_bundle_floor > 0 AND COALESCE(p_qty_good,0) < v_bundle_floor - 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'الكمية الجيّدة ('||COALESCE(p_qty_good,0)||') أقل من المسجَّل عبر مسح الرزم ('||round(v_bundle_floor,4)||')');
    END IF;

    v_is_recompletion := COALESCE(v_stage.qty_completed_total,0) > 0.000001;
    v_new_units := GREATEST(COALESCE(p_qty_good,0) - COALESCE(v_stage.qty_completed_total,0), 0);

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
            v_need := COALESCE(v_ln.rpu,0) * v_new_units;
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
            v_need := COALESCE(v_ln.rpu,0) * v_new_units;
            IF v_need <= 0 THEN CONTINUE; END IF;
            v_batch_id := NULL;
            IF v_ln.req_batch THEN
                SELECT id INTO v_batch_id FROM public.inventory_batches
                 WHERE product_id = v_ln.pid AND warehouse_id = v_wh AND COALESCE(current_quantity,0) > 0
                   AND COALESCE(status,'available') IN ('available','released')
                   AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
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
        qty_completed_total = GREATEST(COALESCE(qty_completed_total,0), COALESCE(p_qty_good,0)),
        started_at = COALESCE(started_at, now()), completed_at = now(), updated_at = now()
    WHERE id = p_stage_id;

    IF NOT v_is_recompletion THEN
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
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.mfg_order_stage_dependencies d
        JOIN public.mfg_order_stages s ON s.id = d.order_stage_id
        WHERE s.production_order_id = v_ord.id) INTO v_is_dag;

    IF v_is_dag THEN
        FOR v_dep IN
            SELECT DISTINCT d.order_stage_id AS sid
              FROM public.mfg_order_stage_dependencies d
             WHERE d.depends_on_order_stage_id = p_stage_id
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.mfg_order_stage_dependencies d2
                JOIN public.mfg_order_stages s2 ON s2.id = d2.depends_on_order_stage_id
                WHERE d2.order_stage_id = v_dep.sid AND s2.status <> 'done')
            THEN
                SELECT MIN(COALESCE(s3.qty_good,0)) INTO v_min_qty
                  FROM public.mfg_order_stage_dependencies d3
                  JOIN public.mfg_order_stages s3 ON s3.id = d3.depends_on_order_stage_id
                 WHERE d3.order_stage_id = v_dep.sid;
                SELECT MAX(COALESCE(s4.completed_at, now()) + (COALESCE(s4.min_wait_hours,0) || ' hours')::interval)
                  INTO v_wait_ts
                  FROM public.mfg_order_stage_dependencies d4
                  JOIN public.mfg_order_stages s4 ON s4.id = d4.depends_on_order_stage_id
                 WHERE d4.order_stage_id = v_dep.sid;
                IF v_wait_ts > now() THEN
                    UPDATE public.mfg_order_stages
                       SET qty_in = GREATEST(v_min_qty, COALESCE(qty_completed_total,0)),
                           status = 'blocked', wait_until = v_wait_ts, updated_at = now()
                     WHERE id = v_dep.sid AND status IN ('blocked','ready');
                ELSE
                    UPDATE public.mfg_order_stages
                       SET qty_in = GREATEST(v_min_qty, COALESCE(qty_completed_total,0)),
                           status = 'ready', wait_until = NULL, updated_at = now()
                     WHERE id = v_dep.sid AND status IN ('blocked','ready');
                    v_next_ready := true;
                    v_readied := v_readied || to_jsonb(v_dep.sid);
                    v_first_ready := COALESCE(v_first_ready, v_dep.sid);
                    PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
                        'مرحلة جاهزة للبدء', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' — '
                            || COALESCE((SELECT name_ar FROM public.mfg_order_stages WHERE id = v_dep.sid),''),
                        '/manufacturing?order=' || v_ord.id, 'mfg_stage_ready', '▶️');
                    -- إشعار موظفي مركز عمل المرحلة الجاهزة (معزول الفشل، بلا فولباك — مدير الإنتاج أُشعر أعلاه)
                    BEGIN
                        SELECT work_center_id, name_ar, is_passive INTO v_ready_rec
                          FROM public.mfg_order_stages WHERE id = v_dep.sid;
                        IF v_ready_rec.work_center_id IS NOT NULL AND NOT COALESCE(v_ready_rec.is_passive,false) THEN
                            PERFORM public.mfg_notify_work_center(v_ord.tenant_id, v_ord.company_id, v_ready_rec.work_center_id,
                                'مرحلتك جاهزة للبدء',
                                'مرحلة ' || COALESCE(v_ready_rec.name_ar,'') || ' جاهزة — أمر ' || COALESCE(v_ord.order_number,''),
                                '/manufacturing?order=' || v_ord.id, 'mfg_stage_ready', '▶️', NULL);
                        END IF;
                    EXCEPTION WHEN OTHERS THEN NULL;
                    END;
                END IF;
            END IF;
        END LOOP;
    ELSE
        SELECT * INTO v_next FROM public.mfg_order_stages
         WHERE production_order_id = v_ord.id AND seq > v_stage.seq ORDER BY seq LIMIT 1;
        IF FOUND AND v_next.status <> 'done' THEN
            IF COALESCE(v_stage.min_wait_hours,0) > 0 THEN
                UPDATE public.mfg_order_stages
                   SET qty_in = GREATEST(p_qty_good, COALESCE(qty_completed_total,0)),
                       status = CASE WHEN status = 'in_progress' THEN 'in_progress' ELSE 'blocked' END,
                       wait_until = CASE WHEN status = 'in_progress' THEN wait_until
                                         ELSE now() + (v_stage.min_wait_hours || ' hours')::interval END,
                       updated_at = now()
                 WHERE id = v_next.id;
            ELSE
                UPDATE public.mfg_order_stages
                   SET qty_in = GREATEST(p_qty_good, COALESCE(qty_completed_total,0)),
                       status = CASE WHEN status = 'in_progress' THEN 'in_progress' ELSE 'ready' END,
                       updated_at = now()
                 WHERE id = v_next.id;
                IF v_next.status <> 'in_progress' THEN
                    v_next_ready := true;
                END IF;
                v_first_ready := v_next.id;
            END IF;
        END IF;
    END IF;

    UPDATE public.mfg_production_orders
       SET status = CASE WHEN status = 'confirmed' THEN 'in_progress' ELSE status END,
           actual_start_date = COALESCE(actual_start_date, CURRENT_DATE), updated_at = now()
     WHERE id = v_ord.id;

    IF v_next_ready AND NOT v_is_dag THEN
        PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
            'مرحلة جاهزة للبدء', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' — ' || COALESCE(v_next.name_ar,''),
            '/manufacturing?order=' || v_ord.id, 'mfg_stage_ready', '▶️');
        -- إشعار موظفي مركز عمل المرحلة التالية (معزول الفشل، بلا فولباك — مدير الإنتاج أُشعر أعلاه)
        BEGIN
            IF v_next.work_center_id IS NOT NULL AND NOT COALESCE(v_next.is_passive,false) THEN
                PERFORM public.mfg_notify_work_center(v_ord.tenant_id, v_ord.company_id, v_next.work_center_id,
                    'مرحلتك جاهزة للبدء',
                    'مرحلة ' || COALESCE(v_next.name_ar,'') || ' جاهزة — أمر ' || COALESCE(v_ord.order_number,''),
                    '/manufacturing?order=' || v_ord.id, 'mfg_stage_ready', '▶️', NULL);
            END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- ── إشعار اكتمال الإنتاج عند إنجاز كل المراحل (معزول الفشل) ──────────────
    BEGIN
        SELECT NOT EXISTS (
            SELECT 1 FROM public.mfg_order_stages
            WHERE production_order_id = v_ord.id AND status <> 'done') INTO v_all_done;
        IF v_all_done THEN
            v_notif := public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager','warehouse_keeper'],
                'الإنتاج مكتمل — جاهز للاستلام بالمستودع',
                'اكتملت جميع مراحل الأمر ' || COALESCE(v_ord.order_number,'') || ' — يمكن استلام المنتج التام في المستودع',
                '/manufacturing?order=' || v_ord.id, 'mfg_order_done', '✅');
            IF v_notif = 0 THEN
                PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['company_admin','tenant_admin','company_owner'],
                    'الإنتاج مكتمل — جاهز للاستلام بالمستودع',
                    'اكتملت جميع مراحل الأمر ' || COALESCE(v_ord.order_number,'') || ' — يمكن استلام المنتج التام في المستودع',
                    '/manufacturing?order=' || v_ord.id, 'mfg_order_done', '✅');
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN jsonb_build_object('success', true, 'stage_id', p_stage_id,
        'next_stage_id', COALESCE(v_first_ready, v_next.id), 'is_last', v_is_last, 'backflush_issue_id', v_issue_id,
        'is_dag', v_is_dag, 'readied_stages', v_readied, 'new_units', v_new_units,
        'overhead_absorbed', v_overhead, 'overhead_minutes', v_oh_min, 'overhead_journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

COMMIT;
