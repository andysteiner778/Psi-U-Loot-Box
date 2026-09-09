-- ---------------------------------------------------------------------------
--  0049 — an item may be worth $0
--
--  The owner is re-photographing a whole house of stuff and wants to upload
--  first and price later. The CHECK forbade it, so every bulk upload needed a
--  price typed before it would save.
--
--  WHY THIS IS SAFE. $0 already means "not in any box": lib/economy.ts,
--  box_odds and tier_lock_state all filter `est_value > 0`, because the weight
--  formula is `min(cap, C * f / V)` and V = 0 divides by zero. So an unpriced
--  item is simply absent from the draw until it is given a value -- it cannot
--  be won for nothing, and it cannot crowd the pool with a capped weight.
--
--  The original CHECK existed because "a single $0.00 item from a bad vision
--  scan" used to break the odds. It no longer can: the filters do that job now,
--  and they are enforced in three places rather than one.
--
--  NEGATIVE values stay forbidden. Those are not a state anything recovers
--  from -- they invert the weight formula and make the EV solve nonsense.
-- ---------------------------------------------------------------------------

ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_est_value_check;
ALTER TABLE public.items ADD CONSTRAINT items_est_value_check CHECK (est_value >= 0);

-- ---------------------------------------------------------------------------
--  tier_lock_state: say WHY a box is empty
--
--  A tier holding nothing but unpriced items reported "everything worth winning
--  in this box has been claimed", which is exactly wrong and sends the admin
--  looking for a stock bug. Count the unpriced separately and say so.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tier_lock_state(p_box_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg JSONB; v_rank INT; v_fmax NUMERIC; v_fmin NUMERIC; v_c NUMERIC;
  v_real INT; v_unpriced INT;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_rank := array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], p_box_tier);
  v_c    := (cfg->'box_prices'->>p_box_tier)::NUMERIC;
  v_fmax := COALESCE((cfg->>'filler_max_value')::NUMERIC, 15);
  v_fmin := COALESCE((cfg->>'filler_min_frac')::NUMERIC, 0) * v_c;

  SELECT
    COUNT(*) FILTER (WHERE i.est_value > 0),
    COUNT(*) FILTER (WHERE i.est_value = 0)
    INTO v_real, v_unpriced
    FROM public.items i
   WHERE i.is_active
     AND i.stock_qty > 0
     AND COALESCE(i.shard_cost, 0) = 0
     AND NOT COALESCE(i.bundle_only, FALSE)
     AND i.reward_credit IS NULL
     AND i.reward_voucher_tier IS NULL
     AND (
       i.box_tier = p_box_tier
       OR i.est_value > v_fmax
       OR (array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], i.box_tier) < v_rank
           AND i.est_value <= v_fmax AND i.est_value >= v_fmin)
     );

  RETURN jsonb_build_object(
    'tier', p_box_tier,
    'locked', v_real = 0,
    'real_items_left', v_real,
    'unpriced_items', v_unpriced,
    'reason', CASE
      WHEN v_real > 0 THEN NULL
      WHEN v_unpriced > 0 THEN
        'Nothing in this box has a price yet — ' || v_unpriced ||
        ' item(s) are waiting to be valued in House Controls.'
      ELSE 'Everything worth winning in this box has been claimed.'
    END);
END;
$fn$;
