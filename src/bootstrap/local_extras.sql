-- ════════════════════════════════════════════════════════════════
-- TexaCore 2.0.0 — objects that exist ONLY on a local install (not in the production baseline).
-- Applied once, right after the baseline. Idempotent. ON_ERROR_STOP.
--
-- 1. public.platform_admin + public.verify_admin_password(text): the admin-portal ("view all companies") gate.
--    The hash lives server-side; anon may only ASK whether a password is right, never read the hash. The call throttles
--    guesses (5 failures lock the gate for a growing 1..15 minutes) because this endpoint can sit behind a public tunnel.
-- ════════════════════════════════════════════════════════════════
SET client_min_messages = warning;

CREATE TABLE IF NOT EXISTS public.platform_admin (
  id              smallint PRIMARY KEY DEFAULT 1,
  password_hash   text,
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_singleton CHECK (id = 1)
);
ALTER TABLE public.platform_admin ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.platform_admin ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- The hash is never readable directly. Production's default privileges hand new tables to anon/authenticated, so this
-- must be explicit, and RLS is on with no policy at all (deny by default for every API role).
ALTER TABLE public.platform_admin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admin FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_admin_password(p_input text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $func$
DECLARE
  v_hash   text;
  v_fail   integer;
  v_locked timestamptz;
  v_ok     boolean;
BEGIN
  SELECT password_hash, failed_attempts, locked_until INTO v_hash, v_fail, v_locked
    FROM public.platform_admin WHERE id = 1 FOR UPDATE;
  IF NOT FOUND OR v_hash IS NULL THEN RETURN false; END IF;
  IF v_locked IS NOT NULL AND v_locked > now() THEN RETURN false; END IF;
  v_ok := (v_hash = crypt(COALESCE(p_input, ''), v_hash));
  IF v_ok THEN
    IF v_fail <> 0 OR v_locked IS NOT NULL THEN
      UPDATE public.platform_admin SET failed_attempts = 0, locked_until = NULL WHERE id = 1;
    END IF;
    RETURN true;
  END IF;
  v_fail := v_fail + 1;
  UPDATE public.platform_admin
     SET failed_attempts = v_fail,
         locked_until = CASE WHEN v_fail >= 5 THEN now() + make_interval(mins => LEAST(15, power(2, v_fail - 5)::int)) ELSE NULL END
   WHERE id = 1;
  RETURN false;
END;
$func$;

REVOKE ALL ON FUNCTION public.verify_admin_password(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_password(text) TO anon, authenticated, service_role;
