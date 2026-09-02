-- ============================================================================
--  HOUSE LOOT — 0004  SESSION & AUTH API
-- ============================================================================
--  app_private is intentionally invisible to PostgREST, which is exactly what
--  makes it safe — and also means supabase-js cannot read or write it directly.
--  These SECURITY DEFINER wrappers in `public` are the only doorway, and they
--  are granted to service_role alone.
--
--  Each one exposes a single verb rather than table access, so even a compromised
--  service role cannot enumerate PIN hashes: there is no function that returns one.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Auth
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_verify_pin(p_name TEXT, p_pin TEXT)
RETURNS TABLE (profile_id UUID, name TEXT, role TEXT, must_change BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp
AS $fn$
DECLARE v_id UUID;
BEGIN
  v_id := app_private.verify_pin(p_name, p_pin);  -- raises PT429 when locked out
  IF v_id IS NULL THEN
    RETURN;  -- zero rows = wrong name or wrong PIN, indistinguishable to the caller
  END IF;

  RETURN QUERY
    SELECT p.id, p.name, p.role, s.must_change
      FROM public.profiles p
      JOIN app_private.profile_secrets s ON s.profile_id = p.id
     WHERE p.id = v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.auth_set_pin(p_profile_id UUID, p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp
AS $fn$
BEGIN
  PERFORM app_private.set_pin(p_profile_id, p_pin);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  Sessions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.session_create(
  p_profile_id UUID, p_token_hash TEXT, p_expires TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp
AS $fn$
BEGIN
  INSERT INTO app_private.sessions (token_hash, profile_id, expires_at)
  VALUES (p_token_hash, p_profile_id, p_expires);

  -- Opportunistic GC. Cheap at this row count and saves a cron job.
  DELETE FROM app_private.sessions WHERE expires_at < NOW();
END;
$fn$;

/**
 * Resolve a session to its player in ONE round trip, and only if unexpired.
 * Returns zero rows for an unknown, expired or revoked token.
 */
CREATE OR REPLACE FUNCTION public.session_lookup(p_token_hash TEXT)
RETURNS TABLE (id UUID, name TEXT, role TEXT, must_change BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app_private, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
    SELECT p.id, p.name, p.role, sec.must_change
      FROM app_private.sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      LEFT JOIN app_private.profile_secrets sec ON sec.profile_id = p.id
     WHERE s.token_hash = p_token_hash
       AND s.expires_at > NOW();
END;
$fn$;

CREATE OR REPLACE FUNCTION public.session_destroy(p_token_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp
AS $fn$
BEGIN
  DELETE FROM app_private.sessions WHERE token_hash = p_token_hash;
END;
$fn$;

/** Sign a player out everywhere. For the admin, when someone loses a phone. */
CREATE OR REPLACE FUNCTION public.session_destroy_all(p_profile_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, pg_temp
AS $fn$
DECLARE n INT;
BEGIN
  DELETE FROM app_private.sessions WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

-- ---------------------------------------------------------------------------
--  Grants. ALTER DEFAULT PRIVILEGES in 0003 already revoked EXECUTE from
--  PUBLIC for functions created after it, but be explicit rather than rely on
--  migration ordering.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.auth_verify_pin(TEXT, TEXT)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auth_set_pin(UUID, TEXT)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.session_create(UUID, TEXT, TIMESTAMPTZ)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.session_lookup(TEXT)                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.session_destroy(TEXT)                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.session_destroy_all(UUID)                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.auth_verify_pin(TEXT, TEXT)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_set_pin(UUID, TEXT)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.session_create(UUID, TEXT, TIMESTAMPTZ)         TO service_role;
GRANT EXECUTE ON FUNCTION public.session_lookup(TEXT)                            TO service_role;
GRANT EXECUTE ON FUNCTION public.session_destroy(TEXT)                           TO service_role;
GRANT EXECUTE ON FUNCTION public.session_destroy_all(UUID)                       TO service_role;

-- ---------------------------------------------------------------------------
--  Roster for the login dropdown. Names only — no balances, no roles, no PINs.
--  Still service_role only: it is served by a server component, not fetched
--  from the browser.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.player_roster()
RETURNS TABLE (id UUID, name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT p.id, p.name FROM public.profiles p ORDER BY p.name;
$fn$;

REVOKE EXECUTE ON FUNCTION public.player_roster() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.player_roster() TO service_role;
