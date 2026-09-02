-- ============================================================================
--  HOUSE LOOT — 0003  LOCKDOWN + REALTIME
-- ============================================================================
--  Login is name + 4-digit PIN, not Supabase Auth, so auth.uid() does not
--  exist and RLS has nothing to key on. The boundary is therefore the server,
--  not the database: every privileged read and write goes through a Next.js
--  route handler holding the service_role key, and the browser's anon key is
--  granted essentially nothing.
--
--  RLS-with-no-policies already denies. But REVOKE is what removes the table
--  from PostgREST's OpenAPI document, so an attacker cannot even enumerate the
--  schema. Do both.
-- ============================================================================

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rolls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drop_overrides  ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_private.profile_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.sessions        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- SECURITY DEFINER functions are world-executable by default, which would make
-- every table policy above irrelevant. open_box in particular takes identity as
-- a parameter, so an unrevoked EXECUTE is a total compromise regardless of RLS.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Must run BEFORE any future function is created, or the next RPC someone adds
-- ships world-executable again.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.open_box(UUID, TEXT, UUID)        TO service_role;
GRANT EXECUTE ON FUNCTION public.box_odds(TEXT)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.scrap_item(UUID, UUID)            TO service_role;
GRANT EXECUTE ON FUNCTION public.compact_scrap(UUID)               TO service_role;
GRANT EXECUTE ON FUNCTION public.salvage_shards(UUID, INT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pc(UUID)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_deposit(UUID, UUID)       TO service_role;
GRANT EXECUTE ON FUNCTION app_private.verify_pin(TEXT, TEXT)       TO service_role;
GRANT EXECUTE ON FUNCTION app_private.set_pin(UUID, TEXT)          TO service_role;

-- ---------------------------------------------------------------------------
--  Live ticker, without publishing a single table.
--
--  postgres_changes would evaluate RLS as the anon role, forcing a SELECT
--  policy on `rolls`. Broadcast-from-database sidesteps that entirely: a
--  trigger composes the exact payload and pushes it to a public topic, so the
--  wire format is whatever we chose to put in jsonb_build_object and no table
--  is readable by the browser at all.
--
--  It also means the payload already carries the player's display name, so the
--  client never needs a public view of `profiles` to resolve user_id -> name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.broadcast_roll()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_name TEXT; v_shards INT;
BEGIN
  SELECT name, pc_shards INTO v_name, v_shards FROM public.profiles WHERE id = NEW.user_id;

  PERFORM realtime.send(
    jsonb_build_object(
      'player', v_name,
      'item',   NEW.item_name,
      'rarity', NEW.item_rarity,
      'kind',   NEW.kind,
      'tier',   NEW.box_tier,
      'at',     NEW.rolled_at,
      'shards', CASE WHEN NEW.kind = 'shard' THEN v_shards ELSE NULL END
    ),
    'roll',          -- event
    'house_ticker',  -- topic
    false            -- public
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A ticker failure must never roll back somebody's win.
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_broadcast_roll ON public.rolls;
CREATE TRIGGER trg_broadcast_roll
  AFTER INSERT ON public.rolls
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_roll();

-- Belt and braces: make sure neither table is publishing rows directly.
-- `deposits` in particular would put everyone's amounts and Venmo notes on a
-- socket that any visitor can subscribe to.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rolls') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.rolls;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'deposits') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.deposits;
  END IF;
END $$;
