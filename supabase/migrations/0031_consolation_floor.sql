-- ---------------------------------------------------------------------------
--  0031 — a FLOOR under the consolation prize, and one filler pool, not two
--
--  Two problems, both in the floor anchor (the "you didn't win an item" branch).
--
--  1. NO MINIMUM. The floor fires on 39% of $10 spins and could pay out a
--     $0.10 Stack of Paper or a $0.50 Type C cable. A sub-dollar trinket from a
--     ten dollar box reads as the machine laughing at you. `filler_min_frac`
--     (a fraction of the box price, 0.10 -> a $1 floor on the $10 box) keeps
--     those items droppable from the boxes they belong to while stopping them
--     being a dear box's idea of a consolation. The mass they lose lands on the
--     credit / free-spin / discount-voucher rewards that share this pool:
--     modelled, junk-object outcomes on the $10 box fall 14.8% -> 7.2% and
--     reward outcomes rise 24.3% -> 35.3%.
--
--  2. TWO DIFFERENT FILLER POOLS. box_odds PUBLISHED the pool as every strictly
--     cheaper tier, but open_box AWARDED from `box_tier = 'tier_1'` alone. So
--     the $10 box's odds listed tier_0 junk that open_box could never hand out,
--     and the $30 box could never award the tier_2 filler it advertised. The
--     published number was not the number the server played. This is the same
--     bug class as the scrap denomination and the missing realized_margin, and
--     it is why scripts/verify-sql.ts compares the two engines directly.
--
--  Both predicates below are now identical to each other AND to the filler pool
--  in lib/economy.ts. Change one, change all three.
-- ---------------------------------------------------------------------------

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
  v_lambda_floor   DOUBLE PRECISION;
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
     -- ...and not so cheap it insults the box. Mirrors fillerMin in
     -- lib/economy.ts and the award predicate in open_box below.
     AND t.est_value >= COALESCE((cfg->>'filler_min_frac')::NUMERIC, 0) * v_c
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

    -- ---- A BOX IS NOT A RE-ROLL MACHINE ------------------------------------
    -- Mirrors the respin clamp in computeBoxOdds. The solve above maximises EV
    -- and values the respin anchor at the full box price, so when a tier's
    -- average item is worth LESS than the box, the arithmetic decides free
    -- re-rolls "pay" better than prizes, drives lambda to zero and leaves a
    -- tier with 0% items. On budget, and useless: the box never gives anything.
    --
    -- Not hypothetical. Tier 3's average item sits a few dollars above its $50
    -- price; win the two dearest prizes and it crosses over mid-party.
    IF v_denom_under < 0 AND v_wp > 0 THEN
      v_lambda_floor := GREATEST(0,
        (1 - v_p_shard - COALESCE((cfg->>'max_respin_share')::DOUBLE PRECISION, 0.25)) / v_wp);
      IF v_lambda_floor > v_lambda THEN
        v_lambda := LEAST(1, v_lambda_floor);
      END IF;
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
     WHERE array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], box_tier)
           < array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], p_box_tier)
       AND est_value <= COALESCE((cfg->>'filler_max_value')::NUMERIC, 15)
       -- The LIST price, not v_price. v_price has already had a 50%-off
       -- voucher applied by this point, and halving the floor for a voucher
       -- holder would let open_box award cheaper filler than box_odds
       -- published for that same box. box_odds emits its v_c here as
       -- 'box_price', so reading it back is exactly the same number.
       AND est_value >= COALESCE((cfg->>'filler_min_frac')::NUMERIC, 0)
                        * (odds->>'box_price')::NUMERIC
       AND COALESCE(shard_cost, 0) = 0
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

  -- ---- Consolation: CREDIT, not coins (terminal fallback) -----------------
  -- This used to hand out scrap coins. On the $0.75 box that was "+8 Scrap
  -- Coins" against a 50-coin cash-out: sixteen cents, expressed as 16% of a
  -- threshold nobody was tracking. The value was never the problem -- it is
  -- capped at about a fifth of the box price, and raising it costs item drops
  -- roughly one for one (doubling it to $0.34 drops Tier 0 from 36.5% prizes to
  -- 24.7%). The two-step was the problem.
  --
  -- Paid straight into the balance instead. Same money, immediately spendable,
  -- no threshold to reach. Five of them buy another spin, which is a story a
  -- player can follow.
  --
  -- Coins still exist -- scrapping an item pays them, and the compactor turns
  -- them into credit. They are just no longer what a losing roll hands you.
  v_coins  := (odds->>'scrap_coins_awarded')::INT;
  v_reward := ROUND(v_coins * COALESCE(
                      (cfg->>'scrap_key_usd')::NUMERIC,
                      (cfg->'box_prices'->>(cfg->>'scrap_key_tier'))::NUMERIC
                    ) / (cfg->>'scrap_coins_per_key')::NUMERIC, 2);

  UPDATE public.profiles SET balance = balance + v_reward WHERE id = p_user_id;
  INSERT INTO public.rolls (user_id, box_tier, kind, item_name, item_rarity,
                            status, box_price, client_roll_id)
  VALUES (p_user_id, p_box_tier, 'scrap', '+$' || TO_CHAR(v_reward, 'FM999990.00') || ' Credit',
          'grey', 'consumed', v_price, p_client_roll_id)
  RETURNING id INTO v_roll_id;

  v_result := jsonb_build_object(
    'type','scrap',
    'item_name','+$' || TO_CHAR(v_reward, 'FM999990.00') || ' Credit',
    'rarity','grey',
    -- scrap_gained stays in the payload: the reveal and the ticker both read
    -- it, and a field the client reads that the server stops writing is the
    -- exact bug shape that has bitten this app three times. It now reports
    -- CENTS OF CREDIT rather than coins, and credit_gained carries the dollars.
    'scrap_gained', 0,
    'credit_gained', v_reward,
    'roll_id', v_roll_id);
  UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.box_odds(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.box_odds(TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.open_box(UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.open_box(UUID,TEXT,UUID) TO service_role;
