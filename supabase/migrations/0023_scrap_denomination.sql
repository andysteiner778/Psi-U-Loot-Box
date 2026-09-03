-- ============================================================================
--  HOUSE LOOT — 0023  FINER SCRAP COINS, $10 CASH-OUT, $10 SHARD SALVAGE
-- ============================================================================
--  Three economy changes, all owner-directed.
--
--  1. SCRAP COINS ARE NOW WORTH $0.02, not $0.10.
--
--     "+2 Scrap Coins" on a $1 box read as nothing. The VALUE was never the
--     problem -- it is 20% of that box's payout budget, about 20 cents, and it
--     cannot be raised without the $1 box paying out more than it takes in.
--     The NUMBER was the problem. At 2 cents a coin the same 20 cents prints
--     as "+10 Scrap Coins", and the tiers read 10 / 40 / 160 / 400.
--
--  2. THE COMPACTOR PAYS $10 FOR 500 COINS, replacing $20 for 200.
--
--     The cash-out was tied to a BOX TIER's price, so it could only ever be
--     $1, $5, $20 or $50. `scrap_key_usd` says the number in dollars instead.
--     500 coins is $10 of scrap because a coin is 2 cents; you still cannot
--     cash out more than you actually accumulated. What changes is that the
--     bar is now half as far away, and one bad Tier 3 roll (400 coins) very
--     nearly clears it.
--
--  3. SHARDS SALVAGE FOR $10 EACH, was $5.
--
--     Same shape of bug as the compactor: the payout was read off
--     `box_prices[shard_salvage_tier]`, so it silently tracked the Tier 1
--     price -- and moved to $4 whenever a flash sale was running. It is an
--     explicit dollar amount now.
--
--  EXISTING BALANCES ARE REBASED. Coins already held were earned at 10 cents.
--  Leaving them alone would quietly cut every player's scrap bag to a fifth of
--  its value, so they are multiplied by the ratio of the old coin to the new.
-- ============================================================================

-- Rebase held coins BEFORE changing the denomination, using the old value.
UPDATE public.profiles p
   SET scrap_coins = ROUND(
         p.scrap_coins * (
           (SELECT (c.value->'box_prices'->>(c.value->>'scrap_key_tier'))::NUMERIC
                   / (c.value->>'scrap_coins_per_key')::NUMERIC
              FROM public.config c WHERE c.key = 'settings')
           / 0.02
         )
       )::INT
 WHERE p.scrap_coins > 0
   AND NOT (SELECT value ? 'scrap_key_usd' FROM public.config WHERE key = 'settings');

UPDATE public.config
   SET value = value
       || jsonb_build_object('scrap_key_usd', 10)
       || jsonb_build_object('scrap_coins_per_key', 500)
       || jsonb_build_object('shard_salvage_value', 10)
 WHERE key = 'settings';

-- ---------------------------------------------------------------------------
--  compact_scrap — pay `scrap_key_usd` dollars, not a box tier's price.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compact_scrap(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE cfg JSONB; v_cost INT; v_coins INT; v_credit NUMERIC;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_cost   := (cfg->>'scrap_coins_per_key')::INT;
  v_credit := COALESCE(
                (cfg->>'scrap_key_usd')::NUMERIC,
                (cfg->'box_prices'->>(cfg->>'scrap_key_tier'))::NUMERIC
              );

  SELECT scrap_coins INTO v_coins FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
  IF v_coins < v_cost THEN
    RAISE EXCEPTION 'Need % scrap coins, have %', v_cost, v_coins USING ERRCODE = 'PT402';
  END IF;

  UPDATE public.profiles
     SET scrap_coins = scrap_coins - v_cost, balance = balance + v_credit
   WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'spent', v_cost, 'credit', v_credit);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  salvage_shards — an explicit dollar amount per shard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvage_shards(p_user_id UUID, p_count INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE cfg JSONB; v_have INT; v_credit NUMERIC; v_per NUMERIC;
BEGIN
  IF p_count < 1 THEN RAISE EXCEPTION 'Nothing to salvage' USING ERRCODE = 'PT400'; END IF;
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_per := COALESCE(
             (cfg->>'shard_salvage_value')::NUMERIC,
             (cfg->'box_prices'->>COALESCE(cfg->>'shard_salvage_tier','tier_1'))::NUMERIC
           );
  v_credit := v_per * p_count;

  SELECT pc_shards INTO v_have FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
  IF v_have < p_count THEN
    RAISE EXCEPTION 'Only % shards held', v_have USING ERRCODE = 'PT402';
  END IF;

  UPDATE public.profiles
     SET pc_shards = pc_shards - p_count, balance = balance + v_credit
   WHERE id = p_user_id;

  UPDATE public.config
     SET value = jsonb_set(value, '{pc_shards_minted}',
                           to_jsonb(GREATEST(0, (value->>'pc_shards_minted')::INT - p_count)))
   WHERE key = 'settings';

  RETURN jsonb_build_object('ok', true, 'salvaged', p_count, 'credit', v_credit, 'per_shard', v_per);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.compact_scrap(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.compact_scrap(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.salvage_shards(UUID,INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.salvage_shards(UUID,INT) TO service_role;

DROP FUNCTION IF EXISTS public.box_odds(TEXT);

CREATE OR REPLACE FUNCTION public.box_odds(p_box_tier TEXT, p_user_id UUID DEFAULT NULL)
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
  v_fill_max       NUMERIC;
  v_cross          DOUBLE PRECISION;
  tiers            TEXT[];
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
  v_max_achievable DOUBLE PRECISION;
  v_denom_under    DOUBLE PRECISION;
  v_lambda_under   DOUBLE PRECISION;
  v_held           INT := 0;
  v_curve          JSONB;
  v_step           DOUBLE PRECISION := 1.0;
  f_ids            UUID[];
  f_nms            TEXT[];
  f_vals           NUMERIC[];
  f_rars           TEXT[];
  f_imgs           TEXT[];
  f_stks           INT[];
  f_msrps          NUMERIC[];
  v_filler         JSONB := '[]'::JSONB;
  j                INT;
  fn               INT;
  v_p_scrap        DOUBLE PRECISION;
  v_items          JSONB := '[]'::JSONB;
  i                INT;
  n                INT;
BEGIN
  IF p_box_tier NOT IN ('tier_0','tier_1','tier_2','tier_3') THEN
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
  -- Per-tier margin override, mirroring marginForTier() in lib/economy.ts.
  -- `tier_margins` is a PARTIAL map: a tier absent from it (or holding a
  -- non-numeric) falls back to the global house_margin. The $1 box sits in
  -- here at 0 -- it is a loss-leader for clearing junk, not an earner.
  --
  -- jsonb_typeof guards the fallback: `(cfg->'tier_margins'->>'tier_0')::NUMERIC`
  -- on a missing key yields NULL, and NULL margin silently makes v_target NULL,
  -- which makes every probability NULL and every roll a scrap.
  v_margin := CASE
                WHEN jsonb_typeof(cfg->'tier_margins'->p_box_tier) = 'number'
                  THEN (cfg->'tier_margins'->>p_box_tier)::NUMERIC
                ELSE (cfg->>'house_margin')::NUMERIC
              END;

  -- Flash sale expires on the server clock, not on whatever the client believes.
  v_sale_ends := NULLIF(cfg->>'flash_sale_ends_at','')::TIMESTAMPTZ;
  IF COALESCE((cfg->>'flash_sale')::BOOLEAN, FALSE)
     AND (v_sale_ends IS NULL OR v_sale_ends > NOW()) THEN
    v_c := ROUND(v_c * (1 - (cfg->>'flash_sale_pct')::NUMERIC), 2);
  END IF;

  v_target := v_c * (1 - v_margin);
  v_max_prob := (cfg->>'max_item_prob')::DOUBLE PRECISION;
  v_weight_factor := (cfg->>'ev_weight_factor')::NUMERIC;
  v_fill_max      := COALESCE((cfg->>'filler_max_value')::NUMERIC, 15);
  v_cross         := COALESCE((cfg->>'cross_tier_factor')::DOUBLE PRECISION, 0.15);

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

    -- Progressive difficulty: the first shards come easily, the last one
    -- barely at all. A flat rate makes the whole set feel equally far away;
    -- front-loading it means a player is holding 2 of 4 early and can SEE the
    -- machine, which is the state that keeps a room spending.
    --
    -- Odds now depend on the caller, so the shard EV charged to a roll is the
    -- one THAT player actually faces -- a flat charge would overcharge someone
    -- near the end and undercharge someone starting out.
    IF p_user_id IS NOT NULL THEN
      SELECT pc_shards INTO v_held FROM public.profiles WHERE id = p_user_id;
      v_held := COALESCE(v_held, 0);
      v_curve := cfg->'shard_progress_curve';
      IF v_curve IS NOT NULL AND jsonb_typeof(v_curve) = 'array' THEN
        -- Past the end of the curve, hold the last multiplier rather than
        -- falling back to 1.0, which would make the final shard the EASIEST.
        v_step := COALESCE(
          (v_curve->>LEAST(v_held, jsonb_array_length(v_curve) - 1))::DOUBLE PRECISION,
          1.0
        );
        v_p_shard := v_p_shard * v_step;
      END IF;
    END IF;
  END IF;

  -- ---- Floor anchor. The spec calls this $0; it is not. -------------------
  -- Coin value = what the compactor pays out, divided by what it costs.
  -- `scrap_key_usd` says that in dollars; it used to be derived from a box
  -- tier's price, which meant the cash-out could only ever be $1, $5, $20 or
  -- $50 -- there is no $10 box. Falls back to the old derivation so a config
  -- row without the key keeps working.
  v_coin_usd := COALESCE(
                  (cfg->>'scrap_key_usd')::NUMERIC,
                  (cfg->'box_prices'->>(cfg->>'scrap_key_tier'))::NUMERIC
                ) / (cfg->>'scrap_coins_per_key')::NUMERIC;
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
         array_agg(t.stock_qty ORDER BY t.id), array_agg(t.msrp ORDER BY t.id),
         array_agg(t.box_tier ORDER BY t.id)
    INTO ids, nms, vals, rars, scrs, imgs, stks, msrps, tiers
    FROM public.items t
   WHERE (t.box_tier = p_box_tier OR t.est_value > v_fill_max)
     AND t.is_active AND t.stock_qty > 0 AND t.est_value > 0
     -- Shard-locked prizes are claimed with shards, never dropped from a box.
     AND COALESCE(t.shard_cost, 0) = 0;

  n := COALESCE(array_length(ids, 1), 0);

  -- Filler pool: cheap junk from a lower tier, used as the consolation object.
  SELECT COALESCE(SUM(t.stock_qty), 0),
         COALESCE(SUM(t.est_value * t.stock_qty), 0),
         array_agg(t.id ORDER BY t.id), array_agg(t.name ORDER BY t.id),
         array_agg(t.est_value ORDER BY t.id), array_agg(t.rarity ORDER BY t.id),
         array_agg(t.image_url ORDER BY t.id), array_agg(t.stock_qty ORDER BY t.id),
         array_agg(t.msrp ORDER BY t.id)
    INTO v_fill_stock, v_fill_value, f_ids, f_nms, f_vals, f_rars, f_imgs, f_stks, f_msrps
    FROM public.items t
   WHERE p_box_tier <> 'tier_0'
     -- Strictly CHEAPER tiers only. A flat value cap let the $5 box borrow $15
     -- tier-2 items as its consolation, putting the floor anchor at $5.41
     -- against a $4.38 budget: tier 1 paid out more than it took in, a realized
     -- margin of -18.5%. Junk is borrowed UP the ladder, never down it.
     AND array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], t.box_tier)
         < array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], p_box_tier)
     AND t.est_value <= COALESCE((cfg->>'filler_max_value')::NUMERIC, 15)
     AND t.is_active AND t.stock_qty > 0 AND t.est_value > 0
     AND COALESCE(t.shard_cost, 0) = 0;

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
    -- Off-tier prizes are suppressed, not excluded: a $5 crate can still cough
    -- up the good monitor, just rarely. Mirrors `affinity` in lib/economy.ts.
    w := array_append(w,
      LEAST(v_max_prob, (v_c * v_weight_factor / vals[i])::DOUBLE PRECISION)
      * CASE WHEN tiers[i] = p_box_tier THEN 1.0 ELSE v_cross END);
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

  -- ---- Scale pass 3: the UNDERSPEND case ----------------------------------
  --
  -- Passes 1 and 2 only ever scale items DOWN, to stop the house losing money.
  -- Neither can fix the opposite: a tier full of items far cheaper than the box
  -- saturates probability at 100% items and pays out less than the budget, with
  -- no probability left for an anchor to top it up. The respin anchor is worth
  -- C, MORE than the budget, so handing out fewer items and some free re-rolls
  -- raises EV. Solve for the lambda where the anchors run all-respin and EV
  -- lands exactly on target:
  --
  --     target = lam*Wv + P_shard*V_shard + (1 - lam*Wp - P_shard) * C
  --
  -- This existed in lib/economy.ts but was never mirrored here, so production
  -- quietly kept up to 20 percentage points more margin than intended while the
  -- solvency proof -- which runs on the TypeScript side -- said everything was
  -- exact. Found by the engine-comparison check in scripts/verify-sql.ts.
  v_max_achievable := v_lambda * v_wv
                      + v_p_shard * v_v_shard::DOUBLE PRECISION
                      + GREATEST(0, 1 - v_lambda * v_wp - v_p_shard) * v_c::DOUBLE PRECISION;

  IF v_max_achievable < v_target::DOUBLE PRECISION - 1e-9 THEN
    v_denom_under := v_wv - v_wp * v_c::DOUBLE PRECISION;
    IF ABS(v_denom_under) > 1e-12 THEN
      v_lambda_under := (v_target::DOUBLE PRECISION
                         - v_p_shard * v_v_shard::DOUBLE PRECISION
                         - (1 - v_p_shard) * v_c::DOUBLE PRECISION) / v_denom_under;
      v_lambda := GREATEST(0, LEAST(v_lambda, v_lambda_under));
    END IF;
  END IF;

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

  -- Expose the filler pool with real probabilities. Without this the published
  -- odds omitted every cheap item that backs the consolation slot -- which in a
  -- $50 box is a quarter of all outcomes -- so the percentages a player could
  -- see did not add up to 100 and the commonest results were invisible.
  fn := COALESCE(array_length(f_ids, 1), 0);
  IF v_floor_kind = 'item' AND v_fill_stock > 0 THEN
    FOR j IN 1..fn LOOP
      v_filler := v_filler || jsonb_build_object(
        'item_id',     f_ids[j],
        'name',        f_nms[j],
        'est_value',   f_vals[j],
        'msrp',        f_msrps[j],
        'rarity',      f_rars[j],
        'image_url',   f_imgs[j],
        'stock_qty',   f_stks[j],
        -- Conditional on the floor branch being drawn, weighted by stock: a
        -- pile of eight cables is eight times likelier than one desk lamp.
        'probability', v_p_scrap * (f_stks[j]::DOUBLE PRECISION / v_fill_stock)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'filler',              v_filler,
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
    'shard_capacity',      v_capacity,
    'shards_held',         v_held,
    'shard_difficulty',    v_step
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
--  open_box(user, tier, client_roll_id) -> JSONB
-- ---------------------------------------------------------------------------
