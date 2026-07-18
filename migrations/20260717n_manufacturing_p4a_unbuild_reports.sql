-- ============================================================================
-- P4a Migration 4 — Unbuild (disassembly) + read-only report layer
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mfg_unbuild_orders (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              uuid NOT NULL,
    company_id             uuid NOT NULL,
    branch_id              uuid,
    unbuild_number         text,
    product_id             uuid NOT NULL REFERENCES public.products(id),
    batch_id               uuid REFERENCES public.inventory_batches(id),
    qty                    numeric NOT NULL,
    warehouse_id           uuid,
    components_warehouse_id uuid,
    status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
    journal_entry_id       uuid,
    cost_breakdown         jsonb DEFAULT '{}'::jsonb,
    custom_data            jsonb DEFAULT '{}'::jsonb,
    notes                  text,
    created_by             uuid,
    created_at             timestamptz DEFAULT now(),
    updated_at             timestamptz DEFAULT now(),
    posted_at              timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mfg_unbuild_product ON public.mfg_unbuild_orders(product_id);

ALTER TABLE public.mfg_unbuild_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfg_unbuild_select_policy ON public.mfg_unbuild_orders;
CREATE POLICY mfg_unbuild_select_policy ON public.mfg_unbuild_orders FOR SELECT
  USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
DROP POLICY IF EXISTS mfg_unbuild_insert_policy ON public.mfg_unbuild_orders;
CREATE POLICY mfg_unbuild_insert_policy ON public.mfg_unbuild_orders FOR INSERT
  WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_unbuild_update_policy ON public.mfg_unbuild_orders;
CREATE POLICY mfg_unbuild_update_policy ON public.mfg_unbuild_orders FOR UPDATE
  USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_unbuild_delete_policy ON public.mfg_unbuild_orders;
CREATE POLICY mfg_unbuild_delete_policy ON public.mfg_unbuild_orders FOR DELETE
  USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));

-- ============================================================================
-- post_unbuild_order(p_id)
--   FG OUT at its batch/avg cost; components IN at the ORIGINAL production
--   order's actual consumption ratios when the batch traces to one (else the
--   product's default approved BOM exploded proportions). Component values are
--   scaled so Σ(component value) == FG value removed  (no value creation).
--   GL: Dr raw inventory / Cr FG inventory (single inventory control account
--   in this ledger → net-zero but posted for audit).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.post_unbuild_order(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
DECLARE
    v_u        public.mfg_unbuild_orders%ROWTYPE;
    v_fg_cost  numeric := 0;
    v_fg_avail numeric := 0;
    v_batch    public.inventory_batches%ROWTYPE;
    v_orig_ord uuid;
    v_qprod    numeric;
    v_V        numeric;
    v_S        numeric := 0;
    v_bom      uuid;
    v_comp_wh  uuid;
    v_scale    numeric;
    v_mv_id    uuid;
    v_num      text;
    v_idx      int := 0;
    v_comp_val numeric := 0;
    v_je       uuid;
    v_raw_acct uuid; v_fg_acct uuid;
    v_settings public.mfg_settings%ROWTYPE;
    c          RECORD;
    v_uc numeric; v_val numeric; v_sumqty numeric;
BEGIN
    SELECT * INTO v_u FROM public.mfg_unbuild_orders WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'أمر التفكيك غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_u.company_id); END IF;
    IF v_u.status <> 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'أمر التفكيك ليس مسودة'); END IF;
    IF public.journal_period_is_locked(v_u.company_id, CURRENT_DATE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked'); END IF;
    IF COALESCE(v_u.qty,0) <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'كمية التفكيك صفر'); END IF;
    IF v_u.warehouse_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'مستودع المنتج التام غير محدد'); END IF;

    IF v_u.batch_id IS NOT NULL THEN
        SELECT * INTO v_batch FROM public.inventory_batches WHERE id = v_u.batch_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة'); END IF;
        IF v_batch.product_id IS DISTINCT FROM v_u.product_id THEN
            RETURN jsonb_build_object('success', false, 'error', 'الدفعة لا تخصّ المنتج'); END IF;
        IF COALESCE(v_batch.current_quantity,0) < v_u.qty - 0.01 THEN
            RETURN jsonb_build_object('success', false, 'error', 'كمية الدفعة غير كافية للتفكيك'); END IF;
        v_fg_cost := COALESCE(NULLIF(v_batch.unit_cost,0),
                       (SELECT average_cost FROM public.inventory_stock
                         WHERE product_id = v_u.product_id AND warehouse_id = v_u.warehouse_id LIMIT 1), 0);
        v_orig_ord := v_batch.production_order_id;
    ELSE
        SELECT COALESCE(average_cost,0) INTO v_fg_cost FROM public.inventory_stock
          WHERE product_id = v_u.product_id AND warehouse_id = v_u.warehouse_id LIMIT 1;
    END IF;

    SELECT COALESCE(quantity_on_hand,0) INTO v_fg_avail FROM public.inventory_stock
      WHERE product_id = v_u.product_id AND warehouse_id = v_u.warehouse_id LIMIT 1;
    IF COALESCE(v_fg_avail,0) < v_u.qty - 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error', 'رصيد المنتج التام غير كافٍ للتفكيك'); END IF;

    v_V := round(COALESCE(v_fg_cost,0) * v_u.qty, 6);
    v_comp_wh := COALESCE(v_u.components_warehouse_id,
                   (SELECT source_warehouse_id FROM public.mfg_production_orders WHERE id = v_orig_ord),
                   v_u.warehouse_id);

    CREATE TEMP TABLE _unbuild_comp (cid uuid, qty numeric, avg_cost numeric) ON COMMIT DROP;

    IF v_orig_ord IS NOT NULL THEN
        SELECT COALESCE(NULLIF(qty_produced,0), qty_planned, v_u.qty) INTO v_qprod
          FROM public.mfg_production_orders WHERE id = v_orig_ord;
        INSERT INTO _unbuild_comp (cid, qty, avg_cost)
        SELECT x.pid,
               round( (x.consumed / NULLIF(v_qprod,0)) * v_u.qty, 6) AS qty,
               COALESCE((SELECT average_cost FROM public.inventory_stock s
                          WHERE s.product_id = x.pid AND s.warehouse_id = v_comp_wh LIMIT 1),0)
        FROM (
            SELECT il.product_id AS pid,
                   SUM(il.qty) - COALESCE((
                       SELECT SUM(rl.qty) FROM public.mfg_material_return_lines rl
                       JOIN public.mfg_material_returns rr ON rr.id = rl.return_id
                       JOIN public.mfg_material_issue_lines il2 ON il2.id = rl.issue_line_id
                       WHERE rr.status = 'posted' AND il2.product_id = il.product_id
                         AND il2.issue_id IN (SELECT id FROM public.mfg_material_issues WHERE production_order_id = v_orig_ord)
                   ),0) AS consumed
            FROM public.mfg_material_issue_lines il
            JOIN public.mfg_material_issues i ON i.id = il.issue_id
            WHERE i.production_order_id = v_orig_ord AND i.status = 'posted' AND il.product_id IS NOT NULL
            GROUP BY il.product_id
        ) x
        WHERE x.consumed > 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM _unbuild_comp) THEN
        SELECT COALESCE(p.default_bom_id,
                 (SELECT id FROM public.mfg_boms WHERE product_id = v_u.product_id AND status='approved'
                   ORDER BY is_default DESC, version DESC LIMIT 1))
          INTO v_bom FROM public.products p WHERE p.id = v_u.product_id;
        IF v_bom IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'لا يوجد أثر استهلاك ولا BOM افتراضية للتفكيك'); END IF;
        PERFORM public.rebuild_bom_explosion(v_bom);
        INSERT INTO _unbuild_comp (cid, qty, avg_cost)
        SELECT e.component_product_id, round(e.qty_per_unit * v_u.qty,6),
               COALESCE((SELECT average_cost FROM public.inventory_stock s
                          WHERE s.product_id = e.component_product_id AND s.warehouse_id = v_comp_wh LIMIT 1),0)
        FROM public.mfg_bom_exploded e WHERE e.bom_id = v_bom AND e.qty_per_unit > 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM _unbuild_comp WHERE qty > 0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'لا مكوّنات لإرجاعها'); END IF;

    SELECT COALESCE(SUM(qty * avg_cost),0), COALESCE(SUM(qty),0) INTO v_S, v_sumqty FROM _unbuild_comp WHERE qty > 0;
    IF v_S > 0.000001 THEN v_scale := v_V / v_S; ELSE v_scale := NULL; END IF;

    -- FG OUT
    v_idx := v_idx + 1;
    INSERT INTO public.inventory_movements (
        tenant_id, company_id, movement_number, movement_date, movement_type,
        product_id, from_warehouse_id, quantity, unit_cost, total_cost,
        reference_type, reference_id, reference_number, notes, created_by)
    VALUES (v_u.tenant_id, v_u.company_id, 'UNB-' || LEFT(p_id::text,8) || '-FG', CURRENT_DATE, 'issue',
        v_u.product_id, v_u.warehouse_id, v_u.qty, v_fg_cost, v_V,
        'production_unbuild', p_id, v_u.unbuild_number, 'تفكيك: إخراج منتج تام', auth.uid())
    RETURNING id INTO v_mv_id;
    IF v_u.batch_id IS NOT NULL THEN
        UPDATE public.inventory_batches SET current_quantity = COALESCE(current_quantity,0) - v_u.qty WHERE id = v_u.batch_id;
    END IF;

    -- Components IN (scaled to Σ = V)
    FOR c IN SELECT * FROM _unbuild_comp WHERE qty > 0 LOOP
        v_idx := v_idx + 1;
        IF v_scale IS NOT NULL THEN
            v_val := round(c.qty * c.avg_cost * v_scale, 6);
        ELSE
            v_val := round(v_V / NULLIF(v_sumqty,0) * c.qty, 6);
        END IF;
        v_uc := CASE WHEN c.qty > 0 THEN v_val / c.qty ELSE 0 END;
        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, to_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_u.tenant_id, v_u.company_id, 'UNB-' || LEFT(p_id::text,8) || '-' || v_idx, CURRENT_DATE, 'receipt',
            c.cid, v_comp_wh, c.qty, v_uc, v_val,
            'production_unbuild', p_id, v_u.unbuild_number, 'تفكيك: إرجاع مكوّن', auth.uid())
        RETURNING id INTO v_mv_id;
        v_comp_val := v_comp_val + v_val;
    END LOOP;

    SELECT * INTO v_settings FROM public.mfg_settings
      WHERE tenant_id = v_u.tenant_id AND company_id = v_u.company_id LIMIT 1;
    v_raw_acct := public.resolve_posting_account(v_u.company_id, 'receipt_inventory');
    v_fg_acct  := public.resolve_posting_account(v_u.company_id, 'receipt_inventory');
    IF v_comp_val > 0 AND v_raw_acct IS NOT NULL AND v_fg_acct IS NOT NULL THEN
        v_je := public.mfg_create_and_post_je(
            v_u.tenant_id, v_u.company_id, v_u.branch_id, CURRENT_DATE,
            'production_unbuild', p_id, v_u.unbuild_number, NULL,
            'تفكيك إنتاج — إرجاع مكوّنات',
            jsonb_build_array(
                jsonb_build_object('account_id', v_raw_acct, 'debit', v_comp_val, 'credit', 0, 'desc', 'مخزون خام (مكوّنات مُعادة)'),
                jsonb_build_object('account_id', v_fg_acct,  'debit', 0, 'credit', v_comp_val, 'desc', 'مخزون تام (منتج مُفكَّك)')));
    END IF;

    v_num := COALESCE(v_u.unbuild_number, public.generate_mfg_number(v_u.tenant_id, v_u.company_id, 'UNB'));
    UPDATE public.mfg_unbuild_orders SET
        status = 'posted', posted_at = now(), unbuild_number = v_num, journal_entry_id = v_je,
        cost_breakdown = jsonb_build_object('fg_value_removed', v_V, 'component_value_returned', v_comp_val,
                          'fg_unit_cost', v_fg_cost, 'components_warehouse_id', v_comp_wh, 'traced_order_id', v_orig_ord),
        updated_at = now()
    WHERE id = p_id;

    RETURN jsonb_build_object('success', true, 'unbuild_id', p_id, 'unbuild_number', v_num,
        'fg_value_removed', v_V, 'component_value_returned', v_comp_val, 'balanced', abs(v_V - v_comp_val) < 0.01,
        'traced_order_id', v_orig_ord, 'journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- ============================================================================
-- Report RPCs (read-only)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.report_order_costs(p_company uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
    SELECT jsonb_build_object('success', true, 'rows', COALESCE(jsonb_agg(r ORDER BY (r->>'order_number')), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'order_id', o.id, 'order_number', o.order_number, 'product_id', o.product_id,
            'status', o.status, 'qty_planned', o.qty_planned, 'qty_produced', o.qty_produced,
            'planned_material', COALESCE(o.planned_material_cost,0), 'planned_labor', COALESCE(o.planned_labor_cost,0),
            'planned_overhead', COALESCE(o.planned_overhead_cost,0),
            'planned_total', COALESCE(o.planned_material_cost,0)+COALESCE(o.planned_labor_cost,0)+COALESCE(o.planned_overhead_cost,0),
            'actual_material', COALESCE(o.actual_material_cost,0), 'actual_labor', COALESCE(o.actual_labor_cost,0),
            'actual_overhead', COALESCE(o.actual_overhead_cost,0), 'subcontract', COALESCE(o.subcontract_cost,0),
            'actual_total', COALESCE(o.actual_material_cost,0)+COALESCE(o.actual_labor_cost,0)+COALESCE(o.actual_overhead_cost,0)+COALESCE(o.subcontract_cost,0),
            'received_cost', COALESCE(o.received_cost,0),
            'wip_remaining', GREATEST(0, COALESCE(o.actual_material_cost,0)+COALESCE(o.actual_labor_cost,0)+COALESCE(o.actual_overhead_cost,0)+COALESCE(o.subcontract_cost,0)-COALESCE(o.received_cost,0)),
            'variance', (COALESCE(o.actual_material_cost,0)+COALESCE(o.actual_labor_cost,0)+COALESCE(o.actual_overhead_cost,0)+COALESCE(o.subcontract_cost,0))
                        - (COALESCE(o.planned_material_cost,0)+COALESCE(o.planned_labor_cost,0)+COALESCE(o.planned_overhead_cost,0))
        ) AS r
        FROM public.mfg_production_orders o
        WHERE o.company_id = p_company AND COALESCE(o.is_deleted,false)=false
          AND COALESCE(o.actual_end_date, o.created_at::date) BETWEEN p_from AND p_to
    ) s;
$function$;

CREATE OR REPLACE FUNCTION public.report_stage_productivity(p_company uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
    SELECT jsonb_build_object('success', true, 'rows', COALESCE(jsonb_agg(r), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'order_stage_id', ll.order_stage_id,
            'stage_name', os.name_ar,
            'work_center_id', os.work_center_id,
            'employee_id', ll.employee_id,
            'qty_good', SUM(COALESCE(ll.qty_good,0)),
            'qty_reject', SUM(COALESCE(ll.qty_reject,0)),
            'minutes', SUM(COALESCE(ll.minutes,0)),
            'wages', SUM(COALESCE(ll.wage_amount,0))
        ) AS r
        FROM public.mfg_labor_logs ll
        LEFT JOIN public.mfg_order_stages os ON os.id = ll.order_stage_id
        WHERE ll.company_id = p_company AND ll.work_date BETWEEN p_from AND p_to
        GROUP BY ll.order_stage_id, ll.employee_id, os.name_ar, os.work_center_id
    ) s;
$function$;

CREATE OR REPLACE FUNCTION public.report_material_consumption(p_company uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
    WITH actual AS (
        SELECT il.product_id AS pid, SUM(COALESCE(il.qty,0)) AS act
        FROM public.mfg_material_issue_lines il
        JOIN public.mfg_material_issues i ON i.id = il.issue_id
        WHERE i.company_id = p_company AND i.status = 'posted'
          AND i.issue_date BETWEEN p_from AND p_to AND il.product_id IS NOT NULL
        GROUP BY il.product_id
    ),
    expected AS (
        SELECT (l->>'component_product_id')::uuid AS pid, SUM((l->>'required_qty')::numeric) AS exp
        FROM public.mfg_production_orders o
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.bom_snapshot->'lines','[]'::jsonb)) l
        WHERE o.company_id = p_company AND COALESCE(o.is_deleted,false)=false
          AND o.status IN ('confirmed','in_progress','completed','closed')
          AND COALESCE(o.actual_start_date, o.created_at::date) BETWEEN p_from AND p_to
          AND (l->>'component_product_id') IS NOT NULL
        GROUP BY (l->>'component_product_id')::uuid
    )
    SELECT jsonb_build_object('success', true, 'rows', COALESCE(jsonb_agg(jsonb_build_object(
        'product_id', COALESCE(a.pid,e.pid),
        'expected', COALESCE(e.exp,0), 'actual', COALESCE(a.act,0),
        'variance', COALESCE(a.act,0) - COALESCE(e.exp,0))), '[]'::jsonb))
    FROM actual a FULL OUTER JOIN expected e ON e.pid = a.pid;
$function$;

CREATE OR REPLACE FUNCTION public.report_wip_balance(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
DECLARE v_rows jsonb; v_total numeric; v_gl numeric; v_wip_acct uuid;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'order_number', o.order_number, 'status', o.status,
        'wip_pool', GREATEST(0, COALESCE(o.actual_material_cost,0)+COALESCE(o.actual_labor_cost,0)+COALESCE(o.actual_overhead_cost,0)+COALESCE(o.subcontract_cost,0)-COALESCE(o.received_cost,0))
        ) ORDER BY o.order_number), '[]'::jsonb),
      COALESCE(SUM(GREATEST(0, COALESCE(o.actual_material_cost,0)+COALESCE(o.actual_labor_cost,0)+COALESCE(o.actual_overhead_cost,0)+COALESCE(o.subcontract_cost,0)-COALESCE(o.received_cost,0))),0)
      INTO v_rows, v_total
    FROM public.mfg_production_orders o
    WHERE o.company_id = p_company AND COALESCE(o.is_deleted,false)=false
      AND o.status IN ('confirmed','in_progress','completed');

    SELECT wip_account_id INTO v_wip_acct FROM public.mfg_settings WHERE company_id = p_company LIMIT 1;
    IF v_wip_acct IS NOT NULL THEN
        SELECT COALESCE(SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)),0) INTO v_gl
        FROM public.journal_entry_lines jel
        JOIN public.journal_entries je ON je.id = jel.entry_id
        WHERE je.company_id = p_company AND jel.account_id = v_wip_acct AND COALESCE(je.is_posted,false)=true;
    END IF;

    RETURN jsonb_build_object('success', true, 'rows', v_rows, 'wip_pool_total', v_total,
        'wip_gl_balance', v_gl, 'reconciles', CASE WHEN v_wip_acct IS NULL THEN NULL ELSE abs(COALESCE(v_gl,0)-v_total) < 0.5 END);
END; $function$;

CREATE OR REPLACE FUNCTION public.report_scrap_by_stage(p_company uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
    SELECT jsonb_build_object('success', true, 'rows', COALESCE(jsonb_agg(r ORDER BY (r->>'stage_name')), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'stage_name', COALESCE(os.name_ar, os.name_en, 'stage'),
            'work_center_id', os.work_center_id,
            'stage_scrap', SUM(COALESCE(os.qty_scrap,0)),
            'labor_reject', COALESCE((SELECT SUM(COALESCE(ll.qty_reject,0)) FROM public.mfg_labor_logs ll
                                       WHERE ll.order_stage_id = os.id AND ll.work_date BETWEEN p_from AND p_to),0)
        ) AS r
        FROM public.mfg_order_stages os
        JOIN public.mfg_production_orders o ON o.id = os.production_order_id
        WHERE o.company_id = p_company AND COALESCE(o.is_deleted,false)=false
          AND COALESCE(o.actual_start_date, o.created_at::date) BETWEEN p_from AND p_to
          AND COALESCE(os.qty_scrap,0) > 0
        GROUP BY COALESCE(os.name_ar, os.name_en, 'stage'), os.work_center_id, os.id
    ) s;
$function$;

COMMENT ON TABLE public.mfg_unbuild_orders IS 'P4a: FG disassembly. post_unbuild_order reverses production — FG OUT, components IN at recorded consumption ratios, component value scaled to equal FG value removed.';
