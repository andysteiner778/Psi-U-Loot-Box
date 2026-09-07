-- ---------------------------------------------------------------------------
--  0041 — RESET CLEARS VOUCHERS, AND EVERY ACCOUNT STARTS WITH THREE SPINS
--
--  reset_party_state cleared rolls, deposits, balances, scrap and shards, but
--  left `vouchers` untouched. So a "fresh" party started with whatever free
--  spins and half-price tokens had piled up during testing -- unearned rolls
--  against a restocked shelf, and the one bit of state that survived a reset
--  it had no business surviving.
--
--  The exception is the welcome package. Three free spins on signup is the
--  hook, and after a reset everybody is starting the night over, so the reset
--  re-issues it rather than leaving the room with nothing.
--
--  Counts live in config (`welcome_vouchers`) so they can be tuned from House
--  Controls without a migration. Default is the owner's: two on the cheapest
--  box and one on the top one.
--
--  NOTE ON COST. A 100%-off voucher sets the charge to zero, and the respin
--  branch refunds `v_price` -- the DISCOUNTED price -- so a free spin can never
--  refund real cash for money that was never paid. Reward rows still pay their
--  face credit ($1 or $3), which is the only way a free spin mints money, and
--  it is bounded by those two rows.
-- ---------------------------------------------------------------------------

UPDATE public.config SET value = value || jsonb_build_object(
  'welcome_vouchers', jsonb_build_object('tier_0', 2, 'tier_3', 1)
) WHERE key = 'settings';

CREATE OR REPLACE FUNCTION public.grant_welcome_vouchers(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg     JSONB;
  v_spec  JSONB;
  v_tier  TEXT;
  v_n     INT;
  i       INT;
  v_total INT := 0;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_spec := COALESCE(cfg->'welcome_vouchers', '{}'::JSONB);

  FOR v_tier, v_n IN SELECT key, value::INT FROM jsonb_each_text(v_spec) LOOP
    -- Ignore a tier that is not a real box rather than writing a voucher no
    -- roll can ever redeem.
    CONTINUE WHEN v_tier NOT IN ('tier_0','tier_1','tier_2','tier_3');
    FOR i IN 1..GREATEST(0, v_n) LOOP
      INSERT INTO public.vouchers (user_id, box_tier, discount_pct)
      VALUES (p_user_id, v_tier, 1);
      v_total := v_total + 1;
    END LOOP;
  END LOOP;

  RETURN v_total;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.grant_welcome_vouchers(UUID) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
--  reset_party_state: vouchers go, then the welcome package is re-issued.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_party_state(p_admin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_role TEXT; v_rolls INT; v_deposits INT; v_pot NUMERIC;
  v_vouchers INT; v_granted INT := 0; r RECORD;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_admin_id;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'PT403';
  END IF;

  SELECT count(*) INTO v_rolls FROM public.rolls;
  SELECT count(*), COALESCE(sum(amount) FILTER (WHERE status = 'approved'), 0)
    INTO v_deposits, v_pot FROM public.deposits;
  SELECT count(*) INTO v_vouchers FROM public.vouchers;

  -- WHERE TRUE on every one of these: required by pg_safeupdate, and an honest
  -- statement that clearing the whole table is the intent.
  DELETE FROM public.drop_overrides WHERE TRUE;
  DELETE FROM public.rolls          WHERE TRUE;
  DELETE FROM public.deposits       WHERE TRUE;
  DELETE FROM public.vouchers       WHERE TRUE;

  UPDATE public.profiles
     SET balance = 0, scrap_coins = 0, pc_shards = 0
   WHERE TRUE;

  UPDATE public.items
     SET stock_qty = COALESCE(initial_stock_qty, stock_qty), is_active = TRUE
   WHERE TRUE;

  UPDATE public.config
     SET value = jsonb_set(value, '{pc_shards_minted}', '0')
   WHERE key = 'settings';

  -- Everyone is starting the night over, so everyone gets the signup package
  -- again. Done after the DELETE so these are the only vouchers in existence.
  FOR r IN SELECT id FROM public.profiles LOOP
    v_granted := v_granted + public.grant_welcome_vouchers(r.id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rolls_cleared', v_rolls,
                            'deposits_cleared', v_deposits, 'pot_cleared', v_pot,
                            'vouchers_cleared', v_vouchers,
                            'welcome_vouchers_granted', v_granted);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  auth_login_or_register: hand out the package on the NEW-ACCOUNT path only.
--  Unchanged apart from that one call -- reproduced in full because
--  CREATE OR REPLACE cannot patch a body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_login_or_register(p_name TEXT, p_pin TEXT)
RETURNS TABLE(profile_id UUID, name TEXT, role TEXT, must_change BOOLEAN, created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app_private, extensions, pg_temp
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

  -- The hook. Only on this path: a login must never mint spins, or anyone
  -- could farm them by signing out and back in.
  PERFORM public.grant_welcome_vouchers(v_id);

  RETURN QUERY
    SELECT p.id, p.name, p.role, FALSE, TRUE
      FROM public.profiles p WHERE p.id = v_id;
END;
$fn$;
