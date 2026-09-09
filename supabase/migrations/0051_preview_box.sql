-- ---------------------------------------------------------------------------
--  0051 — FREE TEST SPIN
--
--  "Let people see what they would have won if they bought the box."
--
--  The obvious implementation -- a second function that re-walks the same CDF
--  without writing -- would be a duplicate of open_box's draw logic, and this
--  codebase has repeatedly been bitten by two copies of one formula drifting
--  apart (the scrap coin existed in FOUR places; box_odds and open_box
--  disagreed about the shard curve for weeks). A preview that quietly stops
--  matching the real roll is worse than no preview at all.
--
--  So this calls THE REAL open_box inside a subtransaction and then throws the
--  subtransaction away. PL/pgSQL variables are ordinary memory and survive the
--  rollback; every table write inside the block does not. There is exactly one
--  copy of the draw.
--
--  What gets undone: the charge, the stock decrement, the roll row, the shard
--  mint, the voucher burn, any bundled rider, any credit paid.
--
--  The balance top-up is inside the block too, so a player with $0 can still
--  try the $30 box -- the point is to show them what is in it.
--
--  NOT EXPLOITABLE: the real roll draws its own fresh random(), so a preview
--  tells you nothing about what your next paid spin will be. It is a shop
--  window, not a look at the answer sheet.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_box(p_user_id UUID, p_box_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_result JSONB;
  v_price  NUMERIC;
BEGIN
  IF p_box_tier NOT IN ('tier_0','tier_1','tier_2','tier_3') THEN
    RAISE EXCEPTION 'Unknown box tier: %', p_box_tier USING ERRCODE = 'PT400';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404';
  END IF;

  -- A locked tier refuses real rolls, and must refuse previews for the same
  -- reason: there is nothing in it to show.
  IF (public.tier_lock_state(p_box_tier)->>'locked')::BOOLEAN THEN
    RAISE EXCEPTION 'This box is empty — everything worth winning in it has been claimed.'
      USING ERRCODE = 'PT423';
  END IF;

  v_price := (public.box_odds(p_box_tier, p_user_id)->>'box_price')::NUMERIC;

  BEGIN
    -- Fund it inside the subtransaction; this is rolled back with everything
    -- else, so it can never leave real credit behind.
    UPDATE public.profiles SET balance = balance + v_price WHERE id = p_user_id;

    v_result := public.open_box(p_user_id, p_box_tier);

    -- Unwind. The RAISE is the only way to discard a subtransaction from
    -- inside PL/pgSQL; PT499 is caught immediately below and nothing escapes.
    RAISE EXCEPTION 'PREVIEW_ROLLBACK' USING ERRCODE = 'PT499';
  EXCEPTION
    WHEN SQLSTATE 'PT499' THEN
      NULL;  -- expected: the block's writes are gone, v_result is not
  END;

  RETURN v_result || jsonb_build_object('preview', TRUE);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.preview_box(UUID, TEXT) FROM anon, authenticated;
