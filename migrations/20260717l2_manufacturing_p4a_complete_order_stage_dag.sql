-- ============================================================================
-- complete_order_stage (full body — P3 base + P4a DAG resolution)
--   Changes vs P3:
--    1. Bundle-floor guard: p_qty_good may not drop below the qty already booked
--       by bundle scans at this stage (enforces the double-count rule; the scan
--       accumulates, completion is authoritative and SETS — never re-adds).
--    2. Downstream release: DAG resolution when the order has dependency edges
--       (a dependent becomes ready when ALL its deps are 'done'; qty_in = MIN
--       over deps' qty_good; min_wait honored via wait_until). Orders with zero
--       dependency rows keep the exact linear seq-chain behavior.
--   Backflush / overhead absorption / period-lock / notifications: unchanged.
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
                IF v_wait_ts > now() THEN
                    UPDATE public.mfg_order_stages
                       SET qty_in = v_min_qty, status = 'blocked', wait_until = v_wait_ts, updated_at = now()
                     WHERE id = v_dep.sid AND status IN ('blocked','ready');
                ELSE
                    UPDATE public.mfg_order_stages
                       SET qty_in = v_min_qty, status = 'ready', wait_until = NULL, updated_at = now()
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
        -- Linear (unchanged): release the next seq stage, honoring min_wait.
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
        'is_dag', v_is_dag, 'readied_stages', v_readied,
        'overhead_absorbed', v_overhead, 'overhead_minutes', v_oh_min, 'overhead_journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
