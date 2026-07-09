-- ════════════════════════════════════════════════════════════════════════
-- 📱 TexaCore Console — ROUND 4: warehouse browsing + containers
-- ════════════════════════════════════════════════════════════════════════
-- Date: 2026-07-07
-- Author: Console server side (reviewed & applied by Fable — NOT auto-applied)
--
-- CONVENTIONS (identical to 20260706a/b/c)
--   • SECURITY DEFINER + SET search_path = public, pg_temp.
--   • Read fns return {ok:false,error:'forbidden'}; write fns RAISE.
--   • assert_can_access_company on every company (direct or resolved).
--   • Reuses LIVE helpers: console_is_admin / console_has_perm /
--     console_has_role / console_special / console_scope_warehouses /
--     console_scope_cash_accounts.
--   • REVOKE PUBLIC/anon + GRANT authenticated loop; BEGIN/COMMIT; contract.
--
-- GATES (Feras's rules)
--   WAREHOUSE READ : admin OR inventory|warehouse read OR inventory|warehouse write
--   COST GATE      : admin OR console_special('can_view_cost_prices')
--                    — cost/value/price fields are NULL without it (keeper sees
--                    qty/locations only; manager sees everything).
--   CONTAINER GATE : admin OR console_special('can_manage_containers')
--                    OR purchases read OR warehouse|inventory write
--   PAYMENT GATE   : treasury|accounting write OR cashier (same as
--                    create_payment_voucher) — PLUS container gate.
--   WAREHOUSE SCOPE: console_scope_warehouses non-empty => listings restricted
--                    to those warehouses; detail calls for out-of-scope
--                    warehouses => forbidden.
--
-- LIVE-DB FACTS — verified against supabase/backup/2026-03-07/full_schema.sql
-- (live dump, most reliable) + post-dump migrations + src usage. The explorer
-- map in the task DRIFTED from live in several places; the live shapes win:
--   warehouses(id, company_id, branch_id, code, name NOT NULL, name_en, name_ar,
--       warehouse_type CHECK(regular|offline_market|van), address, is_active,
--       manager_id)                    ⚠️ NO `city` column — address is closest.
--   ⚠️ warehouse_locations: created only in 20260527 (aisle/rack/shelf/bin) and
--       NOT wired to stock/rolls anywhere. The REAL location system is
--       `bin_locations`(id, warehouse_id, code NOT NULL, name, name_ar, name_en,
--       row_code, column_code, shelf_code, is_active, company_id) referenced by
--       fabric_rolls.bin_location_id (src joins bin_location:bin_locations(code)).
--   inventory_stock (LIVE): material_id, warehouse_id, quantity_on_hand,
--       average_cost, last_cost, company_id, tenant_id.
--       ⚠️ NO location_id, NO quantity_reserved, NO quantity_available, NO
--       total_value in the live table (the 00007 file lies). Reserved qty lives
--       on fabric_rolls.reserved_length; value = qty * average_cost.
--   fabric_rolls: company_id, material_id, warehouse_id, roll_number NOT NULL,
--       barcode, current_length NOT NULL, reserved_length,
--       available_length GENERATED, status (available/reserved/sold/...),
--       bin_location_id.               ⚠️ NO location_id / location_code columns.
--   containers: company_id, tenant_id, container_number NOT NULL, container_name,
--       shipment_number, supplier_id, container_size, container_type,
--       origin_country, port_of_loading, port_of_discharge, shipping_company,
--       vessel_name, bill_of_lading, eta, etd, departure_date, arrival_date,
--       expected_arrival_date, received_date, order_date,
--       status CHECK (draft|booked|loading|in_transit|at_port|customs|cleared|
--                     in_receiving|received|closed),
--       currency, total_cost, total_purchase_value, total_landed_cost,
--       cost_allocation_method, is_cost_finalized,
--       receiving_warehouse_id         ⚠️ NO plain `warehouse_id` column.
--   container_items: container_id, material_id, color_id, item_description,
--       expected_quantity, received_quantity, expected_rolls, received_rolls,
--       unit, unit_cost NOT NULL, final_unit_cost, allocated_costs.
--   container_expenses: container_id, tenant_id, company_id,
--       expense_type NOT NULL, description, vendor_name, vendor_id,
--       vendor_account_id, expense_account_id, amount NOT NULL(!) ,
--       actual_amount, expected_amount, currency_code, exchange_rate,
--       invoice_number, invoice_date, invoice_status, payment_status
--       (default 'unpaid'), is_paid, paid_amount, paid_date, payment_reference,
--       journal_entry_id, is_posted, notes.
--       ⚠️ NO triggers on container_expenses (verified in dump: only indexes +
--       RLS policies). The web creates the JE CLIENT-SIDE when posting actual
--       expenses (ContainerExpensesTab.tsx:588-609 insert, then
--       journalEntriesService) — so the console INSERTS UNPOSTED
--       (is_posted=false, no journal_entry_id) and the accountant finalizes in
--       the web. Allowed expense_type values (ContainerExpensesTab.tsx:124-137):
--       freight, customs, tax, insurance, handling, transport, clearance,
--       storage, inspection, documentation, demurrage, other.
--   container_reservations: reservation_number, customer_id, customer_name,
--       container_id, material_id, item_description, reserved_quantity, unit,
--       status (pending/confirmed/delivered/cancelled), company_id.
--   purchase_receipts: receipt_number, receipt_date, status, container_id ✓.
--   purchase_invoices: invoice_number, invoice_date, total_amount, status,
--       container_id ✓ (both actively used by the web; purchase_transactions is
--       a parallel newer flow with its own container_id — not in this contract).
--   payment_vouchers.container_id ✓ exists (dump + idx_payment_vouchers_container_id).
--   Confirmation center: NO 'container_expense' item type exists in
--       get_confirmation_inbox / execute_confirmation_item — so we add NOTHING
--       to console_execute_item. Unpaid expenses are visible only here.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- helper: console_container_gate(user) — shared container-module gate
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_container_gate(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
    SELECT public.console_is_admin(p_user)
        OR public.console_special(p_user, 'can_manage_containers')
        OR public.console_has_perm(p_user, 'purchases', 'read')
        OR public.console_has_perm(p_user, 'warehouse', 'write')
        OR public.console_has_perm(p_user, 'inventory', 'write');
$$;

-- helper: console_warehouse_read(user)
CREATE OR REPLACE FUNCTION public.console_warehouse_read(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
    SELECT public.console_is_admin(p_user)
        OR public.console_has_perm(p_user, 'inventory', 'read')
        OR public.console_has_perm(p_user, 'inventory', 'write')
        OR public.console_has_perm(p_user, 'warehouse', 'read')
        OR public.console_has_perm(p_user, 'warehouse', 'write');
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 1) get_console_warehouses(company) — warehouse cards
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_warehouses(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_show_cost boolean;
    v_wh_scope uuid[];
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    IF NOT public.console_warehouse_read(v_user) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    v_admin := public.console_is_admin(v_user);
    v_show_cost := v_admin OR public.console_special(v_user, 'can_view_cost_prices');
    v_wh_scope := public.console_scope_warehouses(v_user);

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.code), '[]'::jsonb) INTO v_items FROM (
        SELECT
            w.id,
            COALESCE(w.code,'') AS code,
            COALESCE(NULLIF(w.name_ar,''), NULLIF(w.name,''), NULLIF(w.name_en,''), w.code) AS name,
            COALESCE(w.warehouse_type,'regular') AS type,
            COALESCE(w.address,'') AS city,   -- ⚠️ live has no city column; address is the closest field
            COALESCE(w.is_active, true) AS is_active,
            COALESCE(agg.materials_count, 0) AS materials_count,
            round(COALESCE(agg.total_qty, 0), 3) AS total_qty,
            CASE WHEN v_show_cost THEN round(COALESCE(agg.total_value, 0), 2) ELSE NULL END AS total_value
        FROM warehouses w
        LEFT JOIN LATERAL (
            SELECT COUNT(DISTINCT s.material_id) FILTER (WHERE COALESCE(s.quantity_on_hand,0) > 0) AS materials_count,
                   SUM(COALESCE(s.quantity_on_hand,0)) AS total_qty,
                   SUM(COALESCE(s.quantity_on_hand,0) * COALESCE(s.average_cost,0)) AS total_value
            FROM inventory_stock s
            WHERE s.warehouse_id = w.id AND s.material_id IS NOT NULL
        ) agg ON true
        WHERE w.company_id = p_company_id
          AND (v_wh_scope = ARRAY[]::uuid[] OR w.id = ANY(v_wh_scope))
    ) t;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) get_console_warehouse_detail(company, warehouse, query?, limit)
--    Stock by material in one warehouse. locations = distinct bin_locations.code
--    reached via fabric_rolls.bin_location_id (live inventory_stock has NO
--    location dimension). qty_reserved from fabric_rolls.reserved_length.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_warehouse_detail(
    p_company_id uuid, p_warehouse_id uuid, p_query text DEFAULT NULL, p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_show_cost boolean;
    v_wh_scope uuid[];
    v_wh_company uuid;
    v_q text := NULLIF(trim(COALESCE(p_query,'')), '');
    v_lim int := LEAST(GREATEST(COALESCE(p_limit,50),1), 200);
    v_warehouse jsonb; v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    IF NOT public.console_warehouse_read(v_user) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    SELECT company_id INTO v_wh_company FROM warehouses WHERE id = p_warehouse_id;
    IF v_wh_company IS NULL OR v_wh_company <> p_company_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    -- scope enforcement: out-of-scope warehouse detail => forbidden
    v_wh_scope := public.console_scope_warehouses(v_user);
    IF v_wh_scope <> ARRAY[]::uuid[] AND NOT (p_warehouse_id = ANY(v_wh_scope)) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    v_admin := public.console_is_admin(v_user);
    v_show_cost := v_admin OR public.console_special(v_user, 'can_view_cost_prices');

    SELECT jsonb_build_object(
             'id', w.id,
             'code', COALESCE(w.code,''),
             'name', COALESCE(NULLIF(w.name_ar,''), NULLIF(w.name,''), NULLIF(w.name_en,''), w.code),
             'type', COALESCE(w.warehouse_type,'regular'),
             'city', COALESCE(w.address,''),
             'locations_count', (SELECT COUNT(*) FROM bin_locations b
                                 WHERE b.warehouse_id = w.id AND COALESCE(b.is_active,true)))
      INTO v_warehouse
      FROM warehouses w WHERE w.id = p_warehouse_id;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.name), '[]'::jsonb) INTO v_items FROM (
        SELECT
            m.id AS material_id,
            COALESCE(m.code,'') AS code,
            COALESCE(NULLIF(m.name_ar,''), NULLIF(m.name_en,''), m.code) AS name,
            COALESCE(m.unit,'') AS unit,
            round(COALESCE(st.qty,0),3) AS qty_on_hand,
            round(COALESCE(rr.reserved,0),3) AS qty_reserved,
            round(COALESCE(st.qty,0) - COALESCE(rr.reserved,0),3) AS qty_available,
            COALESCE(rr.locations, '[]'::jsonb) AS locations,
            CASE WHEN v_show_cost THEN round(COALESCE(st.avg_cost,0),4) ELSE NULL END AS avg_cost,
            CASE WHEN v_show_cost THEN round(COALESCE(st.qty,0) * COALESCE(st.avg_cost,0),2) ELSE NULL END AS value
        FROM (
            SELECT s.material_id,
                   SUM(COALESCE(s.quantity_on_hand,0)) AS qty,
                   CASE WHEN SUM(COALESCE(s.quantity_on_hand,0)) > 0
                        THEN SUM(COALESCE(s.quantity_on_hand,0)*COALESCE(s.average_cost,0))
                             / SUM(COALESCE(s.quantity_on_hand,0))
                        ELSE 0 END AS avg_cost
            FROM inventory_stock s
            WHERE s.warehouse_id = p_warehouse_id AND s.material_id IS NOT NULL
            GROUP BY s.material_id
        ) st
        JOIN fabric_materials m ON m.id = st.material_id AND m.company_id = p_company_id
        LEFT JOIN LATERAL (
            SELECT SUM(COALESCE(r.reserved_length,0)) AS reserved,
                   COALESCE(jsonb_agg(DISTINCT b.code) FILTER (WHERE NULLIF(b.code,'') IS NOT NULL), '[]'::jsonb) AS locations
            FROM fabric_rolls r LEFT JOIN bin_locations b ON b.id = r.bin_location_id
            WHERE r.material_id = m.id AND r.warehouse_id = p_warehouse_id
              AND COALESCE(r.current_length,0) > 0
        ) rr ON true
        WHERE COALESCE(st.qty,0) <> 0
          AND (v_q IS NULL OR m.name_ar ILIKE '%'||v_q||'%' OR m.name_en ILIKE '%'||v_q||'%'
               OR m.code ILIKE '%'||v_q||'%')
        ORDER BY COALESCE(NULLIF(m.name_ar,''), m.name_en, m.code)
        LIMIT v_lim
    ) t;

    RETURN jsonb_build_object('ok', true, 'warehouse', v_warehouse, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) get_console_material_locations(company, warehouse, material)
--    Bins (via live bin_locations) + individual rolls. Rolls limited to those
--    with remaining length (>0) — sold/empty history would flood the list.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_material_locations(
    p_company_id uuid, p_warehouse_id uuid, p_material_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_wh_scope uuid[];
    v_wh_company uuid; v_mat_company uuid;
    v_locations jsonb; v_rolls jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    IF NOT public.console_warehouse_read(v_user) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    SELECT company_id INTO v_wh_company FROM warehouses WHERE id = p_warehouse_id;
    SELECT company_id INTO v_mat_company FROM fabric_materials WHERE id = p_material_id;
    IF v_wh_company IS NULL OR v_wh_company <> p_company_id
       OR v_mat_company IS NULL OR v_mat_company <> p_company_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    v_wh_scope := public.console_scope_warehouses(v_user);
    IF v_wh_scope <> ARRAY[]::uuid[] AND NOT (p_warehouse_id = ANY(v_wh_scope)) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    -- bins holding this material (rolls with remaining length), incl. un-binned bucket
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.code), '[]'::jsonb) INTO v_locations FROM (
        SELECT
            b.id AS location_id,
            COALESCE(b.code,'') AS code,
            COALESCE(NULLIF(b.name_ar,''), NULLIF(b.name,''), NULLIF(b.name_en,''), b.code, '') AS name,
            round(SUM(COALESCE(r.current_length,0)),3) AS qty
        FROM fabric_rolls r LEFT JOIN bin_locations b ON b.id = r.bin_location_id
        WHERE r.material_id = p_material_id AND r.warehouse_id = p_warehouse_id
          AND COALESCE(r.current_length,0) > 0
        GROUP BY b.id, b.code, b.name, b.name_ar, b.name_en
    ) t;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.roll_number), '[]'::jsonb) INTO v_rolls FROM (
        SELECT
            r.id AS roll_id,
            COALESCE(r.roll_number,'') AS roll_number,
            COALESCE(r.barcode,'') AS barcode,
            round(COALESCE(r.current_length,0),3) AS current_length,
            round(COALESCE(r.reserved_length,0),3) AS reserved_length,
            COALESCE(r.status,'') AS status,
            COALESCE(b.code,'') AS location_code
        FROM fabric_rolls r LEFT JOIN bin_locations b ON b.id = r.bin_location_id
        WHERE r.material_id = p_material_id AND r.warehouse_id = p_warehouse_id
          AND COALESCE(r.current_length,0) > 0
        ORDER BY r.roll_number
        LIMIT 100
    ) t;

    RETURN jsonb_build_object('ok', true,
        'locations', COALESCE(v_locations,'[]'::jsonb),
        'rolls', COALESCE(v_rolls,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 4) get_console_containers(company, status?, query?, limit) — container list
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_containers(
    p_company_id uuid, p_status text DEFAULT NULL, p_query text DEFAULT NULL, p_limit int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_show_cost boolean;
    v_q text := NULLIF(trim(COALESCE(p_query,'')), '');
    v_status text := NULLIF(trim(COALESCE(p_status,'')), '');
    v_lim int := LEAST(GREATEST(COALESCE(p_limit,30),1), 100);
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    IF NOT public.console_container_gate(v_user) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    v_admin := public.console_is_admin(v_user);
    v_show_cost := v_admin OR public.console_special(v_user, 'can_view_cost_prices');

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_items FROM (
        SELECT
            c.id,
            COALESCE(c.container_number,'') AS container_number,
            COALESCE(c.container_name,'') AS name,
            COALESCE(s.name_ar, s.name_en, '') AS supplier_name,
            COALESCE(c.status,'') AS status,
            COALESCE(c.eta, c.expected_arrival_date) AS eta,
            COALESCE(c.etd, c.departure_date) AS etd,
            c.arrival_date,
            c.received_date,
            COALESCE(c.port_of_loading,'') AS port_of_loading,
            COALESCE(c.port_of_discharge,'') AS port_of_discharge,
            COALESCE(c.vessel_name,'') AS vessel_name,
            COALESCE(c.shipping_company,'') AS shipping_company,
            COALESCE(c.container_size,'') AS size,
            COALESCE(c.container_type,'') AS type,
            (SELECT COUNT(*) FROM container_items ci WHERE ci.container_id = c.id) AS items_count,
            (SELECT COUNT(*) FROM container_expenses ce WHERE ce.container_id = c.id) AS expenses_count,
            CASE WHEN v_show_cost THEN round(COALESCE(c.total_landed_cost,0),2) ELSE NULL END AS total_landed_cost,
            COALESCE(c.currency,'') AS currency,
            c.created_at
        FROM containers c LEFT JOIN suppliers s ON s.id = c.supplier_id
        WHERE c.company_id = p_company_id
          AND (v_status IS NULL OR c.status = v_status)
          AND (v_q IS NULL
               OR c.container_number ILIKE '%'||v_q||'%'
               OR c.container_name ILIKE '%'||v_q||'%'
               OR c.shipment_number ILIKE '%'||v_q||'%'
               OR c.vessel_name ILIKE '%'||v_q||'%'
               OR s.name_ar ILIKE '%'||v_q||'%'
               OR s.name_en ILIKE '%'||v_q||'%')
        ORDER BY c.created_at DESC
        LIMIT v_lim
    ) t;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 5) get_console_container(company, container) — full container drill-down
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_container(p_company_id uuid, p_container_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_show_cost boolean; v_show_expenses boolean;
    v_c_company uuid;
    v_container jsonb; v_items jsonb; v_expenses jsonb;
    v_receipts jsonb; v_invoices jsonb; v_reservations jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    IF NOT public.console_container_gate(v_user) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    SELECT company_id INTO v_c_company FROM containers WHERE id = p_container_id;
    IF v_c_company IS NULL OR v_c_company <> p_company_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    v_admin := public.console_is_admin(v_user);
    v_show_cost := v_admin OR public.console_special(v_user, 'can_view_cost_prices');
    -- expenses are cost data: cost gate OR accounting read
    v_show_expenses := v_show_cost OR public.console_has_perm(v_user,'accounting','read');

    SELECT jsonb_build_object(
             'id', c.id,
             'container_number', COALESCE(c.container_number,''),
             'name', COALESCE(c.container_name,''),
             'shipment_number', COALESCE(c.shipment_number,''),
             'status', COALESCE(c.status,''),
             'supplier', CASE WHEN c.supplier_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', s.id,
                 'name', COALESCE(s.name_ar, s.name_en, ''),
                 'phone', COALESCE(NULLIF(s.phone,''), NULLIF(s.mobile,''), '')) END,
             'warehouse_name', COALESCE(NULLIF(w.name_ar,''), NULLIF(w.name,''), NULLIF(w.name_en,''), ''),
             'size', COALESCE(c.container_size,''),
             'type', COALESCE(c.container_type,''),
             'origin_country', COALESCE(c.origin_country,''),
             'port_of_loading', COALESCE(c.port_of_loading,''),
             'port_of_discharge', COALESCE(c.port_of_discharge,''),
             'shipping_company', COALESCE(c.shipping_company,''),
             'vessel_name', COALESCE(c.vessel_name,''),
             'bill_of_lading', COALESCE(c.bill_of_lading,''),
             'order_date', c.order_date,
             'etd', COALESCE(c.etd, c.departure_date),
             'eta', COALESCE(c.eta, c.expected_arrival_date),
             'departure_date', c.departure_date,
             'arrival_date', COALESCE(c.arrival_date, c.actual_arrival_date),
             'received_date', c.received_date,
             'cost_allocation_method', COALESCE(c.cost_allocation_method,''),
             'is_cost_finalized', COALESCE(c.is_cost_finalized,false),
             'currency', COALESCE(c.currency,''),
             'total_cost', CASE WHEN v_show_cost THEN round(COALESCE(c.total_cost,0),2) ELSE NULL END,
             'total_purchase_value', CASE WHEN v_show_cost THEN round(COALESCE(c.total_purchase_value,0),2) ELSE NULL END,
             'total_landed_cost', CASE WHEN v_show_cost THEN round(COALESCE(c.total_landed_cost,0),2) ELSE NULL END)
      INTO v_container
      FROM containers c
      LEFT JOIN suppliers s ON s.id = c.supplier_id
      LEFT JOIN warehouses w ON w.id = c.receiving_warehouse_id
      WHERE c.id = p_container_id;

    -- items (costs gated)
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_items FROM (
        SELECT
            ci.id,
            ci.material_id,
            COALESCE(NULLIF(m.name_ar,''), NULLIF(m.name_en,''), NULLIF(ci.item_description,''), '') AS name,
            COALESCE(m.code,'') AS code,
            COALESCE(ci.item_description,'') AS description,
            round(COALESCE(ci.expected_quantity,0),4) AS expected_quantity,
            round(COALESCE(ci.received_quantity,0),4) AS received_quantity,
            COALESCE(ci.unit,'') AS unit,
            COALESCE(ci.expected_rolls,0) AS expected_rolls,
            COALESCE(ci.received_rolls,0) AS received_rolls,
            CASE WHEN v_show_cost THEN round(COALESCE(ci.unit_cost,0),4) ELSE NULL END AS unit_cost,
            CASE WHEN v_show_cost THEN round(COALESCE(ci.final_unit_cost,0),4) ELSE NULL END AS final_unit_cost
        FROM container_items ci LEFT JOIN fabric_materials m ON m.id = ci.material_id
        WHERE ci.container_id = p_container_id
        ORDER BY ci.created_at
    ) t;

    -- expenses: included ONLY behind the expense gate
    IF v_show_expenses THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at), '[]'::jsonb) INTO v_expenses FROM (
            SELECT
                ce.id,
                COALESCE(ce.expense_type,'') AS expense_type,
                COALESCE(ce.description,'') AS description,
                COALESCE(ce.vendor_name,'') AS vendor_name,
                round(COALESCE(ce.expected_amount,0),2) AS expected_amount,
                round(COALESCE(ce.actual_amount, ce.amount, 0),2) AS actual_amount,
                COALESCE(ce.currency_code,'') AS currency_code,
                COALESCE(ce.invoice_number,'') AS invoice_number,
                ce.invoice_date,
                COALESCE(ce.payment_status,'unpaid') AS payment_status,
                COALESCE(ce.is_posted,false) AS is_posted,
                ce.created_at
            FROM container_expenses ce
            WHERE ce.container_id = p_container_id
        ) t;
    ELSE
        v_expenses := '[]'::jsonb;
    END IF;

    -- linked purchase receipts
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.date DESC), '[]'::jsonb) INTO v_receipts FROM (
        SELECT pr.id, COALESCE(pr.receipt_number,'') AS number,
               pr.receipt_date AS date, COALESCE(pr.status,'') AS status
        FROM purchase_receipts pr
        WHERE pr.container_id = p_container_id AND pr.company_id = p_company_id
    ) t;

    -- linked purchase invoices (total cost-gated)
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.date DESC), '[]'::jsonb) INTO v_invoices FROM (
        SELECT pi.id, COALESCE(pi.invoice_number,'') AS number,
               pi.invoice_date AS date,
               CASE WHEN v_show_cost THEN round(COALESCE(pi.total_amount,0),2) ELSE NULL END AS total,
               COALESCE(pi.status,'') AS status
        FROM purchase_invoices pi
        WHERE pi.container_id = p_container_id AND pi.company_id = p_company_id
    ) t;

    -- customer reservations against this container
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_reservations FROM (
        SELECT
            cr.id,
            COALESCE(cr.reservation_number,'') AS reservation_number,
            COALESCE(NULLIF(cr.customer_name,''), cu.name_ar, cu.name_en, '') AS customer_name,
            COALESCE(NULLIF(m.name_ar,''), NULLIF(m.name_en,''), NULLIF(cr.item_description,''), '') AS material_name,
            round(COALESCE(cr.reserved_quantity,0),3) AS reserved_quantity,
            COALESCE(cr.unit,'') AS unit,
            COALESCE(cr.status,'') AS status
        FROM container_reservations cr
        LEFT JOIN customers cu ON cu.id = cr.customer_id
        LEFT JOIN fabric_materials m ON m.id = cr.material_id
        WHERE cr.container_id = p_container_id
        ORDER BY cr.reservation_date DESC NULLS LAST
    ) t;

    RETURN jsonb_build_object('ok', true,
        'container', v_container,
        'items', COALESCE(v_items,'[]'::jsonb),
        'expenses', COALESCE(v_expenses,'[]'::jsonb),
        'receipts', COALESCE(v_receipts,'[]'::jsonb),
        'invoices', COALESCE(v_invoices,'[]'::jsonb),
        'reservations', COALESCE(v_reservations,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 6) console_add_container_expense — WRITE (RAISES)
--    Mirrors the web's actual-expense insert (ContainerExpensesTab.tsx:588-609)
--    EXCEPT it does NOT create a journal entry: no trigger exists on
--    container_expenses (verified) and the web builds the JE client-side, so
--    the console leaves is_posted=false / journal_entry_id NULL — the
--    accountant finalizes/post in the web flow. amount is NOT NULL live, so it
--    is set alongside actual_amount. payment_status defaults 'unpaid'.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_add_container_expense(
    p_container_id uuid, p_expense_type text, p_amount numeric,
    p_vendor_name text DEFAULT NULL, p_supplier_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_can_pay boolean;
    v_company uuid; v_tenant uuid; v_currency text;
    v_supp_company uuid; v_supp_name text;
    v_expense_id uuid;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
    IF p_expense_type IS NULL OR p_expense_type NOT IN
       ('freight','customs','tax','insurance','handling','transport','clearance',
        'storage','inspection','documentation','demurrage','other') THEN
        RAISE EXCEPTION 'invalid_expense_type';
    END IF;

    SELECT company_id, tenant_id, COALESCE(NULLIF(currency,''),'USD')
      INTO v_company, v_tenant, v_currency
      FROM containers WHERE id = p_container_id;
    IF v_company IS NULL THEN RAISE EXCEPTION 'container_not_found'; END IF;
    PERFORM assert_can_access_company(v_company);   -- raises on cross-tenant

    IF NOT public.console_container_gate(v_user) THEN
        RAISE EXCEPTION 'forbidden: container permission required';
    END IF;
    v_can_pay := public.console_is_admin(v_user)
                 OR public.console_has_perm(v_user,'treasury','write')
                 OR public.console_has_perm(v_user,'accounting','write')
                 OR public.console_has_role(v_user,'cashier');
    IF NOT v_can_pay THEN RAISE EXCEPTION 'forbidden: payment permission required'; END IF;

    -- optional supplier link must belong to this company
    IF p_supplier_id IS NOT NULL THEN
        SELECT company_id, COALESCE(NULLIF(name_ar,''), name_en)
          INTO v_supp_company, v_supp_name
          FROM suppliers WHERE id = p_supplier_id;
        IF v_supp_company IS NULL OR v_supp_company <> v_company THEN
            RAISE EXCEPTION 'invalid_supplier';
        END IF;
    END IF;

    INSERT INTO container_expenses(
        container_id, tenant_id, company_id,
        expense_type, description, vendor_name, vendor_id,
        amount, actual_amount, currency_code, exchange_rate,
        payment_status, is_posted, notes, created_at, updated_at
    ) VALUES (
        p_container_id, v_tenant, v_company,
        p_expense_type, NULLIF(p_notes,''),
        COALESCE(NULLIF(p_vendor_name,''), v_supp_name),
        p_supplier_id,
        round(p_amount,2), round(p_amount,2), v_currency, 1,
        'unpaid', false, NULLIF(p_notes,''), now(), now()
    ) RETURNING id INTO v_expense_id;

    RETURN jsonb_build_object('ok', true, 'expense_id', v_expense_id);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 7) console_pay_container_expense — WRITE (RAISES)
--    Creates a payment_voucher EXACTLY like create_payment_voucher (20260706a)
--    with payment_vouchers.container_id set, then marks the expense paid.
--    PAYEE RESOLUTION (correctness over convenience): the voucher JE trigger
--    (create_payment_voucher_journal_entry, rewritten in 20260706a §6b) debits
--    suppliers.payable_account_id of NEW.supplier_id, falling back to a GENERIC
--    payable account when the supplier is NULL — which would post a partyless
--    AP debit for a free-text vendor. That is wrong accounting, so we REQUIRE a
--    linked supplier: expense.vendor_id, else a supplier whose
--    payable_account_id = expense.vendor_account_id in the same company; else
--    RAISE 'vendor_not_linked' (link the vendor in the web first).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_pay_container_expense(
    p_expense_id uuid, p_cash_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_can_pay boolean;
    v_company uuid; v_tenant uuid;
    v_container uuid; v_container_currency text;
    v_amount numeric; v_currency text; v_pay_status text;
    v_vendor_id uuid; v_vendor_acct uuid;
    v_supplier uuid; v_supp_name text;
    v_scoped uuid[];
    v_is_cash boolean; v_is_bank boolean; v_acct_company uuid;
    v_status text; v_do_post boolean; v_method text;
    v_voucher_id uuid; v_number text;
    v_acct uuid := p_cash_account_id;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

    SELECT ce.container_id, ce.company_id, ce.tenant_id,
           COALESCE(ce.actual_amount, ce.expected_amount, ce.amount),
           NULLIF(ce.currency_code,''),
           COALESCE(ce.payment_status,'unpaid'),
           ce.vendor_id, ce.vendor_account_id
      INTO v_container, v_company, v_tenant, v_amount, v_currency,
           v_pay_status, v_vendor_id, v_vendor_acct
      FROM container_expenses ce WHERE ce.id = p_expense_id;
    IF v_container IS NULL AND v_company IS NULL THEN RAISE EXCEPTION 'expense_not_found'; END IF;

    -- company can come from the expense row or its container
    IF v_company IS NULL THEN
        SELECT company_id, tenant_id INTO v_company, v_tenant FROM containers WHERE id = v_container;
    END IF;
    IF v_company IS NULL THEN RAISE EXCEPTION 'expense_company_unknown'; END IF;
    PERFORM assert_can_access_company(v_company);

    IF v_pay_status = 'paid' THEN RAISE EXCEPTION 'already_paid'; END IF;
    IF COALESCE(v_amount,0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

    v_admin := public.console_is_admin(v_user);
    IF NOT public.console_container_gate(v_user) THEN
        RAISE EXCEPTION 'forbidden: container permission required';
    END IF;
    v_can_pay := v_admin
                 OR public.console_has_perm(v_user,'treasury','write')
                 OR public.console_has_perm(v_user,'accounting','write')
                 OR public.console_has_role(v_user,'cashier');
    IF NOT v_can_pay THEN RAISE EXCEPTION 'forbidden: payment permission required'; END IF;

    -- ── payee resolution: linked supplier REQUIRED ──
    IF v_vendor_id IS NOT NULL THEN
        SELECT id, COALESCE(NULLIF(name_ar,''), name_en) INTO v_supplier, v_supp_name
          FROM suppliers WHERE id = v_vendor_id AND company_id = v_company;
    END IF;
    IF v_supplier IS NULL AND v_vendor_acct IS NOT NULL THEN
        SELECT id, COALESCE(NULLIF(name_ar,''), name_en) INTO v_supplier, v_supp_name
          FROM suppliers WHERE payable_account_id = v_vendor_acct AND company_id = v_company
          LIMIT 1;
    END IF;
    IF v_supplier IS NULL THEN
        RAISE EXCEPTION 'vendor_not_linked: link the expense vendor to a supplier in the web before paying';
    END IF;

    -- ── cash account resolution — identical to create_payment_voucher ──
    v_scoped := public.console_scope_cash_accounts(v_user);
    IF v_acct IS NULL THEN
        SELECT id INTO v_acct FROM chart_of_accounts
        WHERE company_id = v_company
          AND (COALESCE(is_cash_account,false) OR COALESCE(is_bank_account,false))
          AND COALESCE(is_group,false) = false
          AND (v_scoped = ARRAY[]::uuid[] OR id = ANY(v_scoped))
        ORDER BY account_code LIMIT 1;
        IF v_acct IS NULL THEN RAISE EXCEPTION 'no_cash_account_available'; END IF;
    END IF;

    SELECT COALESCE(is_cash_account,false), COALESCE(is_bank_account,false), company_id
      INTO v_is_cash, v_is_bank, v_acct_company
      FROM chart_of_accounts WHERE id = v_acct;
    IF v_acct_company IS NULL OR v_acct_company <> v_company THEN RAISE EXCEPTION 'invalid_cash_account'; END IF;
    IF NOT (v_is_cash OR v_is_bank) THEN RAISE EXCEPTION 'not_a_cash_account'; END IF;
    IF v_scoped <> ARRAY[]::uuid[] AND NOT (v_acct = ANY(v_scoped)) THEN
        RAISE EXCEPTION 'cash_account_out_of_scope';
    END IF;

    -- posting behavior by operating mode — identical to create_payment_voucher
    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = v_company), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));
    v_status := CASE WHEN v_do_post THEN 'confirmed' ELSE 'draft' END;
    v_method := CASE WHEN v_is_cash THEN 'cash' ELSE 'bank_transfer' END;

    SELECT COALESCE(NULLIF(currency,''),'USD') INTO v_container_currency
      FROM containers WHERE id = v_container;
    v_currency := COALESCE(v_currency, v_container_currency,
                           (SELECT default_currency FROM companies WHERE id = v_company), 'USD');

    v_number := 'PAY-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO payment_vouchers(
        tenant_id, company_id, voucher_number, voucher_date, supplier_id, supplier_name,
        amount, currency, payment_method, treasury_account_id, container_id,
        status, notes, created_by, created_at
    ) VALUES (
        v_tenant, v_company, v_number, CURRENT_DATE, v_supplier, v_supp_name,
        round(v_amount,2), v_currency, v_method, v_acct, v_container,
        v_status,
        'دفع مصروف كونتينر — '||COALESCE((SELECT expense_type FROM container_expenses WHERE id = p_expense_id),''),
        v_user, now()
    ) RETURNING id, voucher_number INTO v_voucher_id, v_number;

    UPDATE container_expenses
       SET payment_status = 'paid',
           is_paid = true,
           paid_amount = round(v_amount,2),
           paid_date = CURRENT_DATE,
           payment_reference = v_number,
           updated_at = now()
     WHERE id = p_expense_id;

    RETURN jsonb_build_object('ok', true, 'voucher_id', v_voucher_id,
        'voucher_number', v_number, 'status', v_status);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 🔐 GRANTS — authenticated only; explicitly revoke anon/public
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.console_container_gate(uuid)',
        'public.console_warehouse_read(uuid)',
        'public.get_console_warehouses(uuid)',
        'public.get_console_warehouse_detail(uuid, uuid, text, int)',
        'public.get_console_material_locations(uuid, uuid, uuid)',
        'public.get_console_containers(uuid, text, text, int)',
        'public.get_console_container(uuid, uuid)',
        'public.console_add_container_expense(uuid, text, numeric, text, uuid, text)',
        'public.console_pay_container_expense(uuid, uuid)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn); EXCEPTION WHEN OTHERS THEN NULL; END;
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- 📇 CONTRACT SUMMARY (the Flutter app codes against exactly these)
-- ════════════════════════════════════════════════════════════════════════
-- get_console_warehouses(p_company_id)
--   -> {ok, items:[{id, code, name, type, city, is_active, materials_count,
--        total_qty, total_value}]}
--   total_value NULL without cost gate. Scoped to console_scope_warehouses
--   when non-empty. ⚠️ `city` is sourced from warehouses.address (no city
--   column exists live).
--
-- get_console_warehouse_detail(p_company_id, p_warehouse_id, p_query?, p_limit=50)
--   -> {ok, warehouse:{id,code,name,type,city,locations_count},
--        items:[{material_id, code, name, unit, qty_on_hand, qty_reserved,
--                qty_available, locations:[codes], avg_cost, value}]}
--   avg_cost/value NULL without cost gate. Out-of-scope warehouse => forbidden.
--   ⚠️ Live inventory_stock has NO reserved/available/location columns:
--   qty_reserved = Σ fabric_rolls.reserved_length (material+warehouse, rolls
--   with length > 0); qty_available = qty_on_hand − qty_reserved; locations =
--   DISTINCT bin_locations.code via fabric_rolls.bin_location_id (the live
--   location system — warehouse_locations is unused by stock).
--   locations_count = active bin_locations of the warehouse.
--
-- get_console_material_locations(p_company_id, p_warehouse_id, p_material_id)
--   -> {ok, locations:[{location_id, code, name, qty}],
--        rolls:[{roll_id, roll_number, barcode, current_length, reserved_length,
--                status, location_code}]}
--   locations grouped from rolls by bin (location_id NULL + code '' = un-binned
--   bucket); qty = Σ current_length. rolls: only current_length > 0, ordered by
--   roll_number, LIMIT 100. Warehouse read gate + scope enforced.
--
-- get_console_containers(p_company_id, p_status?, p_query?, p_limit=30)
--   -> {ok, items:[{id, container_number, name, supplier_name, status, eta, etd,
--        arrival_date, received_date, port_of_loading, port_of_discharge,
--        vessel_name, shipping_company, size, type, items_count, expenses_count,
--        total_landed_cost, currency, created_at}]}
--   Container gate. total_landed_cost NULL without cost gate. Status filter is
--   exact; live values: draft|booked|loading|in_transit|at_port|customs|cleared|
--   in_receiving|received|closed. eta/etd COALESCE with
--   expected_arrival_date/departure_date (same aliasing as ContainersList.tsx).
--
-- get_console_container(p_company_id, p_container_id)
--   -> {ok, container:{id, container_number, name, shipment_number, status,
--        supplier:{id,name,phone}|null, warehouse_name (from
--        receiving_warehouse_id — no warehouse_id column exists), size, type,
--        origin_country, ports, shipping_company, vessel_name, bill_of_lading,
--        order_date, etd, eta, departure_date, arrival_date, received_date,
--        cost_allocation_method, is_cost_finalized, currency,
--        total_cost/total_purchase_value/total_landed_cost (NULL without cost gate)},
--       items:[{id, material_id, name, code, description, expected_quantity,
--               received_quantity, unit, expected_rolls, received_rolls,
--               unit_cost, final_unit_cost}]  (costs NULL without cost gate),
--       expenses:[{id, expense_type, description, vendor_name, expected_amount,
--               actual_amount, currency_code, invoice_number, invoice_date,
--               payment_status, is_posted}]  (ONLY when cost gate OR accounting
--               read; otherwise []),
--       receipts:[{id, number, date, status}]        (purchase_receipts.container_id),
--       invoices:[{id, number, date, total (cost-gated), status}] (purchase_invoices),
--       reservations:[{id, reservation_number, customer_name, material_name,
--               reserved_quantity, unit, status}]}
--
-- console_add_container_expense(p_container_id, p_expense_type, p_amount,
--                               p_vendor_name?, p_supplier_id?, p_notes?)
--   -> {ok, expense_id}   WRITE (RAISES: invalid_amount | invalid_expense_type |
--      container_not_found | invalid_supplier | forbidden)
--   Gates: container gate + payment gate + company access. expense_type must be
--   one of the web's 12: freight|customs|tax|insurance|handling|transport|
--   clearance|storage|inspection|documentation|demurrage|other.
--   Inserts UNPOSTED (is_posted=false, no journal entry): no trigger exists on
--   container_expenses and the web creates the GL entry client-side — the
--   accountant finalizes/allocates in the web. currency = container currency;
--   amount + actual_amount both set (amount is NOT NULL live);
--   payment_status='unpaid'; vendor_id = p_supplier_id (validated).
--
-- console_pay_container_expense(p_expense_id, p_cash_account_id?)
--   -> {ok, voucher_id, voucher_number, status 'draft'|'confirmed'}
--   WRITE (RAISES: expense_not_found | already_paid | invalid_amount |
--      vendor_not_linked | no_cash_account_available | invalid_cash_account |
--      not_a_cash_account | cash_account_out_of_scope | forbidden)
--   Gates: container gate + payment gate. amount = actual_amount →
--   expected_amount → amount. Creates a payment_voucher exactly like
--   create_payment_voucher (NULL cash account => first scoped/company cash
--   leaf; 'direct' mode + approver => status 'confirmed' and the existing
--   trigger posts the JE) with payment_vouchers.container_id set, then marks
--   the expense payment_status='paid' (+is_paid, paid_amount, paid_date,
--   payment_reference=voucher_number).
--   ⚠️ PATH TAKEN: a LINKED SUPPLIER IS REQUIRED (expense.vendor_id, else a
--   supplier matched by payable_account_id = expense.vendor_account_id).
--   Free-text-vendor expenses raise 'vendor_not_linked' — the voucher JE
--   trigger would otherwise debit a generic payable account with no party,
--   which is wrong accounting (correctness over convenience).
--
-- NOTE: NO new item type was added to console_execute_item /
-- execute_confirmation_item — the confirmation center has no
-- 'container_expense' type (verified in ConfirmationCenter.tsx + inbox RPC).
-- ════════════════════════════════════════════════════════════════════════
