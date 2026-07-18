-- ============================================================================
-- P4a Migration 3 — Exploded BOM snapshot + MRP-lite
--   • mfg_bom_exploded (plan §2.2): fully-exploded leaf requirements per 1 unit
--     of the top FG, denormalized for fast multi-level reads.
--   • rebuild_bom_explosion(bom): recursive CTE through component_bom_id,
--     aggregating leaf qty_per_unit; normalizes formula-basis to per-FG-unit,
--     folds yield + line scrap; depth + visited guard against cyclic BOMs.
--   • trigger on mfg_boms/mfg_bom_lines → rebuild own + cascade UP to every
--     parent BOM that references it as a component (invalidate+rebuild).
--   • mrp_suggestions(company, warehouse?): pure read — demand (undelivered
--     sales for manufactured products + reorder shortfalls) vs supply (stock +
--     in-progress orders) → make/buy rows with per-material bottleneck check.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mfg_bom_exploded (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL,
    company_id           uuid NOT NULL,
    bom_id               uuid NOT NULL REFERENCES public.mfg_boms(id) ON DELETE CASCADE,
    component_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    qty_per_unit         numeric NOT NULL DEFAULT 0,   -- aggregated across all levels, per 1 FG unit
    regenerated_at       timestamptz DEFAULT now(),
    UNIQUE (bom_id, component_product_id)
);
CREATE INDEX IF NOT EXISTS idx_mfg_bom_exploded_bom ON public.mfg_bom_exploded(bom_id);
CREATE INDEX IF NOT EXISTS idx_mfg_bom_exploded_comp ON public.mfg_bom_exploded(component_product_id);

ALTER TABLE public.mfg_bom_exploded ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfg_bom_exploded_select_policy ON public.mfg_bom_exploded;
CREATE POLICY mfg_bom_exploded_select_policy ON public.mfg_bom_exploded FOR SELECT
  USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
DROP POLICY IF EXISTS mfg_bom_exploded_insert_policy ON public.mfg_bom_exploded;
CREATE POLICY mfg_bom_exploded_insert_policy ON public.mfg_bom_exploded FOR INSERT
  WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_bom_exploded_update_policy ON public.mfg_bom_exploded;
CREATE POLICY mfg_bom_exploded_update_policy ON public.mfg_bom_exploded FOR UPDATE
  USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_bom_exploded_delete_policy ON public.mfg_bom_exploded;
CREATE POLICY mfg_bom_exploded_delete_policy ON public.mfg_bom_exploded FOR DELETE
  USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));

-- ============================================================================
-- rebuild_bom_explosion(p_bom_id)
--   per-unit-of-a-line within its own BOM pb (includes yield + line scrap):
--     per_unit = raw_qty / (yield_pct/100) * (1 + scrap_pct/100)
--     where raw_qty = qty_per_unit                        (per_unit basis)
--                   = qty_per_unit / pb.quantity          (formula, absolute qty per ref batch)
--                   = formula_pct/100                     (formula, % of mix — planning approximation)
--   Leaf contribution to top FG = (accumulated multiplier at pb) * per_unit(line).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rebuild_bom_explosion(p_bom_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
DECLARE
    v_tenant uuid; v_company uuid; v_cnt int := 0;
BEGIN
    SELECT tenant_id, company_id INTO v_tenant, v_company FROM public.mfg_boms WHERE id = p_bom_id;
    IF v_tenant IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'BOM غير موجودة'); END IF;

    DELETE FROM public.mfg_bom_exploded WHERE bom_id = p_bom_id;

    WITH RECURSIVE tree AS (
        SELECT b.id AS bom_id, 1::numeric AS mult, 0 AS depth, ARRAY[b.id] AS visited
        FROM public.mfg_boms b WHERE b.id = p_bom_id
        UNION ALL
        SELECT bl.component_bom_id,
               t.mult * (
                   (CASE
                      WHEN pb.bom_basis='formula' AND bl.formula_pct IS NOT NULL AND bl.qty_per_unit IS NULL THEN bl.formula_pct/100.0
                      WHEN pb.bom_basis='formula' AND bl.qty_per_unit IS NOT NULL THEN bl.qty_per_unit / NULLIF(pb.quantity,0)
                      ELSE COALESCE(bl.qty_per_unit,0)
                    END)
                   / (COALESCE(NULLIF(pb.yield_pct,0),100)/100.0)
                   * (1 + COALESCE(bl.scrap_pct,0)/100.0)
               ),
               t.depth + 1, t.visited || bl.component_bom_id
        FROM tree t
        JOIN public.mfg_boms pb ON pb.id = t.bom_id
        JOIN public.mfg_bom_lines bl ON bl.bom_id = t.bom_id
        WHERE bl.component_bom_id IS NOT NULL
          AND t.depth < 10
          AND NOT (bl.component_bom_id = ANY(t.visited))
    ),
    leaves AS (
        SELECT bl.component_product_id AS cid,
               SUM( t.mult * (
                   (CASE
                      WHEN pb.bom_basis='formula' AND bl.formula_pct IS NOT NULL AND bl.qty_per_unit IS NULL THEN bl.formula_pct/100.0
                      WHEN pb.bom_basis='formula' AND bl.qty_per_unit IS NOT NULL THEN bl.qty_per_unit / NULLIF(pb.quantity,0)
                      ELSE COALESCE(bl.qty_per_unit,0)
                    END)
                   / (COALESCE(NULLIF(pb.yield_pct,0),100)/100.0)
                   * (1 + COALESCE(bl.scrap_pct,0)/100.0)
               ) ) AS qpu
        FROM tree t
        JOIN public.mfg_boms pb ON pb.id = t.bom_id
        JOIN public.mfg_bom_lines bl ON bl.bom_id = t.bom_id
        WHERE bl.component_product_id IS NOT NULL AND bl.component_bom_id IS NULL
        GROUP BY bl.component_product_id
    )
    INSERT INTO public.mfg_bom_exploded (tenant_id, company_id, bom_id, component_product_id, qty_per_unit, regenerated_at)
    SELECT v_tenant, v_company, p_bom_id, cid, round(qpu,8), now() FROM leaves WHERE cid IS NOT NULL AND qpu > 0;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'bom_id', p_bom_id, 'leaf_rows', v_cnt);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

-- ── cascade: rebuild this BOM + every parent that uses it as a component ──────
CREATE OR REPLACE FUNCTION public.mfg_rebuild_bom_cascade(p_bom_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
DECLARE
    v_queue uuid[] := ARRAY[p_bom_id];
    v_seen  uuid[] := ARRAY[]::uuid[];
    v_cur   uuid;
    v_par   uuid;
    v_guard int := 0;
BEGIN
    WHILE array_length(v_queue,1) > 0 AND v_guard < 500 LOOP
        v_guard := v_guard + 1;
        v_cur := v_queue[1];
        v_queue := v_queue[2:];
        IF v_cur = ANY(v_seen) THEN CONTINUE; END IF;
        v_seen := v_seen || v_cur;
        PERFORM public.rebuild_bom_explosion(v_cur);
        FOR v_par IN
            SELECT DISTINCT bl.bom_id FROM public.mfg_bom_lines bl
             WHERE bl.component_bom_id = v_cur AND bl.bom_id <> v_cur
        LOOP
            IF NOT (v_par = ANY(v_seen)) THEN v_queue := v_queue || v_par; END IF;
        END LOOP;
    END LOOP;
END; $function$;

CREATE OR REPLACE FUNCTION public.mfg_bom_explosion_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
AS $function$
DECLARE v_bom uuid;
BEGIN
    IF TG_TABLE_NAME = 'mfg_bom_lines' THEN
        v_bom := COALESCE(NEW.bom_id, OLD.bom_id);
    ELSE
        v_bom := COALESCE(NEW.id, OLD.id);
    END IF;
    IF v_bom IS NOT NULL THEN PERFORM public.mfg_rebuild_bom_cascade(v_bom); END IF;
    RETURN NULL;
END; $function$;

DROP TRIGGER IF EXISTS trg_mfg_bom_lines_explode ON public.mfg_bom_lines;
CREATE TRIGGER trg_mfg_bom_lines_explode
    AFTER INSERT OR UPDATE OR DELETE ON public.mfg_bom_lines
    FOR EACH ROW EXECUTE FUNCTION public.mfg_bom_explosion_trg();

DROP TRIGGER IF EXISTS trg_mfg_boms_explode ON public.mfg_boms;
CREATE TRIGGER trg_mfg_boms_explode
    AFTER INSERT OR UPDATE OF bom_basis, yield_pct, quantity OR DELETE ON public.mfg_boms
    FOR EACH ROW EXECUTE FUNCTION public.mfg_bom_explosion_trg();

-- ============================================================================
-- mrp_suggestions — pure read planning helper (Katana-style, not heavy MRP)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mrp_suggestions(p_company_id uuid, p_warehouse_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','extensions','pg_temp'
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

COMMENT ON TABLE public.mfg_bom_exploded IS 'P4a: denormalized fully-exploded leaf requirements per 1 FG unit; maintained by trg_mfg_bom_lines_explode / trg_mfg_boms_explode via mfg_rebuild_bom_cascade.';
