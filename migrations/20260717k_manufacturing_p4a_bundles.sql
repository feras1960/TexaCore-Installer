-- ============================================================================
-- P4a Migration 1 — Bundles (garment-style progressive-bundle lot tracking)
-- Plan §2.3 mfg_bundles + §4-د garment insight (one scan = progress + productivity)
-- ============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_bundles (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL,
    company_id          uuid NOT NULL,
    production_order_id uuid NOT NULL REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    bundle_number       int  NOT NULL,
    qr_code             text,                       -- compact json {t:'mfg_bundle', id}
    qty                 numeric NOT NULL DEFAULT 0,
    current_stage_id    uuid REFERENCES public.mfg_order_stages(id) ON DELETE SET NULL,
    status              text NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','in_progress','done')),
    custom_data         jsonb DEFAULT '{}'::jsonb,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),
    UNIQUE (production_order_id, bundle_number)
);
CREATE INDEX IF NOT EXISTS idx_mfg_bundles_order ON public.mfg_bundles(production_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_bundles_stage ON public.mfg_bundles(current_stage_id);

ALTER TABLE public.mfg_bundles ENABLE ROW LEVEL SECURITY;

-- ── RLS (canonical P0-P3 pattern) ────────────────────────────────────────────
DROP POLICY IF EXISTS mfg_bundles_select_policy ON public.mfg_bundles;
CREATE POLICY mfg_bundles_select_policy ON public.mfg_bundles FOR SELECT
  USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
DROP POLICY IF EXISTS mfg_bundles_insert_policy ON public.mfg_bundles;
CREATE POLICY mfg_bundles_insert_policy ON public.mfg_bundles FOR INSERT
  WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_bundles_update_policy ON public.mfg_bundles;
CREATE POLICY mfg_bundles_update_policy ON public.mfg_bundles FOR UPDATE
  USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_bundles_delete_policy ON public.mfg_bundles;
CREATE POLICY mfg_bundles_delete_policy ON public.mfg_bundles FOR DELETE
  USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));

-- ============================================================================
-- create_order_bundles — split qty_planned into bundles (by size OR by count)
--   • p_bundle_size: bundles of this size; remainder (if any) in a final bundle
--     e.g. qty 100 size 30 → 30/30/30/10 (4 bundles)
--   • p_count: N roughly-equal bundles; remainder folded into the last one
--   qr_code payload = compact json {"t":"mfg_bundle","id":<uuid>} for scanning
--   current_stage_id starts at the first (min seq) order stage.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order_bundles(
    p_order_id uuid, p_bundle_size numeric DEFAULT NULL, p_count int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
DECLARE
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_first_st   uuid;
    v_total      numeric;
    v_n          int;
    v_i          int := 0;
    v_size       numeric;
    v_qty        numeric;
    v_assigned   numeric := 0;
    v_bid        uuid;
    v_bundles    jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ord.company_id); END IF;
    IF v_ord.status NOT IN ('confirmed','in_progress') THEN
        RETURN jsonb_build_object('success', false, 'error', 'الرزم تُنشأ لأمر مؤكَّد أو جارٍ فقط (الحالة: '||v_ord.status||')');
    END IF;
    IF (p_bundle_size IS NULL) = (p_count IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'حدّد حجم الرزمة (p_bundle_size) أو عددها (p_count) — أحدهما لا كليهما');
    END IF;
    IF EXISTS (SELECT 1 FROM public.mfg_bundles WHERE production_order_id = p_order_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'الرزم مُنشأة مسبقاً لهذا الأمر');
    END IF;

    v_total := COALESCE(v_ord.qty_planned,0);
    IF v_total <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'كمية الأمر صفر'); END IF;

    SELECT id INTO v_first_st FROM public.mfg_order_stages
      WHERE production_order_id = p_order_id ORDER BY seq LIMIT 1;

    -- derive bundle count + per-bundle size
    IF p_bundle_size IS NOT NULL THEN
        IF p_bundle_size <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'حجم الرزمة غير صالح'); END IF;
        v_size := p_bundle_size;
        v_n := CEIL(v_total / v_size)::int;                 -- last bundle carries the remainder
    ELSE
        IF p_count <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'عدد الرزم غير صالح'); END IF;
        v_n := p_count;
        v_size := FLOOR((v_total / v_n)::numeric * 1000000) / 1000000;  -- base size, last bundle takes remainder
    END IF;

    FOR v_i IN 1..v_n LOOP
        IF v_i = v_n THEN
            v_qty := round(v_total - v_assigned, 6);        -- final bundle absorbs remainder
        ELSE
            v_qty := round(v_size, 6);
        END IF;
        IF v_qty <= 0 THEN CONTINUE; END IF;
        v_bid := gen_random_uuid();
        INSERT INTO public.mfg_bundles (
            id, tenant_id, company_id, production_order_id, bundle_number,
            qr_code, qty, current_stage_id, status)
        VALUES (v_bid, v_ord.tenant_id, v_ord.company_id, p_order_id, v_i,
            json_build_object('t','mfg_bundle','id',v_bid)::text, v_qty, v_first_st, 'created');
        v_assigned := v_assigned + v_qty;
        v_bundles := v_bundles || jsonb_build_object('id', v_bid, 'bundle_number', v_i, 'qty', v_qty,
                        'qr_code', json_build_object('t','mfg_bundle','id',v_bid)::text);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'bundle_count',
        jsonb_array_length(v_bundles), 'total_qty', v_assigned, 'bundles', v_bundles);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- ============================================================================
-- scan_bundle_advance — ONE scan = progress + productivity (§4-د garment insight)
--   Advances a bundle to a stage, ACCUMULATES its good/scrap into the stage
--   counters (bounded by qty_in), and optionally writes a PENDING labor log for
--   the employee (piece-rate wage per stage pay rule).
--
--   ── DOUBLE-COUNT RULE (chosen) ─────────────────────────────────────────────
--   Bundle scans ACCUMULATE directly into mfg_order_stages.qty_good/qty_scrap as
--   a fine-grained parallel progress view. They DO NOT trigger backflush, do NOT
--   complete the stage, and do NOT release downstream stages.
--   complete_order_stage remains the single authoritative completion: it SETS
--   qty_good = p_qty_good (overriding the accumulated bundle total) and runs
--   backflush exactly once — so material consumption is NEVER double-counted.
--   The only coupling: complete_order_stage validates p_qty_good is not below the
--   already-scanned bundle floor at that stage (added in migration 20260717l).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.scan_bundle_advance(
    p_bundle_id uuid, p_stage_id uuid, p_qty_good numeric,
    p_qty_scrap numeric DEFAULT 0, p_employee_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
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
    SELECT * INTO v_bnd FROM public.mfg_bundles WHERE id = p_bundle_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الرزمة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_bnd.company_id); END IF;

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

COMMENT ON TABLE public.mfg_bundles IS 'P4a: garment-style progressive bundles — parallel fine-grained progress view over mfg_order_stages. Scans accumulate into stage counters; complete_order_stage stays authoritative (no material double-count).';
