-- ---------------------------------------------------------------------------
--  0034 — clearance claims become atomic
--
--  THE BUG. Both clearance routes decremented stock like this:
--
--      const { data: item } = await db.from('items').select('stock_qty')...   -- reads 2
--      await db.from('items').update({ stock_qty: item.stock_qty - 1 })       -- writes 1
--               .eq('id', id).gt('stock_qty', 0);
--
--  That is a READ-MODIFY-WRITE, not an atomic decrement. The `stock_qty > 0`
--  guard only saves the case where stock is exactly 1 -- which is the only case
--  that was tested. With stock >= 2 both racers read 2, both write 1, both pass
--  the guard, and TWO units are handed out against ONE decrement. A unit is
--  conjured. This project has already had five prizes duplicated exactly this
--  way; `stock_qty + held = initial_stock_qty` is the invariant it breaks.
--
--  The balance charge had the same shape (read balance, write balance - price),
--  so two concurrent claims could each deduct from the same starting figure and
--  the player would pay once for two items.
--
--  And the compensating rollback wrote back the STALE value:
--
--      await db.from('items').update({ stock_qty: item.stock_qty })  -- resurrects
--
--  which un-sells anything another buyer took in between.
--
--  THE FIX. One statement, computed in the database:
--
--      UPDATE items SET stock_qty = stock_qty - 1 WHERE id = ? AND stock_qty > 0
--
--  `stock_qty - 1` is evaluated by Postgres against the row it just locked, so
--  concurrent callers serialise and the loser gets ROW_COUNT 0. Charging,
--  decrementing and recording the roll all happen in one transaction, so there
--  is nothing to compensate for: either the whole claim happens or none of it.
--
--  Mirrors the approach already used by open_box, which has always done its
--  decrement this way.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.clearance_claim(
  p_user_id        UUID,
  p_item_id        UUID,
  p_price          NUMERIC,
  p_charge_balance BOOLEAN,
  p_mode           TEXT,
  p_payment_method TEXT,
  p_client_roll_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r_item RECORD; v_bal NUMERIC; v_roll UUID; v_affected INT; v_existing RECORD;
BEGIN
  IF p_price < 0 THEN
    RAISE EXCEPTION 'Price cannot be negative' USING ERRCODE = 'PT400';
  END IF;

  -- Idempotency: a retried request must not buy the item twice.
  IF p_client_roll_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.rolls
     WHERE client_roll_id = p_client_roll_id AND user_id = p_user_id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'roll_id', v_existing.id,
                                'item_name', v_existing.item_name);
    END IF;
  END IF;

  SELECT id, name, rarity, est_value, box_tier, image_url, is_active
    INTO r_item FROM public.items WHERE id = p_item_id;
  IF NOT FOUND OR NOT r_item.is_active THEN
    RAISE EXCEPTION 'No such item' USING ERRCODE = 'PT404';
  END IF;

  IF p_charge_balance THEN
    SELECT balance INTO v_bal FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
    IF v_bal < p_price THEN
      RAISE EXCEPTION 'Insufficient balance: have %, need %', v_bal, p_price
        USING ERRCODE = 'PT402';
    END IF;
    UPDATE public.profiles SET balance = balance - p_price WHERE id = p_user_id
      RETURNING balance INTO v_bal;
  ELSE
    SELECT balance INTO v_bal FROM public.profiles WHERE id = p_user_id;
  END IF;

  -- The whole point of this function.
  UPDATE public.items SET stock_qty = stock_qty - 1
   WHERE id = p_item_id AND stock_qty > 0;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    -- Rolls back the charge above with it; nothing to compensate by hand.
    RAISE EXCEPTION 'Somebody just took the last one' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                            status, box_price, client_roll_id, payload)
  VALUES (p_user_id, r_item.box_tier, 'physical', r_item.id, r_item.name, r_item.rarity,
          'inventory', p_price, p_client_roll_id,
          jsonb_build_object('clearance', true, 'mode', p_mode,
                             'payment_method', p_payment_method, 'price', p_price,
                             'reserved', p_payment_method = 'venmo_reserve'))
  RETURNING id INTO v_roll;

  RETURN jsonb_build_object(
    'ok', true, 'roll_id', v_roll, 'balance', v_bal,
    'item_id', r_item.id, 'item_name', r_item.name, 'rarity', r_item.rarity,
    'est_value', r_item.est_value, 'image_url', r_item.image_url,
    'box_tier', r_item.box_tier);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.clearance_claim(UUID,UUID,NUMERIC,BOOLEAN,TEXT,TEXT,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.clearance_claim(UUID,UUID,NUMERIC,BOOLEAN,TEXT,TEXT,UUID)
  TO service_role;
