-- 20260703e_supplier_portal.sql
-- Supplier Cabinet V1 — portal accounts, invites, telegram link codes.
-- Suppliers NEVER get direct table access; all reads/writes go through the
-- supplier-portal edge fn (service key + explicit server-side filtering).
-- The only RLS grants here are tenant-manage (staff) + a self-select on
-- supplier_portal_accounts so a supplier can confirm their own account exists.
-- Idempotent.

-- ── suppliers: telegram_chat_id for direct supplier telegram later ──
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

-- ── portal accounts (1 auth user ↔ 1 supplier) ──
CREATE TABLE IF NOT EXISTS public.supplier_portal_accounts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id  uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    auth_user_id uuid NOT NULL UNIQUE,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_portal_accounts_supplier ON public.supplier_portal_accounts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_portal_accounts_tenant ON public.supplier_portal_accounts(tenant_id);

-- ── portal invites (staff generates code → supplier redeems) ──
CREATE TABLE IF NOT EXISTS public.supplier_portal_invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    code        text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_portal_invites_supplier ON public.supplier_portal_invites(supplier_id);

-- ── supplier telegram link codes (cabinet → deep-link → set chat_id) ──
CREATE TABLE IF NOT EXISTS public.supplier_telegram_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    code        text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── auto_set_tenant_id triggers (fn exists) ──
DROP TRIGGER IF EXISTS trg_supplier_portal_accounts_tenant ON public.supplier_portal_accounts;
CREATE TRIGGER trg_supplier_portal_accounts_tenant
    BEFORE INSERT ON public.supplier_portal_accounts
    FOR EACH ROW EXECUTE FUNCTION public.auto_set_tenant_id();
DROP TRIGGER IF EXISTS trg_supplier_portal_invites_tenant ON public.supplier_portal_invites;
CREATE TRIGGER trg_supplier_portal_invites_tenant
    BEFORE INSERT ON public.supplier_portal_invites
    FOR EACH ROW EXECUTE FUNCTION public.auto_set_tenant_id();
DROP TRIGGER IF EXISTS trg_supplier_telegram_codes_tenant ON public.supplier_telegram_codes;
CREATE TRIGGER trg_supplier_telegram_codes_tenant
    BEFORE INSERT ON public.supplier_telegram_codes
    FOR EACH ROW EXECUTE FUNCTION public.auto_set_tenant_id();

-- ── RLS ──
ALTER TABLE public.supplier_portal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_portal_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_telegram_codes ENABLE ROW LEVEL SECURITY;

-- staff (authenticated, same tenant) manage everything
DROP POLICY IF EXISTS spa_tenant_manage ON public.supplier_portal_accounts;
CREATE POLICY spa_tenant_manage ON public.supplier_portal_accounts
    TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id())
    WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

-- a supplier user may SELECT their own account row (confirm linkage in-app)
DROP POLICY IF EXISTS spa_self_select ON public.supplier_portal_accounts;
CREATE POLICY spa_self_select ON public.supplier_portal_accounts
    FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS spi_tenant_manage ON public.supplier_portal_invites;
CREATE POLICY spi_tenant_manage ON public.supplier_portal_invites
    TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id())
    WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS stc_tenant_manage ON public.supplier_telegram_codes;
CREATE POLICY stc_tenant_manage ON public.supplier_telegram_codes
    TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id())
    WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_portal_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_portal_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_telegram_codes TO authenticated;

-- ── enrich enqueue_order_agent_tasks: include supplier telegram_chat_id in
--    the recipient jsonb so future supplier tasks can reach them DIRECTLY.
--    Copied verbatim from live \sf; ONLY the supplier branch recipient is
--    changed (adds chat_id via a lookup on suppliers). Everything else EXACT. ──
CREATE OR REPLACE FUNCTION public.enqueue_order_agent_tasks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_stage RECORD;
    v_task JSONB;
    v_sup RECORD;
    v_member RECORD;
    v_recipient JSONB;
    v_chain JSONB;
    v_primary TEXT;
    v_sup_chat TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_stage FROM ecommerce_workflow_stages
    WHERE code = NEW.status
      AND doc_type = 'ecom_order'
      AND is_active = true
      AND (store_id = NEW.store_id OR store_id IS NULL)
    ORDER BY store_id NULLS LAST
    LIMIT 1;

    IF v_stage IS NULL OR COALESCE((v_stage.automation_config->>'enabled')::boolean, false) = false THEN
        RETURN NEW;
    END IF;

    FOR v_task IN SELECT * FROM jsonb_array_elements(COALESCE(v_stage.automation_config->'tasks', '[]'::jsonb))
    LOOP
        v_primary := COALESCE(v_task->>'task_type', 'telegram');
        -- chain: الخطوة الأساسية + الخطوات الاحتياطية (fallback_steps)
        v_chain := jsonb_build_array(jsonb_build_object(
            'channel', v_primary,
            'wait_minutes', COALESCE((v_task->>'timeout_minutes')::int, 120),
            'prompt', v_task->>'call_prompt'
        )) || COALESCE(v_task->'fallback_steps', '[]'::jsonb);

        IF v_task->>'recipient_type' = 'supplier' THEN
            FOR v_sup IN
                SELECT id, supplier_id, supplier_name, supplier_phone
                FROM ecommerce_order_suppliers
                WHERE order_id = NEW.id AND status IN ('pending')
            LOOP
                -- enrich: direct supplier telegram chat_id (if the supplier linked their telegram)
                v_sup_chat := NULL;
                IF v_sup.supplier_id IS NOT NULL THEN
                    SELECT s.telegram_chat_id INTO v_sup_chat FROM suppliers s WHERE s.id = v_sup.supplier_id;
                END IF;
                INSERT INTO ecommerce_agent_tasks
                    (tenant_id, store_id, order_id, supplier_row_id, stage_code, task_type,
                     recipient_type, recipient, payload, advance_to, chain)
                VALUES
                    (NEW.tenant_id, NEW.store_id, NEW.id, v_sup.id, NEW.status, v_primary,
                     'supplier',
                     jsonb_build_object('name', v_sup.supplier_name, 'phone', v_sup.supplier_phone, 'supplier_id', v_sup.supplier_id)
                        || CASE WHEN v_sup_chat IS NOT NULL THEN jsonb_build_object('chat_id', v_sup_chat) ELSE '{}'::jsonb END,
                     v_task, v_task->>'advance_to', v_chain);
            END LOOP;
        ELSE
            v_recipient := '{}'::jsonb;
            IF v_task->>'recipient_type' = 'customer' THEN
                v_recipient := jsonb_build_object('name', NEW.customer_name, 'phone', NEW.customer_phone, 'email', NEW.customer_email);
            ELSIF v_task->>'role' IS NOT NULL THEN
                -- حل المستلم من دليل الفريق (أول عضو نشط بالدور)
                SELECT * INTO v_member FROM ops_team_members
                WHERE tenant_id = NEW.tenant_id AND role = v_task->>'role' AND is_active = true
                ORDER BY created_at LIMIT 1;
                IF v_member.id IS NOT NULL THEN
                    v_recipient := jsonb_build_object(
                        'name', v_member.name, 'phone', v_member.phone,
                        'chat_id', v_member.telegram_chat_id,
                        'nexa_user_id', v_member.nexa_user_id,
                        'extension', v_member.extension,
                        'member_id', v_member.id);
                END IF;
            ELSIF v_task->>'custom_chat_id' IS NOT NULL THEN
                v_recipient := jsonb_build_object('chat_id', v_task->>'custom_chat_id');
            END IF;

            INSERT INTO ecommerce_agent_tasks
                (tenant_id, store_id, order_id, stage_code, task_type,
                 recipient_type, recipient, payload, advance_to, chain, role)
            VALUES
                (NEW.tenant_id, NEW.store_id, NEW.id, NEW.status, v_primary,
                 v_task->>'recipient_type', v_recipient, v_task,
                 v_task->>'advance_to', v_chain, v_task->>'role');
        END IF;
    END LOOP;

    RETURN NEW;
END;
$function$;
