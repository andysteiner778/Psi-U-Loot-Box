-- ============================================================================
--  HOUSE LOOT - 0029  A DISCOUNT VOUCHER THAT ACTUALLY DISCOUNTS
-- ============================================================================
--  "50% OFF a $40 box" paid out $20 of ordinary credit. The name promised a
--  reason to open the $40 box; the behaviour was 26 more spins of the $0.75
--  one. It did not do the one thing it existed for, and calling something a
--  discount while handing over fungible credit is worse than not shipping it.
--
--  A voucher is now a real row, locked to a tier, and the price it reduces is
--  computed on the SERVER from that row. The client passes a tier and nothing
--  else. That is deliberate: the spec's original security hole was accepting a
--  box price from the caller, and taking a voucher id from the request body
--  would be the same mistake wearing a hat. The server finds the player's best
--  unredeemed voucher for the tier they asked for and applies it.
--
--  FOR UPDATE ... SKIP LOCKED so two simultaneous rolls cannot spend one
--  voucher: the loser does not see it and pays full price. It is burned only
--  AFTER the charge succeeds, so a roll refused for want of funds does not
--  silently eat it.
--
--  EV is unchanged -- the awarding row still carries est_value equal to the
--  discount it grants ($20 for half off a $40 box), so the solvency engine
--  charges the tier exactly what the voucher will cost the house.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vouchers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  box_tier       TEXT NOT NULL CHECK (box_tier IN ('tier_0','tier_1','tier_2','tier_3')),
  -- 0.5 = half price, 1.0 = free.
  discount_pct   NUMERIC NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 1),
  source_roll_id UUID REFERENCES public.rolls(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS vouchers_open_idx
  ON public.vouchers (user_id, box_tier) WHERE redeemed_at IS NULL;

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vouchers FROM PUBLIC, anon, authenticated;

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS reward_voucher_tier TEXT,
  ADD COLUMN IF NOT EXISTS reward_voucher_pct  NUMERIC;

COMMENT ON COLUMN public.items.reward_voucher_tier IS
  'If set, winning this row grants a voucher for that tier instead of credit.';

CREATE OR REPLACE FUNCTION public.open_box(
  p_user_id        UUID,
  p_box_tier       TEXT,
  p_client_roll_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  odds        JSONB;
  cfg         JSONB;
  v_balance   NUMERIC;
  v_shards    INT;
  v_required  INT;
  v_price     NUMERIC;
  v_rand      DOUBLE PRECISION;
  v_cum       DOUBLE PRECISION := 0;
  v_pick      INT := 0;
  v_it        JSONB;
  v_items     JSONB;
  v_n         INT;
  i           INT;
  v_affected  INT;
  v_coins     INT;
  v_roll_id   UUID;
  v_result    JSONB;
  v_override  UUID;
  v_scrap_val INT;
  v_fid       UUID;
  v_fname     TEXT;
  v_fimg      TEXT;
  v_frar      TEXT;
  v_fval      NUMERIC;
  v_fscrap    INT;
  v_fmsrp     NUMERIC;
  v_reward    NUMERIC;
  v_vch_id    UUID;
  v_vch_pct   NUMERIC;
  v_vch_tier  TEXT;
  v_vch_gpct  NUMERIC;
  v_full      NUMERIC;
  v_hi_scrap  BOOLEAN;
  v_prior     INT;
  v_welcome_n INT;
  v_welcome   BOOLEAN := FALSE;
  v_mass      DOUBLE PRECISION;
BEGIN
  -- ---- Idempotency: a double-tap must not charge twice --------------------
  IF p_client_roll_id IS NOT NULL THEN
    SELECT payload INTO v_result FROM public.rolls WHERE client_roll_id = p_client_roll_id;
    IF FOUND THEN RETURN v_result; END IF;
  END IF;

  IF p_box_tier NOT IN ('tier_0','tier_1','tier_2','tier_3') THEN
    RAISE EXCEPTION 'Unknown box tier: %', p_box_tier USING ERRCODE = 'PT400';
  END IF;

  -- ---- Lock the payer. FOUND check first: NULL < price is NULL, which the
  --      spec's bare comparison silently treated as "sufficient funds". ------
  SELECT balance, pc_shards INTO v_balance, v_shards
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404';
  END IF;

  odds    := public.box_odds(p_box_tier);
  v_price := (odds->>'box_price')::NUMERIC;
  v_full  := v_price;

  -- ---- HELD VOUCHER, APPLIED AUTOMATICALLY --------------------------------
  -- Found and priced HERE, on the server, from a row the player cannot write.
  -- The client passes a tier and nothing else -- deliberately: the spec's
  -- original security hole was accepting a box price from the caller, and a
  -- voucher id in the request body would be the same mistake wearing a hat.
  --
  -- FOR UPDATE ... SKIP LOCKED so two simultaneous rolls cannot spend the same
  -- voucher; the loser simply does not see it and pays full price.
  SELECT id, discount_pct INTO v_vch_id, v_vch_pct
    FROM public.vouchers
   WHERE user_id = p_user_id
     AND box_tier = p_box_tier
     AND redeemed_at IS NULL
   ORDER BY discount_pct DESC, created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_vch_id IS NOT NULL THEN
    v_price := ROUND(v_price * (1 - LEAST(1, GREATEST(0, v_vch_pct))), 2);
  END IF;
  cfg     := (SELECT value FROM public.config WHERE key = 'settings');
  v_required := (cfg->>'shards_required')::INT;
  -- May the good stuff be turned into coins? Mirrors the same flag that
  -- scrap_item enforces. Read once here so all four payload sites agree.
  v_hi_scrap := COALESCE((cfg->>'allow_high_rarity_scrap')::BOOLEAN, FALSE);

  IF v_balance < v_price THEN
    -- Distinct SQLSTATE so the route handler can render "not enough credits"
    -- without also swallowing genuine bugs. PostgREST maps PT402 -> HTTP 402.
    RAISE EXCEPTION 'Insufficient balance' USING ERRCODE = 'PT402';
  END IF;

  UPDATE public.profiles SET balance = balance - v_price WHERE id = p_user_id;

  -- Burned only after the charge succeeded, so a roll refused for want of
  -- funds does not silently eat the voucher.
  IF v_vch_id IS NOT NULL THEN
    UPDATE public.vouchers SET redeemed_at = NOW() WHERE id = v_vch_id;
  END IF;

  -- ---- Admin forced drop, consumed once -----------------------------------
  SELECT item_id INTO v_override FROM public.drop_overrides WHERE user_id = p_user_id;
  IF FOUND THEN
    DELETE FROM public.drop_overrides WHERE user_id = p_user_id;
    UPDATE public.items SET stock_qty = stock_qty - 1
      WHERE id = v_override AND stock_qty > 0
      RETURNING jsonb_build_object(
        'item_id', id, 'item_name', name, 'image_url', image_url,
        'rarity', rarity, 'est_value', est_value, 'msrp', msrp,
        'reward_credit', reward_credit,
        'scrap_value', CASE WHEN rarity IN ('purple','pink','gold') AND NOT v_hi_scrap
                              THEN 0 ELSE scrap_value END
      ) INTO v_it;

    -- A forced drop can be a reward row too. This branch builds its own payload
    -- rather than sharing the ordinary one, so it needs the same check -- and
    -- without it, testing a reward by forcing it silently exercised the wrong
    -- path and put credit on the shelf as an object.
    IF v_it IS NOT NULL THEN
      SELECT reward_voucher_tier, reward_voucher_pct INTO v_vch_tier, v_vch_gpct
        FROM public.items WHERE id = (v_it->>'item_id')::UUID;
    END IF;

    IF v_it IS NOT NULL AND v_vch_tier IS NOT NULL THEN
      INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                                status, box_price, client_roll_id)
      VALUES (p_user_id, p_box_tier, 'respin', (v_it->>'item_id')::UUID,
              v_it->>'item_name', v_it->>'rarity', 'consumed', v_price, p_client_roll_id)
      RETURNING id INTO v_roll_id;
      INSERT INTO public.vouchers (user_id, box_tier, discount_pct, source_roll_id)
      VALUES (p_user_id, v_vch_tier, v_vch_gpct, v_roll_id);
      v_result := jsonb_build_object(
        'type','respin', 'item_name', v_it->>'item_name', 'rarity', v_it->>'rarity',
        'refund_amount', 0, 'image_url', v_it->'image_url',
        'voucher_tier', v_vch_tier, 'voucher_pct', v_vch_gpct, 'roll_id', v_roll_id);
      UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
      RETURN v_result;
    END IF;

    IF v_it IS NOT NULL AND (v_it->>'reward_credit') IS NOT NULL
       AND (v_it->>'reward_credit')::NUMERIC > 0 THEN
      v_reward := (v_it->>'reward_credit')::NUMERIC;
      UPDATE public.profiles SET balance = balance + v_reward WHERE id = p_user_id;
      INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                                status, box_price, client_roll_id)
      VALUES (p_user_id, p_box_tier, 'respin', (v_it->>'item_id')::UUID,
              v_it->>'item_name', v_it->>'rarity', 'consumed', v_price, p_client_roll_id)
      RETURNING id INTO v_roll_id;
      v_result := jsonb_build_object(
        'type','respin', 'item_name', v_it->>'item_name', 'rarity', v_it->>'rarity',
        'refund_amount', v_reward, 'image_url', v_it->'image_url', 'roll_id', v_roll_id);
      UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
      RETURN v_result;
    END IF;

    IF v_it IS NOT NULL THEN
      INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                                status, box_price, client_roll_id)
      VALUES (p_user_id, p_box_tier, 'physical', (v_it->>'item_id')::UUID,
              v_it->>'item_name', v_it->>'rarity', 'inventory', v_price, p_client_roll_id)
      RETURNING id INTO v_roll_id;
      v_result := v_it || jsonb_build_object('type','physical','roll_id',v_roll_id);
      UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
      RETURN v_result;
    END IF;
  END IF;

  -- ---- Draw. A FRESH uniform, used once. The spec reused one random() for
  --      the shard check, the item walk AND the respin/scrap split, which
  --      correlates all three decisions. ------------------------------------
  v_rand  := random();
  v_items := odds->'items';
  v_n     := jsonb_array_length(v_items);

  -- ---- WELCOME GUARANTEE --------------------------------------------------
  -- A player's first few rolls always hand back a real object.
  --
  -- Someone puts in $5, loses the first two spins to scrap coins, and never
  -- opens the app again -- which is the single most likely way this night goes
  -- wrong. These rolls are still PAID FOR; what is guaranteed is that they
  -- return something you can hold.
  --
  -- Two deliberate limits:
  --   * Only on the two cheap tiers. Otherwise the first thing a clever player
  --     does is spend their guarantee on four $50 boxes.
  --   * Never a purple/pink/gold. The guarantee is a floor, not a jackpot, and
  --     handing someone the TV on their first tap costs the house its headline
  --     prize for nothing.
  v_welcome_n := COALESCE((cfg->>'welcome_spins')::INT, 0);
  IF v_welcome_n > 0 AND p_box_tier IN ('tier_0','tier_1') THEN
    SELECT COUNT(*) INTO v_prior FROM public.rolls WHERE user_id = p_user_id;
    IF v_prior < v_welcome_n THEN
      SELECT COALESCE(jsonb_agg(e), '[]'::JSONB), COALESCE(SUM((e->>'probability')::DOUBLE PRECISION), 0)
        INTO v_items, v_mass
        FROM jsonb_array_elements(odds->'items') e
       WHERE e->>'rarity' NOT IN ('purple','pink','gold')
         AND (e->>'probability')::DOUBLE PRECISION > 0;
      v_n := jsonb_array_length(v_items);
      IF v_n > 0 AND v_mass > 0 THEN
        -- Renormalise onto the eligible items so the draw cannot miss them.
        v_welcome := TRUE;
        v_rand    := random() * v_mass;
      ELSE
        -- Nothing eligible left in the pool: fall back to an ordinary roll
        -- rather than erroring or handing out a prize that is not there.
        v_items := odds->'items';
        v_n     := jsonb_array_length(v_items);
      END IF;
    END IF;
  END IF;

  FOR i IN 0..v_n-1 LOOP
    v_cum := v_cum + (v_items->i->>'probability')::DOUBLE PRECISION;
    IF v_rand < v_cum THEN v_pick := i + 1; EXIT; END IF;
  END LOOP;

  -- ---- Physical win -------------------------------------------------------
  IF v_pick > 0 THEN
    v_it := v_items->(v_pick - 1);

    -- No FOR UPDATE on items: the spec's tier-wide lock creates a
    -- profiles -> items lock-ordering deadlock and a convoy under load.
    -- A conditional decrement is atomic on its own and cannot go negative.
    UPDATE public.items SET stock_qty = stock_qty - 1
      WHERE id = (v_it->>'item_id')::UUID AND stock_qty > 0;
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 1 THEN
      -- ---- REWARD ITEMS ----------------------------------------------------
      -- Some catalogue rows are not objects: a free spin, a half-price voucher,
      -- house credit. They live in `items` on purpose, so the existing engine
      -- prices them, publishes honest odds for them, and `stock_qty` caps how
      -- many the house can ever give away. Winning one credits the balance
      -- instead of putting something on a shelf.
      --
      -- Reported as `respin`, which already means "credit went back to you,
      -- roll again" and which every screen already renders. A new payload type
      -- would have meant touching the reveal, the inventory and the ticker for
      -- no behavioural gain.
      SELECT reward_credit INTO v_reward FROM public.items
       WHERE id = (v_it->>'item_id')::UUID;


      SELECT reward_voucher_tier, reward_voucher_pct INTO v_vch_tier, v_vch_gpct
        FROM public.items WHERE id = (v_it->>'item_id')::UUID;

      IF v_vch_tier IS NOT NULL THEN
        INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                                  status, box_price, client_roll_id)
        VALUES (p_user_id, p_box_tier, 'respin', (v_it->>'item_id')::UUID,
                v_it->>'name', v_it->>'rarity', 'consumed', v_price, p_client_roll_id)
        RETURNING id INTO v_roll_id;

        INSERT INTO public.vouchers (user_id, box_tier, discount_pct, source_roll_id)
        VALUES (p_user_id, v_vch_tier, v_vch_gpct, v_roll_id);

        v_result := jsonb_build_object(
          'type','respin', 'item_name', v_it->>'name', 'rarity', v_it->>'rarity',
          'refund_amount', 0, 'image_url', v_it->'image_url',
          'voucher_tier', v_vch_tier, 'voucher_pct', v_vch_gpct,
          'roll_id', v_roll_id);
        UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
        RETURN v_result;
      END IF;

      IF v_reward IS NOT NULL AND v_reward > 0 THEN
        UPDATE public.profiles SET balance = balance + v_reward WHERE id = p_user_id;
        INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                                  status, box_price, client_roll_id)
        VALUES (p_user_id, p_box_tier, 'respin', (v_it->>'item_id')::UUID,
                v_it->>'name', v_it->>'rarity', 'consumed', v_price, p_client_roll_id)
        RETURNING id INTO v_roll_id;

        v_result := jsonb_build_object(
          'type','respin', 'item_name', v_it->>'name', 'rarity', v_it->>'rarity',
          'refund_amount', v_reward, 'image_url', v_it->'image_url',
          'roll_id', v_roll_id);
        UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
        RETURN v_result;
      END IF;

      v_scrap_val := CASE WHEN v_it->>'rarity' IN ('purple','pink','gold') AND NOT v_hi_scrap
                            THEN 0 ELSE (v_it->>'scrap_value')::INT END;
      -- NOTE: box_odds emits the key `name`, not `item_name`. Reading the wrong
      -- key here inserted NULL into rolls.item_name and threw a not-null
      -- violation on EVERY physical win -- the single most common success path.
      INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                                status, box_price, client_roll_id)
      VALUES (p_user_id, p_box_tier, 'physical', (v_it->>'item_id')::UUID,
              v_it->>'name', v_it->>'rarity', 'inventory', v_price, p_client_roll_id)
      RETURNING id INTO v_roll_id;

      v_result := jsonb_build_object(
        'type','physical', 'item_id', v_it->>'item_id', 'item_name', v_it->>'name',
        'image_url', v_it->'image_url', 'rarity', v_it->>'rarity',
        'est_value', (v_it->>'est_value')::NUMERIC, 'scrap_value', v_scrap_val,
        'msrp', v_it->'msrp',
        'roll_id', v_roll_id);
      UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
      RETURN v_result;
    END IF;
    -- Lost the race for the last unit. Refund rather than silently charge.
    v_pick := -1;
  END IF;

  -- ---- Shard --------------------------------------------------------------
  IF v_pick = 0 THEN
    v_cum := v_cum + (odds->>'p_shard')::DOUBLE PRECISION;
    IF v_rand < v_cum THEN
      -- Guarded atomic mint: caps global PC supply. Per-player cap is covered
      -- by the profiles row lock we already hold.
      IF v_shards < v_required THEN
        UPDATE public.config
           SET value = jsonb_set(value, '{pc_shards_minted}',
                                 to_jsonb(((value->>'pc_shards_minted')::INT) + 1))
         WHERE key = 'settings'
           AND (value->>'pc_shards_minted')::INT
               < COALESCE((value->>'pc_shard_mint_cap')::INT,
                          (value->>'pc_total_supply')::INT * (value->>'shards_required')::INT);
        GET DIAGNOSTICS v_affected = ROW_COUNT;

        IF v_affected = 1 THEN
          UPDATE public.profiles SET pc_shards = pc_shards + 1 WHERE id = p_user_id;
          INSERT INTO public.rolls (user_id, box_tier, kind, item_name, item_rarity,
                                    status, box_price, client_roll_id)
          VALUES (p_user_id, p_box_tier, 'shard',
                  'PC Core Shard (' || (v_shards + 1) || '/' || v_required || ')',
                  'gold', 'inventory', v_price, p_client_roll_id)
          RETURNING id INTO v_roll_id;

          v_result := jsonb_build_object(
            'type','shard',
            'item_name','PC Core Shard (' || (v_shards + 1) || '/' || v_required || ')',
            'rarity','gold', 'current_shards', v_shards + 1,
            'shards_required', v_required, 'roll_id', v_roll_id);
          UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
          RETURN v_result;
        END IF;
      END IF;
      -- Already at 5/5, or global supply exhausted: fall through to respin.
      v_pick := -1;
    END IF;
  END IF;

  -- ---- Respin (ceiling anchor) -------------------------------------------
  IF v_pick = -1 THEN
    v_cum := 2;  -- force the respin branch for race-losers and capped shards
  ELSE
    v_cum := v_cum + (odds->>'p_respin')::DOUBLE PRECISION;
  END IF;

  IF v_rand < v_cum THEN
    UPDATE public.profiles SET balance = balance + v_price WHERE id = p_user_id;
    INSERT INTO public.rolls (user_id, box_tier, kind, item_name, item_rarity,
                              status, box_price, client_roll_id)
    VALUES (p_user_id, p_box_tier, 'respin', 'Free Re-Roll Token', 'blue',
            'consumed', v_price, p_client_roll_id)
    RETURNING id INTO v_roll_id;

    v_result := jsonb_build_object('type','respin', 'item_name','Free Re-Roll Token',
                                   'rarity','blue', 'refund_amount', v_price,
                                   'roll_id', v_roll_id);
    UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
    RETURN v_result;
  END IF;

  -- ---- Floor anchor -------------------------------------------------------
  -- Preferably a real, cheap object rather than abstract coins. Winning a $4
  -- cable bundle reads as a win; "+5 Scrap Coins" reads as a loss, even when
  -- the coins are worth more. Its value is charged to the EV budget in
  -- box_odds exactly like any other item, so this is not free generosity.
  IF (odds->>'floor_kind') = 'item' AND p_box_tier IN ('tier_2','tier_3') THEN
    -- Stock-weighted sample: a pile of 8 cable bundles is 8x likelier than a
    -- single desk lamp. -LN(random())/weight is the standard weighted-sampling
    -- trick and needs no expansion of the row set.
    SELECT id, name, image_url, rarity, est_value, scrap_value, msrp
      INTO v_fid, v_fname, v_fimg, v_frar, v_fval, v_fscrap, v_fmsrp
      FROM public.items
     WHERE box_tier = 'tier_1'
       AND est_value <= COALESCE(((SELECT value FROM public.config WHERE key='settings')->>'filler_max_value')::NUMERIC, 15)
       AND is_active AND stock_qty > 0 AND est_value > 0
     ORDER BY -LN(random()) / stock_qty
     LIMIT 1;

    IF FOUND THEN
      UPDATE public.items SET stock_qty = stock_qty - 1
       WHERE id = v_fid AND stock_qty > 0;
      GET DIAGNOSTICS v_affected = ROW_COUNT;

      IF v_affected = 1 THEN
        INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name,
                                  item_rarity, status, box_price, client_roll_id)
        VALUES (p_user_id, p_box_tier, 'physical', v_fid, v_fname, v_frar,
                'inventory', v_price, p_client_roll_id)
        RETURNING id INTO v_roll_id;

        v_result := jsonb_build_object(
          'type','physical', 'item_id', v_fid, 'item_name', v_fname,
          'image_url', v_fimg, 'rarity', v_frar, 'est_value', v_fval,
            'msrp', v_fmsrp,
          'scrap_value', CASE WHEN v_frar IN ('purple','pink','gold') AND NOT v_hi_scrap
                                  THEN 0 ELSE v_fscrap END,
          'roll_id', v_roll_id);
        UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
        RETURN v_result;
      END IF;
    END IF;
    -- Junk pool raced empty: fall through to coins.
  END IF;

  -- ---- Scrap coins (terminal fallback) ------------------------------------
  v_coins := (odds->>'scrap_coins_awarded')::INT;
  UPDATE public.profiles SET scrap_coins = scrap_coins + v_coins WHERE id = p_user_id;
  INSERT INTO public.rolls (user_id, box_tier, kind, item_name, item_rarity,
                            status, box_price, client_roll_id)
  VALUES (p_user_id, p_box_tier, 'scrap', '+' || v_coins || ' Scrap Coins', 'grey',
          'consumed', v_price, p_client_roll_id)
  RETURNING id INTO v_roll_id;

  v_result := jsonb_build_object('type','scrap', 'item_name','+' || v_coins || ' Scrap Coins',
                                 'rarity','grey', 'scrap_gained', v_coins, 'roll_id', v_roll_id);
  UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
  RETURN v_result;
END;
$fn$;
