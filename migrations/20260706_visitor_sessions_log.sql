-- ═══════════════════════════════════════════════════════════════
-- Live Visitors: persistent session log (ecommerce_visitor_sessions)
-- ═══════════════════════════════════════════════════════════════
-- The dashboard records every presence session it observes: one row
-- per visit (entered_at → left_at) with the LAST cart/wishlist
-- snapshot, so departed visitors survive page reloads and the tab can
-- show real history. Tenant-scoped via a BEFORE INSERT trigger.

BEGIN;

CREATE TABLE IF NOT EXISTS ecommerce_visitor_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid,
  visitor_key  text NOT NULL,
  user_id      text,
  is_guest     boolean NOT NULL DEFAULT true,
  name         text,
  phone        text,
  email        text,
  company      text,
  platform     text,             -- 'app' | 'web'
  location     text,
  store_slugs  text[] DEFAULT '{}',
  widget_uuid  text,
  cart         jsonb,
  cart_value   numeric,
  wishlist     jsonb,
  entered_at   timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_tenant_entered
  ON ecommerce_visitor_sessions (tenant_id, entered_at DESC);
-- One OPEN session per visitor per tenant (dashboard re-entry reuses it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_visitor_sessions_open
  ON ecommerce_visitor_sessions (tenant_id, visitor_key)
  WHERE left_at IS NULL;

CREATE OR REPLACE FUNCTION ecommerce_visitor_sessions_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  NEW.tenant_id := coalesce(NEW.tenant_id, get_user_tenant_id());
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_visitor_sessions_stamp
  ON ecommerce_visitor_sessions;
CREATE TRIGGER trg_visitor_sessions_stamp
  BEFORE INSERT OR UPDATE ON ecommerce_visitor_sessions
  FOR EACH ROW EXECUTE FUNCTION ecommerce_visitor_sessions_stamp();

ALTER TABLE ecommerce_visitor_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visitor_sessions_tenant ON ecommerce_visitor_sessions;
CREATE POLICY visitor_sessions_tenant ON ecommerce_visitor_sessions
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_platform_admin())
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_platform_admin());

COMMIT;

NOTIFY pgrst, 'reload schema';
