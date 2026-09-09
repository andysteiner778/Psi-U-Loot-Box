-- ---------------------------------------------------------------------------
--  0057 — a party is not a bank: 10 tries, and a 60-second cool-off
--
--  Five wrong PINs bought a FIFTEEN MINUTE lockout, which is a sensible rule
--  for a login form on the internet and a bad one for a phone being passed
--  around a house. The owner hit it on his own admin account mid-setup and was
--  simply locked out of his own app with no way back in except a script.
--
--  Ten attempts, then sixty seconds. That still defeats the only real threat
--  here -- somebody idly guessing a 4-digit PIN on a borrowed phone, who would
--  need 10,000 guesses and over an hour and a half of sitting there -- while
--  costing an honest person who fat-fingered it a minute rather than a
--  quarter of an hour.
--
--  Both numbers are read from config so they can be retuned mid-party without
--  a deploy, and default to the same values if the keys are missing.
-- ---------------------------------------------------------------------------

UPDATE public.config SET value = value || jsonb_build_object(
  'pin_max_attempts',   10,
  'pin_lockout_seconds', 60
) WHERE key = 'settings';

CREATE OR REPLACE FUNCTION app_private.verify_pin(p_name TEXT, p_pin TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'app_private', 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  r        RECORD;
  cfg      JSONB;
  v_max    INT;
  v_secs   INT;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_max  := GREATEST(1, COALESCE((cfg->>'pin_max_attempts')::INT, 10));
  v_secs := GREATEST(1, COALESCE((cfg->>'pin_lockout_seconds')::INT, 60));

  SELECT p.id, s.pin_hash, s.failed_attempts, s.locked_until
    INTO r
    FROM public.profiles p
    JOIN app_private.profile_secrets s ON s.profile_id = p.id
   WHERE p.name = p_name
   FOR UPDATE OF s;

  IF NOT FOUND THEN
    -- Equalise timing so a wrong name is indistinguishable from a wrong PIN.
    PERFORM extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
    RETURN NULL;
  END IF;

  IF r.locked_until IS NOT NULL AND r.locked_until > NOW() THEN
    RAISE EXCEPTION 'Too many attempts' USING ERRCODE = 'PT429';
  END IF;

  IF extensions.crypt(p_pin, r.pin_hash) = r.pin_hash THEN
    UPDATE app_private.profile_secrets
       SET failed_attempts = 0, locked_until = NULL WHERE profile_id = r.id;
    RETURN r.id;
  END IF;

  UPDATE app_private.profile_secrets
     SET failed_attempts = failed_attempts + 1,
         locked_until = CASE
           WHEN failed_attempts + 1 >= v_max
           THEN NOW() + (v_secs || ' seconds')::INTERVAL
         END
   WHERE profile_id = r.id;
  RETURN NULL;
END;
$fn$;
