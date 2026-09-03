-- ============================================================================
--  HOUSE LOOT — 0014  SCRAP FLOOR
-- ============================================================================
--  Scrap value used GREATEST(1, ROUND(value * recovery)), so anything cheap
--  enough rounded UP to the one-coin minimum:
--
--      $1.00 item -> ROUND(0.60) = 1 coin = $1.00  -> 100% of its value
--      $2.00 item -> ROUND(1.20) = 1 coin = $1.00  ->  50%
--
--  A dollar item returning a dollar is not a money printer, but it does break
--  the rule the whole scrap economy rests on: recycling must always be a loss,
--  or "win junk, convert to credit" becomes a free action rather than a
--  reluctant one.
--
--  FLOOR instead, with no minimum. Items worth under about $1.70 now compute to
--  0, which the app reads as "not scrappable" -- which is honest: a single
--  cable is not worth a token. They can still be claimed and taken home.
-- ============================================================================

UPDATE public.items SET scrap_value = FLOOR(
  est_value * CASE WHEN rarity IN ('purple','pink','gold') THEN 0.40 ELSE 0.60 END
)::INT
WHERE TRUE;

CREATE OR REPLACE FUNCTION public.scrap_item(p_user_id UUID, p_roll_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r RECORD; cfg JSONB; v_coins INT; v_value NUMERIC; v_frac NUMERIC; v_high BOOLEAN;
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

  SELECT est_value INTO v_value FROM public.items WHERE id = r.item_id;
  IF v_value IS NULL THEN
    SELECT scrap_value INTO v_coins FROM public.items WHERE id = r.item_id;
    v_coins := COALESCE(v_coins, 0);
  ELSE
    v_frac := CASE WHEN v_high
                   THEN COALESCE((cfg->>'scrap_recovery_high')::NUMERIC, 0.40)
                   ELSE COALESCE((cfg->>'scrap_recovery_frac')::NUMERIC, 0.60) END;
    -- FLOOR, not ROUND, and no minimum: rounding up handed a $1 item a $1 coin.
    v_coins := FLOOR(
      v_value * v_frac
      / ((cfg->'box_prices'->>(cfg->>'scrap_key_tier'))::NUMERIC
         / (cfg->>'scrap_coins_per_key')::NUMERIC)
    )::INT;
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
