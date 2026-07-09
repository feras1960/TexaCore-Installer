-- ════════════════════════════════════════════════════════════════════════
-- 20260707d — TexaCore Console: party balances (receivables/payables drill-down)
-- ────────────────────────────────────────────────────────────────────────
-- WHY: the home dashboard receivables/payables KPIs come from the PARTY
-- sub-ledger (customers.balance / suppliers.balance), NOT the GL receivable/
-- payable control accounts (which, in live data, carry 0 posted movement —
-- balances are tracked per party). Tapping those cards previously opened
-- get_console_accounts ('receivable'/'payable') and showed 0.00 everywhere,
-- mismatching the KPI. This function returns the party balances that actually
-- sum to the KPI, so the drill-down reconciles.
--
-- Conventions identical to the other console migrations: SECURITY DEFINER,
-- SET search_path=public,pg_temp; read fn returns {ok:false,error:'forbidden'};
-- assert_can_access_company; reuse console_has_perm/console_is_admin;
-- REVOKE PUBLIC/anon + GRANT authenticated; BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- get_console_party_balances(company, type, limit) — non-zero party balances.
-- Gate mirrors console_list_parties: customer → sales|crm|customers|accounting
-- read; supplier → purchases|suppliers|accounting read.
-- total_positive = Σ balance where balance > 0 (matches the dashboard KPI, which
-- sums positive party balances). items ordered by balance DESC (biggest debtor
-- first), balance <> 0 only.
CREATE OR REPLACE FUNCTION public.get_console_party_balances(
    p_company_id uuid, p_type text, p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean := false;
    v_lim int := LEAST(GREATEST(COALESCE(p_limit,100),1), 500);
    v_items jsonb; v_total numeric;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    IF p_type = 'customer' THEN
        v_ok := v_admin OR public.console_has_perm(v_user,'sales','read')
                        OR public.console_has_perm(v_user,'crm','read')
                        OR public.console_has_perm(v_user,'customers','read')
                        OR public.console_has_perm(v_user,'accounting','read');
    ELSIF p_type = 'supplier' THEN
        v_ok := v_admin OR public.console_has_perm(v_user,'purchases','read')
                        OR public.console_has_perm(v_user,'suppliers','read')
                        OR public.console_has_perm(v_user,'accounting','read');
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'bad_type');
    END IF;
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    IF p_type = 'customer' THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.balance DESC), '[]'::jsonb),
               COALESCE((SELECT SUM(balance) FROM customers WHERE company_id = p_company_id AND balance > 0),0)
          INTO v_items, v_total FROM (
            SELECT c.id,
                   COALESCE(c.code,'') AS code,
                   COALESCE(NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''), '') AS name,
                   COALESCE(NULLIF(c.phone,''), NULLIF(c.mobile,''), '') AS phone,
                   round(COALESCE(c.balance,0),2) AS balance
            FROM customers c
            WHERE c.company_id = p_company_id AND COALESCE(c.balance,0) <> 0
            ORDER BY c.balance DESC
            LIMIT v_lim
        ) t;
    ELSE
        SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.balance DESC), '[]'::jsonb),
               COALESCE((SELECT SUM(balance) FROM suppliers WHERE company_id = p_company_id AND balance > 0),0)
          INTO v_items, v_total FROM (
            SELECT s.id,
                   COALESCE(s.code,'') AS code,
                   COALESCE(NULLIF(s.name_ar,''), NULLIF(s.name_en,''), '') AS name,
                   COALESCE(NULLIF(s.phone,''), NULLIF(s.mobile,''), '') AS phone,
                   round(COALESCE(s.balance,0),2) AS balance
            FROM suppliers s
            WHERE s.company_id = p_company_id AND COALESCE(s.balance,0) <> 0
            ORDER BY s.balance DESC
            LIMIT v_lim
        ) t;
    END IF;

    RETURN jsonb_build_object('ok', true, 'total_positive', round(COALESCE(v_total,0),2),
                              'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.get_console_party_balances(uuid, text, int) FROM PUBLIC;
DO $$ BEGIN
    BEGIN REVOKE ALL ON FUNCTION public.get_console_party_balances(uuid, text, int) FROM anon; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
GRANT EXECUTE ON FUNCTION public.get_console_party_balances(uuid, text, int) TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- CONTRACT
-- get_console_party_balances(p_company_id, p_type 'customer'|'supplier', p_limit=100)
--   -> {ok, total_positive, items:[{id, code, name, phone, balance}]}
--   items = parties with balance <> 0, ordered by balance DESC. total_positive
--   = Σ positive balances (reconciles with the dashboard receivables/payables KPI).
--   Tap an item -> get_party_statement(company, type, id) (existing).
-- ════════════════════════════════════════════════════════════════════════
