-- ============================================================================
--  HOUSE LOOT — 0015  FINER SCRAP COINS
-- ============================================================================
--  Scrap recovery was wildly out of proportion at the cheap end, and the cause
--  was the coin denomination rather than the formula. A coin was worth $1.00 and
--  coins are whole numbers, so 60% of a small item could not be expressed:
--
--      $15 item -> 9 coins = $9.00  -> 60%   correct
--      $3  item -> 1 coin  = $1.00  -> 33%   should be 60%
--      $1  item -> 0 coins = $0.00  ->  0%   nothing at all
--
--  Two thirds of this catalog is under $5, so most of it was being scrapped at
--  half the intended rate or refused outright. Fixing the rounding cannot help:
--  60% of $1 is 60 cents and there was no coin small enough to pay it.
--
--  A coin is now worth $0.10 (200 buy the $20 Tier-2 key). Every whole-dollar
--  item then lands on its exact intended rate, because 10% divides evenly into
--  both 60% and 40%:
--
--      $1  item -> 6 coins   = $0.60  -> 60%
--      $3  item -> 18 coins  = $1.80  -> 60%
--      $50 purple -> 200 coins = $20  -> 40%
--
--  Numbers get bigger, which reads fine for a game currency, and the compactor
--  becomes "200 coins = a free Tier-2 box".
-- ============================================================================

UPDATE public.config SET value = value || jsonb_build_object(
  'scrap_coins_per_key', 200      -- with a $20 key tier, one coin = $0.10
) WHERE key = 'settings';

-- Recompute every item at the new denomination.
UPDATE public.items SET scrap_value = ROUND(
  est_value * CASE WHEN rarity IN ('purple','pink','gold') THEN 0.40 ELSE 0.60 END
  / 0.10
)::INT
WHERE TRUE;

CREATE OR REPLACE FUNCTION public.scrap_item(p_user_id UUID, p_roll_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r RECORD; cfg JSONB; v_coins INT; v_value NUMERIC; v_frac NUMERIC;
  v_high BOOLEAN; v_coin_usd NUMERIC;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';

  SELECT * INTO r FROM public.rolls
   WHERE id = p_roll_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your item' USING ERRCODE = 'PT403';
  END IF;
  IF r.status <> 'inventory' OR r.kind <> 'physical' THEN
    RAISE EXCEPTION 'Item is not scrappable' USING ERRCODE = 'PT409';
  END IF;

  v_high := r.item_rarity IN ('purple','pink','gold');
  IF v_high AND NOT COALESCE((cfg->>'allow_high_rarity_scrap')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Restricted, Covert and Special items are physical pickup only'
      USING ERRCODE = 'PT403';
  END IF;

  v_coin_usd := (cfg->'box_prices'->>(cfg->>'scrap_key_tier'))::NUMERIC
                / (cfg->>'scrap_coins_per_key')::NUMERIC;

  SELECT est_value INTO v_value FROM public.items WHERE id = r.item_id;
  IF v_value IS NULL THEN
    SELECT scrap_value INTO v_coins FROM public.items WHERE id = r.item_id;
    v_coins := COALESCE(v_coins, 0);
  ELSE
    v_frac := CASE WHEN v_high
                   THEN COALESCE((cfg->>'scrap_recovery_high')::NUMERIC, 0.40)
                   ELSE COALESCE((cfg->>'scrap_recovery_frac')::NUMERIC, 0.60) END;
    -- ROUND is safe now: at 10c granularity the rounding error is at most 5c,
    -- far too small to push any item past 100% of its own value.
    v_coins := ROUND(v_value * v_frac / v_coin_usd)::INT;
  END IF;

  IF v_coins < 1 THEN
    RAISE EXCEPTION 'This is not worth scrapping — take it home instead'
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.rolls SET status = 'scrapped' WHERE id = p_roll_id;
  UPDATE public.items SET stock_qty = stock_qty + 1 WHERE id = r.item_id;
  UPDATE public.profiles SET scrap_coins = scrap_coins + v_coins WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'scrap_gained', v_coins);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.scrap_item(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.scrap_item(UUID, UUID) TO service_role;
