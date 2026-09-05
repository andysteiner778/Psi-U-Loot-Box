-- ---------------------------------------------------------------------------
--  0032 — the PC unlocks when the pot can pay for it
--
--  There are now TWO pot gates, and they do different jobs:
--
--    pot_revenue_threshold ($200)  shards stop dropping below this. Already
--                                  enforced in box_odds; published as
--                                  pot_gate_met so cards can say WHY odds are
--                                  0% rather than leaving players to guess.
--
--    pc_claim_threshold    ($500)  shards drop and accumulate freely, but the
--                                  finished machine cannot be claimed until
--                                  approved deposits reach this. The PC costs
--                                  $400; letting it leave before the pot covers
--                                  it is how the house ends the night down.
--
--  WHY A CLAIM GATE RATHER THAN QUIETLY UNWINNABLE ODDS. The obvious way to
--  protect the PC is to make the last shard never drop. That is a rigged
--  jackpot: about 21% of every spin's value is charged to the shard track, the
--  HUD shows a progress bar toward it, and a prize that cannot be won is money
--  taken for nothing. This gate is the honest version of the same protection --
--  it is a stated condition, it is published to the UI, it is reached by the
--  party actually happening, and the error below tells the player the exact
--  number rather than failing vaguely.
--
--  Shards are NOT burned on a refused claim: the FOR UPDATE row is untouched
--  until every check passes, so a player who tries early keeps their four.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_pc(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg JSONB; v_have INT; v_required INT; v_value NUMERIC;
  v_pot NUMERIC; v_claim_thr NUMERIC;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_required := (cfg->>'shards_required')::INT;
  v_value    := (cfg->>'pc_value')::NUMERIC;

  SELECT pc_shards INTO v_have FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
  IF v_have < v_required THEN
    RAISE EXCEPTION 'Need % shards, have %', v_required, v_have USING ERRCODE = 'PT402';
  END IF;

  -- The pot must be able to pay for the machine before it walks out the door.
  v_claim_thr := COALESCE((cfg->>'pc_claim_threshold')::NUMERIC, 0);
  SELECT COALESCE(SUM(amount), 0) INTO v_pot
    FROM public.deposits WHERE status = 'approved';

  IF v_pot < v_claim_thr THEN
    RAISE EXCEPTION
      'The PC unlocks once the pot reaches $%. It is at $% right now — your % shards are safe and keep their place.',
      ROUND(v_claim_thr, 2), ROUND(v_pot, 2), v_required
      USING ERRCODE = 'PT423';
  END IF;

  UPDATE public.profiles SET pc_shards = pc_shards - v_required WHERE id = p_user_id;
  INSERT INTO public.rolls (user_id, box_tier, kind, item_name, item_rarity, status, box_price)
  VALUES (p_user_id, 'tier_3', 'shard', 'Gaming PC', 'gold', 'claimed', 0);

  RETURN jsonb_build_object('ok', true, 'item_name', 'Gaming PC', 'value', v_value);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_pc(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_pc(UUID) TO service_role;
