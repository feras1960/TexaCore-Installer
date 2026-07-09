-- ══════════════════════════════════════════════════════════════════════════════
-- 📨 Storefront contact / wholesale-request inbox (Tkanex / Obuvix / any store)
-- Date: 2026-07-05
-- Purpose:
--   The website Contact and Wholesale forms were placeholders (setTimeout, no
--   backend). This durable, per-tenant inbox captures every submission. Anyone
--   (anon) may submit a message for an ACTIVE store; a BEFORE-INSERT trigger
--   stamps the store's tenant_id and forces safe defaults. ERP tenant members
--   read/triage their own tenant's messages (RLS by get_current_tenant_id()).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.storefront_contact_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id   UUID NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
    tenant_id  UUID,                              -- filled from the store by trigger
    kind       TEXT NOT NULL DEFAULT 'contact',   -- contact | wholesale
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    subject    TEXT,
    message    TEXT NOT NULL,
    meta       JSONB NOT NULL DEFAULT '{}'::jsonb, -- company type, annual volume… (wholesale)
    locale     TEXT,
    status     TEXT NOT NULL DEFAULT 'new',        -- new | read | archived
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sfc_tenant_status
    ON public.storefront_contact_messages(tenant_id, status, created_at DESC);

-- Stamp tenant_id from the store + sanitize on insert (SECURITY DEFINER so anon
-- can resolve the store's tenant without direct table access).
CREATE OR REPLACE FUNCTION public.storefront_contact_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ecommerce_stores WHERE id = NEW.store_id;
    IF NEW.tenant_id IS NULL THEN
        RAISE EXCEPTION 'invalid store';
    END IF;
    NEW.status  := 'new';
    NEW.kind    := COALESCE(NULLIF(NEW.kind, ''), 'contact');
    IF NEW.kind NOT IN ('contact', 'wholesale') THEN NEW.kind := 'contact'; END IF;
    NEW.name    := left(COALESCE(NEW.name, ''), 200);
    NEW.email   := left(COALESCE(NEW.email, ''), 200);
    NEW.phone   := left(COALESCE(NEW.phone, ''), 60);
    NEW.subject := left(COALESCE(NEW.subject, ''), 200);
    NEW.message := left(COALESCE(NEW.message, ''), 5000);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_storefront_contact_before_insert ON public.storefront_contact_messages;
CREATE TRIGGER trg_storefront_contact_before_insert
    BEFORE INSERT ON public.storefront_contact_messages
    FOR EACH ROW EXECUTE FUNCTION public.storefront_contact_before_insert();

ALTER TABLE public.storefront_contact_messages ENABLE ROW LEVEL SECURITY;

-- Submit: anyone, but only for an ACTIVE store (name + message are NOT NULL).
DROP POLICY IF EXISTS storefront_contact_insert ON public.storefront_contact_messages;
CREATE POLICY storefront_contact_insert ON public.storefront_contact_messages
    FOR INSERT TO anon, authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.ecommerce_stores s
        WHERE s.id = store_id AND s.is_active = true));

-- Read/triage: ERP members of the owning tenant only.
DROP POLICY IF EXISTS storefront_contact_select ON public.storefront_contact_messages;
CREATE POLICY storefront_contact_select ON public.storefront_contact_messages
    FOR SELECT TO authenticated
    USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS storefront_contact_update ON public.storefront_contact_messages;
CREATE POLICY storefront_contact_update ON public.storefront_contact_messages
    FOR UPDATE TO authenticated
    USING (tenant_id = get_current_tenant_id())
    WITH CHECK (tenant_id = get_current_tenant_id());

GRANT INSERT ON public.storefront_contact_messages TO anon, authenticated;
GRANT SELECT, UPDATE ON public.storefront_contact_messages TO authenticated;

NOTIFY pgrst, 'reload schema';
