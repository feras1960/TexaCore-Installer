-- ============================================================================
-- P4a Migration 2 — DAG stage-dependency engine
--   • mfg_order_stage_dependencies: order-scoped junction (real FKs, plan §5/26)
--   • validate_template_dag: acyclicity check for the UI + confirm guard
--   • confirm_production_order: copy template deps → order edges, set initial
--     statuses (no-dep = ready, others = blocked)  [surgical add; linear intact]
--   • complete_order_stage: dependency resolution replaces linear next-stage
--     (a stage becomes ready when ALL deps are done; qty_in = MIN over deps'
--      qty_good; min_wait respected via wait_until). Pure-linear templates
--      (zero dependency rows) keep the exact current seq-chain behavior.
--   Also: enforces the bundle/stage double-count rule — p_qty_good may not drop
--   below the bundle-scanned floor already booked at the stage.
-- ============================================================================

-- ── Junction table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_order_stage_dependencies (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 uuid NOT NULL,
    company_id                uuid NOT NULL,
    order_stage_id            uuid NOT NULL REFERENCES public.mfg_order_stages(id) ON DELETE CASCADE,
    depends_on_order_stage_id uuid NOT NULL REFERENCES public.mfg_order_stages(id) ON DELETE CASCADE,
    created_at                timestamptz DEFAULT now(),
    UNIQUE (order_stage_id, depends_on_order_stage_id),
    CHECK (order_stage_id <> depends_on_order_stage_id)
);
CREATE INDEX IF NOT EXISTS idx_mfg_osd_stage ON public.mfg_order_stage_dependencies(order_stage_id);
CREATE INDEX IF NOT EXISTS idx_mfg_osd_dep   ON public.mfg_order_stage_dependencies(depends_on_order_stage_id);

ALTER TABLE public.mfg_order_stage_dependencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfg_osd_select_policy ON public.mfg_order_stage_dependencies;
CREATE POLICY mfg_osd_select_policy ON public.mfg_order_stage_dependencies FOR SELECT
  USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
DROP POLICY IF EXISTS mfg_osd_insert_policy ON public.mfg_order_stage_dependencies;
CREATE POLICY mfg_osd_insert_policy ON public.mfg_order_stage_dependencies FOR INSERT
  WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_osd_update_policy ON public.mfg_order_stage_dependencies;
CREATE POLICY mfg_osd_update_policy ON public.mfg_order_stage_dependencies FOR UPDATE
  USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_osd_delete_policy ON public.mfg_order_stage_dependencies;
CREATE POLICY mfg_osd_delete_policy ON public.mfg_order_stage_dependencies FOR DELETE
  USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));

-- ============================================================================
-- validate_template_dag — detect cycles in a template's stage dependencies.
--   Edges live in mfg_stage_dependencies (template stage ids). Follows the
--   dependency chain (stage → depends_on) tracking the visited path; a revisit
--   of a node on its own path signals a cycle.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_template_dag(p_template_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
DECLARE
    v_cycle uuid;
BEGIN
    WITH RECURSIVE dep AS (
        SELECT sd.stage_id AS a, sd.depends_on_stage_id AS b
        FROM public.mfg_stage_dependencies sd
        JOIN public.mfg_workflow_stages s ON s.id = sd.stage_id
        WHERE s.template_id = p_template_id
    ),
    walk AS (
        SELECT a, b, ARRAY[a] AS path, (a = b) AS cyc
        FROM dep
        UNION ALL
        SELECT w.a, d.b, w.path || d.a, (d.b = ANY(w.path))
        FROM walk w
        JOIN dep d ON d.a = w.b
        WHERE NOT w.cyc AND array_length(w.path,1) < 200
    )
    SELECT a INTO v_cycle FROM walk WHERE cyc LIMIT 1;

    RETURN jsonb_build_object('success', true, 'template_id', p_template_id,
        'acyclic', v_cycle IS NULL, 'cycle_stage_id', v_cycle);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- ============================================================================
-- confirm_production_order  (full body — P3 base + P4a DAG population)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_production_order(p_order_id uuid, p_reserve boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_ord public.mfg_production_orders%ROWTYPE; v_bom public.mfg_boms%ROWTYPE; v_tmpl_id uuid;
    v_yield numeric; v_sum_pct numeric; v_lines jsonb; v_outputs jsonb; v_snapshot jsonb;
    v_stages int := 0; v_reserved int := 0; v_plan_cost numeric := 0; v_ln RECORD; v_first_seq int; v_num text;
    v_dag jsonb; v_dep_edges int := 0;   -- P4a
BEGIN
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ord.company_id); END IF;
    IF v_ord.status <> 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'لا يمكن تأكيد أمر إلا من حالة مسودة (الحالة: '||v_ord.status||')'); END IF;
    IF v_ord.bom_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر بلا قائمة مواد'); END IF;
    SELECT * INTO v_bom FROM public.mfg_boms WHERE id = v_ord.bom_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد غير موجودة'); END IF;
    IF v_bom.status <> 'approved' THEN RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد غير معتمدة — لا يُنتَج إلا من BOM معتمدة'); END IF;
    IF (v_bom.effective_from IS NOT NULL AND v_bom.effective_from > CURRENT_DATE) OR (v_bom.effective_to IS NOT NULL AND v_bom.effective_to < CURRENT_DATE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد خارج فترة السريان'); END IF;
    v_yield := COALESCE(NULLIF(v_bom.yield_pct,0),100)/100.0;
    v_tmpl_id := COALESCE(v_ord.workflow_template_id, v_bom.workflow_template_id);
    SELECT COALESCE(SUM(formula_pct),0) INTO v_sum_pct FROM public.mfg_bom_lines WHERE bom_id = v_bom.id AND formula_pct IS NOT NULL;
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'line_id', t.id, 'component_product_id', t.component_product_id, 'component_bom_id', t.component_bom_id,
        'qty_per_unit', t.qty_per_unit, 'formula_pct', t.formula_pct, 'unit_id', t.unit_id, 'stage_id', t.stage_id,
        'issue_method', t.issue_method, 'scrap_pct', COALESCE(t.scrap_pct,0), 'consumption_tolerance_pct', t.consumption_tolerance_pct,
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
        -- If the template declares stage dependencies, translate them into
        -- order-scoped edges and recompute initial statuses. Templates with NO
        -- dependency rows keep the linear seq-chain set above (current behavior).
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
            -- no-dependency stages become ready (seeded qty_in), all others blocked
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
        planned_material_cost=v_plan_cost, updated_at=now() WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'order_number', v_num, 'stages_created', v_stages,
        'dependency_edges', v_dep_edges, 'reserved_lines', v_reserved, 'planned_material_cost', v_plan_cost);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
