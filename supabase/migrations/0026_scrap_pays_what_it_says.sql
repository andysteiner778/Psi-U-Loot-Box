-- ============================================================================
--  HOUSE LOOT — 0026  SCRAPPING PAYS THE NUMBER THE PLAYER WAS SHOWN
-- ============================================================================
--  The reveal panel said "Can be scrapped for +42 coins" and scrapping paid 3.
--
--  scrap_item derived the coin value itself, the old way:
--
--      coin = box_prices[scrap_key_tier] / scrap_coins_per_key
--
--  Migration 0023 replaced that with an explicit `scrap_key_usd`, because the
--  cash-out could otherwise only ever be a box tier's price. box_odds and
--  compact_scrap were updated. scrap_item was NOT. With tier_2 at $15 and 50
--  coins per key it was valuing a coin at $0.30 instead of $0.02, so it paid
--  fourteen times too few.
--
--  Rather than fix the second copy of the formula, delete it. `items.scrap_value`
--  is what the odds table publishes, what the reveal panel promises, and what
--  the admin form writes -- so it is what scrapping should pay. One number, one
--  place, and no way for the promise and the payment to drift apart again.
--
--  The 60%/40% recovery rule now lives solely where scrap_value is WRITTEN
--  (POST and PATCH /api/admin/items), which is the only place it belongs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.scrap_item(p_user_id UUID, p_roll_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r RECORD; cfg JSONB; v_coins INT; v_high BOOLEAN;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';

  SELECT * INTO r FROM public.rolls WHERE id = p_roll_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your item' USING ERRCODE = 'PT403';
  END IF;
  IF r.status <> 'inventory' OR r.kind <> 'physical' THEN
    RAISE EXCEPTION 'Item is not scrappable' USING ERRCODE = 'PT409';
  END IF;

  v_high := r.item_rarity IN ('purple','pink','gold');
  IF v_high AND NOT COALESCE((cfg->>'allow_high_rarity_scrap')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Legendary, Mythic and Exotic items are physical pickup only'
      USING ERRCODE = 'PT403';
  END IF;

  -- The published number, paid verbatim.
  SELECT scrap_value INTO v_coins FROM public.items WHERE id = r.item_id;
  v_coins := COALESCE(v_coins, 0);

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

REVOKE EXECUTE ON FUNCTION public.scrap_item(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.scrap_item(UUID,UUID) TO service_role;
