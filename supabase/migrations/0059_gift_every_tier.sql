-- ---------------------------------------------------------------------------
--  0059 — you can gift a spin on ANY box, including the cheapest one
--
--  admin_grant_spins refused tier_0 outright:
--
--      IF p_box_tier NOT IN ('tier_1','tier_2','tier_3') THEN
--        RAISE EXCEPTION 'Unknown box tier'
--
--  It predates tier_0 existing (0019 added the $0.50 box), and nothing updated
--  it, so the admin roster only ever offered three tiers — and the cheapest box,
--  the one you would most want to hand out a few free spins on, was the one you
--  could not gift.
--
--  Validated against the same four-tier list the rest of the schema uses rather
--  than a fourth hand-written copy, so adding a tier later cannot leave this
--  behind again.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_grant_spins(
  p_admin_id UUID, p_user_id UUID, p_box_tier TEXT, p_count INT, p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_role TEXT; cfg JSONB; v_price NUMERIC; v_total NUMERIC; v_name TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_admin_id;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'PT403';
  END IF;

  IF p_box_tier NOT IN ('tier_0','tier_1','tier_2','tier_3') THEN
    RAISE EXCEPTION 'Unknown box tier' USING ERRCODE = 'PT400';
  END IF;
  IF p_count < 1 OR p_count > 50 THEN
    RAISE EXCEPTION 'Gift between 1 and 50 spins' USING ERRCODE = 'PT400';
  END IF;

  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_price := (cfg->'box_prices'->>p_box_tier)::NUMERIC;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'No price configured for %', p_box_tier USING ERRCODE = 'PT400';
  END IF;
  v_total := v_price * p_count;

  SELECT name INTO v_name FROM public.profiles WHERE id = p_user_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404';
  END IF;

  UPDATE public.profiles SET balance = balance + v_total WHERE id = p_user_id;

  INSERT INTO public.gifts (user_id, amount, note, granted_by)
  VALUES (p_user_id, v_total,
          COALESCE(p_note, p_count || ' free ' || p_box_tier || ' spins'), p_admin_id);

  RETURN jsonb_build_object('ok', true, 'player', v_name, 'spins', p_count,
                            'tier', p_box_tier, 'credited', v_total);
END;
$fn$;
