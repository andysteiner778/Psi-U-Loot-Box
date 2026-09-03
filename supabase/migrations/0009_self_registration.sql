-- ============================================================================
--  HOUSE LOOT — 0009  SELF-REGISTRATION
-- ============================================================================
--  Pre-seeding 30 placeholder players meant the owner had to rename every one
--  of them before the party, and anyone whose name was missing simply could not
--  play. Instead: type your name, choose a PIN, and the account is created on
--  the spot.
--
--  ONE FUNCTION, NOT TWO. Checking "does this name exist?" and then creating it
--  in a separate statement is a race: two people typing the same name at the
--  same moment both see "free" and one insert fails with a raw constraint
--  error. This resolves login-or-register atomically and lets the unique index
--  arbitrate.
--
--  NAMES ARE MATCHED CASE-INSENSITIVELY. `name TEXT UNIQUE` would happily hold
--  both "andy" and "Andy" as separate accounts, so someone would log in, see an
--  empty balance, and reasonably conclude the app had eaten their money.
-- ============================================================================

-- Normalise existing names before adding the case-insensitive index, or it will
-- fail on any pair that already collides.
UPDATE public.profiles p SET name = p.name || ' (' || left(p.id::TEXT, 4) || ')'
 WHERE EXISTS (
   SELECT 1 FROM public.profiles q
    WHERE lower(q.name) = lower(p.name) AND q.id < p.id
 );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_name_ci_idx ON public.profiles (lower(name));

-- ---------------------------------------------------------------------------
--  auth_login_or_register(name, pin)
--
--  Existing name -> behaves exactly like auth_verify_pin, lockout included.
--  New name      -> creates the profile and its PIN in one transaction.
--
--  Returns zero rows for a wrong PIN on an existing account, which is the same
--  answer the old function gave. Note this DOES reveal whether a name is taken:
--  unavoidable once players pick their own names, and harmless here, since the
--  alternative is silently creating a second account for someone who mistyped
--  their own PIN.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_login_or_register(p_name TEXT, p_pin TEXT)
RETURNS TABLE (profile_id UUID, name TEXT, role TEXT, must_change BOOLEAN, created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app_private, extensions, pg_temp
AS $fn$
DECLARE
  v_clean TEXT;
  v_id    UUID;
  v_first BOOLEAN;
BEGIN
  v_clean := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));

  IF length(v_clean) < 2 OR length(v_clean) > 24 THEN
    RAISE EXCEPTION 'Name must be 2-24 characters' USING ERRCODE = 'PT400';
  END IF;
  IF p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits' USING ERRCODE = 'PT400';
  END IF;

  SELECT p.id INTO v_id FROM public.profiles p WHERE lower(p.name) = lower(v_clean);

  -- ---- Existing account: ordinary login, lockout and all ------------------
  IF FOUND THEN
    v_id := app_private.verify_pin((SELECT p.name FROM public.profiles p WHERE p.id = v_id), p_pin);
    IF v_id IS NULL THEN
      RETURN;  -- wrong PIN
    END IF;
    RETURN QUERY
      SELECT p.id, p.name, p.role, s.must_change, FALSE
        FROM public.profiles p
        JOIN app_private.profile_secrets s ON s.profile_id = p.id
       WHERE p.id = v_id;
    RETURN;
  END IF;

  -- ---- New account --------------------------------------------------------
  -- The very first account to exist becomes the admin, so a fresh database is
  -- never left with nobody able to reach the house controls.
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO v_first;

  BEGIN
    INSERT INTO public.profiles (name, role)
    VALUES (v_clean, CASE WHEN v_first THEN 'admin' ELSE 'player' END)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Someone claimed this name between our SELECT and our INSERT. Fall back to
    -- treating it as a login attempt rather than surfacing a constraint error.
    SELECT p.id INTO v_id FROM public.profiles p WHERE lower(p.name) = lower(v_clean);
    v_id := app_private.verify_pin((SELECT p.name FROM public.profiles p WHERE p.id = v_id), p_pin);
    IF v_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
      SELECT p.id, p.name, p.role, s.must_change, FALSE
        FROM public.profiles p
        JOIN app_private.profile_secrets s ON s.profile_id = p.id
       WHERE p.id = v_id;
    RETURN;
  END;

  INSERT INTO app_private.profile_secrets (profile_id, pin_hash, must_change)
  VALUES (v_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), FALSE);

  RETURN QUERY
    SELECT p.id, p.name, p.role, FALSE, TRUE
      FROM public.profiles p WHERE p.id = v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.auth_login_or_register(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auth_login_or_register(TEXT, TEXT) TO service_role;
