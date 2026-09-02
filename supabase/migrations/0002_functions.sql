-- ============================================================================
--  HOUSE LOOT — 0002  ATOMIC FUNCTIONS
-- ============================================================================
--  These mirror lib/economy.ts exactly. If you change one, change both and
--  re-run `npm run simulate`.
-- ============================================================================

-- CRITICAL: the spec's signature took a client-supplied price. `CREATE OR
-- REPLACE` with a new signature OVERLOADS rather than replaces, leaving the
-- exploitable version callable forever. Drop it explicitly.
DROP FUNCTION IF EXISTS public.open_box(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.open_box(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.box_odds(TEXT);

-- ---------------------------------------------------------------------------
--  box_odds(tier) -> JSONB
--
--  The dual-anchor engine. Solves the closed system
--      sum(P_i) + P_shard + P_respin + P_scrap                       = 1
--      sum(P_i.V_i) + P_shard.V_shard + P_respin.C + P_scrap.V_scrap = target
--  for the two anchor probabilities, scaling item weights so the books balance.
--
--  Read-only. Safe to expose to the admin dashboard as a live odds preview.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.box_odds(p_box_tier TEXT)
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
  v_capacity := (cfg->>'pc_total_supply')::INT * (cfg->>'shards_required')::INT;
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
         array_agg(t.stock_qty ORDER BY t.id)
    INTO ids, nms, vals, rars, scrs, imgs, stks
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
CREATE FUNCTION public.open_box(
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
               < (value->>'pc_total_supply')::INT * (value->>'shards_required')::INT;
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

-- ---------------------------------------------------------------------------
--  scrap_item — anti-exploit rule 2 enforced server-side
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scrap_item(p_user_id UUID, p_roll_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE r RECORD; v_coins INT;
BEGIN
  SELECT * INTO r FROM public.rolls
   WHERE id = p_roll_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your item' USING ERRCODE = 'PT403';
  END IF;
  IF r.status <> 'inventory' OR r.kind <> 'physical' THEN
    RAISE EXCEPTION 'Item is not scrappable' USING ERRCODE = 'PT409';
  END IF;
  IF r.item_rarity IN ('purple','pink','gold') THEN
    RAISE EXCEPTION 'Restricted, Covert and Special items are physical pickup only'
      USING ERRCODE = 'PT403';
  END IF;

  SELECT scrap_value INTO v_coins FROM public.items WHERE id = r.item_id;
  v_coins := COALESCE(v_coins, 0);

  UPDATE public.rolls SET status = 'scrapped' WHERE id = p_roll_id;
  -- Return the unit to the pool so the tier's odds rebalance.
  UPDATE public.items SET stock_qty = stock_qty + 1 WHERE id = r.item_id;
  UPDATE public.profiles SET scrap_coins = scrap_coins + v_coins WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'scrap_gained', v_coins);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  compact_scrap — 100 coins -> one key for the configured tier
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compact_scrap(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE cfg JSONB; v_cost INT; v_coins INT; v_tier TEXT; v_credit NUMERIC;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_cost := (cfg->>'scrap_coins_per_key')::INT;
  v_tier := cfg->>'scrap_key_tier';
  v_credit := (cfg->'box_prices'->>v_tier)::NUMERIC;

  SELECT scrap_coins INTO v_coins FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
  IF v_coins < v_cost THEN
    RAISE EXCEPTION 'Need % scrap coins, have %', v_cost, v_coins USING ERRCODE = 'PT402';
  END IF;

  UPDATE public.profiles
     SET scrap_coins = scrap_coins - v_cost, balance = balance + v_credit
   WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'spent', v_cost, 'credit', v_credit, 'tier', v_tier);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  salvage_shards — abandon shards for free rolls (spec: 1 free tier-2 roll each)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvage_shards(p_user_id UUID, p_count INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE cfg JSONB; v_have INT; v_credit NUMERIC;
BEGIN
  IF p_count < 1 THEN RAISE EXCEPTION 'Nothing to salvage' USING ERRCODE = 'PT400'; END IF;
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_credit := (cfg->'box_prices'->>'tier_2')::NUMERIC * p_count;

  SELECT pc_shards INTO v_have FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
  IF v_have < p_count THEN
    RAISE EXCEPTION 'Only % shards held', v_have USING ERRCODE = 'PT402';
  END IF;

  UPDATE public.profiles
     SET pc_shards = pc_shards - p_count, balance = balance + v_credit
   WHERE id = p_user_id;

  -- Return the shards to global supply so the PC stays winnable.
  UPDATE public.config
     SET value = jsonb_set(value, '{pc_shards_minted}',
                           to_jsonb(GREATEST(0, (value->>'pc_shards_minted')::INT - p_count)))
   WHERE key = 'settings';

  RETURN jsonb_build_object('ok', true, 'salvaged', p_count, 'credit', v_credit);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  claim_pc — 5/5 shards -> the physical PC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pc(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE cfg JSONB; v_have INT; v_required INT; v_value NUMERIC;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_required := (cfg->>'shards_required')::INT;
  v_value    := (cfg->>'pc_value')::NUMERIC;

  SELECT pc_shards INTO v_have FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
  IF v_have < v_required THEN
    RAISE EXCEPTION 'Need % shards, have %', v_required, v_have USING ERRCODE = 'PT402';
  END IF;

  UPDATE public.profiles SET pc_shards = pc_shards - v_required WHERE id = p_user_id;
  INSERT INTO public.rolls (user_id, box_tier, kind, item_name, item_rarity, status, box_price)
  VALUES (p_user_id, 'tier_3', 'shard', 'Gaming PC', 'gold', 'claimed', 0);

  RETURN jsonb_build_object('ok', true, 'item_name', 'Gaming PC', 'value', v_value);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  approve_deposit — the only path that creates credits
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_deposit(p_deposit_id UUID, p_admin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE d RECORD; v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_admin_id;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'PT403';
  END IF;

  SELECT * INTO d FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such deposit' USING ERRCODE = 'PT404'; END IF;
  IF d.status <> 'pending' THEN
    RAISE EXCEPTION 'Already %', d.status USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.deposits
     SET status = 'approved', approved_by = p_admin_id, approved_at = NOW()
   WHERE id = p_deposit_id;
  UPDATE public.profiles SET balance = balance + d.amount WHERE id = d.user_id;

  RETURN jsonb_build_object('ok', true, 'amount', d.amount, 'user_id', d.user_id);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  PIN verification, with lockout.
--  The lockout — not the hash — is what makes a 4-digit PIN survivable:
--  10,000 candidates at 10 req/s is ~17 minutes; five strikes and a 15-minute
--  lock turns that into roughly 500 hours.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.verify_pin(p_name TEXT, p_pin TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, public, extensions, pg_temp
AS $fn$
DECLARE r RECORD;
BEGIN
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
         locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' END
   WHERE profile_id = r.id;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION app_private.set_pin(p_profile_id UUID, p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, public, extensions, pg_temp
AS $fn$
BEGIN
  IF p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits' USING ERRCODE = 'PT400';
  END IF;
  INSERT INTO app_private.profile_secrets (profile_id, pin_hash, must_change)
  VALUES (p_profile_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), FALSE)
  ON CONFLICT (profile_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash, must_change = FALSE,
        failed_attempts = 0, locked_until = NULL;
END;
$fn$;
