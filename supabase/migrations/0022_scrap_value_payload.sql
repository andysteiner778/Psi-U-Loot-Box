-- ============================================================================
--  HOUSE LOOT — 0022  open_box PUBLISHES THE REAL SCRAP VALUE
-- ============================================================================
--  `allow_high_rarity_scrap` is on, and `scrap_item` honours it: a purple item
--  converts to coins at 40% and the unit goes back in the pool. But open_box
--  hardcoded `CASE WHEN rarity IN ('purple','pink','gold') THEN 0` in four
--  places, so the payload every UI reads reported scrap_value = 0 for exactly
--  the items the feature is about.
--
--  The effect was a feature that worked only if you called the API by hand:
--  the server would happily pay 280 coins for a $70 monitor, while the reveal
--  panel said "Physical Pickup Only" and the inventory screen showed no
--  button, because both gate on payload.scrap_value > 0.
--
--  This is the "displayed number vs the number that decides" class again --
--  the same shape as box_odds never emitting realized_margin, which had every
--  tier telling players it returned 100% of its cost.
--
--  Only open_box changes. box_odds keeps the definition 0021 gave it.
-- ============================================================================

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
  v_hi_scrap  BOOLEAN;
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

  -- ---- Admin forced drop, consumed once -----------------------------------
  SELECT item_id INTO v_override FROM public.drop_overrides WHERE user_id = p_user_id;
  IF FOUND THEN
    DELETE FROM public.drop_overrides WHERE user_id = p_user_id;
    UPDATE public.items SET stock_qty = stock_qty - 1
      WHERE id = v_override AND stock_qty > 0
      RETURNING jsonb_build_object(
        'item_id', id, 'item_name', name, 'image_url', image_url,
        'rarity', rarity, 'est_value', est_value,
        'scrap_value', CASE WHEN rarity IN ('purple','pink','gold') AND NOT v_hi_scrap
                              THEN 0 ELSE scrap_value END
      ) INTO v_it;
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
    SELECT id, name, image_url, rarity, est_value, scrap_value
      INTO v_fid, v_fname, v_fimg, v_frar, v_fval, v_fscrap
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
