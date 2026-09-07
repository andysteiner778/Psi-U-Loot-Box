-- ---------------------------------------------------------------------------
--  0044 — CRUSH ALL SCRAP, A FINER COIN, AND NO "SCRAP ALL ITEMS"
--
--  1. scrap_all() GOES. It was built from a misread: the ask was a button that
--     crushes all your scrap COINS into credit, not one that recycles every
--     object on your shelf. The latter is a foot-gun -- one tap turns a night's
--     winnings into coins, and there is no undo -- so it should not exist at
--     all rather than sit behind a confirm.
--
--  2. compact_scrap takes p_all. It converted exactly one key's worth per call,
--     so a player holding 900 coins had to tap nine times. Same function, same
--     rate, one extra argument: keeping it here rather than adding a second
--     entry point means the cost and the credit cannot drift apart.
--
--  3. THE COIN GETS FINER. scrap_coins_per_key 50 -> 100, so a coin is worth
--     $0.01 instead of $0.02.
--
--     The owner priced everything they are happy to give away at $0.01, and a
--     $0.02 coin cannot represent that: one coin was already worth more than
--     the item, so 0043 correctly made those rows unscrappable -- which reads
--     as "some random items can't be scrapped". Halving the coin makes the
--     cheapest item in the catalogue exactly one coin, so everything is
--     scrappable again without any payout exceeding what the thing is worth.
--
--     This is denomination only, not generosity: scrap_value is stored in COINS,
--     so every existing row must double to keep paying the same dollars.
--     `npm run rebase-scrap -- --fix` does that from est_value, and the audit's
--     SCRAP RECOVERY gate fails loudly if the two ever drift.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.scrap_all(UUID);

UPDATE public.config SET value = value || jsonb_build_object(
  'scrap_coins_per_key', 100
) WHERE key = 'settings';

-- The single-argument version must GO, not merely be replaced. Adding an
-- overload with a defaulted second parameter makes compact_scrap(uuid)
-- ambiguous, and Postgres refuses to choose -- every existing caller breaks at
-- once. Same trap 0017 hit with box_odds.
DROP FUNCTION IF EXISTS public.compact_scrap(UUID);

CREATE OR REPLACE FUNCTION public.compact_scrap(p_user_id UUID, p_all BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg JSONB; v_rate INT; v_coins INT; v_per NUMERIC; v_keys INT; v_spent INT; v_credit NUMERIC;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_rate := (cfg->>'scrap_coins_per_key')::INT;
  v_per  := COALESCE(
              (cfg->>'scrap_key_usd')::NUMERIC,
              (cfg->'box_prices'->>(cfg->>'scrap_key_tier'))::NUMERIC
            );

  SELECT scrap_coins INTO v_coins FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such player' USING ERRCODE = 'PT404'; END IF;
  IF v_coins < v_rate THEN
    RAISE EXCEPTION 'Need % scrap coins, have %', v_rate, v_coins USING ERRCODE = 'PT402';
  END IF;

  -- Whole keys only, both ways. The remainder stays as coins rather than being
  -- rounded into credit the house never charged for.
  v_keys   := CASE WHEN p_all THEN v_coins / v_rate ELSE 1 END;
  v_spent  := v_keys * v_rate;
  v_credit := v_keys * v_per;

  UPDATE public.profiles
     SET scrap_coins = scrap_coins - v_spent, balance = balance + v_credit
   WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'spent', v_spent, 'credit', v_credit, 'keys', v_keys);
END;
$fn$;
