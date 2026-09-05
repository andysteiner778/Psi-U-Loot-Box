-- ---------------------------------------------------------------------------
--  0035 — the shard prizes are not for sale
--
--  /api/clearance/catalog listed every active item with stock, filtering out
--  only the reward rows. The Gaming PC is an ordinary `items` row with
--  shard_cost = 4, so it appeared in BOTH clearance modes: buyable outright at
--  est_value, and eligible as one of the three items in a custom spin.
--
--  That undoes the entire shard track. The PC is meant to be assembled from
--  four shards whose last one drops at 1%; being able to simply buy it at the
--  end of the night -- or win it on a 33% custom spin -- makes every shard
--  anybody collected worthless, and hands over the most valuable object in the
--  house for a fraction of what the shard chase charges for it.
--
--  Enforced HERE rather than only in the route because both clearance modes now
--  go through clearance_claim, so one guard covers both and cannot be bypassed
--  by a hand-made API call. The route filter is still fixed alongside it, so
--  the item never appears in the UI to begin with.
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

  IF p_client_roll_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.rolls
     WHERE client_roll_id = p_client_roll_id AND user_id = p_user_id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'roll_id', v_existing.id,
                                'item_name', v_existing.item_name);
    END IF;
  END IF;

  SELECT id, name, rarity, est_value, box_tier, image_url, is_active, shard_cost
    INTO r_item FROM public.items WHERE id = p_item_id;
  IF NOT FOUND OR NOT r_item.is_active THEN
    RAISE EXCEPTION 'No such item' USING ERRCODE = 'PT404';
  END IF;

  -- Shard-locked prizes are claimed with shards, never sold.
  IF COALESCE(r_item.shard_cost, 0) > 0 THEN
    RAISE EXCEPTION '% is claimed with shards, not bought', r_item.name
      USING ERRCODE = 'PT403';
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

  UPDATE public.items SET stock_qty = stock_qty - 1
   WHERE id = p_item_id AND stock_qty > 0;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
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
