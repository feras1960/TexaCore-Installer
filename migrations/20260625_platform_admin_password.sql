-- Platform admin portal password gate.
-- Replaces the hardcoded client-side check (adminPasswordInput === 'admin')
-- with a server-verified, hashed password. The installer keeps the hash in
-- sync (default = license key, or a manager-set value) on startup + after
-- restore. anon may ONLY call verify_admin_password(); it cannot read the hash.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.platform_admin (
  id            smallint PRIMARY KEY DEFAULT 1,
  password_hash text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_singleton CHECK (id = 1)
);

-- The hash must never be readable directly — only through the SECURITY DEFINER
-- function below. Revoke everything from the API roles.
REVOKE ALL ON public.platform_admin FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.platform_admin FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.platform_admin FROM authenticated;
  END IF;
END $$;

-- Returns true iff p_input matches the stored bcrypt hash. SECURITY DEFINER so
-- it can read platform_admin while the caller (anon) cannot. Constant-ish work
-- via crypt(); returns false when no password is configured yet.
CREATE OR REPLACE FUNCTION public.verify_admin_password(p_input text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
  SELECT COALESCE(
    (SELECT password_hash = crypt(p_input, password_hash)
       FROM public.platform_admin
      WHERE id = 1 AND password_hash IS NOT NULL),
    false
  );
$func$;

REVOKE ALL ON FUNCTION public.verify_admin_password(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION public.verify_admin_password(text) TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.verify_admin_password(text) TO authenticated;
  END IF;
END $$;
