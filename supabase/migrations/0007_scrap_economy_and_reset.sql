-- ============================================================================
--  HOUSE LOOT — 0007  SCRAP ECONOMY FIX + PARTY RESET
-- ============================================================================
--
--  CRITICAL: SCRAPPING PAID 2x AN ITEM'S VALUE
--
--  SPEC.md section 6 defines scrap value as "price * 10". That only works if a
--  coin is worth $0.05. Here a coin was worth `tier_2 price / 100` = $0.20, so
--  ten coins per dollar of item value paid out $2.00 for every $1.00 scrapped.
--
--      Phone Charger    $5   ->  50 coins  = $10.00   (2.0x)
--      1080p Monitor    $70  -> 700 coins  = $140.00  (2.0x)
--
--  That is a money printer, not a leak: win a $70 monitor, scrap it for $140,
--  buy seven more boxes, repeat. No house margin survives it, and every
--  solvency gate we have missed it because they all model the ROLL, not what a
--  player does with the item afterwards.
--
--  FIX, in three parts:
--    1. A coin is now worth exactly $1.00 (20 coins buys the $20 Tier-2 key),
--       which also makes the compactor legible: "20 coins = $20" instead of
--       "100 coins = $20" where each coin was an opaque 20 cents.
--    2. Scrapping recovers a FRACTION of value, never a multiple. 60% for
--       ordinary items, 40% for Restricted/Covert/Special.
--    3. Every existing item's scrap_value is recomputed.
--
--  HIGH-RARITY SCRAPPING IS NOW ALLOWED
--  The original blanket ban existed to stop someone recycling a $200 speaker
--  into enough spins to clear the house. At 40% recovery against a 12.5% house
--  margin that trade destroys value for the player, so the maths defuses the
--  exploit and the ban is no longer doing work. Someone who genuinely does not
--  want a speaker can now turn it into credit at a deliberately poor rate, and
--  the item returns to the pool for someone who does want it.
-- ============================================================================

-- The CHECK that forbade a scrappable high-rarity item has to go before we can
-- write non-zero scrap values onto them.
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS high_tier_never_scrappable;

UPDATE public.config SET value = value
  || jsonb_build_object(
       'scrap_coins_per_key',   20,      -- with scrap_key_tier = tier_2 ($20) this makes a coin $1.00
       'scrap_ev_frac',         0.20,    -- a losing roll returns 20% of the box price
       'scrap_recovery_frac',   0.60,    -- ordinary items recover 60% of value
       'scrap_recovery_high',   0.40,    -- Restricted/Covert/Special recover 40%
       'allow_high_rarity_scrap', true
     )
WHERE key = 'settings';

-- Recompute every item against the corrected rates.
UPDATE public.items SET scrap_value = GREATEST(
  1,
  ROUND(est_value * CASE WHEN rarity IN ('purple','pink','gold') THEN 0.40 ELSE 0.60 END)
)::INT;

-- ---------------------------------------------------------------------------
--  scrap_item — honour the configured recovery rates and the high-rarity flag
-- ---------------------------------------------------------------------------
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

  -- Recompute from the item's live value rather than trusting a stored column,
  -- so an admin correcting a price immediately corrects the scrap rate too.
  SELECT est_value INTO v_value FROM public.items WHERE id = r.item_id;
  IF v_value IS NULL THEN
    SELECT scrap_value INTO v_coins FROM public.items WHERE id = r.item_id;
    v_coins := COALESCE(v_coins, 1);
  ELSE
    v_frac := CASE WHEN v_high
                   THEN COALESCE((cfg->>'scrap_recovery_high')::NUMERIC, 0.40)
                   ELSE COALESCE((cfg->>'scrap_recovery_frac')::NUMERIC, 0.60) END;
    -- coin_usd = scrap_key_tier price / scrap_coins_per_key
    v_coins := GREATEST(1, ROUND(
      v_value * v_frac
      / ((cfg->'box_prices'->>(cfg->>'scrap_key_tier'))::NUMERIC
         / (cfg->>'scrap_coins_per_key')::NUMERIC)
    ))::INT;
  END IF;

  UPDATE public.rolls SET status = 'scrapped' WHERE id = p_roll_id;
  -- Return the unit to the pool so the tier's odds rebalance and someone who
  -- actually wants it can still win it.
  UPDATE public.items SET stock_qty = stock_qty + 1 WHERE id = r.item_id;
  UPDATE public.profiles SET scrap_coins = scrap_coins + v_coins WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'scrap_gained', v_coins);
END;
$fn$;

-- ---------------------------------------------------------------------------
--  Opening stock, so a reset can restore it
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS initial_stock_qty INT;
UPDATE public.items SET initial_stock_qty = stock_qty WHERE initial_stock_qty IS NULL;

CREATE OR REPLACE FUNCTION public.items_set_initial_stock()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.initial_stock_qty IS NULL THEN NEW.initial_stock_qty := NEW.stock_qty; END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_items_initial_stock ON public.items;
CREATE TRIGGER trg_items_initial_stock
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.items_set_initial_stock();

-- ---------------------------------------------------------------------------
--  reset_party_state() — clear the test run, keep the people
--
--  Testing leaves rows that are invisible on the admin screen but change the
--  game: approved test deposits inflate the gross pot and can push it past the
--  shard gate before anyone has played, rolls sit in inventories, stock is
--  decremented, and minted shards count against the global cap.
--
--  Deliberately does NOT touch names, roles or PINs, so a roster already
--  renamed to real housemates survives.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_party_state(p_admin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_role TEXT; v_rolls INT; v_deposits INT; v_pot NUMERIC;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_admin_id;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'PT403';
  END IF;

  SELECT count(*) INTO v_rolls FROM public.rolls;
  SELECT count(*), COALESCE(sum(amount) FILTER (WHERE status = 'approved'), 0)
    INTO v_deposits, v_pot FROM public.deposits;

  DELETE FROM public.drop_overrides;
  DELETE FROM public.rolls;
  DELETE FROM public.deposits;
  UPDATE public.profiles SET balance = 0, scrap_coins = 0, pc_shards = 0;
  UPDATE public.items SET stock_qty = COALESCE(initial_stock_qty, stock_qty), is_active = TRUE;
  UPDATE public.config SET value = jsonb_set(value, '{pc_shards_minted}', '0')
   WHERE key = 'settings';

  RETURN jsonb_build_object('ok', true, 'rolls_cleared', v_rolls,
                            'deposits_cleared', v_deposits, 'pot_cleared', v_pot);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.reset_party_state(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.scrap_item(UUID, UUID)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reset_party_state(UUID) TO service_role;
GRANT  EXECUTE ON FUNCTION public.scrap_item(UUID, UUID)  TO service_role;
