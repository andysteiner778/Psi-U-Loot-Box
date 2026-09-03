-- ============================================================================
--  HOUSE LOOT — 0011  RESET vs pg_safeupdate
-- ============================================================================
--  "DELETE requires a WHERE clause".
--
--  Supabase loads pg_safeupdate for the API roles, which refuses any DELETE or
--  UPDATE with no WHERE clause. That guard applies to statements INSIDE a
--  SECURITY DEFINER function too, so reset_party_state's four deliberately
--  unqualified statements were rejected the moment it was called through
--  PostgREST.
--
--  It never failed in `npm run verify:sql` because PGlite is a plain Postgres
--  with no safeupdate loaded — a genuine gap between the harness and production,
--  and worth remembering: the harness proves the SQL is CORRECT, not that
--  Supabase will permit it.
--
--  The fix is simply to say what we mean. `WHERE TRUE` satisfies the guard and
--  documents that clearing everything is intended rather than a forgotten
--  filter, which is exactly the mistake safeupdate exists to catch.
-- ============================================================================

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

  -- WHERE TRUE on every one of these: required by pg_safeupdate, and an honest
  -- statement that clearing the whole table is the intent.
  DELETE FROM public.drop_overrides WHERE TRUE;
  DELETE FROM public.rolls          WHERE TRUE;
  DELETE FROM public.deposits       WHERE TRUE;

  UPDATE public.profiles
     SET balance = 0, scrap_coins = 0, pc_shards = 0
   WHERE TRUE;

  UPDATE public.items
     SET stock_qty = COALESCE(initial_stock_qty, stock_qty), is_active = TRUE
   WHERE TRUE;

  UPDATE public.config
     SET value = jsonb_set(value, '{pc_shards_minted}', '0')
   WHERE key = 'settings';

  RETURN jsonb_build_object('ok', true, 'rolls_cleared', v_rolls,
                            'deposits_cleared', v_deposits, 'pot_cleared', v_pot);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.reset_party_state(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reset_party_state(UUID) TO service_role;
