-- ============================================================================
-- 20260718a — Manufacturing P4c: verified-scenario fixes (B1/B2/B3/B4/B5)
--   B1 (HIGH): make complete_order_stage rework-aware so re-completing a stage
--              reopened by record_stage_rework does NOT double-consume material,
--              does NOT re-absorb overhead, and does NOT overwrite downstream
--              done-stage counts. New column mfg_order_stages.qty_completed_total
--              tracks the cumulative good qty already backflushed/counted; only
--              genuinely-new units (p_qty_good - qty_completed_total) are
--              backflushed. First-completion behavior is byte-identical.
--   B2 (MED): wire the dormant weigh_tolerance_pct on BOM lines in
--             post_material_issue (independent per-line precision tolerance,
--             warn > tol, block > 2×tol unless p_override).
--   B3 (LOW-MED): confirm_production_order emits soft BATCH_BELOW_MIN /
--             BATCH_ABOVE_MAX warnings (never blocks) from BOM batch_min/max.
--   B4: documentation-only COMMENT on mfg_bom_outputs.default_package_size.
--   B5 (MED): mfg_tenant_has_module() wrapper adds a service_role / no-JWT
--             (pg_cron) bypass to the 8 manufacturing SECDEF module guards so
--             genuine automation is not gated out. Real-user path is unchanged
--             (identical JWT-derived tenant_has_module('manufacturing') check),
--             so error precedence and gating for real callers are preserved.
--   Idempotent. No commits. RESTRICTIVE RLS untouched.
-- ============================================================================

-- ─── B1: state column ───────────────────────────────────────────────────────
ALTER TABLE public.mfg_order_stages
    ADD COLUMN IF NOT EXISTS qty_completed_total numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.mfg_order_stages.qty_completed_total IS
    'B1: cumulative good qty already backflushed/counted by complete_order_stage. '
    'Used to compute v_new_units on re-completion after rework so material is not '
    'double-consumed. Maintained as GREATEST(prev, p_qty_good) on every completion.';

-- ─── B4: documentation-only ─────────────────────────────────────────────────
COMMENT ON COLUMN public.mfg_bom_outputs.default_package_size IS
    'Nominal package size for the output (e.g. kg per bag). NOTE (v1): packaging '
    'material lines are consumed PER OUTPUT-UNIT (e.g. per kg produced), NOT per '
    'package count — the engine does not divide required packaging by this size. '
    'Model packaging BOM lines on a per-output-unit basis accordingly.';

-- ─── B5: service/cron-aware module guard wrapper ────────────────────────────
-- Mirrors assert_can_access_company's bypass: a genuine service_role or a
-- no-JWT (pg_cron / direct) caller has no tenant JWT and must not receive
-- MODULE_NOT_ENABLED. For a real authenticated tenant user the check is the
-- exact original JWT-derived gate, so no behavior changes for real callers.
CREATE OR REPLACE FUNCTION public.mfg_tenant_has_module()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_role text;
BEGIN
    -- Service-context bypass (mirror assert_can_access_company).
    BEGIN
        v_role := current_setting('request.jwt.claims', true)::json->>'role';
        IF v_role = 'service_role' THEN
            RETURN true;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Unparseable/absent JWT claims = direct/superuser/cron context.
        RETURN true;
    END;
    -- No authenticated user (pg_cron / service with claims absent), excluding anon.
    IF auth.uid() IS NULL AND COALESCE(v_role,'') <> 'anon' THEN
        RETURN true;
    END IF;
    -- Real tenant user: original JWT-derived module gate (unchanged behavior).
    RETURN public.tenant_has_module('manufacturing');
END;
$function$;

-- ─── B5: swap the guard in the 6 unmodified SECDEF RPCs programmatically ─────
-- (post_material_issue and confirm_production_order get the swap inline below,
--  bundled with their B2/B3 edits.) Programmatic replace() avoids transcribing
--  large function bodies verbatim. Idempotent: the LIKE filter excludes any
--  function whose guard was already swapped.
DO $mig$
DECLARE
    r    record;
    v_def text;
BEGIN
    FOR r IN
        SELECT p.oid
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('add_labor_log','create_production_order_from_sale',
                             'post_production_receipt','post_unbuild_order',
                             'scan_bundle_advance','ship_to_subcontractor')
           AND pg_get_functiondef(p.oid) LIKE '%public.tenant_has_module(''manufacturing'')%'
    LOOP
        v_def := pg_get_functiondef(r.oid);
        v_def := replace(v_def,
            'public.tenant_has_module(''manufacturing'')',
            'public.mfg_tenant_has_module()');
        EXECUTE v_def;
    END LOOP;
END
$mig$;

-- ============================================================================
-- B1: complete_order_stage — rework-aware backflush / overhead / downstream
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_order_stage(p_stage_id uuid, p_qty_good numeric, p_qty_scrap numeric DEFAULT 0, p_override_shortage boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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
    -- P4a
    v_bundle_floor numeric := 0;
    v_is_dag       boolean := false;
    v_dep          RECORD;
    v_min_qty      numeric;
    v_wait_ts      timestamptz;
    v_readied      jsonb := '[]'::jsonb;
    v_first_ready  uuid;
    -- P4c/B1 rework-awareness
    v_new_units       numeric := 0;
    v_is_recompletion boolean := false;
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

    -- P4a bundle-floor guard: authoritative completion may not under-report below
    -- what bundle scans already booked as good at this stage.
    SELECT COALESCE(SUM(qty_good),0) INTO v_bundle_floor
      FROM public.mfg_labor_logs WHERE order_stage_id = p_stage_id AND bundle_id IS NOT NULL;
    IF v_bundle_floor > 0 AND COALESCE(p_qty_good,0) < v_bundle_floor - 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'الكمية الجيّدة ('||COALESCE(p_qty_good,0)||') أقل من المسجَّل عبر مسح الرزم ('||round(v_bundle_floor,4)||')');
    END IF;

    -- P4c/B1: only backflush/absorb overhead for genuinely NEW good units. On a
    -- re-completion after rework, qty_completed_total already covers prior units.
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

    -- ── استيعاب الأوفرهيد للمرحلة (§4-ج/15 + §4-د/13) ──
    -- P4c/B1: skip on re-completion after rework to avoid double-absorbing
    -- overhead/labor already booked on the first completion. First completion
    -- (qty_completed_total = 0) runs this block byte-identically to before.
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

    -- ── تحرير المراحل التالية (P4a: DAG resolution أو الخطي القديم) ──
    SELECT EXISTS (
        SELECT 1 FROM public.mfg_order_stage_dependencies d
        JOIN public.mfg_order_stages s ON s.id = d.order_stage_id
        WHERE s.production_order_id = v_ord.id) INTO v_is_dag;

    IF v_is_dag THEN
        -- Resolve every stage that depends on the just-completed stage.
        FOR v_dep IN
            SELECT DISTINCT d.order_stage_id AS sid
              FROM public.mfg_order_stage_dependencies d
             WHERE d.depends_on_order_stage_id = p_stage_id
        LOOP
            -- ready only when ALL dependencies are done
            IF NOT EXISTS (
                SELECT 1 FROM public.mfg_order_stage_dependencies d2
                JOIN public.mfg_order_stages s2 ON s2.id = d2.depends_on_order_stage_id
                WHERE d2.order_stage_id = v_dep.sid AND s2.status <> 'done')
            THEN
                -- qty_in = MIN over deps' qty_good (a multi-input stage cannot
                -- process more than its scarcest feeder produced).
                SELECT MIN(COALESCE(s3.qty_good,0)) INTO v_min_qty
                  FROM public.mfg_order_stage_dependencies d3
                  JOIN public.mfg_order_stages s3 ON s3.id = d3.depends_on_order_stage_id
                 WHERE d3.order_stage_id = v_dep.sid;
                -- wait_until = MAX over deps of (completed_at + dep.min_wait_hours)
                SELECT MAX(COALESCE(s4.completed_at, now()) + (COALESCE(s4.min_wait_hours,0) || ' hours')::interval)
                  INTO v_wait_ts
                  FROM public.mfg_order_stage_dependencies d4
                  JOIN public.mfg_order_stages s4 ON s4.id = d4.depends_on_order_stage_id
                 WHERE d4.order_stage_id = v_dep.sid;
                -- P4c/B1: never DECREASE a dependent's qty_in below what it has
                -- already processed (its own qty_completed_total).
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
                END IF;
            END IF;
        END LOOP;
    ELSE
        -- Linear: release the next seq stage, honoring min_wait.
        -- P4c/B1: on re-completion after rework, an already-'done' downstream
        -- stage must NOT be reset/overwritten; only blocked/ready/in_progress
        -- downstream stages are (re)seeded, and their qty_in never drops below
        -- their own qty_completed_total.
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
    END IF;

    RETURN jsonb_build_object('success', true, 'stage_id', p_stage_id,
        'next_stage_id', COALESCE(v_first_ready, v_next.id), 'is_last', v_is_last, 'backflush_issue_id', v_issue_id,
        'is_dag', v_is_dag, 'readied_stages', v_readied, 'new_units', v_new_units,
        'overhead_absorbed', v_overhead, 'overhead_minutes', v_oh_min, 'overhead_journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ============================================================================
-- B2 + B5: post_material_issue — wire weigh_tolerance_pct; service-aware guard
-- ============================================================================
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
    -- P4c/B2 weighing tolerance (independent per-line precision)
    v_wtol       numeric;
    v_wdev       numeric;
BEGIN
    IF NOT public.mfg_tenant_has_module() THEN RETURN jsonb_build_object('success', false, 'error', 'MODULE_NOT_ENABLED'); END IF;
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

            -- P4c/B2: independent per-line weighing tolerance (critical additives).
            -- Read live from mfg_bom_lines so it applies to orders confirmed before
            -- the snapshot carried this field. warn > tol; block > 2×tol unless override.
            SELECT weigh_tolerance_pct INTO v_wtol FROM public.mfg_bom_lines WHERE id = v_line.bom_line_id;
            IF v_wtol IS NOT NULL AND COALESCE(v_req,0) > 0 THEN
                v_wdev := abs(v_qty - v_req) / v_req * 100.0;
                IF v_wdev > v_wtol THEN
                    v_warn := v_warn || jsonb_build_object('line_id', v_line.id, 'product_id', v_line.product_id,
                                'required', v_req, 'issued', v_qty, 'deviation_pct', round(v_wdev,2),
                                'weigh_tolerance_pct', v_wtol, 'kind', 'weigh');
                    IF v_wdev > 2 * v_wtol AND NOT p_override THEN
                        RAISE EXCEPTION 'انحراف الوزن %٪ يتجاوز ضعف حدّ السماح الوزني %٪ للمنتج % — يلزم تجاوز مشرف', round(v_wdev,2), v_wtol, v_line.product_id;
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

-- ============================================================================
-- B3 + B5: confirm_production_order — soft batch_min/max warnings; service guard
-- ============================================================================
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
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'order_number', v_num, 'stages_created', v_stages,
        'dependency_edges', v_dep_edges, 'reserved_lines', v_reserved, 'planned_material_cost', v_plan_cost,
        'warnings', v_warnings);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
