-- ---------------------------------------------------------------------------
--  0055 — the ladder applies even when there is no player
--
--  The progress block was wrapped in `IF p_user_id IS NOT NULL`, so a caller
--  without a player -- the admin odds preview, and the offline engine the
--  solvency proof runs against -- skipped it and got the raw per-tier base
--  instead of the first rung of the ladder.
--
--  That is a number nobody can ever actually be shown, and it made the SQL and
--  the TypeScript engine disagree by 19 percentage points on tier_0. A caller
--  with no player is simply a player holding zero shards.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.box_odds(p_box_tier text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  bvals            NUMERIC[];   -- bundled voucher value, per item
  f_bvals          NUMERIC[];   -- ...and per filler item
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
  v_ladder         JSONB;
  rwds             BOOLEAN[];   -- is this row a promise rather than a thing?
  f_rwds           BOOLEAN[];
  v_real_units     INT;
  v_shard_taper    DOUBLE PRECISION;
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
  -- What the BUDGET is charged per shard, which is not what the machine is
  -- worth. pc_value/shards_required charges $100 a shard against a $0.50 box --
  -- more than the box costs -- and the EV solve responds by dumping everything
  -- into the floor anchor (measured: 96% junk on tier_1). A shard's honest
  -- expected cash value is near zero, because a set is almost never completed:
  -- the ladder below puts a full tier_3 set at ~218 rolls. pc_value stays the
  -- machine's real worth for claim_pc and the HUD.
  v_v_shard  := COALESCE(
                  (cfg->>'shard_ev_value')::NUMERIC,
                  (cfg->>'pc_value')::NUMERIC / (cfg->>'shards_required')::INT
                );

  -- Global supply cap. Without this, ~100 tier-3 rolls mint four PCs' worth of
  -- shards against one physical PC, which ends in a real argument.
  IF v_gate_met AND v_minted < v_capacity THEN
    v_p_shard := COALESCE((cfg->'shard_probs'->>p_box_tier)::DOUBLE PRECISION, 0);

    -- Progressive difficulty: the first shards come easily, the last one
    -- barely at all. A flat rate makes the whole set feel equally far away;
    -- front-loading it means a player is holding 2 of 4 early and can SEE the
    -- machine, which is the state that keeps a room spending.
    --
    -- Odds depend on the caller, so the shard EV charged to a roll is the one
    -- THAT player actually faces -- a flat charge would overcharge someone near
    -- the end and undercharge someone starting out.
    /*
     * A caller with no player (the admin preview, and the offline drift test)
     * is treated as holding ZERO shards, not as exempt from the ladder. It used
     * to skip this block entirely and fall through to the raw per-tier base,
     * so the number an admin previewed was one nobody could ever be shown --
     * and the TS engine, which has no player either, disagreed with it.
     */
    v_held := 0;
    IF p_user_id IS NOT NULL THEN
      SELECT pc_shards INTO v_held FROM public.profiles WHERE id = p_user_id;
      v_held := COALESCE(v_held, 0);
    END IF;

    IF TRUE THEN

      -- A COMPLETE SET DROPS NOTHING. open_box refuses to mint past
      -- shards_required and falls through to a refund, so publishing a live
      -- shard chance to a player at 4/4 advertised something the server could
      -- never award -- and it kept showing after they had collected them all.
      IF v_held >= (cfg->>'shards_required')::INT THEN
        v_p_shard := 0;
      ELSE
        -- Per-tier ladder, indexed by shards held: the Nth entry is the chance
        -- of the (N+1)th shard. Replaces one shared curve scaled by a per-tier
        -- base, which could not express "20/10 on every box, then diverge".
        v_ladder := cfg->'shard_ladder'->p_box_tier;
        IF v_ladder IS NOT NULL AND jsonb_typeof(v_ladder) = 'array'
           AND jsonb_array_length(v_ladder) > 0 THEN
          v_p_shard := COALESCE(
            (v_ladder->>LEAST(v_held, jsonb_array_length(v_ladder) - 1))::DOUBLE PRECISION,
            0
          );
        ELSE
          -- Fallback to the old base x curve so a config without the ladder
          -- still behaves, rather than silently dropping shards to zero.
          v_curve := cfg->'shard_progress_curve';
          IF v_curve IS NOT NULL AND jsonb_typeof(v_curve) = 'array' THEN
            v_step := COALESCE(
              (v_curve->>LEAST(v_held, jsonb_array_length(v_curve) - 1))::DOUBLE PRECISION,
              1.0
            );
            v_p_shard := v_p_shard * v_step;
          END IF;
        END IF;
      END IF;
    END IF;

    -- A PICKED-CLEAN TIER MUST NOT BECOME A SHARD LOTTERY.
    --
    -- p_shard is a fixed per-tier number, so as the real prizes are won it
    -- becomes a larger and larger share of what is actually left -- exactly
    -- when the PC should be getting HARDER, not easier. Taper it with the
    -- remaining real stock so the last few items in a tier do not turn it into
    -- a shard machine.
    SELECT COALESCE(SUM(t.stock_qty), 0) INTO v_real_units
      FROM public.items t
     WHERE t.is_active AND t.stock_qty > 0 AND t.est_value > 0
       AND COALESCE(t.shard_cost, 0) = 0
       AND NOT COALESCE(t.bundle_only, FALSE)
       AND t.reward_credit IS NULL AND t.reward_voucher_tier IS NULL
       AND (t.box_tier = p_box_tier OR t.est_value > v_fill_max);

    v_shard_taper := LEAST(1.0,
      v_real_units::DOUBLE PRECISION
      / GREATEST(1, COALESCE((cfg->>'shard_full_stock_threshold')::INT, 5))::DOUBLE PRECISION);
    v_p_shard := v_p_shard * v_shard_taper;
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
         array_agg(t.box_tier ORDER BY t.id),
         -- A bundled voucher is real money out of the budget. Priced here so
         -- the weight formula makes bundled items rarer AND the EV solve pays
         -- for them; doing only one of the two would silently overspend.
         array_agg((COALESCE(
           (cfg->'box_prices'->>t.bonus_voucher_tier)::NUMERIC * t.bonus_voucher_pct, 0)
           + COALESCE((SELECT b.est_value FROM public.items b WHERE b.id = t.bonus_item_id), 0))
           ORDER BY t.id)
         ,
         -- House credit, free spins and discount vouchers live in `items` so
         -- the engine prices them, but they are promises, not objects. The odds
         -- screen listed them under "Physical Loot Pool", which is what made the
         -- junk odds look inflated.
         array_agg((t.reward_credit IS NOT NULL OR t.reward_voucher_tier IS NOT NULL)
                   ORDER BY t.id)
    INTO ids, nms, vals, rars, scrs, imgs, stks, msrps, tiers, bvals, rwds
    FROM public.items t
   WHERE (t.box_tier = p_box_tier OR t.est_value > v_fill_max)
     AND t.is_active AND t.stock_qty > 0 AND t.est_value > 0
     -- Shard-locked prizes are claimed with shards, never dropped from a box.
     -- A bundle-only row is a rider, not a prize: it reaches a player attached
     -- to something else (bonus_item_id) and must never be drawn by itself.
     AND NOT COALESCE(t.bundle_only, FALSE)
     AND COALESCE(t.shard_cost, 0) = 0;

  n := COALESCE(array_length(ids, 1), 0);

  -- Filler pool: cheap junk from a lower tier, used as the consolation object.
  SELECT COALESCE(SUM(t.stock_qty), 0),
         COALESCE(SUM((t.est_value + (COALESCE(
           (cfg->'box_prices'->>t.bonus_voucher_tier)::NUMERIC * t.bonus_voucher_pct, 0)
           + COALESCE((SELECT b.est_value FROM public.items b WHERE b.id = t.bonus_item_id), 0)))
           * t.stock_qty), 0),
         array_agg(t.id ORDER BY t.id), array_agg(t.name ORDER BY t.id),
         array_agg(t.est_value ORDER BY t.id), array_agg(t.rarity ORDER BY t.id),
         array_agg(t.image_url ORDER BY t.id), array_agg(t.stock_qty ORDER BY t.id),
         array_agg(t.msrp ORDER BY t.id),
         array_agg((COALESCE(
           (cfg->'box_prices'->>t.bonus_voucher_tier)::NUMERIC * t.bonus_voucher_pct, 0)
           + COALESCE((SELECT b.est_value FROM public.items b WHERE b.id = t.bonus_item_id), 0))
           ORDER BY t.id)
         ,
         array_agg((t.reward_credit IS NOT NULL OR t.reward_voucher_tier IS NOT NULL)
                   ORDER BY t.id)
    INTO v_fill_stock, v_fill_value, f_ids, f_nms, f_vals, f_rars, f_imgs, f_stks, f_msrps, f_bvals, f_rwds
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
     -- A bundle-only row is a rider, not a prize: it reaches a player attached
     -- to something else (bonus_item_id) and must never be drawn by itself.
     AND NOT COALESCE(t.bundle_only, FALSE)
     -- The consolation must be an OBJECT. House credit, free spins and
     -- vouchers live in `items` so the engine prices them, but the floor anchor
     -- exists because "you got junk" should still put something in your hands.
     -- They also carry far more stock than the one-off junk beside them (20 of
     -- a credit row against 1 of a keyring) and the floor draw is
     -- stock-weighted, so they were winning it. They still drop normally from
     -- their own tier's prize pool.
     AND t.reward_credit IS NULL AND t.reward_voucher_tier IS NULL
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
      LEAST(v_max_prob, (v_c * v_weight_factor / (vals[i] + bvals[i]))::DOUBLE PRECISION)
      * CASE WHEN tiers[i] = p_box_tier THEN 1.0 ELSE v_cross END);
    v_wp := v_wp + w[i];
    v_wv := v_wv + w[i] * (vals[i] + bvals[i])::DOUBLE PRECISION;
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
      'bonus_value', bvals[i],
      'is_reward',    COALESCE(rwds[i], FALSE),
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
        'bonus_value', f_bvals[j],
        'is_reward',    COALESCE(f_rwds[j], FALSE),
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
    'shard_taper',         v_shard_taper,
    'shard_real_units',    v_real_units,
    'shard_difficulty',    v_step
  );
END;
$function$
;
