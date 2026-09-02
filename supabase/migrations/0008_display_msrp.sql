-- ============================================================================
--  HOUSE LOOT — 0008  DISPLAY MSRP
-- ============================================================================
--  The owner wanted items priced at MSRP-or-higher so players feel they are
--  winning more. Doing that to `est_value` achieves the opposite: the engine
--  sets each item's drop chance at `C * ev_weight_factor / est_value`, so
--  inflating a $70 monitor to $120 makes it drop about 40% LESS often and eats
--  the payout budget faster. People would see the bigger number on the rare win
--  and more junk the rest of the night.
--
--  So `msrp` is a SEPARATE, display-only column. `est_value` stays honest and
--  drives every probability; `msrp` is what the card shows.
--
--  This is the same split already used for the PC (`pc_value` charges the
--  economy, `pc_display_value` is shown). The rule is identical and worth
--  stating once: a number the player sees must never be a number the odds
--  depend on, or "make it look better" silently becomes "make it worse".
-- ============================================================================

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS msrp NUMERIC(10,2)
  CHECK (msrp IS NULL OR msrp > 0);

COMMENT ON COLUMN public.items.msrp IS
  'Display-only retail price. NEVER used in odds or EV; est_value drives those.';

CREATE OR REPLACE FUNCTION public.box_odds(p_box_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg              JSONB;
  v_c              NUMERIC;
  v_target         NUMERIC;
  v_margin         NUMERIC;
  v_sale_ends      TIMESTAMPTZ;
  v_pot            NUMERIC;
  v_threshold      NUMERIC;
  v_gate_met       BOOLEAN;
  v_p_shard        DOUBLE PRECISION := 0;
  v_v_shard        NUMERIC;
  v_minted         INT;
  v_capacity       INT;
  v_coin_usd       NUMERIC;
  v_coins          INT;
  v_v_scrap        NUMERIC;
  v_fill_stock     INT;
  v_fill_value     NUMERIC;
  v_floor_kind     TEXT;
  v_max_prob       DOUBLE PRECISION;
  v_weight_factor  NUMERIC;
  ids              UUID[];
  msrps            NUMERIC[];
  nms              TEXT[];
  vals             NUMERIC[];
  rars             TEXT[];
  scrs             INT[];
  imgs             TEXT[];
  stks             INT[];
  w                DOUBLE PRECISION[] := '{}';
  v_wp             DOUBLE PRECISION := 0;
  v_wv             DOUBLE PRECISION := 0;
  v_lambda_prob    DOUBLE PRECISION;
  v_lambda_ev      DOUBLE PRECISION;
  v_lambda         DOUBLE PRECISION;
  v_spendable      DOUBLE PRECISION;
  v_denom          DOUBLE PRECISION;
  v_p_phys         DOUBLE PRECISION;
  v_ev_phys        DOUBLE PRECISION;
  v_k              DOUBLE PRECISION;
  v_b              DOUBLE PRECISION;
  v_p_respin       DOUBLE PRECISION;
  v_p_scrap        DOUBLE PRECISION;
  v_items          JSONB := '[]'::JSONB;
  i                INT;
  n                INT;
BEGIN
  IF p_box_tier NOT IN ('tier_1','tier_2','tier_3') THEN
    RAISE EXCEPTION 'Unknown box tier: %', p_box_tier USING ERRCODE = 'PT400';
  END IF;

  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  IF cfg IS NULL THEN
    RAISE EXCEPTION 'Missing config row' USING ERRCODE = 'PT500';
  END IF;

  -- Price is derived here, on the server, from the tier. It is never accepted
  -- from the caller: the spec's `p_box_price` parameter let anyone roll tier 3
  -- for a penny, or pass a negative price to mint balance.
  v_c := (cfg->'box_prices'->>p_box_tier)::NUMERIC;
  v_margin := (cfg->>'house_margin')::NUMERIC;

  -- Flash sale expires on the server clock, not on whatever the client believes.
  v_sale_ends := NULLIF(cfg->>'flash_sale_ends_at','')::TIMESTAMPTZ;
  IF COALESCE((cfg->>'flash_sale')::BOOLEAN, FALSE)
     AND (v_sale_ends IS NULL OR v_sale_ends > NOW()) THEN
    v_c := ROUND(v_c * (1 - (cfg->>'flash_sale_pct')::NUMERIC), 2);
  END IF;

  v_target := v_c * (1 - v_margin);
  v_max_prob := (cfg->>'max_item_prob')::DOUBLE PRECISION;
  v_weight_factor := (cfg->>'ev_weight_factor')::NUMERIC;

  -- ---- Pot gate: shards stay locked at 0% until deposits cross the floor ----
  SELECT COALESCE(SUM(amount), 0) INTO v_pot FROM public.deposits WHERE status = 'approved';
  v_threshold := (cfg->>'pot_revenue_threshold')::NUMERIC;
  v_gate_met := v_pot >= v_threshold;

  v_minted   := COALESCE((cfg->>'pc_shards_minted')::INT, 0);
  -- How many shards may EXIST, which is deliberately not the same as how many
  -- you need to complete a set. Tying them together (supply = 1 PC x 5 shards)
  -- meant exactly 5 shards ever existed: spread across 30 players, nobody could
  -- ever assemble a set, and the PC was unwinnable by construction.
  v_capacity := COALESCE((cfg->>'pc_shard_mint_cap')::INT,
                         (cfg->>'pc_total_supply')::INT * (cfg->>'shards_required')::INT);
  v_v_shard  := (cfg->>'pc_value')::NUMERIC / (cfg->>'shards_required')::INT;

  -- Global supply cap. Without this, ~100 tier-3 rolls mint four PCs' worth of
  -- shards against one physical PC, which ends in a real argument.
  IF v_gate_met AND v_minted < v_capacity THEN
    v_p_shard := COALESCE((cfg->'shard_probs'->>p_box_tier)::DOUBLE PRECISION, 0);
  END IF;

  -- ---- Floor anchor. The spec calls this $0; it is not. -------------------
  v_coin_usd := (cfg->'box_prices'->>(cfg->>'scrap_key_tier'))::NUMERIC
                / (cfg->>'scrap_coins_per_key')::NUMERIC;
  v_coins    := GREATEST(1, ROUND((cfg->>'scrap_ev_frac')::NUMERIC * v_c / v_coin_usd)::INT);

  -- ---- Snapshot the pool once, so totals and the CDF cannot disagree -------
  --
  -- NATIVE prizes belong to this tier. FILLER is cheap tier-1 junk borrowed as
  -- the floor anchor. They must stay separate: merging filler into the prize
  -- pool makes probability rather than budget the binding constraint, and since
  -- lambda scales uniformly it then shrinks the expensive items too -- the only
  -- ones able to spend the budget. Measured effect of merging: a $50 box paid
  -- out $23.68 against a $47.50 budget, a silent 53% margin.
  SELECT array_agg(t.id      ORDER BY t.id), array_agg(t.name      ORDER BY t.id),
         array_agg(t.est_value ORDER BY t.id), array_agg(t.rarity  ORDER BY t.id),
         array_agg(t.scrap_value ORDER BY t.id), array_agg(t.image_url ORDER BY t.id),
         array_agg(t.stock_qty ORDER BY t.id), array_agg(t.msrp ORDER BY t.id)
    INTO ids, nms, vals, rars, scrs, imgs, stks, msrps
    FROM public.items t
   WHERE t.box_tier = p_box_tier
     AND t.is_active AND t.stock_qty > 0 AND t.est_value > 0;

  n := COALESCE(array_length(ids, 1), 0);

  -- Filler pool: cheap junk from a lower tier, used as the consolation object.
  SELECT COALESCE(SUM(t.stock_qty), 0),
         COALESCE(SUM(t.est_value * t.stock_qty), 0)
    INTO v_fill_stock, v_fill_value
    FROM public.items t
   WHERE t.box_tier <> p_box_tier
     AND p_box_tier IN ('tier_2','tier_3')
     AND t.box_tier = 'tier_1'
     AND t.est_value <= COALESCE((cfg->>'filler_max_value')::NUMERIC, 15)
     AND t.is_active AND t.stock_qty > 0 AND t.est_value > 0;

  -- A junk object beats abstract coins for the same money: in CS:GO the usual
  -- result is a cheap skin, not "nothing". Fall back to coins when the junk
  -- runs out, so there is always a terminal branch.
  IF v_fill_stock > 0 THEN
    v_floor_kind := 'item';
    v_v_scrap    := v_fill_value / v_fill_stock;   -- stock-weighted mean
  ELSE
    v_floor_kind := 'coins';
    v_v_scrap    := v_coins * v_coin_usd;
  END IF;

  -- ---- Raw weights: the spec's expression, used as a SHAPE ----------------
  FOR i IN 1..n LOOP
    w := array_append(w, LEAST(v_max_prob, (v_c * v_weight_factor / vals[i])::DOUBLE PRECISION));
    v_wp := v_wp + w[i];
    v_wv := v_wv + w[i] * vals[i]::DOUBLE PRECISION;
  END LOOP;

  -- ---- Scale pass 1: probability mass must fit under 1 --------------------
  v_lambda_prob := CASE WHEN v_wp > 0 THEN (1 - v_p_shard) / v_wp ELSE 'Infinity'::DOUBLE PRECISION END;

  -- ---- Scale pass 2: expected value must fit the budget -------------------
  v_spendable := v_target::DOUBLE PRECISION
                 - v_p_shard * v_v_shard::DOUBLE PRECISION
                 - (1 - v_p_shard) * v_v_scrap::DOUBLE PRECISION;
  v_denom := v_wv - v_wp * v_v_scrap::DOUBLE PRECISION;
  v_lambda_ev := CASE WHEN v_denom > 1e-12 THEN v_spendable / v_denom
                      ELSE 'Infinity'::DOUBLE PRECISION END;

  v_lambda := GREATEST(0, LEAST(1, v_lambda_prob, v_lambda_ev));

  v_p_phys  := v_lambda * v_wp;
  v_ev_phys := v_lambda * v_wv;

  -- ---- Solve the two anchors ---------------------------------------------
  v_k := 1 - v_p_phys - v_p_shard;
  v_b := v_target::DOUBLE PRECISION - v_ev_phys - v_p_shard * v_v_shard::DOUBLE PRECISION;

  IF v_k <= 1e-12 OR (v_c - v_v_scrap) <= 1e-12 THEN
    v_p_respin := 0;
  ELSE
    v_p_respin := GREATEST(0, LEAST(v_k,
      (v_b - v_k * v_v_scrap::DOUBLE PRECISION) / (v_c - v_v_scrap)::DOUBLE PRECISION));
  END IF;
  v_p_scrap := GREATEST(0, v_k - v_p_respin);

  FOR i IN 1..n LOOP
    v_items := v_items || jsonb_build_object(
      'item_id',     ids[i],
      'name',        nms[i],
      'est_value',   vals[i],
      -- Display only. NEVER used in any probability or EV calculation.
      'msrp',        msrps[i],
      'rarity',      rars[i],
      'scrap_value', scrs[i],
      'image_url',   imgs[i],
      'stock_qty',   stks[i],
      'probability', v_lambda * w[i]
    );
  END LOOP;

  RETURN jsonb_build_object(
    'tier',                p_box_tier,
    'box_price',           v_c,
    'target_ev',           v_target,
    'items',               v_items,
    'p_physical',          v_p_phys,
    'ev_physical',         v_ev_phys,
    'p_shard',             v_p_shard,
    'ev_shard',            v_p_shard * v_v_shard,
    'p_respin',            v_p_respin,
    'ev_respin',           v_p_respin * v_c,
    'p_scrap',             v_p_scrap,
    'ev_scrap',            v_p_scrap * v_v_scrap,
    'scrap_coins_awarded', v_coins,
    'floor_kind',          v_floor_kind,
    'floor_value',         v_v_scrap,
    'shard_value',         v_v_shard,
    'total_ev',            v_ev_phys + v_p_shard * v_v_shard + v_p_respin * v_c + v_p_scrap * v_v_scrap,
    'scale_factor',        v_lambda,
    'pot_total',           v_pot,
    'pot_gate_met',        v_gate_met,
    'shards_minted',       v_minted,
    'shard_capacity',      v_capacity
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
--  open_box(user, tier, client_roll_id) -> JSONB
-- ---------------------------------------------------------------------------
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
BEGIN
  -- ---- Idempotency: a double-tap must not charge twice --------------------
  IF p_client_roll_id IS NOT NULL THEN
    SELECT payload INTO v_result FROM public.rolls WHERE client_roll_id = p_client_roll_id;
    IF FOUND THEN RETURN v_result; END IF;
  END IF;

  IF p_box_tier NOT IN ('tier_1','tier_2','tier_3') THEN
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
        'scrap_value', CASE WHEN rarity IN ('purple','pink','gold') THEN 0 ELSE scrap_value END
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
      v_scrap_val := CASE WHEN v_it->>'rarity' IN ('purple','pink','gold')
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
          'scrap_value', CASE WHEN v_frar IN ('purple','pink','gold') THEN 0 ELSE v_fscrap END,
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



REVOKE EXECUTE ON FUNCTION public.box_odds(TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.open_box(UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.box_odds(TEXT)           TO service_role;
GRANT  EXECUTE ON FUNCTION public.open_box(UUID,TEXT,UUID) TO service_role;
