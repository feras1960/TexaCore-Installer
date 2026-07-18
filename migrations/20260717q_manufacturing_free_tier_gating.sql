-- 20260717q_manufacturing_free_tier_gating.sql
-- Manufacturing on FREE plan: DB-enforced usage gating + module gating hardening.
-- Idempotent. Unlimited/absent limits short-circuit with zero overhead.
-- Gates (per owner spec): (1) mfg_orders_per_month=10 on free (confirm_production_order),
--   (2) mfg_advanced=false on free (subcontract ship, bundle scan, MRP, unbuild, custom-field-defs).
-- Setup entities (BOMs / work centers / templates) stay UNLIMITED on free (keys kept, no enforcement).
-- Also: module-gating RLS on all 38 mfg_ tables + module check inside 8 SECDEF entry points,
--   and a fix for invoices_monthly counting drift (sales_invoices -> sales_transactions).

-- ============================================================
-- 1. Monthly-confirm counter column (grandfathers existing rows: NULL confirmed_at not counted)
-- ============================================================
ALTER TABLE public.mfg_production_orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- ============================================================
-- 2. Plan limit keys (jsonb bag: subscription_plans.features) + module membership
-- ============================================================
-- FREE: manufacturing usage-throttled; setup entities unlimited.
UPDATE public.subscription_plans
   SET features = features || jsonb_build_object(
        'mfg_orders_per_month', 10,
        'mfg_advanced',         false,
        'mfg_max_boms',         NULL,
        'mfg_max_work_centers', NULL,
        'mfg_max_templates',    NULL)
 WHERE code = 'free';

-- PROFESSIONAL / ENTERPRISE: unlimited + advanced (explicit for the plans-editor UI).
UPDATE public.subscription_plans
   SET features = features || jsonb_build_object(
        'mfg_orders_per_month', NULL,
        'mfg_advanced',         true,
        'mfg_max_boms',         NULL,
        'mfg_max_work_centers', NULL,
        'mfg_max_templates',    NULL)
 WHERE code IN ('texa-professional','texa-enterprise');

-- Add manufacturing to FREE included_modules (fires trg_plan_modules_sync -> tenant_modules cascade).
-- [installer-adapt] included_modules is jsonb locally (text[] on cloud): use jsonb ops.
UPDATE public.subscription_plans
   SET included_modules = (SELECT jsonb_agg(DISTINCT m ORDER BY m)
                             FROM jsonb_array_elements_text(included_modules || '["manufacturing"]'::jsonb) AS m)
 WHERE code = 'free'
   AND NOT (included_modules ? 'manufacturing');

-- plan_modules registry row for FREE (module_id FK -> system_modules).
INSERT INTO public.plan_modules (plan_id, module_id, is_enabled, is_core, display_order)
SELECT p.id, sm.id, true, false, 30
  FROM public.subscription_plans p
  CROSS JOIN public.system_modules sm
 WHERE p.code = 'free' AND sm.code = 'manufacturing'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id = p.id AND pm.module_id = sm.id);

-- ============================================================
-- 3. Limit resolver helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.mfg_plan_features(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_plan_id uuid; v_features jsonb;
BEGIN
  IF p_tenant_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  -- Resolve the tenant's effective plan the same way get_all_plan_limits does.
  SELECT ts.plan_id INTO v_plan_id
    FROM public.tenant_subscriptions ts
   WHERE ts.tenant_id = p_tenant_id
     AND ( ts.status IN ('trial','active','grace')
        OR (ts.status = 'expired' AND ts.grace_period_end IS NOT NULL AND ts.grace_period_end >= CURRENT_DATE) )
   ORDER BY CASE ts.status WHEN 'active' THEN 1 WHEN 'trial' THEN 2 WHEN 'grace' THEN 3 ELSE 4 END
   LIMIT 1;
  IF v_plan_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions t2 WHERE t2.tenant_id = p_tenant_id) THEN
    SELECT plan_id INTO v_plan_id FROM public.subscriptions
     WHERE tenant_id = p_tenant_id AND status IN ('trial','active')
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_plan_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT COALESCE(features,'{}'::jsonb) INTO v_features FROM public.subscription_plans WHERE id = v_plan_id;
  RETURN COALESCE(v_features,'{}'::jsonb);
END;
$fn$;

-- Generic gate reader. Returns {allowed, used, limit, error?}.
-- Absent/NULL/-1 numeric limit => unlimited (allowed, no counting).
-- Absent mfg_advanced => true (paid/legacy default); FREE sets it false explicitly.
CREATE OR REPLACE FUNCTION public.mfg_check_limit(p_tenant_id uuid, p_company_id uuid, p_limit_key text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_f jsonb; v_limit numeric; v_used numeric; v_adv boolean;
BEGIN
  v_f := public.mfg_plan_features(p_tenant_id);

  IF p_limit_key = 'mfg_advanced' THEN
    v_adv := COALESCE((v_f->>'mfg_advanced')::boolean, true);
    RETURN jsonb_build_object('allowed', v_adv, 'used', NULL, 'limit', v_adv,
      'error', CASE WHEN v_adv THEN NULL ELSE 'MFG_LIMIT_ADVANCED' END);
  END IF;

  v_limit := NULLIF(v_f->>p_limit_key,'')::numeric;
  IF v_limit IS NULL OR v_limit < 0 THEN
    RETURN jsonb_build_object('allowed', true, 'used', NULL, 'limit', -1, 'unlimited', true);
  END IF;

  IF p_limit_key = 'mfg_orders_per_month' THEN
    SELECT count(*) INTO v_used FROM public.mfg_production_orders
     WHERE tenant_id = p_tenant_id AND company_id = p_company_id
       AND COALESCE(is_deleted,false) = false
       AND confirmed_at >= date_trunc('month', now());
    RETURN jsonb_build_object('allowed', v_used < v_limit, 'used', v_used, 'limit', v_limit,
      'error', CASE WHEN v_used < v_limit THEN NULL ELSE 'MFG_LIMIT_ORDERS' END);
  END IF;

  -- Other numeric keys are panel-editable but NOT enforced (setup entities unlimited by policy).
  RETURN jsonb_build_object('allowed', true, 'used', NULL, 'limit', v_limit, 'unlimited', false);
END;
$fn$;

-- ============================================================
-- 4. Patched entry points (module guard + free-tier gates + invoices-count fix)
-- ============================================================

-- >>> get_all_plan_limits
CREATE OR REPLACE FUNCTION public.get_all_plan_limits(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_plan RECORD;
    v_sub RECORD;
    v_plan_id UUID;
    v_users_count INT := 0;
    v_companies_count INT := 0;
    v_branches_count INT := 0;
    v_warehouses_count INT := 0;
    v_products_count INT := 0;
    v_customers_count INT := 0;
    v_invoices_count INT := 0;
BEGIN
    -- المستأجر المعلّق: قفل صريح مهما كانت حالة الاشتراك
    IF EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id AND status = 'suspended') THEN
        RETURN jsonb_build_object('error', 'tenant_suspended');
    END IF;

    -- جلب الاشتراك: النشط/التجريبي/السماح، أو المنتهي داخل نافذة السماح
    SELECT ts.plan_id, ts.status, ts.grace_period_end, ts.end_date
      INTO v_sub
    FROM tenant_subscriptions ts
    WHERE ts.tenant_id = p_tenant_id
      AND (
        ts.status IN ('trial', 'active', 'grace')
        OR (ts.status = 'expired' AND ts.grace_period_end IS NOT NULL
            AND ts.grace_period_end >= CURRENT_DATE)
      )
    ORDER BY
      CASE ts.status
        WHEN 'active' THEN 1 WHEN 'trial' THEN 2 WHEN 'grace' THEN 3 ELSE 4
      END
    LIMIT 1;
    v_plan_id := v_sub.plan_id;

    -- Fallback (الجدول القديم subscriptions) — فقط لمستأجر بلا أي صف في
    -- tenant_subscriptions إطلاقاً. بدون هذا الشرط كان المنتهي بعد السماح يسقط
    -- على صفّه القديم في subscriptions (لا تحدّثه check_expired_subscriptions أبداً)
    -- فيبدو نشطاً للأبد.
    IF v_plan_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions ts2 WHERE ts2.tenant_id = p_tenant_id) THEN
        SELECT plan_id INTO v_plan_id
        FROM subscriptions
        WHERE tenant_id = p_tenant_id AND status IN ('trial', 'active')
        ORDER BY created_at DESC LIMIT 1;
    END IF;

    IF v_plan_id IS NULL THEN
        RETURN jsonb_build_object('error', 'no_active_subscription');
    END IF;

    SELECT * INTO v_plan FROM subscription_plans WHERE id = v_plan_id;

    -- عد الموارد الحالية
    SELECT COUNT(*) INTO v_users_count FROM user_profiles WHERE tenant_id = p_tenant_id;
    SELECT COUNT(*) INTO v_companies_count FROM companies WHERE tenant_id = p_tenant_id;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'branches' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_branches_count FROM branches WHERE tenant_id = p_tenant_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'warehouses' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_warehouses_count FROM warehouses WHERE tenant_id = p_tenant_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_products_count FROM products WHERE tenant_id = p_tenant_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_customers_count FROM customers WHERE tenant_id = p_tenant_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_transactions' AND table_schema = 'public') THEN
        SELECT COUNT(*) INTO v_invoices_count FROM sales_transactions WHERE tenant_id = p_tenant_id AND created_at >= date_trunc('month', CURRENT_DATE);
    END IF;

    RETURN jsonb_build_object(
        'plan_code', v_plan.code,
        'plan_name_ar', v_plan.name_ar,
        'plan_name_en', v_plan.name_en,
        'plan_type', v_plan.plan_type,
        'subscription_status', CASE
            WHEN v_sub.status = 'expired' THEN 'grace'
            ELSE COALESCE(v_sub.status, 'active')
        END,
        'grace_until', CASE
            WHEN v_sub.status = 'expired' THEN v_sub.grace_period_end
            ELSE NULL
        END,
        'limits', jsonb_build_object(
            'users',      jsonb_build_object('current', v_users_count, 'max', v_plan.max_users, 'unlimited', v_plan.max_users = -1, 'allowed', v_plan.max_users = -1 OR v_users_count < v_plan.max_users),
            'companies',  jsonb_build_object('current', v_companies_count, 'max', v_plan.max_companies, 'unlimited', v_plan.max_companies = -1, 'allowed', v_plan.max_companies = -1 OR v_companies_count < v_plan.max_companies),
            'branches',   jsonb_build_object('current', v_branches_count, 'max', v_plan.max_branches, 'unlimited', v_plan.max_branches = -1, 'allowed', v_plan.max_branches = -1 OR v_branches_count < v_plan.max_branches),
            'warehouses', jsonb_build_object('current', v_warehouses_count, 'max', v_plan.max_warehouses, 'unlimited', v_plan.max_warehouses = -1, 'allowed', v_plan.max_warehouses = -1 OR v_warehouses_count < v_plan.max_warehouses),
            'products',   jsonb_build_object('current', v_products_count, 'max', v_plan.max_products, 'unlimited', v_plan.max_products = -1, 'allowed', v_plan.max_products = -1 OR v_products_count < v_plan.max_products),
            'customers',  jsonb_build_object('current', v_customers_count, 'max', v_plan.max_customers, 'unlimited', v_plan.max_customers = -1, 'allowed', v_plan.max_customers = -1 OR v_customers_count < v_plan.max_customers),
            'invoices_monthly', jsonb_build_object('current', v_invoices_count, 'max', v_plan.max_invoices_monthly, 'unlimited', v_plan.max_invoices_monthly = -1, 'allowed', v_plan.max_invoices_monthly = -1 OR v_invoices_count < v_plan.max_invoices_monthly),
            'storage_gb', jsonb_build_object('current', 0, 'max', v_plan.storage_gb, 'unlimited', v_plan.storage_gb = -1)
        ),
        'modules', COALESCE(
            -- [installer-adapt] emit jsonb both ways: array_agg(text[]) can't COALESCE with jsonb included_modules locally
            (SELECT to_jsonb(array_agg(tm.module_code ORDER BY tm.module_code))
                    FROM tenant_modules tm
                    WHERE tm.tenant_id = p_tenant_id AND tm.is_active),
            v_plan.included_modules
        ),
        'features', v_plan.features
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('error', 'exception', 'message', SQLERRM);
END;
$function$;

-- >>> confirm_production_order
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
BEGIN
    IF NOT public.tenant_has_module('manufacturing') THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
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
        planned_material_cost=v_plan_cost, confirmed_at=now(), updated_at=now() WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'order_number', v_num, 'stages_created', v_stages,
        'dependency_edges', v_dep_edges, 'reserved_lines', v_reserved, 'planned_material_cost', v_plan_cost);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- >>> ship_to_subcontractor
CREATE OR REPLACE FUNCTION public.ship_to_subcontractor(p_shipment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
    IF NOT public.tenant_has_module('manufacturing') THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
    SELECT * INTO v_sh FROM public.mfg_subcontract_shipments WHERE id = p_shipment_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الإرسال غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_sh.company_id); END IF;
    IF NOT COALESCE((public.mfg_check_limit(v_sh.tenant_id, v_sh.company_id, 'mfg_advanced')->>'allowed')::boolean, true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'MFG_LIMIT_ADVANCED');
    END IF;
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
        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, from_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_sh.tenant_id, v_sh.company_id, 'SUBS-' || LEFT(p_shipment_id::text,8) || '-O' || v_idx,
            v_sh.ship_date, 'transfer_out', v_ln.product_id, v_src, v_ln.qty_sent, v_cost, v_cost*v_ln.qty_sent,
            'subcontract_ship', p_shipment_id, v_sh.doc_number, 'إرسال خام لمقاول الباطن', auth.uid());
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
$function$;

-- >>> scan_bundle_advance
CREATE OR REPLACE FUNCTION public.scan_bundle_advance(p_bundle_id uuid, p_stage_id uuid, p_qty_good numeric, p_qty_scrap numeric DEFAULT 0, p_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_bnd       public.mfg_bundles%ROWTYPE;
    v_stage     public.mfg_order_stages%ROWTYPE;
    v_ord       public.mfg_production_orders%ROWTYPE;
    v_is_last   boolean;
    v_new_good  numeric;
    v_new_scrap numeric;
    v_room      numeric;
    v_rate      numeric := 0;
    v_wage      numeric := 0;
    v_lab_id    uuid;
BEGIN
    IF NOT public.tenant_has_module('manufacturing') THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
    SELECT * INTO v_bnd FROM public.mfg_bundles WHERE id = p_bundle_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الرزمة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_bnd.company_id); END IF;
    IF NOT COALESCE((public.mfg_check_limit(v_bnd.tenant_id, v_bnd.company_id, 'mfg_advanced')->>'allowed')::boolean, true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'MFG_LIMIT_ADVANCED');
    END IF;

    SELECT * INTO v_stage FROM public.mfg_order_stages WHERE id = p_stage_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'المرحلة غير موجودة'); END IF;
    IF v_stage.production_order_id <> v_bnd.production_order_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرحلة لا تخصّ أمر الرزمة');
    END IF;
    IF COALESCE(p_qty_good,0) < 0 OR COALESCE(p_qty_scrap,0) < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'كميات سالبة غير مسموحة');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_bnd.production_order_id;

    -- bound accumulation by the stage's qty_in (can't scan more than arrived)
    v_room := COALESCE(v_stage.qty_in,0) - COALESCE(v_stage.qty_good,0) - COALESCE(v_stage.qty_scrap,0);
    IF COALESCE(v_stage.qty_in,0) > 0 AND (COALESCE(p_qty_good,0) + COALESCE(p_qty_scrap,0)) > v_room + 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'المسح يتجاوز المتبقّي الداخل للمرحلة (المتاح '||round(v_room,4)||')');
    END IF;

    v_new_good  := COALESCE(v_stage.qty_good,0)  + COALESCE(p_qty_good,0);
    v_new_scrap := COALESCE(v_stage.qty_scrap,0) + COALESCE(p_qty_scrap,0);

    UPDATE public.mfg_order_stages SET
        qty_good = v_new_good, qty_scrap = v_new_scrap,
        status = CASE WHEN status = 'ready' THEN 'in_progress' ELSE status END,
        started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = p_stage_id;

    -- move bundle; mark done when it reaches the final stage of the order
    SELECT NOT EXISTS (SELECT 1 FROM public.mfg_order_stages
        WHERE production_order_id = v_bnd.production_order_id AND seq > v_stage.seq) INTO v_is_last;
    UPDATE public.mfg_bundles SET
        current_stage_id = p_stage_id,
        status = CASE WHEN v_is_last THEN 'done' ELSE 'in_progress' END,
        updated_at = now()
    WHERE id = p_bundle_id;

    -- optional pending labor log = productivity + wage (piece-rate per stage rule)
    IF p_employee_id IS NOT NULL THEN
        IF v_stage.pay_type = 'per_piece' THEN
            v_rate := COALESCE(v_stage.piece_rate,0);
            v_wage := round(v_rate * COALESCE(p_qty_good,0), 4);
        ELSE
            v_rate := 0; v_wage := 0;   -- hourly/none: time not captured by a scan
        END IF;
        INSERT INTO public.mfg_labor_logs (
            tenant_id, company_id, production_order_id, order_stage_id, bundle_id,
            employee_id, work_date, qty_good, qty_reject, pay_type, rate, wage_amount, status, created_by)
        VALUES (v_bnd.tenant_id, v_bnd.company_id, v_bnd.production_order_id, p_stage_id, p_bundle_id,
            p_employee_id, CURRENT_DATE, COALESCE(p_qty_good,0), COALESCE(p_qty_scrap,0),
            COALESCE(v_stage.pay_type,'none'), v_rate, v_wage, 'pending', auth.uid())
        RETURNING id INTO v_lab_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'bundle_id', p_bundle_id, 'stage_id', p_stage_id,
        'bundle_status', CASE WHEN v_is_last THEN 'done' ELSE 'in_progress' END,
        'stage_qty_good', v_new_good, 'stage_qty_scrap', v_new_scrap,
        'labor_log_id', v_lab_id, 'wage_amount', v_wage);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- >>> post_unbuild_order
CREATE OR REPLACE FUNCTION public.post_unbuild_order(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
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
    IF NOT public.tenant_has_module('manufacturing') THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
    SELECT * INTO v_u FROM public.mfg_unbuild_orders WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'أمر التفكيك غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_u.company_id); END IF;
    IF NOT COALESCE((public.mfg_check_limit(v_u.tenant_id, v_u.company_id, 'mfg_advanced')->>'allowed')::boolean, true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'MFG_LIMIT_ADVANCED');
    END IF;
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

-- >>> add_labor_log
CREATE OR REPLACE FUNCTION public.add_labor_log(p_log jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_stage    public.mfg_order_stages%ROWTYPE;
    v_order_id uuid := (p_log->>'production_order_id')::uuid;
    v_stage_id uuid := (p_log->>'order_stage_id')::uuid;
    v_qg  numeric := COALESCE((p_log->>'qty_good')::numeric, 0);
    v_qr  numeric := COALESCE((p_log->>'qty_reject')::numeric, 0);
    v_min numeric := COALESCE((p_log->>'minutes')::numeric, 0);
    v_emp uuid := NULLIF(p_log->>'employee_id','')::uuid;
    v_pay text; v_rate numeric; v_wage numeric; v_sum numeric; v_id uuid;
BEGIN
    IF NOT public.tenant_has_module('manufacturing') THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
    IF v_stage_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'order_stage_id مطلوب'); END IF;
    SELECT * INTO v_stage FROM public.mfg_order_stages WHERE id = v_stage_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'المرحلة غير موجودة'); END IF;
    IF v_order_id IS NOT NULL AND v_stage.production_order_id <> v_order_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرحلة لا تخصّ الأمر المحدّد');
    END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_stage.company_id); END IF;

    -- سقف: Σ (جيّد+مرفوض) على سجلات المرحلة (pending+approved+swept) + الجديد ≤ qty_in
    SELECT COALESCE(SUM(COALESCE(qty_good,0) + COALESCE(qty_reject,0)), 0) INTO v_sum
      FROM public.mfg_labor_logs WHERE order_stage_id = v_stage_id;
    IF COALESCE(v_stage.qty_in,0) > 0 AND (v_sum + v_qg + v_qr) > v_stage.qty_in + 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'تجاوز سقف كمية المرحلة (qty_in=' || v_stage.qty_in || '، المسجّل=' || v_sum || '، الجديد=' || (v_qg + v_qr) || ')');
    END IF;

    v_pay  := COALESCE(NULLIF(p_log->>'pay_type',''), v_stage.pay_type, 'none');
    v_rate := COALESCE((p_log->>'rate')::numeric, v_stage.piece_rate, 0);
    v_wage := CASE WHEN v_pay = 'per_piece' THEN v_rate * v_qg
                   WHEN v_pay = 'hourly'    THEN v_rate * v_min / 60.0
                   ELSE 0 END;

    INSERT INTO public.mfg_labor_logs (
        tenant_id, company_id, production_order_id, order_stage_id, employee_id,
        work_date, minutes, qty_good, qty_reject, pay_type, rate, wage_amount, status, created_by)
    VALUES (v_stage.tenant_id, v_stage.company_id, v_stage.production_order_id, v_stage_id, v_emp,
        COALESCE((p_log->>'work_date')::date, CURRENT_DATE), v_min, v_qg, v_qr, v_pay, v_rate, round(v_wage,4), 'pending', auth.uid())
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'log_id', v_id, 'wage_amount', round(v_wage,4), 'pay_type', v_pay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- >>> mrp_suggestions
CREATE OR REPLACE FUNCTION public.mrp_suggestions(p_company_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_rows jsonb := '[]'::jsonb;
    r          RECORD;
    v_available numeric;
    v_demand    numeric;
    v_shortfall numeric;
    v_bom       uuid;
    v_suggest   text;
    v_mat       jsonb;
    v_enough    boolean;
    v_btl_pid   uuid;
    v_btl_short numeric;
    v_buys      jsonb;
BEGIN
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(p_company_id); END IF;
    IF NOT COALESCE((public.mfg_check_limit((SELECT tenant_id FROM public.companies WHERE id = p_company_id), p_company_id, 'mfg_advanced')->>'allowed')::boolean, true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'MFG_LIMIT_ADVANCED');
    END IF;

    FOR r IN
        WITH demand AS (
            SELECT sti.product_id AS pid,
                   SUM(GREATEST(0, COALESCE(sti.quantity,0) - COALESCE(sti.delivered_qty,0) - COALESCE(sti.returned_qty,0))) AS dq
            FROM public.sales_transaction_items sti
            JOIN public.sales_transactions st ON st.id = sti.transaction_id
            JOIN public.products p ON p.id = sti.product_id
            WHERE st.company_id = p_company_id AND COALESCE(st.is_deleted,false) = false
              AND COALESCE(p.is_manufactured,false) = true
              AND (p_warehouse_id IS NULL OR COALESCE(sti.warehouse_id, st.warehouse_id) = p_warehouse_id)
            GROUP BY sti.product_id
        ),
        stock AS (
            SELECT product_id AS pid, SUM(COALESCE(quantity_on_hand,0)) AS oh, SUM(COALESCE(reserved_quantity,0)) AS rq
            FROM public.inventory_stock
            WHERE company_id = p_company_id AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
            GROUP BY product_id
        ),
        wip AS (
            SELECT product_id AS pid, SUM(GREATEST(0, COALESCE(qty_planned,0) - COALESCE(qty_produced,0))) AS expc
            FROM public.mfg_production_orders
            WHERE company_id = p_company_id AND status IN ('confirmed','in_progress') AND COALESCE(is_deleted,false) = false
            GROUP BY product_id
        )
        SELECT p.id AS pid,
               COALESCE(p.name_en, p.name_ar, p.name) AS pname,
               COALESCE(p.is_manufactured,false) AS is_mfd,
               COALESCE(p.is_purchasable,false) AS is_pur,
               p.default_bom_id,
               COALESCE(NULLIF(p.reorder_level,0), p.minimum_stock, 0) AS reorder,
               COALESCE(d.dq,0) AS sales_demand,
               COALESCE(s.oh,0) AS on_hand, COALESCE(s.rq,0) AS reserved,
               COALESCE(w.expc,0) AS expected
        FROM public.products p
        LEFT JOIN demand d ON d.pid = p.id
        LEFT JOIN stock  s ON s.pid = p.id
        LEFT JOIN wip    w ON w.pid = p.id
        WHERE p.company_id = p_company_id
          AND ( d.dq IS NOT NULL OR COALESCE(NULLIF(p.reorder_level,0), p.minimum_stock, 0) > 0 )
    LOOP
        v_available := r.on_hand - r.reserved;
        v_demand    := GREATEST(COALESCE(r.sales_demand,0), COALESCE(r.reorder,0));  -- reorder acts as a floor
        v_shortfall := round(v_demand - v_available - r.expected, 6);
        IF v_shortfall <= 0.000001 THEN CONTINUE; END IF;

        -- default approved BOM (explicit default → default flag → latest version)
        v_bom := r.default_bom_id;
        IF v_bom IS NULL AND r.is_mfd THEN
            SELECT id INTO v_bom FROM public.mfg_boms
             WHERE product_id = r.pid AND status = 'approved'
             ORDER BY is_default DESC, version DESC LIMIT 1;
        END IF;
        v_suggest := CASE WHEN r.is_mfd AND v_bom IS NOT NULL THEN 'make'
                          WHEN r.is_pur THEN 'buy'
                          WHEN r.is_mfd THEN 'make' ELSE 'buy' END;

        v_mat := NULL; v_enough := NULL; v_btl_pid := NULL; v_btl_short := NULL; v_buys := '[]'::jsonb;

        IF v_suggest = 'make' AND v_bom IS NOT NULL THEN
            WITH chk AS (
                SELECT e.component_product_id AS cid, e.qty_per_unit AS qpu,
                       round(e.qty_per_unit * v_shortfall, 6) AS need,
                       COALESCE((SELECT SUM(COALESCE(quantity_on_hand,0) - COALESCE(reserved_quantity,0))
                                   FROM public.inventory_stock s
                                  WHERE s.product_id = e.component_product_id AND s.company_id = p_company_id
                                    AND (p_warehouse_id IS NULL OR s.warehouse_id = p_warehouse_id)),0) AS avail,
                       COALESCE(pc.is_manufactured,false) AS c_mfd,
                       COALESCE(pc.is_purchasable,false) AS c_pur,
                       COALESCE(pc.name_en, pc.name_ar, pc.name) AS c_name
                FROM public.mfg_bom_exploded e
                JOIN public.products pc ON pc.id = e.component_product_id
                WHERE e.bom_id = v_bom
            )
            SELECT
                COALESCE(jsonb_agg(jsonb_build_object('product_id', cid, 'name', c_name,
                    'need', need, 'available', avail, 'short', round(need - avail,6))
                    ORDER BY (avail / NULLIF(need,0)) ASC) FILTER (WHERE need > avail + 0.000001), '[]'::jsonb),
                bool_and(need <= avail + 0.000001),
                (SELECT cid   FROM chk WHERE need > avail + 0.000001 ORDER BY (avail/NULLIF(need,0)) ASC LIMIT 1),
                (SELECT round(need-avail,6) FROM chk WHERE need > avail + 0.000001 ORDER BY (avail/NULLIF(need,0)) ASC LIMIT 1),
                COALESCE(jsonb_agg(jsonb_build_object('product_id', cid, 'name', c_name,
                    'demand_qty', round(need - avail,6), 'available', avail, 'expected', 0,
                    'shortfall', round(need - avail,6), 'suggestion', 'buy', 'bom_id', NULL)
                    ) FILTER (WHERE need > avail + 0.000001 AND c_pur AND NOT c_mfd), '[]'::jsonb)
            INTO v_mat, v_enough, v_btl_pid, v_btl_short, v_buys
            FROM chk;
        END IF;

        v_rows := v_rows || jsonb_build_object(
            'product_id', r.pid, 'name', r.pname,
            'demand_qty', v_demand, 'available', round(v_available,6), 'expected', r.expected,
            'shortfall', v_shortfall, 'suggestion', v_suggest, 'bom_id', v_bom,
            'material_check', CASE WHEN v_suggest='make' AND v_bom IS NOT NULL
                THEN jsonb_build_object('enough', COALESCE(v_enough,true),
                       'bottleneck_product_id', v_btl_pid, 'bottleneck_short', v_btl_short,
                       'shortages', COALESCE(v_mat,'[]'::jsonb))
                ELSE NULL END);
        -- append one-level buy suggestions for short purchasable raw components
        IF v_buys IS NOT NULL AND jsonb_array_length(v_buys) > 0 THEN
            v_rows := v_rows || v_buys;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'company_id', p_company_id, 'count', jsonb_array_length(v_rows), 'suggestions', v_rows);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- >>> post_material_issue
CREATE OR REPLACE FUNCTION public.post_material_issue(p_issue_id uuid, p_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
    v_mln        RECORD;
    v_dry        numeric;
    v_wet        numeric;
    v_added_water numeric := 0;
BEGIN
    IF NOT public.tenant_has_module('manufacturing') THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
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

    v_added_water := 0;
    FOR v_mln IN
        SELECT il.id AS line_id, il.qty, il.moisture_pct
          FROM public.mfg_material_issue_lines il
          JOIN public.products p ON p.id = il.product_id
         WHERE il.issue_id = p_issue_id
           AND COALESCE(p.is_moisture_bearing,false) = true
           AND COALESCE(il.moisture_pct,0) > 0 AND COALESCE(il.moisture_pct,0) < 100
    LOOP
        v_dry := COALESCE(v_mln.qty,0);
        IF v_dry <= 0 THEN CONTINUE; END IF;
        v_wet := v_dry / (1 - v_mln.moisture_pct/100.0);
        UPDATE public.mfg_material_issue_lines SET qty = round(v_wet,6) WHERE id = v_mln.line_id;
        v_added_water := v_added_water + (v_wet - v_dry);
    END LOOP;
    IF v_added_water > 0.000001 THEN
        UPDATE public.mfg_material_issue_lines il
           SET qty = GREATEST(0, COALESCE(il.qty,0) - round(v_added_water,6))
         WHERE il.id = (
            SELECT il2.id FROM public.mfg_material_issue_lines il2
              JOIN public.mfg_bom_lines bl ON bl.id = il2.bom_line_id
             WHERE il2.issue_id = p_issue_id AND COALESCE(bl.is_water_adjustment,false) = true
             ORDER BY il2.created_at LIMIT 1);
    END IF;

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
            IF COALESCE(v_batch.status,'available') IN ('on_hold','rejected') THEN
                RAISE EXCEPTION 'الدفعة % بحالة % — لا يمكن صرفها (محجورة/مرفوضة)', v_batch.batch_number, v_batch.status;
            END IF;
            IF v_batch.expiry_date IS NOT NULL AND v_batch.expiry_date < v_iss.issue_date THEN
                RAISE EXCEPTION 'الدفعة % منتهية الصلاحية (%) — لا يمكن صرفها', v_batch.batch_number, v_batch.expiry_date;
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
$function$;

-- >>> post_production_receipt
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
BEGIN
    IF NOT public.tenant_has_module('manufacturing') THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
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
        'batch_status', v_batch_status, 'fg_reserved', round(GREATEST(0, v_primary_recv - COALESCE(v_take, v_primary_recv)),6));
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- >>> create_production_order_from_sale
CREATE OR REPLACE FUNCTION public.create_production_order_from_sale(p_sales_transaction_id uuid, p_item_id uuid, p_qty numeric, p_bom_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_tx    public.sales_transactions%ROWTYPE;
    v_item  public.sales_transaction_items%ROWTYPE;
    v_bom   uuid;
    v_prod  uuid;
    v_set   public.mfg_settings%ROWTYPE;
    v_ord_id uuid;
    v_saleno text;
BEGIN
    IF NOT public.tenant_has_module('manufacturing') THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
    IF COALESCE(p_qty,0) <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'الكمية غير صالحة'); END IF;
    SELECT * INTO v_tx FROM public.sales_transactions WHERE id = p_sales_transaction_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'أمر البيع غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_tx.company_id); END IF;
    SELECT * INTO v_item FROM public.sales_transaction_items
     WHERE id = p_item_id AND transaction_id = p_sales_transaction_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'بند البيع غير موجود'); END IF;
    v_prod := v_item.product_id;
    IF v_prod IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'البند بلا منتج (مادة فقط) — لا يُصنَّع'); END IF;
    v_bom := p_bom_id;
    IF v_bom IS NULL THEN SELECT default_bom_id INTO v_bom FROM public.products WHERE id = v_prod; END IF;
    IF v_bom IS NULL THEN
        SELECT id INTO v_bom FROM public.mfg_boms
         WHERE product_id = v_prod AND company_id = v_tx.company_id AND status = 'approved'
         ORDER BY is_default DESC, version DESC LIMIT 1;
    END IF;
    SELECT * INTO v_set FROM public.mfg_settings
     WHERE tenant_id = v_tx.tenant_id AND company_id = v_tx.company_id LIMIT 1;
    v_saleno := COALESCE(v_tx.order_no, v_tx.reservation_no, v_tx.quotation_no, v_tx.draft_no, LEFT(v_tx.id::text,8));
    INSERT INTO public.mfg_production_orders (
        tenant_id, company_id, branch_id, product_id, bom_id, qty_planned, status,
        source_warehouse_id, wip_warehouse_id, fg_warehouse_id, scrap_warehouse_id, notes, created_by)
    VALUES (v_tx.tenant_id, v_tx.company_id, v_tx.branch_id, v_prod, v_bom, p_qty, 'draft',
        COALESCE(v_item.warehouse_id, v_tx.warehouse_id, v_set.default_wip_warehouse_id),
        v_set.default_wip_warehouse_id, v_set.default_fg_warehouse_id, v_set.default_scrap_warehouse_id,
        'MTO — أمر بيع ' || v_saleno, auth.uid())
    RETURNING id INTO v_ord_id;
    INSERT INTO public.mfg_order_sales_links (
        tenant_id, company_id, order_id, sales_transaction_id, qty_allocated)
    VALUES (v_tx.tenant_id, v_tx.company_id, v_ord_id, p_sales_transaction_id, p_qty);
    RETURN jsonb_build_object('success', true, 'order_id', v_ord_id, 'bom_id', v_bom,
        'product_id', v_prod, 'sale_ref', v_saleno,
        'note', CASE WHEN v_bom IS NULL THEN 'لا BOM معتمدة — عيّنها قبل التأكيد' ELSE NULL END);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ============================================================
-- 5. Advanced gate on custom-field-def creation (mfg_advanced)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mfg_custom_field_defs_plan_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF NOT COALESCE((public.mfg_check_limit(NEW.tenant_id, NEW.company_id, 'mfg_advanced')->>'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'MFG_LIMIT_ADVANCED'
      USING ERRCODE='P0001', DETAIL='custom_field_defs_requires_advanced_plan';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_mfg_custom_field_defs_plan_guard ON public.mfg_custom_field_defs;
CREATE TRIGGER trg_mfg_custom_field_defs_plan_guard
  BEFORE INSERT ON public.mfg_custom_field_defs
  FOR EACH ROW EXECUTE FUNCTION public.mfg_custom_field_defs_plan_guard();

-- ============================================================
-- 6. Module-gating RESTRICTIVE RLS on all 38 mfg_ tables
--    (SELECT/INSERT/UPDATE) — mirrors the platform module-guard pattern.
-- ============================================================
DO $do$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'mfg_bom_exploded',
    'mfg_bom_line_alternates',
    'mfg_bom_lines',
    'mfg_bom_outputs',
    'mfg_boms',
    'mfg_bundles',
    'mfg_custom_field_defs',
    'mfg_custom_register_rows',
    'mfg_custom_registers',
    'mfg_downtime_events',
    'mfg_field_override_whitelist',
    'mfg_field_overrides',
    'mfg_finished_receipt_lines',
    'mfg_finished_receipts',
    'mfg_labor_logs',
    'mfg_material_issue_lines',
    'mfg_material_issues',
    'mfg_material_reservations',
    'mfg_material_return_lines',
    'mfg_material_returns',
    'mfg_number_sequences',
    'mfg_order_sales_links',
    'mfg_order_stage_dependencies',
    'mfg_order_stages',
    'mfg_payroll_sweeps',
    'mfg_production_calendar',
    'mfg_production_orders',
    'mfg_qc_tests',
    'mfg_settings',
    'mfg_stage_dependencies',
    'mfg_stage_work_centers',
    'mfg_subcontract_shipment_lines',
    'mfg_subcontract_shipments',
    'mfg_unbuild_orders',
    'mfg_wip_adjustments',
    'mfg_work_centers',
    'mfg_workflow_stages',
    'mfg_workflow_templates'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_module_guard', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_module_guard_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_module_guard_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO public USING (public.tenant_has_module(''manufacturing''))', t||'_module_guard', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO public WITH CHECK (public.tenant_has_module(''manufacturing''))', t||'_module_guard_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO public USING (public.tenant_has_module(''manufacturing''))', t||'_module_guard_update', t);
  END LOOP;
END
$do$;
