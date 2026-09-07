-- ---------------------------------------------------------------------------
--  0039 — LOCK AN EMPTY BOX, AND DO NOT PROMISE A SECOND PC
--
--  Two guards, both about not selling something that is not there.
--
--  1. TIER LOCK. box_odds already recomputes from live stock on every roll, so
--     the published odds are never stale. What it did NOT do is notice when a
--     tier has run out of things worth winning. tier_2 currently holds ONE real
--     object; once that is gone the box still sells for $10 and open_box quietly
--     refunds, because the only rows left are free spins, vouchers and credit.
--     The house does not lose money doing that -- but the player pays, waits for
--     the reel, and gets their money back, forever. That is a broken box, not a
--     game.
--
--     tier_lock_state() answers "can this box still hand over a real object?"
--     using the same pool predicate box_odds uses, and open_box refuses a locked
--     tier instead of taking the money first.
--
--  2. PC SUPPLY. pc_shard_mint_cap is 24 against shards_required 4, which is six
--     assemblable sets, and claim_pc checked shards and the pot but never
--     whether a machine was actually left. Six people finishing a set would have
--     been promised six PCs when exactly one exists. The curve makes that
--     unlikely, not impossible, and "unlikely" is not a guarantee you can make to
--     a room. claim_pc now counts PCs already claimed against pc_total_supply.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tier_lock_state(p_box_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg         JSONB;
  v_rank      INT;
  v_fmax      NUMERIC;
  v_fmin      NUMERIC;
  v_c         NUMERIC;
  v_real      INT;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_rank := array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], p_box_tier);
  v_c    := (cfg->'box_prices'->>p_box_tier)::NUMERIC;
  v_fmax := COALESCE((cfg->>'filler_max_value')::NUMERIC, 15);
  v_fmin := COALESCE((cfg->>'filler_min_frac')::NUMERIC, 0) * v_c;

  -- A "real object" is something a player can carry home: not house credit, not
  -- a voucher, not a free spin, not the shard-locked PC. Mirrors the reward-row
  -- predicate open_box branches on.
  SELECT COUNT(*) INTO v_real
    FROM public.items i
   WHERE i.is_active
     AND i.stock_qty > 0
     AND i.est_value > 0
     AND COALESCE(i.shard_cost, 0) = 0
     AND i.reward_credit IS NULL
     AND i.reward_voucher_tier IS NULL
     AND (
       -- this tier's own prizes, plus anything expensive enough to cross tiers
       i.box_tier = p_box_tier
       OR i.est_value > v_fmax
       -- cheap junk borrowed UP the ladder as the floor anchor
       OR (array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], i.box_tier) < v_rank
           AND i.est_value <= v_fmax AND i.est_value >= v_fmin)
     );

  RETURN jsonb_build_object(
    'tier', p_box_tier,
    'locked', v_real = 0,
    'real_items_left', v_real,
    'reason', CASE WHEN v_real = 0
                   THEN 'Everything worth winning in this box has been claimed.'
                   ELSE NULL END);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.tier_lock_state(TEXT) FROM anon;

-- ---------------------------------------------------------------------------
--  claim_pc: refuse when no machine is left, rather than promising a second.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pc(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg JSONB; v_have INT; v_required INT; v_value NUMERIC;
  v_pot NUMERIC; v_claim_thr NUMERIC; v_supply INT; v_claimed INT;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_required := (cfg->>'shards_required')::INT;
  v_value    := (cfg->>'pc_value')::NUMERIC;
  v_supply   := COALESCE((cfg->>'pc_total_supply')::INT, 1);

  SELECT pc_shards INTO v_have FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
  IF v_have < v_required THEN
    RAISE EXCEPTION 'Need % shards, have %', v_required, v_have USING ERRCODE = 'PT402';
  END IF;

  -- There is one machine. The mint cap allows six assemblable sets on purpose
  -- (shards must exist across a whole room to feel reachable), so the supply
  -- check has to live HERE, at the moment one would leave the house.
  SELECT COUNT(*) INTO v_claimed
    FROM public.rolls WHERE kind = 'shard' AND status = 'claimed';
  IF v_claimed >= v_supply THEN
    RAISE EXCEPTION
      'The PC has already been claimed. Your % shards can still be salvaged for credit.',
      v_required USING ERRCODE = 'PT409';
  END IF;

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
