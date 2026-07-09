-- ═══════════════════════════════════════════════════════════════
-- Live Visitors: dedup + identity enrichment (one row per visitor)
-- ═══════════════════════════════════════════════════════════════
-- Presence reconnect flaps used to insert a fresh session row on every
-- re-entry → the same anonymous visitor showed up many times. This
-- migration moves session open/close into SECURITY DEFINER RPCs that
-- REUSE an existing session (by visitor_key OR by ip+browser when the
-- guest id differs across origins) and bump a visits counter instead.
-- It also stores ip/city/device/browser/os so the table + sheet can
-- show WHO/WHERE. Additive only — no existing rows are touched.

BEGIN;

-- ── New identity/geo columns (additive) ──
ALTER TABLE ecommerce_visitor_sessions
  ADD COLUMN IF NOT EXISTS ip             text,
  ADD COLUMN IF NOT EXISTS country        text,
  ADD COLUMN IF NOT EXISTS city           text,
  ADD COLUMN IF NOT EXISTS device         text,   -- 'mobile' | 'desktop'
  ADD COLUMN IF NOT EXISTS browser        text,
  ADD COLUMN IF NOT EXISTS os             text,
  ADD COLUMN IF NOT EXISTS last_heartbeat timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS visits         int DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_ip_browser
  ON ecommerce_visitor_sessions (tenant_id, ip, browser)
  WHERE left_at IS NULL;

-- ── start_visitor_session: open OR reuse a session, return its id ──
-- Reuse window = 10 min. Same visitor_key OR (same ip+browser) reopens
-- the row (visits++ only when it had actually closed).
CREATE OR REPLACE FUNCTION start_visitor_session(
  p_visitor_key text,
  p_payload     jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid := get_user_tenant_id();
  v_id         uuid;
  v_ip         text := nullif(p_payload->>'ip', '');
  v_browser    text := nullif(p_payload->>'browser', '');
  v_had_closed boolean := false;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no tenant';
  END IF;

  -- Close stale open sessions of this tenant (no heartbeat > 10 min).
  UPDATE ecommerce_visitor_sessions
     SET left_at = last_heartbeat
   WHERE tenant_id = v_tenant
     AND left_at IS NULL
     AND last_heartbeat < now() - interval '10 minutes';

  -- Reuse: same visitor_key, or same ip+browser (merges duplicate guest
  -- ids for the same human), still open OR closed within 10 min.
  SELECT id, (left_at IS NOT NULL)
    INTO v_id, v_had_closed
    FROM ecommerce_visitor_sessions
   WHERE tenant_id = v_tenant
     AND (
           visitor_key = p_visitor_key
        OR (v_ip IS NOT NULL AND v_browser IS NOT NULL
            AND ip = v_ip AND browser = v_browser)
         )
     AND (left_at IS NULL OR left_at > now() - interval '10 minutes')
   ORDER BY entered_at DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE ecommerce_visitor_sessions
       SET left_at        = NULL,
           last_heartbeat = now(),
           visits         = visits + (CASE WHEN v_had_closed THEN 1 ELSE 0 END),
           name        = COALESCE(nullif(p_payload->>'name', ''), name),
           phone       = COALESCE(nullif(p_payload->>'phone', ''), phone),
           email       = COALESCE(nullif(p_payload->>'email', ''), email),
           company     = COALESCE(nullif(p_payload->>'company', ''), company),
           location    = COALESCE(nullif(p_payload->>'location', ''), location),
           ip          = COALESCE(v_ip, ip),
           country     = COALESCE(nullif(p_payload->>'country', ''), country),
           city        = COALESCE(nullif(p_payload->>'city', ''), city),
           device      = COALESCE(nullif(p_payload->>'device', ''), device),
           browser     = COALESCE(v_browser, browser),
           os          = COALESCE(nullif(p_payload->>'os', ''), os),
           widget_uuid = COALESCE(nullif(p_payload->>'widget_uuid', ''), widget_uuid),
           platform    = COALESCE(nullif(p_payload->>'platform', ''), platform),
           store_slugs = COALESCE(
             (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'store_slugs') x),
             store_slugs)
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- No reusable session → insert a fresh one. On the rare open-unique
  -- race (uq_visitor_sessions_open) re-select the winning open row.
  BEGIN
    INSERT INTO ecommerce_visitor_sessions (
      visitor_key, user_id, is_guest, name, phone, email, company,
      platform, location, store_slugs, widget_uuid,
      ip, country, city, device, browser, os,
      entered_at, last_heartbeat, visits
    ) VALUES (
      p_visitor_key,
      nullif(p_payload->>'user_id', ''),
      COALESCE((p_payload->>'is_guest')::boolean, true),
      nullif(p_payload->>'name', ''),
      nullif(p_payload->>'phone', ''),
      nullif(p_payload->>'email', ''),
      nullif(p_payload->>'company', ''),
      nullif(p_payload->>'platform', ''),
      nullif(p_payload->>'location', ''),
      COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'store_slugs') x),
        '{}'::text[]),
      nullif(p_payload->>'widget_uuid', ''),
      v_ip,
      nullif(p_payload->>'country', ''),
      nullif(p_payload->>'city', ''),
      nullif(p_payload->>'device', ''),
      v_browser,
      nullif(p_payload->>'os', ''),
      COALESCE((p_payload->>'entered_at')::timestamptz, now()),
      now(),
      1
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id
      FROM ecommerce_visitor_sessions
     WHERE tenant_id = v_tenant
       AND visitor_key = p_visitor_key
       AND left_at IS NULL
     LIMIT 1;
  END;

  RETURN v_id;
END $$;

-- ── heartbeat_visitor_session: bump heartbeat + latest snapshot ──
CREATE OR REPLACE FUNCTION heartbeat_visitor_session(
  p_id         uuid,
  p_cart       jsonb,
  p_cart_value numeric,
  p_wishlist   jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ecommerce_visitor_sessions
     SET last_heartbeat = now(),
         cart       = COALESCE(p_cart, cart),
         cart_value = COALESCE(p_cart_value, cart_value),
         wishlist   = COALESCE(p_wishlist, wishlist)
   WHERE id = p_id
     AND tenant_id = get_user_tenant_id();
END $$;

-- ── end_visitor_session: close an open session ──
CREATE OR REPLACE FUNCTION end_visitor_session(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ecommerce_visitor_sessions
     SET left_at = now()
   WHERE id = p_id
     AND tenant_id = get_user_tenant_id()
     AND left_at IS NULL;
END $$;

GRANT EXECUTE ON FUNCTION start_visitor_session(text, jsonb)          TO authenticated;
GRANT EXECUTE ON FUNCTION heartbeat_visitor_session(uuid, jsonb, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION end_visitor_session(uuid)                   TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
