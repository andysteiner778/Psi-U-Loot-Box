-- ---------------------------------------------------------------------------
--  0038 — SCRAP ALL
--
--  Scrapping a shelf one row at a time is a dozen round trips, each its own
--  transaction, and a failure halfway leaves the player unsure what actually
--  got recycled. This does the lot atomically: all of it lands, or none does.
--
--  WHY IT CALLS scrap_item RATHER THAN REIMPLEMENTING IT. The eligibility
--  rules -- owned by the caller, still in inventory, physical, rarity allowed
--  by allow_high_rarity_scrap, worth at least one coin -- already exist in
--  exactly one place. Copying the predicate here would create a second copy
--  free to drift from the first, which is how this codebase has produced bugs
--  before. The pre-filter below decides WHICH rolls to offer; scrap_item stays
--  the only thing that decides whether a roll may actually be scrapped, and
--  its RAISE aborts the whole batch rather than silently skipping a row.
--
--  The pre-filter is therefore an optimisation, not a rule. If it ever selects
--  something scrap_item refuses, the transaction fails loudly instead of
--  half-emptying somebody's inventory.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scrap_all(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg        JSONB;
  v_high_ok  BOOLEAN;
  r          RECORD;
  v_res      JSONB;
  v_count    INT := 0;
  v_coins    INT := 0;
  v_names    JSONB := '[]'::JSONB;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_high_ok := COALESCE((cfg->>'allow_high_rarity_scrap')::BOOLEAN, FALSE);

  -- Lock the player so two "scrap all" taps cannot both enumerate the same
  -- shelf. Without this the second pass finds rows the first has not yet
  -- marked and scrap_item raises PT409 on a roll that is already gone.
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404';
  END IF;

  FOR r IN
    SELECT ro.id, ro.item_name, i.scrap_value
      FROM public.rolls ro
      JOIN public.items i ON i.id = ro.item_id
     WHERE ro.user_id = p_user_id
       AND ro.status  = 'inventory'
       AND ro.kind    = 'physical'
       AND COALESCE(i.scrap_value, 0) >= 1
       AND (v_high_ok OR ro.item_rarity NOT IN ('purple','pink','gold'))
     ORDER BY i.scrap_value DESC, ro.rolled_at ASC
  LOOP
    v_res   := public.scrap_item(p_user_id, r.id);
    v_count := v_count + 1;
    v_coins := v_coins + (v_res->>'scrap_gained')::INT;
    v_names := v_names || jsonb_build_object('name', r.item_name,
                                             'coins', (v_res->>'scrap_gained')::INT);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'scrapped', v_count, 'scrap_gained', v_coins, 'items', v_names);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.scrap_all(UUID) FROM anon, authenticated;
