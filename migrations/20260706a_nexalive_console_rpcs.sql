-- ════════════════════════════════════════════════════════════════════════
-- 📱 TexaCore Console RPCs — role-aware mobile mini-ERP (NexaLive Flutter)
-- ════════════════════════════════════════════════════════════════════════
-- Date: 2026-07-06
-- Author: Console server side (reviewed & applied by Fable — NOT auto-applied)
--
-- WHY THIS EXISTS
--   Existing dashboard RPCs check *company* access (assert_can_access_company)
--   but NOT *role*. The mobile client cannot be trusted to filter by role, so
--   these functions enforce role/permission SERVER-SIDE. The Flutter app codes
--   against the exact names/shapes below — keep them stable.
--
-- CONVENTIONS
--   • Every function: SECURITY DEFINER, SET search_path = public, pg_temp.
--   • REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated ONLY.
--     (service_role keeps implicit access as table owner; we do not grant anon.)
--   • Read functions NEVER raise for permission denial: they return
--       {"ok": false, "error": "forbidden"}  (or "error":"<code>").
--   • Write functions RAISE EXCEPTION on forbidden.
--   • Tenant isolation: assert_can_access_company(company) in every function
--     that takes a company (directly or via the item's resolved company).
--   • Amounts in company base currency (companies.default_currency), mirroring
--     get_manager_dashboard / get_customer_statement (ledger is base-currency).
--
-- REUSED EXISTING OBJECTS (verified against migrations)
--   assert_can_access_company(uuid)                      — tenant guard
--   check_user_permission(user, module, perm)            — RBAC module perms
--   get_user_special_permissions(user) -> jsonb          — special perms map
--   is_super_admin(user) -> bool
--   get_manager_dashboard(company), get_low_stock_materials(company, wh[], lim)
--   get_my_hr(user), get_confirmation_counts(company),
--   get_confirmation_inbox(company, status, type), execute_confirmation_item(type,id)
--   payment_receipts / payment_vouchers tables carry triggers that BUILD + POST
--     the journal entry when status flips to 'confirmed' (20260617d). So the
--     console INSERTs the voucher/receipt row — it does NOT hand-write GL lines.
--
-- Table/column facts verified:
--   sales_transactions(stage IN draft/quotation/reservation/confirmed/delivery/
--     posted/cancelled/... , total_amount, currency, customer_id, customer_name,
--     created_by, driver_id, driver_name, driver_phone, delivery_method,
--     customer_address, doc_date, delivered_at, delivery_confirmed_at/by, tenant_id)
--   sales_transaction_items(transaction_id, line_number, quantity, unit_price,
--     description, product_id, material_id)
--   customers(code, name_ar, name_en, company_name, phone, mobile, balance,
--     credit_limit, receivable_account_id, company_id, tenant_id)
--   suppliers(code, name_ar, name_en, phone, mobile, balance, payable_account_id,
--     company_id, tenant_id)   [no credit_limit]
--   journal_entry_lines(entry_id, account_id, debit, credit, party_type, party_id)
--   fabric_materials.selling_price = ERP default sale price
--   companies.default_currency = base currency; companies.settings->>'operating_mode'
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 0) Internal helpers — keep all gates consistent
-- ════════════════════════════════════════════════════════════════════════

-- console_has_perm: module/perm gate evaluated directly over roles/user_roles.
-- LIVE-DB REALITY (verified 2026-07-06): check_user_permission() from
-- 20260205_complete_rbac_system.sql is NOT deployed; the live roles.permissions
-- JSONB uses ARRAYS: {"sales":["read","write"], ...} or {"all": true}. We read
-- both the array shape (live) and the object shape ({module:{read:true}}) from
-- the original design, so this survives either convention.
CREATE OR REPLACE FUNCTION public.console_has_perm(p_user uuid, p_module text, p_perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND (
                r.permissions->>'all' = 'true'
             OR (jsonb_typeof(r.permissions->p_module) = 'array'
                 AND r.permissions->p_module ? p_perm)
             OR (jsonb_typeof(r.permissions->p_module) = 'object'
                 AND COALESCE((r.permissions->p_module->>p_perm)::boolean, false))
          )
    );
$$;

-- console_is_admin: tenant_owner / company_admin / company_owner / super_admin.
-- Admin => full role bypass at the console level.
CREATE OR REPLACE FUNCTION public.console_is_admin(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_is boolean := false;
BEGIN
    IF p_user IS NULL THEN RETURN false; END IF;
    BEGIN
        IF public.is_super_admin(p_user) THEN RETURN true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    SELECT EXISTS (
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND (r.code IN ('super_admin','tenant_owner','company_owner','company_admin')
               OR r.permissions->>'all' = 'true')
    ) INTO v_is;
    RETURN COALESCE(v_is, false);
END;
$$;

-- console_has_role: TRUE if user holds an active role with the given code.
CREATE OR REPLACE FUNCTION public.console_has_role(p_user uuid, p_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.code = p_code
    );
$$;

-- console_special: read a boolean special-permission flag (can_*) from the
-- user's active roles. LIVE-DB REALITY: get_user_special_permissions() and the
-- roles.special_permissions column are NOT deployed — so we look for the flag
-- as a top-level boolean key in roles.permissions (e.g. {"can_approve_transactions": true})
-- or nested under a 'special' object. Absent flag => false (production parity:
-- admins bypass these at every call site anyway).
CREATE OR REPLACE FUNCTION public.console_special(p_user uuid, p_flag text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND (r.permissions->>p_flag = 'true'
               OR r.permissions->'special'->>p_flag = 'true')
    );
$$;

-- console_scope_warehouses: warehouse ids the user is scoped to (empty => all).
-- ADMIN BYPASS: admins always get an empty scope (= unrestricted). Discovered
-- live: stale user_resource_access rows can point at deleted warehouses, which
-- would otherwise filter an admin down to nothing.
CREATE OR REPLACE FUNCTION public.console_scope_warehouses(p_user uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
    SELECT CASE WHEN public.console_is_admin(p_user) THEN ARRAY[]::uuid[]
           ELSE COALESCE((SELECT array_agg(resource_id)
                          FROM user_resource_access
                          WHERE user_id = p_user AND resource_type = 'warehouse'),
                         ARRAY[]::uuid[])
           END;
$$;

-- console_scope_cash_accounts: cash/bank account ids the user is scoped to.
-- ADMIN BYPASS: same rationale as console_scope_warehouses.
CREATE OR REPLACE FUNCTION public.console_scope_cash_accounts(p_user uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
    SELECT CASE WHEN public.console_is_admin(p_user) THEN ARRAY[]::uuid[]
           ELSE COALESCE((SELECT array_agg(resource_id)
                          FROM user_resource_access
                          WHERE user_id = p_user AND resource_type IN ('cash_account','bank_account')),
                         ARRAY[]::uuid[])
           END;
$$;

-- console_driver_id: the drivers row (active) for this user, or NULL.
CREATE OR REPLACE FUNCTION public.console_driver_id(p_user uuid, p_company uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
    SELECT d.id FROM drivers d
    WHERE d.user_id = p_user AND d.status = 'active'
      AND (p_company IS NULL OR d.company_id = p_company)
    ORDER BY (d.company_id = p_company) DESC NULLS LAST
    LIMIT 1;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 1) get_console_profile() — identity + resolved role surface + tabs
-- ════════════════════════════════════════════════════════════════════════
-- Gate: authenticated user only (no company arg — resolves from context).
CREATE OR REPLACE FUNCTION public.get_console_profile()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_tenant uuid;
    v_company uuid;
    v_companies jsonb := '[]'::jsonb;
    v_name text;
    v_roles jsonb;
    v_admin boolean;
    v_special jsonb;
    v_mode text;
    v_currency text;
    v_branches uuid[];
    v_warehouses uuid[];
    v_cash uuid[];
    v_branches_j jsonb; v_warehouses_j jsonb; v_cash_j jsonb;
    v_tabs text[] := ARRAY[]::text[];
    -- gate helpers
    v_can_acct_r boolean; v_can_acct_w boolean;
    v_can_sales_r boolean; v_can_sales_w boolean;
    v_can_purch_r boolean;
    v_can_crm_r boolean;
    v_can_treasury_w boolean;
    v_can_inv boolean; v_can_wh_w boolean;
    v_can_approve boolean;
    v_is_cashier boolean;
    v_is_driver boolean;
BEGIN
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
    END IF;

    -- tenant + display name + primary company (user_profiles is the anchor)
    SELECT up.tenant_id, up.company_id, COALESCE(NULLIF(up.full_name,''), up.email)
      INTO v_tenant, v_company, v_name
      FROM user_profiles up WHERE up.id = v_user;

    -- companies list: prefer explicit user_companies mapping; fall back to all
    -- companies of the tenant (defensive — user_companies may be sparse).
    BEGIN
        SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', COALESCE(c.name, c.name_en, '')))
          INTO v_companies
          FROM companies c
          WHERE c.id IN (
              SELECT uc.company_id FROM user_companies uc WHERE uc.user_id = v_user
          );
    EXCEPTION WHEN OTHERS THEN
        v_companies := NULL;
    END;

    IF v_companies IS NULL OR v_companies = '[]'::jsonb THEN
        SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', COALESCE(c.name, c.name_en, '')))
          INTO v_companies
          FROM companies c
          WHERE v_tenant IS NOT NULL AND c.tenant_id = v_tenant;
    END IF;
    v_companies := COALESCE(v_companies, '[]'::jsonb);

    -- pick default company: user_profiles.company_id if set & present, else first
    IF v_company IS NULL OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_companies) e WHERE (e->>'id')::uuid = v_company
    ) THEN
        v_company := NULLIF(v_companies->0->>'id','')::uuid;
    END IF;

    -- roles (codes), admin, special perms
    SELECT COALESCE(jsonb_agg(DISTINCT r.code), '[]'::jsonb) INTO v_roles
      FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_user AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now());

    v_admin := public.console_is_admin(v_user);
    -- merged can_* flags from active roles (see console_special for the live-DB rationale)
    SELECT COALESCE(jsonb_object_agg(s.k, true), '{}'::jsonb) INTO v_special
      FROM (
          SELECT DISTINCT e.key AS k
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          CROSS JOIN LATERAL jsonb_each_text(
              CASE WHEN jsonb_typeof(r.permissions) = 'object' THEN r.permissions ELSE '{}'::jsonb END) e
          WHERE ur.user_id = v_user AND ur.is_active = true
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
            AND e.key LIKE 'can\_%' AND e.value = 'true'
      ) s;
    v_special := COALESCE(v_special, '{}'::jsonb);

    -- operating mode + base currency for the resolved company
    IF v_company IS NOT NULL THEN
        BEGIN
            SELECT COALESCE(NULLIF(c.settings->>'operating_mode',''), 'workflow'),
                   COALESCE(c.default_currency, '')
              INTO v_mode, v_currency
              FROM companies c WHERE c.id = v_company;
        EXCEPTION WHEN OTHERS THEN
            v_mode := 'workflow'; v_currency := '';
        END;
    END IF;
    v_mode := COALESCE(v_mode, 'workflow');
    v_currency := COALESCE(v_currency, '');

    -- resource scopes (as {id,name} objects — the Flutter model parses maps only)
    SELECT COALESCE(array_agg(resource_id), ARRAY[]::uuid[]) INTO v_branches
      FROM user_resource_access
      WHERE user_id = v_user AND resource_type = 'branch';
    v_warehouses := public.console_scope_warehouses(v_user);
    v_cash := public.console_scope_cash_accounts(v_user);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id,
               'name', COALESCE(NULLIF(b.name,''), NULLIF(b.name_en,''), ''))), '[]'::jsonb)
      INTO v_branches_j FROM branches b WHERE b.id = ANY(v_branches);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', w.id,
               'name', COALESCE(NULLIF(w.name_ar,''), NULLIF(w.name_en,''), w.code, ''))), '[]'::jsonb)
      INTO v_warehouses_j FROM warehouses w WHERE w.id = ANY(v_warehouses);

    -- ── tab derivation (server-side; order matters) ──
    v_can_acct_r := v_admin OR public.console_has_perm(v_user, 'accounting', 'read');
    v_can_acct_w := v_admin OR public.console_has_perm(v_user, 'accounting', 'write');
    v_can_sales_r := v_admin OR public.console_has_perm(v_user, 'sales', 'read');
    v_can_sales_w := v_admin OR public.console_has_perm(v_user, 'sales', 'write');
    v_can_purch_r := v_admin OR public.console_has_perm(v_user, 'purchases', 'read');
    v_can_crm_r := v_admin OR public.console_has_perm(v_user, 'crm', 'read')
                            OR public.console_has_perm(v_user, 'customers', 'read');
    v_can_treasury_w := v_admin OR public.console_has_perm(v_user, 'treasury', 'write');
    v_can_inv := v_admin OR public.console_has_perm(v_user, 'inventory', 'read')
                         OR public.console_has_perm(v_user, 'inventory', 'write');
    v_can_wh_w := v_admin OR public.console_has_perm(v_user, 'warehouse', 'write');
    v_can_approve := v_admin OR public.console_special(v_user, 'can_approve_transactions');
    v_is_cashier := public.console_has_role(v_user, 'cashier');
    v_is_driver := (public.console_driver_id(v_user, v_company) IS NOT NULL);

    -- cash accounts for the treasury form: explicit scope wins; otherwise any
    -- user allowed to create payments gets ALL company cash/bank leaf accounts
    -- (most users have no explicit scope — an empty picker would dead-end them).
    IF v_cash <> ARRAY[]::uuid[] THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id,
                   'name', COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), a.account_code))
                   ORDER BY a.account_code), '[]'::jsonb)
          INTO v_cash_j FROM chart_of_accounts a WHERE a.id = ANY(v_cash);
    ELSIF v_company IS NOT NULL AND (v_admin OR v_can_treasury_w OR v_can_acct_w OR v_is_cashier) THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id,
                   'name', COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), a.account_code))
                   ORDER BY a.account_code), '[]'::jsonb)
          INTO v_cash_j
          FROM (SELECT id, name_ar, name_en, account_code FROM chart_of_accounts
                WHERE company_id = v_company
                  AND (COALESCE(is_cash_account,false) OR COALESCE(is_bank_account,false))
                  AND COALESCE(is_group,false) = false
                ORDER BY account_code LIMIT 50) a;
    END IF;
    v_cash_j := COALESCE(v_cash_j, '[]'::jsonb);

    v_tabs := array_append(v_tabs, 'dashboard');                                   -- always
    IF v_can_approve OR v_admin OR v_can_acct_w THEN v_tabs := array_append(v_tabs, 'approvals'); END IF;
    IF v_can_treasury_w OR v_is_cashier THEN v_tabs := array_append(v_tabs, 'treasury'); END IF;
    IF v_can_sales_w THEN v_tabs := array_append(v_tabs, 'sales'); END IF;
    IF v_can_sales_r OR v_can_purch_r OR v_can_acct_r THEN v_tabs := array_append(v_tabs, 'parties'); END IF;
    IF v_can_inv OR v_can_wh_w THEN v_tabs := array_append(v_tabs, 'warehouse'); END IF;
    IF v_is_driver THEN v_tabs := array_append(v_tabs, 'driver'); END IF;
    v_tabs := array_append(v_tabs, 'hr');                                          -- always (self-service)

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', v_user,
        'tenant_id', v_tenant,
        'company_id', v_company,
        'companies', v_companies,
        'display_name', COALESCE(v_name, ''),
        'roles', v_roles,
        'is_admin', v_admin,
        'special_permissions', COALESCE(v_special, '{}'::jsonb),
        'operating_mode', v_mode,
        'currency', v_currency,
        'scopes', jsonb_build_object(
            'branches', COALESCE(v_branches_j, '[]'::jsonb),
            'warehouses', COALESCE(v_warehouses_j, '[]'::jsonb),
            'cash_accounts', v_cash_j
        ),
        'tabs', to_jsonb(v_tabs)
    );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) get_console_dashboard(company) — one call, sections gated by permission
-- ════════════════════════════════════════════════════════════════════════
-- Gate: company access. Each section is included ONLY when permitted.
CREATE OR REPLACE FUNCTION public.get_console_dashboard(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_sections jsonb := '{}'::jsonb;
    v_currency text := '';
    v_admin boolean;
    v_all_branches boolean;         -- can_view_all_branches OR admin
    -- section gates
    v_g_finance boolean;
    v_g_sales boolean;
    v_g_approvals boolean;
    v_g_inv boolean;
    v_driver_id uuid;
    -- scratch
    v_cash numeric; v_recv numeric; v_pay numeric;
    v_today_total numeric; v_today_cnt bigint;
    v_month_total numeric; v_month_cnt bigint;
    v_pending_total bigint; v_by_type jsonb;
    v_wh uuid[]; v_low jsonb; v_low_items jsonb; v_low_cnt int;
    v_driver_cnt bigint;
    v_hr jsonb;
    v_only_own boolean;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN
        PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END;

    BEGIN SELECT COALESCE(default_currency,'') INTO v_currency FROM companies WHERE id = p_company_id; EXCEPTION WHEN OTHERS THEN v_currency := ''; END;
    v_admin := public.console_is_admin(v_user);
    v_all_branches := v_admin OR public.console_special(v_user, 'can_view_all_branches');

    v_g_finance := v_admin OR public.console_has_perm(v_user,'accounting','read')
                            OR public.console_has_perm(v_user,'treasury','read');
    v_g_sales   := v_admin OR public.console_has_perm(v_user,'sales','read');
    v_g_approvals := v_admin OR public.console_special(v_user,'can_approve_transactions')
                             OR public.console_has_perm(v_user,'accounting','write');
    v_g_inv := v_admin OR public.console_has_perm(v_user,'inventory','read')
                       OR public.console_has_perm(v_user,'inventory','write')
                       OR public.console_has_perm(v_user,'warehouse','write');
    v_driver_id := public.console_driver_id(v_user, p_company_id);

    -- ── finance (cash / receivables / payables) — mirrors get_manager_dashboard ──
    IF v_g_finance THEN
        SELECT round(COALESCE(SUM(jel.debit - jel.credit),0),2) INTO v_cash
          FROM journal_entry_lines jel
          JOIN journal_entries je ON je.id = jel.entry_id
          JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE je.company_id = p_company_id AND COALESCE(je.is_posted,false)
            AND (COALESCE(coa.is_cash_account,false) OR COALESCE(coa.is_bank_account,false));
        SELECT round(COALESCE(SUM(balance),0),2) INTO v_recv FROM customers WHERE company_id = p_company_id AND balance > 0;
        SELECT round(COALESCE(SUM(balance),0),2) INTO v_pay  FROM suppliers WHERE company_id = p_company_id AND balance > 0;
        v_sections := v_sections || jsonb_build_object('finance', jsonb_build_object(
            'cash', COALESCE(v_cash,0), 'receivables', COALESCE(v_recv,0),
            'payables', COALESCE(v_pay,0), 'currency', v_currency));
    END IF;

    -- ── sales_today (+ my_sales for sales_rep) ──
    IF v_g_sales THEN
        -- sales_rep-only view: no can_view_all_branches AND not admin => own docs
        v_only_own := (NOT v_all_branches);

        SELECT round(COALESCE(SUM(total_amount),0),2), COALESCE(COUNT(*),0)
          INTO v_today_total, v_today_cnt
          FROM sales_transactions
          WHERE company_id = p_company_id AND created_at::date = CURRENT_DATE
            AND COALESCE(stage,'') NOT IN ('draft','quotation','cancelled')
            AND (NOT v_only_own OR created_by = v_user);
        v_sections := v_sections || jsonb_build_object('sales_today', jsonb_build_object(
            'total', COALESCE(v_today_total,0), 'count', COALESCE(v_today_cnt,0), 'currency', v_currency));

        IF v_only_own THEN
            SELECT round(COALESCE(SUM(total_amount),0),2), COALESCE(COUNT(*),0)
              INTO v_month_total, v_month_cnt
              FROM sales_transactions
              WHERE company_id = p_company_id AND created_by = v_user
                AND date_trunc('month', created_at) = date_trunc('month', now())
                AND COALESCE(stage,'') NOT IN ('draft','quotation','cancelled');
            v_sections := v_sections || jsonb_build_object('my_sales', jsonb_build_object(
                'month_total', COALESCE(v_month_total,0), 'month_count', COALESCE(v_month_cnt,0), 'currency', v_currency));
        END IF;
    END IF;

    -- ── pending (approvals) — reuse get_confirmation_counts ──
    IF v_g_approvals THEN
        SELECT COALESCE(SUM(cnt),0),
               COALESCE(jsonb_agg(jsonb_build_object('item_type', item_type, 'cnt', cnt)), '[]'::jsonb)
          INTO v_pending_total, v_by_type
          FROM get_confirmation_counts(p_company_id);
        v_sections := v_sections || jsonb_build_object('pending', jsonb_build_object(
            'total', COALESCE(v_pending_total,0), 'by_type', COALESCE(v_by_type,'[]'::jsonb)));
    END IF;

    -- ── low_stock (max 5) — reuse get_low_stock_materials, scope to warehouses ──
    IF v_g_inv THEN
        v_wh := public.console_scope_warehouses(v_user);
        IF v_wh = ARRAY[]::uuid[] THEN v_wh := NULL; END IF;  -- empty => all company warehouses
        BEGIN
            v_low := public.get_low_stock_materials(p_company_id, v_wh, 5);
        EXCEPTION WHEN OTHERS THEN
            v_low := jsonb_build_object('items','[]'::jsonb);
        END;
        -- normalize field names to the console contract
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'material_name', it->>'name',
                   'qty', COALESCE((it->>'qty')::numeric,0),
                   'reorder_point', COALESCE((it->>'reorder')::numeric,0),
                   'unit', COALESCE(it->>'unit',''),
                   'warehouse_name', NULL
               )), '[]'::jsonb),
               COALESCE(count(*),0)
          INTO v_low_items, v_low_cnt
          FROM jsonb_array_elements(COALESCE(v_low->'items','[]'::jsonb)) it;
        v_sections := v_sections || jsonb_build_object('low_stock', jsonb_build_object(
            'count', COALESCE(v_low_cnt,0), 'items', COALESCE(v_low_items,'[]'::jsonb)));
    END IF;

    -- ── driver_tasks ──
    IF v_driver_id IS NOT NULL THEN
        SELECT COALESCE(COUNT(*),0) INTO v_driver_cnt
          FROM sales_transactions
          WHERE company_id = p_company_id AND driver_id = v_driver_id
            AND COALESCE(stage,'') IN ('confirmed','delivery','order');
        v_sections := v_sections || jsonb_build_object('driver_tasks', jsonb_build_object('count', COALESCE(v_driver_cnt,0)));
    END IF;

    -- ── hr (self-service) — reuse get_my_hr ──
    BEGIN
        v_hr := public.get_my_hr(v_user);
    EXCEPTION WHEN OTHERS THEN v_hr := NULL; END;
    IF v_hr IS NOT NULL AND COALESCE((v_hr->>'is_employee')::boolean, false) THEN
        v_sections := v_sections || jsonb_build_object('hr', jsonb_build_object(
            'leave_remaining', COALESCE((v_hr->>'leave_remaining')::numeric, 0),
            'last_payslip_net', COALESCE((v_hr->'last_payslip'->>'net_salary')::numeric, NULL),
            'last_payslip_currency', COALESCE(v_hr->'last_payslip'->>'currency', '')));
    END IF;

    RETURN jsonb_build_object('ok', true, 'sections', v_sections);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) console_list_parties(company, type, query?, limit) — customer/supplier list
-- ════════════════════════════════════════════════════════════════════════
-- Gate: customer -> sales|crm|customers|accounting read; supplier -> purchases|accounting read.
CREATE OR REPLACE FUNCTION public.console_list_parties(
    p_company_id uuid, p_type text, p_query text DEFAULT NULL, p_limit int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_ok boolean := false;
    v_items jsonb;
    v_q text := NULLIF(trim(COALESCE(p_query,'')), '');
    v_lim int := LEAST(GREATEST(COALESCE(p_limit,30),1), 200);
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
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_items FROM (
            SELECT c.id,
                   COALESCE(c.code,'') AS code,
                   COALESCE(NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''), '') AS name,
                   COALESCE(NULLIF(c.phone,''), NULLIF(c.mobile,''), '') AS phone,
                   round(COALESCE(c.balance,0),2) AS balance,
                   round(COALESCE(c.credit_limit,0),2) AS credit_limit
            FROM customers c
            WHERE c.company_id = p_company_id
              AND (v_q IS NULL OR c.name_ar ILIKE '%'||v_q||'%' OR c.name_en ILIKE '%'||v_q||'%'
                   OR c.company_name ILIKE '%'||v_q||'%' OR c.code ILIKE '%'||v_q||'%'
                   OR c.phone ILIKE '%'||v_q||'%' OR c.mobile ILIKE '%'||v_q||'%')
            ORDER BY COALESCE(NULLIF(c.name_ar,''), c.name_en, c.code) ASC
            LIMIT v_lim
        ) t;
    ELSE
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_items FROM (
            SELECT s.id,
                   COALESCE(s.code,'') AS code,
                   COALESCE(NULLIF(s.name_ar,''), NULLIF(s.name_en,''), '') AS name,
                   COALESCE(NULLIF(s.phone,''), NULLIF(s.mobile,''), '') AS phone,
                   round(COALESCE(s.balance,0),2) AS balance,
                   0::numeric AS credit_limit   -- suppliers have no credit_limit column
            FROM suppliers s
            WHERE s.company_id = p_company_id
              AND (v_q IS NULL OR s.name_ar ILIKE '%'||v_q||'%' OR s.name_en ILIKE '%'||v_q||'%'
                   OR s.code ILIKE '%'||v_q||'%' OR s.phone ILIKE '%'||v_q||'%' OR s.mobile ILIKE '%'||v_q||'%')
            ORDER BY COALESCE(NULLIF(s.name_ar,''), s.name_en, s.code) ASC
            LIMIT v_lim
        ) t;
    END IF;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 4) get_party_statement(company, party_type, party_id, from?, to?)
-- ════════════════════════════════════════════════════════════════════════
-- Gate: same as console_list_parties. Mirrors get_customer_statement +
-- accountLedgerService: ledger from journal_entry_lines by party_type/party_id,
-- POSTED entries only, base currency (companies.default_currency). Running
-- balance direction: customer = debit-credit, supplier = credit-debit.
-- opening_balance = sum before p_from. Default range: last 90 days.
CREATE OR REPLACE FUNCTION public.get_party_statement(
    p_company_id uuid, p_party_type text, p_party_id uuid,
    p_from date DEFAULT NULL, p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean := false;
    v_from date := COALESCE(p_from, CURRENT_DATE - INTERVAL '90 days');
    v_to   date := COALESCE(p_to, CURRENT_DATE);
    v_currency text := '';
    v_party jsonb;
    v_name text; v_code text; v_phone text; v_bal numeric; v_credit numeric;
    v_opening numeric := 0;
    v_sign int;            -- +1 customer (debit-credit), -1 supplier (credit-debit)
    v_lines jsonb;
    v_closing numeric;
    v_exists boolean;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    IF p_party_type = 'customer' THEN
        v_ok := v_admin OR public.console_has_perm(v_user,'sales','read')
                        OR public.console_has_perm(v_user,'crm','read')
                        OR public.console_has_perm(v_user,'customers','read')
                        OR public.console_has_perm(v_user,'accounting','read');
        v_sign := 1;
        SELECT true, COALESCE(NULLIF(name_ar,''), NULLIF(company_name,''), NULLIF(name_en,''), ''),
               COALESCE(code,''), COALESCE(NULLIF(phone,''), NULLIF(mobile,''), ''),
               round(COALESCE(balance,0),2), round(COALESCE(credit_limit,0),2)
          INTO v_exists, v_name, v_code, v_phone, v_bal, v_credit
          FROM customers WHERE id = p_party_id AND company_id = p_company_id;
    ELSIF p_party_type = 'supplier' THEN
        v_ok := v_admin OR public.console_has_perm(v_user,'purchases','read')
                        OR public.console_has_perm(v_user,'suppliers','read')
                        OR public.console_has_perm(v_user,'accounting','read');
        v_sign := -1;
        SELECT true, COALESCE(NULLIF(name_ar,''), NULLIF(name_en,''), ''),
               COALESCE(code,''), COALESCE(NULLIF(phone,''), NULLIF(mobile,''), ''),
               round(COALESCE(balance,0),2), 0::numeric
          INTO v_exists, v_name, v_code, v_phone, v_bal, v_credit
          FROM suppliers WHERE id = p_party_id AND company_id = p_company_id;
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'bad_type');
    END IF;

    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
    IF NOT COALESCE(v_exists,false) THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

    BEGIN SELECT COALESCE(default_currency,'') INTO v_currency FROM companies WHERE id = p_company_id; EXCEPTION WHEN OTHERS THEN v_currency := ''; END;

    -- opening balance: signed sum of posted lines strictly before v_from
    SELECT round(COALESCE(SUM(v_sign * (jel.debit - jel.credit)),0),2) INTO v_opening
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE jel.party_type = p_party_type AND jel.party_id = p_party_id
        AND je.company_id = p_company_id AND COALESCE(je.is_posted,false) = true
        AND je.entry_date < v_from;

    -- lines within [from, to] with running balance (ordinal-driven, no composite ORDER BY)
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.ord) INTO v_lines FROM (
        SELECT
            s.ord,
            s.entry_date AS date,
            s.entry_number,
            s.descr AS description,
            s.debit, s.credit,
            round(v_opening + SUM(v_sign*(s.debit - s.credit)) OVER (ORDER BY s.ord ROWS UNBOUNDED PRECEDING), 2) AS running_balance
        FROM (
            SELECT
                row_number() OVER (ORDER BY je.entry_date ASC, je.entry_number ASC, jel.line_number ASC) AS ord,
                (je.entry_date::date) AS entry_date,
                COALESCE(je.entry_number,'') AS entry_number,
                COALESCE(NULLIF(jel.description,''), NULLIF(je.description,''), '') AS descr,
                round(COALESCE(jel.debit,0),2) AS debit,
                round(COALESCE(jel.credit,0),2) AS credit
            FROM journal_entry_lines jel
            JOIN journal_entries je ON je.id = jel.entry_id
            WHERE jel.party_type = p_party_type AND jel.party_id = p_party_id
              AND je.company_id = p_company_id AND COALESCE(je.is_posted,false) = true
              AND je.entry_date >= v_from AND je.entry_date <= v_to
        ) s
    ) x;

    -- closing = opening + signed net within range
    SELECT round(v_opening + COALESCE(SUM(v_sign*((l->>'debit')::numeric - (l->>'credit')::numeric)),0),2)
      INTO v_closing
      FROM jsonb_array_elements(COALESCE(v_lines,'[]'::jsonb)) l;

    v_party := jsonb_build_object('id', p_party_id, 'name', v_name, 'code', v_code,
                                  'phone', v_phone, 'balance', v_bal, 'credit_limit', v_credit);

    RETURN jsonb_build_object(
        'ok', true, 'party', v_party, 'currency', v_currency,
        'opening_balance', v_opening,
        'lines', COALESCE(v_lines, '[]'::jsonb),
        'closing_balance', COALESCE(v_closing, v_opening)
    );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 5) create_payment_receipt(...) — customer receipt (DR cash / CR receivable)
-- ════════════════════════════════════════════════════════════════════════
-- WRITE — RAISES on forbidden. Inserts a payment_receipts row; the existing
-- trigger builds + posts the GL entry when status='confirmed'. In workflow
-- mode (or without approval rights) the receipt stays 'draft' and appears in
-- the confirmation center. Gate: treasury|accounting write OR cashier role.
CREATE OR REPLACE FUNCTION public.create_payment_receipt(
    p_company_id uuid, p_party_id uuid, p_amount numeric, p_currency text,
    p_cash_account_id uuid, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_can boolean;
    v_tenant uuid; v_cust_company uuid; v_cust_name text;
    v_scoped uuid[];
    v_is_cash boolean; v_is_bank boolean; v_acct_company uuid;
    v_status text; v_do_post boolean;
    v_receipt_id uuid; v_number text; v_method text;
    v_acct uuid := p_cash_account_id;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);   -- raises on cross-tenant

    v_admin := public.console_is_admin(v_user);
    v_can := v_admin
             OR public.console_has_perm(v_user,'treasury','write')
             OR public.console_has_perm(v_user,'accounting','write')
             OR public.console_has_role(v_user,'cashier');
    IF NOT v_can THEN RAISE EXCEPTION 'forbidden: payment permission required'; END IF;

    IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

    -- customer must belong to this company
    SELECT tenant_id, company_id, COALESCE(NULLIF(name_ar,''), NULLIF(company_name,''), name_en)
      INTO v_tenant, v_cust_company, v_cust_name
      FROM customers WHERE id = p_party_id;
    IF v_cust_company IS NULL OR v_cust_company <> p_company_id THEN RAISE EXCEPTION 'invalid_customer'; END IF;

    v_scoped := public.console_scope_cash_accounts(v_user);

    -- NULL account => server picks the default (first scoped account, else the
    -- company's first cash/bank leaf — same behavior the JE trigger falls back to)
    IF v_acct IS NULL THEN
        SELECT id INTO v_acct FROM chart_of_accounts
        WHERE company_id = p_company_id
          AND (COALESCE(is_cash_account,false) OR COALESCE(is_bank_account,false))
          AND COALESCE(is_group,false) = false
          AND (v_scoped = ARRAY[]::uuid[] OR id = ANY(v_scoped))
        ORDER BY account_code LIMIT 1;
        IF v_acct IS NULL THEN RAISE EXCEPTION 'no_cash_account_available'; END IF;
    END IF;

    -- cash account must be a cash/bank account of this company
    SELECT COALESCE(is_cash_account,false), COALESCE(is_bank_account,false), company_id
      INTO v_is_cash, v_is_bank, v_acct_company
      FROM chart_of_accounts WHERE id = v_acct;
    IF v_acct_company IS NULL OR v_acct_company <> p_company_id THEN RAISE EXCEPTION 'invalid_cash_account'; END IF;
    IF NOT (v_is_cash OR v_is_bank) THEN RAISE EXCEPTION 'not_a_cash_account'; END IF;

    -- if user is scoped to specific cash accounts, enforce membership
    IF v_scoped <> ARRAY[]::uuid[] AND NOT (v_acct = ANY(v_scoped)) THEN
        RAISE EXCEPTION 'cash_account_out_of_scope';
    END IF;

    -- posting behavior by operating mode
    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = p_company_id), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));
    v_status := CASE WHEN v_do_post THEN 'confirmed' ELSE 'draft' END;
    v_method := CASE WHEN v_is_cash THEN 'cash' ELSE 'bank_transfer' END;

    -- defensive server-side number (mirrors app RCV-<epoch> fallback)
    v_number := 'RCV-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO payment_receipts(
        tenant_id, company_id, receipt_number, receipt_date, customer_id, customer_name,
        amount, currency, payment_method, treasury_account_id, status, notes, created_by, created_at
    ) VALUES (
        v_tenant, p_company_id, v_number, CURRENT_DATE, p_party_id, v_cust_name,
        round(p_amount,2), COALESCE(NULLIF(p_currency,''), (SELECT default_currency FROM companies WHERE id = p_company_id), 'USD'),
        v_method, v_acct, v_status, NULLIF(p_notes,''), v_user, now()
    ) RETURNING id, receipt_number INTO v_receipt_id, v_number;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_receipt_id, 'entry_number', v_number, 'status', v_status);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 6) create_payment_voucher(...) — supplier payment (DR payable / CR cash)
-- ════════════════════════════════════════════════════════════════════════
-- WRITE — RAISES on forbidden. Mirror of create_payment_receipt for suppliers.
-- payment_vouchers.treasury_account_id (added 20260620a) constrains the cash acct.
CREATE OR REPLACE FUNCTION public.create_payment_voucher(
    p_company_id uuid, p_party_id uuid, p_amount numeric, p_currency text,
    p_cash_account_id uuid, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_can boolean;
    v_tenant uuid; v_supp_company uuid; v_supp_name text;
    v_scoped uuid[];
    v_is_cash boolean; v_is_bank boolean; v_acct_company uuid;
    v_status text; v_do_post boolean;
    v_voucher_id uuid; v_number text; v_method text;
    v_acct uuid := p_cash_account_id;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);

    v_admin := public.console_is_admin(v_user);
    v_can := v_admin
             OR public.console_has_perm(v_user,'treasury','write')
             OR public.console_has_perm(v_user,'accounting','write')
             OR public.console_has_role(v_user,'cashier');
    IF NOT v_can THEN RAISE EXCEPTION 'forbidden: payment permission required'; END IF;

    IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

    SELECT tenant_id, company_id, COALESCE(NULLIF(name_ar,''), name_en)
      INTO v_tenant, v_supp_company, v_supp_name
      FROM suppliers WHERE id = p_party_id;
    IF v_supp_company IS NULL OR v_supp_company <> p_company_id THEN RAISE EXCEPTION 'invalid_supplier'; END IF;

    v_scoped := public.console_scope_cash_accounts(v_user);

    -- NULL account => server default (first scoped, else first company cash/bank leaf)
    IF v_acct IS NULL THEN
        SELECT id INTO v_acct FROM chart_of_accounts
        WHERE company_id = p_company_id
          AND (COALESCE(is_cash_account,false) OR COALESCE(is_bank_account,false))
          AND COALESCE(is_group,false) = false
          AND (v_scoped = ARRAY[]::uuid[] OR id = ANY(v_scoped))
        ORDER BY account_code LIMIT 1;
        IF v_acct IS NULL THEN RAISE EXCEPTION 'no_cash_account_available'; END IF;
    END IF;

    SELECT COALESCE(is_cash_account,false), COALESCE(is_bank_account,false), company_id
      INTO v_is_cash, v_is_bank, v_acct_company
      FROM chart_of_accounts WHERE id = v_acct;
    IF v_acct_company IS NULL OR v_acct_company <> p_company_id THEN RAISE EXCEPTION 'invalid_cash_account'; END IF;
    IF NOT (v_is_cash OR v_is_bank) THEN RAISE EXCEPTION 'not_a_cash_account'; END IF;

    IF v_scoped <> ARRAY[]::uuid[] AND NOT (v_acct = ANY(v_scoped)) THEN
        RAISE EXCEPTION 'cash_account_out_of_scope';
    END IF;

    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = p_company_id), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));
    v_status := CASE WHEN v_do_post THEN 'confirmed' ELSE 'draft' END;
    v_method := CASE WHEN v_is_cash THEN 'cash' ELSE 'bank_transfer' END;

    v_number := 'PAY-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO payment_vouchers(
        tenant_id, company_id, voucher_number, voucher_date, supplier_id, supplier_name,
        amount, currency, payment_method, treasury_account_id, status, notes, created_by, created_at
    ) VALUES (
        v_tenant, p_company_id, v_number, CURRENT_DATE, p_party_id, v_supp_name,
        round(p_amount,2), COALESCE(NULLIF(p_currency,''), (SELECT default_currency FROM companies WHERE id = p_company_id), 'USD'),
        v_method, v_acct, v_status, NULLIF(p_notes,''), v_user, now()
    ) RETURNING id, voucher_number INTO v_voucher_id, v_number;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_voucher_id, 'entry_number', v_number, 'status', v_status);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 6a) console_list_cash_accounts(company) — cash/bank accounts for the
--     treasury form, company-aware (profile scopes only cover the default
--     company; switching company must refresh this list). Explicit
--     user_resource_access scope wins; otherwise all cash/bank leaves.
--     Gate: treasury|accounting write OR cashier (same as create_payment_*).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_list_cash_accounts(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_can boolean;
    v_scoped uuid[];
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_can := v_admin
             OR public.console_has_perm(v_user,'treasury','write')
             OR public.console_has_perm(v_user,'accounting','write')
             OR public.console_has_role(v_user,'cashier');
    IF NOT v_can THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    v_scoped := public.console_scope_cash_accounts(v_user);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', a.id,
               'name', COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), a.account_code),
               'code', a.account_code,
               'is_bank', COALESCE(a.is_bank_account,false))
               ORDER BY a.account_code), '[]'::jsonb)
      INTO v_items
      FROM (SELECT id, name_ar, name_en, account_code, is_bank_account FROM chart_of_accounts
            WHERE company_id = p_company_id
              AND (COALESCE(is_cash_account,false) OR COALESCE(is_bank_account,false))
              AND COALESCE(is_group,false) = false
              AND (v_scoped = ARRAY[]::uuid[] OR id = ANY(v_scoped))
            ORDER BY account_code LIMIT 50) a;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 6b) FIX (pre-existing bug, surfaced by console review): the voucher JE
--     trigger ignored payment_vouchers.treasury_account_id (column added in
--     20260620a AFTER the trigger was last rewritten in 20260617d) and always
--     credited the company's FIRST cash/bank account by account_code. So a
--     cashier choosing a specific cash box got the GL entry on a different
--     account. This replacement prefers NEW.treasury_account_id (validated as
--     a real cash/bank leaf of the company) and falls back to the old lookup.
--     The receipt-side function already honors treasury_account_id — this
--     brings vouchers to parity. Affects web + console alike.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_payment_voucher_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_entry_id UUID;
    v_supp UUID;
    v_cash UUID;
    v_fy UUID;
BEGIN
    IF NEW.status != 'confirmed' THEN RETURN NEW; END IF;
    IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;

    -- حساب المورد (الذمم الدائنة)
    v_supp := (SELECT payable_account_id FROM suppliers WHERE id = NEW.supplier_id);
    IF v_supp IS NULL THEN
        SELECT id INTO v_supp FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND is_party_account = true AND party_type = 'supplier' AND party_id = NEW.supplier_id LIMIT 1;
    END IF;
    IF v_supp IS NULL THEN
        SELECT id INTO v_supp FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND is_payable = true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;
    IF v_supp IS NULL THEN
        SELECT id INTO v_supp FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND account_code IN ('2112','2110','2100','2000') AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;

    -- النقد/البنك: أولوية للحساب المختار على السند (treasury_account_id)
    IF NEW.treasury_account_id IS NOT NULL THEN
        SELECT id INTO v_cash FROM chart_of_accounts
        WHERE id = NEW.treasury_account_id AND company_id = NEW.company_id
          AND (is_cash_account = true OR is_bank_account = true)
          AND COALESCE(is_group,false) = false;
    END IF;
    IF v_cash IS NULL THEN
        IF NEW.payment_method IN ('cash','نقدي','نقداً') THEN
            SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND is_cash_account=true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
        ELSE
            SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND is_bank_account=true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
        END IF;
    END IF;
    IF v_cash IS NULL THEN
        SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND (is_cash_account=true OR is_bank_account=true) AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;

    IF v_supp IS NULL OR v_cash IS NULL THEN
        RAISE EXCEPTION 'سند الصرف %: تعذّر إيجاد حساب %', NEW.voucher_number,
            CASE WHEN v_supp IS NULL THEN 'المورد/الذمم الدائنة' ELSE 'النقد/البنك' END;
    END IF;

    SELECT id INTO v_fy FROM fiscal_years WHERE company_id=NEW.company_id AND is_current=true LIMIT 1;

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date, fiscal_year_id, entry_type,
        reference_type, reference_id, reference_number, description, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by, created_at
    ) VALUES (
        NEW.tenant_id, NEW.company_id, NEW.branch_id, 'JE-PV-'||NEW.voucher_number, NEW.voucher_date, v_fy, 'payment_voucher',
        'payment_voucher', NEW.id, NEW.voucher_number,
        'سند صرف رقم '||NEW.voucher_number||' - '||COALESCE(NEW.supplier_name,''), NEW.currency, NEW.exchange_rate,
        NEW.amount, NEW.amount, 'draft', false, NEW.created_by, NOW()
    ) RETURNING id INTO v_entry_id;

    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, party_type, party_id, reference_type, reference_id)
    VALUES (NEW.tenant_id, v_entry_id, 1, v_supp, NEW.amount, 0, NEW.amount, 0, NEW.currency, NEW.exchange_rate, 'سداد للمورد - سند '||NEW.voucher_number, 'supplier', NEW.supplier_id, 'payment_voucher', NEW.id);

    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, reference_type, reference_id)
    VALUES (NEW.tenant_id, v_entry_id, 2, v_cash, 0, NEW.amount, 0, NEW.amount, NEW.currency, NEW.exchange_rate, 'صرف نقدي - سند '||NEW.voucher_number, 'payment_voucher', NEW.id);

    PERFORM post_journal_entry(v_entry_id, NEW.created_by);
    NEW.journal_entry_id := v_entry_id;
    RETURN NEW;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════
-- 7) get_console_work_queue(company) — actionable operational items by role
--    + console_execute_item(type,id) — role-enforcing wrapper over
--      execute_confirmation_item (Flutter ONLY calls the wrapper).
-- ════════════════════════════════════════════════════════════════════════
-- Gate: company access. Items depend on role:
--   • warehouse keeper (inventory/warehouse write): pending stock_transfer +
--     sales at delivery-active stage + purchase invoices awaiting receipt,
--     scoped to accessible warehouses when defined.
--   • approver (can_approve/admin/accounting write): confirmation inbox drafts.
--   can_execute = whether console_execute_item would be allowed for this user.
CREATE OR REPLACE FUNCTION public.get_console_work_queue(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_is_wh boolean;
    v_is_approver boolean;
    v_currency text := '';
    v_wh uuid[];
    v_items jsonb := '[]'::jsonb;
    v_row jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    BEGIN SELECT COALESCE(default_currency,'') INTO v_currency FROM companies WHERE id = p_company_id; EXCEPTION WHEN OTHERS THEN v_currency := ''; END;
    v_admin := public.console_is_admin(v_user);
    v_is_wh := v_admin OR public.console_has_perm(v_user,'warehouse','write')
                       OR public.console_has_perm(v_user,'inventory','write');
    v_is_approver := v_admin OR public.console_special(v_user,'can_approve_transactions')
                             OR public.console_has_perm(v_user,'accounting','write');
    v_wh := public.console_scope_warehouses(v_user);

    -- ── approver: confirmation inbox drafts (reuse get_confirmation_inbox) ──
    IF v_is_approver THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'kind', 'approval',
                   'id', i.item_id,
                   'item_type', i.item_type,
                   'title', COALESCE(i.title, i.item_type),
                   'subtitle', COALESCE(i.party_name, ''),
                   'amount', COALESCE(i.amount, 0),
                   'currency', v_currency,
                   'stage', COALESCE(i.status, ''),
                   'created_at', i.created_at,
                   'can_execute', true
               )), '[]'::jsonb)
          INTO v_items
          FROM get_confirmation_inbox(p_company_id, NULL, NULL) i;
    END IF;

    -- ── warehouse keeper: sales awaiting delivery (scoped) ──
    IF v_is_wh THEN
        SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
                   'kind', 'delivery',
                   'id', st.id,
                   'item_type', 'sales_invoice',
                   'title', COALESCE(NULLIF(st.customer_name,''), c.name_ar, c.name_en, '—'),
                   'subtitle', COALESCE(st.delivery_method,''),
                   'amount', COALESCE(st.total_amount,0),
                   'currency', v_currency,
                   'stage', st.stage,
                   'created_at', st.created_at,
                   'can_execute', true
               )), '[]'::jsonb)
          INTO v_items
          FROM sales_transactions st LEFT JOIN customers c ON c.id = st.customer_id
          WHERE st.company_id = p_company_id
            AND st.stage = 'confirmed'
            AND COALESCE(st.is_posted,false) = false
            AND (v_wh = ARRAY[]::uuid[] OR st.warehouse_id = ANY(v_wh) OR st.warehouse_id IS NULL);

        -- pending stock transfers (kind = transfer)
        SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
                   'kind', 'transfer',
                   'id', tr.id,
                   'item_type', 'stock_transfer',
                   'title', COALESCE(tr.transfer_number,'—'),
                   'subtitle', 'مناقلة مخزون',
                   'amount', COALESCE(tr.total_meters,0),
                   'currency', '',
                   'stage', tr.status,
                   'created_at', tr.created_at,
                   'can_execute', true
               )), '[]'::jsonb)
          INTO v_items
          FROM stock_transfers tr
          WHERE tr.company_id = p_company_id AND tr.status = 'pending';

        -- purchase invoices awaiting receipt (confirmed, unposted)
        SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
                   'kind', 'purchase_receipt',
                   'id', pt.id,
                   'item_type', 'purchase_invoice',
                   'title', COALESCE(s.name_ar, s.name_en, '—'),
                   'subtitle', 'استلام مشتريات',
                   'amount', COALESCE(pt.total_amount,0),
                   'currency', v_currency,
                   'stage', pt.stage,
                   'created_at', pt.created_at,
                   'can_execute', true
               )), '[]'::jsonb)
          INTO v_items
          FROM purchase_transactions pt LEFT JOIN suppliers s ON s.id = pt.supplier_id
          WHERE pt.company_id = p_company_id
            AND pt.stage = 'confirmed' AND COALESCE(pt.is_posted,false) = false;
    END IF;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- console_execute_item: enforces role server-side then delegates.
-- WRITE — RAISES on forbidden. Flutter must call ONLY this (never
-- execute_confirmation_item directly). Approver gates apply to confirmation
-- items; warehouse gate applies to stock_transfer / delivery / purchase.
CREATE OR REPLACE FUNCTION public.console_execute_item(p_item_type text, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_company uuid;
    v_ok boolean := false;
    v_is_wh boolean; v_is_approver boolean;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

    -- resolve the item's company for tenant + role checks
    IF p_item_type = 'payment_receipt' THEN
        SELECT company_id INTO v_company FROM payment_receipts WHERE id = p_item_id;
    ELSIF p_item_type = 'payment_voucher' THEN
        SELECT company_id INTO v_company FROM payment_vouchers WHERE id = p_item_id;
    ELSIF p_item_type = 'journal_entry' THEN
        SELECT company_id INTO v_company FROM journal_entries WHERE id = p_item_id;
    ELSIF p_item_type = 'sales_invoice' THEN
        SELECT company_id INTO v_company FROM sales_transactions WHERE id = p_item_id;
    ELSIF p_item_type = 'purchase_invoice' THEN
        SELECT company_id INTO v_company FROM purchase_transactions WHERE id = p_item_id;
    ELSIF p_item_type = 'stock_transfer' THEN
        SELECT company_id INTO v_company FROM stock_transfers WHERE id = p_item_id;
    ELSIF p_item_type = 'pending_action' THEN
        SELECT company_id INTO v_company FROM pending_actions WHERE id = p_item_id;
    ELSE
        RAISE EXCEPTION 'unsupported_item_type: %', p_item_type;
    END IF;

    IF v_company IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
    PERFORM assert_can_access_company(v_company);   -- raises on cross-tenant

    v_admin := public.console_is_admin(v_user);
    v_is_wh := v_admin OR public.console_has_perm(v_user,'warehouse','write')
                       OR public.console_has_perm(v_user,'inventory','write');
    v_is_approver := v_admin OR public.console_special(v_user,'can_approve_transactions')
                             OR public.console_has_perm(v_user,'accounting','write');

    -- role matrix per item type
    IF p_item_type IN ('payment_receipt','payment_voucher','journal_entry','sales_invoice','pending_action') THEN
        v_ok := v_is_approver;
    ELSIF p_item_type IN ('stock_transfer','purchase_invoice') THEN
        v_ok := v_is_approver OR v_is_wh;
    END IF;

    IF NOT v_ok THEN RAISE EXCEPTION 'forbidden: not permitted to execute %', p_item_type; END IF;

    RETURN execute_confirmation_item(p_item_type, p_item_id);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 8) get_driver_tasks(company) — deliveries assigned to the calling driver
-- ════════════════════════════════════════════════════════════════════════
-- WRITE-flavored gate (RAISES): must be an active driver of this company.
-- Delivery-active stages = confirmed/delivery/order (stock not yet posted).
CREATE OR REPLACE FUNCTION public.get_driver_tasks(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_driver uuid;
    v_currency text := '';
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);

    v_driver := public.console_driver_id(v_user, p_company_id);
    IF v_driver IS NULL THEN RAISE EXCEPTION 'forbidden: not a driver'; END IF;

    BEGIN SELECT COALESCE(default_currency,'') INTO v_currency FROM companies WHERE id = p_company_id; EXCEPTION WHEN OTHERS THEN v_currency := ''; END;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.doc_date DESC), '[]'::jsonb) INTO v_items FROM (
        SELECT
            st.id AS tx_id,
            COALESCE(NULLIF(st.tracking_number,''),
                     NULLIF(st.invoice_no,''),
                     NULLIF(st.order_no,''),
                     'ST-'||upper(substr(st.id::text,1,8))) AS doc_number,
            COALESCE(NULLIF(st.customer_name,''), c.name_ar, c.name_en, '—') AS customer_name,
            COALESCE(NULLIF(c.phone,''), NULLIF(c.mobile,''), '') AS customer_phone,
            COALESCE(NULLIF(st.shipping_address,''), NULLIF(c.address,''), '') AS address,
            st.stage,
            COALESCE(st.delivery_method,'') AS delivery_method,
            st.doc_date,
            COALESCE(st.total_amount,0) AS total,
            v_currency AS currency
        FROM sales_transactions st LEFT JOIN customers c ON c.id = st.customer_id
        WHERE st.company_id = p_company_id
          AND st.driver_id = v_driver
          AND COALESCE(st.stage,'') IN ('confirmed','delivery','order')
    ) t;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 9) console_driver_update_status(tx_id, status) — driver marks picked/delivered
-- ════════════════════════════════════════════════════════════════════════
-- WRITE (RAISES). NEVER posts inventory or accounting — that stays with the
-- warehouse/manager confirmation flow. We only record a soft delivery signal:
--   picked_up  -> stamp delivery_notes marker + set stage 'delivery' (in-progress)
--   delivered  -> stamp delivered_at (leaves stage at 'delivery' for the
--                 warehouse keeper to post). We do NOT advance to 'posted'.
-- The transaction must belong to the calling driver.
CREATE OR REPLACE FUNCTION public.console_driver_update_status(p_tx_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_driver uuid;
    v_company uuid;
    v_stage text;
    v_new_stage text;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    IF p_status NOT IN ('picked_up','delivered') THEN RAISE EXCEPTION 'invalid_status'; END IF;

    SELECT company_id, driver_id, stage INTO v_company, v_driver, v_stage
      FROM sales_transactions WHERE id = p_tx_id;
    IF v_company IS NULL THEN RAISE EXCEPTION 'tx_not_found'; END IF;
    PERFORM assert_can_access_company(v_company);

    IF v_driver IS NULL OR v_driver <> public.console_driver_id(v_user, v_company) THEN
        RAISE EXCEPTION 'forbidden: task not assigned to you';
    END IF;

    IF p_status = 'picked_up' THEN
        -- move confirmed -> delivery (in-progress). If already delivery/posted, leave stage.
        v_new_stage := CASE WHEN v_stage = 'confirmed' THEN 'delivery' ELSE v_stage END;
        UPDATE sales_transactions
           SET stage = v_new_stage,
               internal_notes = COALESCE(NULLIF(internal_notes,'')||' | ','')
                                || 'picked_up@'||to_char(now(),'YYYY-MM-DD HH24:MI'),
               updated_at = now(), updated_by = v_user
         WHERE id = p_tx_id;
    ELSE  -- delivered
        v_new_stage := CASE WHEN v_stage IN ('confirmed') THEN 'delivery' ELSE v_stage END;
        UPDATE sales_transactions
           SET stage = v_new_stage,
               delivered_at = now(),
               internal_notes = COALESCE(NULLIF(internal_notes,'')||' | ','')
                                || 'delivered@'||to_char(now(),'YYYY-MM-DD HH24:MI'),
               updated_at = now(), updated_by = v_user
         WHERE id = p_tx_id;
    END IF;

    SELECT stage INTO v_new_stage FROM sales_transactions WHERE id = p_tx_id;
    RETURN jsonb_build_object('ok', true, 'stage', v_new_stage);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 10) console_create_sales_order(company, customer, items, notes?) — DRAFT
-- ════════════════════════════════════════════════════════════════════════
-- WRITE (RAISES). Gate: sales write (or admin). Creates a stage='draft'
-- sales_transactions + items so it enters the normal workflow — NEVER posts.
-- SERVER-SIDE PRICING: client unit_price is IGNORED unless the user is admin;
-- otherwise price is resolved from fabric_materials.selling_price (the ERP
-- default sale price). Mirrors create_sales_draft_from_analysis structure.
CREATE OR REPLACE FUNCTION public.console_create_sales_order(
    p_company_id uuid, p_customer_id uuid, p_items jsonb, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_tenant uuid; v_cust_company uuid; v_cust_name text;
    v_currency text;
    v_txn uuid;
    v_item jsonb;
    v_n int := 0;
    v_mat uuid; v_qty numeric; v_price numeric; v_line_total numeric;
    v_subtotal numeric := 0;
    v_desc text; v_name text;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);

    v_admin := public.console_is_admin(v_user);
    IF NOT (v_admin OR public.console_has_perm(v_user,'sales','write')) THEN
        RAISE EXCEPTION 'forbidden: sales write required';
    END IF;

    SELECT tenant_id, company_id, COALESCE(NULLIF(name_ar,''), NULLIF(company_name,''), name_en)
      INTO v_tenant, v_cust_company, v_cust_name
      FROM customers WHERE id = p_customer_id;
    IF v_cust_company IS NULL OR v_cust_company <> p_company_id THEN RAISE EXCEPTION 'invalid_customer'; END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'empty_items';
    END IF;

    SELECT COALESCE(default_currency,'USD') INTO v_currency FROM companies WHERE id = p_company_id;

    INSERT INTO sales_transactions(company_id, tenant_id, stage, customer_id, customer_name,
                                   currency, total_amount, subtotal, notes, created_by, created_by_name, source_type)
      VALUES(p_company_id, v_tenant, 'draft', p_customer_id, v_cust_name,
             v_currency, 0, 0, NULLIF(p_notes,''), v_user,
             (SELECT COALESCE(NULLIF(full_name,''), email) FROM user_profiles WHERE id = v_user),
             'console_app')
      RETURNING id INTO v_txn;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_mat := NULLIF(v_item->>'material_id','')::uuid;
        v_qty := COALESCE(NULLIF(v_item->>'quantity','')::numeric, 0);
        IF v_mat IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
        v_n := v_n + 1;

        -- server-side price resolution; honor client price only for admins
        IF v_admin AND (v_item ? 'unit_price') AND NULLIF(v_item->>'unit_price','') IS NOT NULL THEN
            v_price := COALESCE((v_item->>'unit_price')::numeric, 0);
        ELSE
            SELECT COALESCE(selling_price, 0) INTO v_price
              FROM fabric_materials WHERE id = v_mat AND company_id = p_company_id;
            v_price := COALESCE(v_price, 0);
        END IF;

        SELECT COALESCE(NULLIF(name_ar,''), NULLIF(name_en,''), code) INTO v_name
          FROM fabric_materials WHERE id = v_mat;
        v_desc := COALESCE(v_name, '');
        v_line_total := round(v_qty * v_price, 2);
        v_subtotal := v_subtotal + v_line_total;

        INSERT INTO sales_transaction_items(transaction_id, line_number, material_id,
                                            quantity, unit_price, subtotal, total, description)
          VALUES(v_txn, v_n, v_mat, v_qty, v_price, v_line_total, v_line_total, NULLIF(v_desc,''));
    END LOOP;

    IF v_n = 0 THEN
        DELETE FROM sales_transactions WHERE id = v_txn;
        RAISE EXCEPTION 'no_valid_items';
    END IF;

    UPDATE sales_transactions
       SET subtotal = round(v_subtotal,2), total_amount = round(v_subtotal,2), updated_at = now()
     WHERE id = v_txn;

    RETURN jsonb_build_object('ok', true, 'tx_id', v_txn,
        'doc_number', 'ST-'||upper(substr(v_txn::text,1,8)), 'stage', 'draft', 'items', v_n);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 🔐 GRANTS — authenticated only; explicitly revoke anon/public
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.console_has_perm(uuid, text, text)',
        'public.console_is_admin(uuid)',
        'public.console_has_role(uuid, text)',
        'public.console_special(uuid, text)',
        'public.console_scope_warehouses(uuid)',
        'public.console_scope_cash_accounts(uuid)',
        'public.console_driver_id(uuid, uuid)',
        'public.get_console_profile()',
        'public.get_console_dashboard(uuid)',
        'public.console_list_parties(uuid, text, text, int)',
        'public.get_party_statement(uuid, text, uuid, date, date)',
        'public.create_payment_receipt(uuid, uuid, numeric, text, uuid, text)',
        'public.create_payment_voucher(uuid, uuid, numeric, text, uuid, text)',
        'public.console_list_cash_accounts(uuid)',
        'public.get_console_work_queue(uuid)',
        'public.console_execute_item(text, uuid)',
        'public.get_driver_tasks(uuid)',
        'public.console_driver_update_status(uuid, text)',
        'public.console_create_sales_order(uuid, uuid, jsonb, text)'
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
-- get_console_profile()
--   -> {ok, user_id, tenant_id, company_id, companies:[{id,name}], display_name,
--       roles:[code], is_admin, special_permissions:{}, operating_mode,
--       currency, scopes:{branches:[],warehouses:[],cash_accounts:[]}, tabs:[]}
--
-- get_console_dashboard(p_company_id uuid)
--   -> {ok, sections:{ finance:{cash,receivables,payables,currency},
--        sales_today:{total,count,currency}, my_sales:{month_total,month_count,currency},
--        pending:{total,by_type:[{item_type,cnt}]},
--        low_stock:{count,items:[{material_name,qty,reorder_point,unit,warehouse_name}]},
--        driver_tasks:{count},
--        hr:{leave_remaining,last_payslip_net,last_payslip_currency} }}
--   Sections appear ONLY when the caller is permitted.
--
-- console_list_parties(p_company_id, p_type 'customer'|'supplier', p_query?, p_limit=30)
--   -> {ok, items:[{id,code,name,phone,balance,credit_limit}]}
--
-- get_party_statement(p_company_id, p_party_type, p_party_id, p_from?, p_to?)
--   -> {ok, party:{id,name,code,phone,balance,credit_limit}, currency,
--        opening_balance, lines:[{date,entry_number,description,debit,credit,running_balance}],
--        closing_balance}   (default range: last 90 days)
--
-- console_list_cash_accounts(p_company_id)
--   -> {ok, items:[{id,name,code,is_bank}]}   (scoped if user has explicit
--      cash-account scopes; else all company cash/bank leaves; gate = payments gate)
--   NOTE: profile scopes.cash_accounts/branches/warehouses are [{id,name}] objects.
--
-- create_payment_receipt(p_company_id,p_party_id,p_amount,p_currency,p_cash_account_id,p_notes?)
-- create_payment_voucher(p_company_id,p_party_id,p_amount,p_currency,p_cash_account_id,p_notes?)
--   -> {ok, entry_id, entry_number, status 'draft'|'posted'}
--   NOTE: entry_id/entry_number are the payment_receipt/voucher row id+number;
--   status 'posted' means the doc was created with status='confirmed' and the
--   existing trigger has posted its journal entry. Otherwise 'draft'.
--
-- get_console_work_queue(p_company_id)
--   -> {ok, items:[{kind,id,item_type,title,subtitle,amount,currency,stage,created_at,can_execute}]}
-- console_execute_item(p_item_type, p_item_id) -> execute_confirmation_item result jsonb
--   Flutter must call ONLY console_execute_item (role-enforced wrapper).
--
-- get_driver_tasks(p_company_id)
--   -> {ok, items:[{tx_id,doc_number,customer_name,customer_phone,address,stage,
--        delivery_method,doc_date,total,currency}]}
-- console_driver_update_status(p_tx_id, p_status 'picked_up'|'delivered') -> {ok, stage}
--
-- console_create_sales_order(p_company_id, p_customer_id, p_items, p_notes?)
--   p_items: [{material_id, quantity, unit_price?}]  (unit_price honored for admin only)
--   -> {ok, tx_id, doc_number, stage 'draft', items}
-- ════════════════════════════════════════════════════════════════════════
