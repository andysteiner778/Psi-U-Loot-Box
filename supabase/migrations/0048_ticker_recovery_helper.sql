-- ---------------------------------------------------------------------------
--  0048 — read the ticker log from the app's own client
--
--  `realtime.messages` is outside the `public` schema, so PostgREST cannot see
--  it and a recovery script using the normal client cannot read it. This
--  exposes exactly one query over it: the most recent broadcast per item name,
--  which is what a catalogue rebuild needs after the items table was lost.
--
--  Read-only, service-role only. It is a recovery tool, not part of the game.
--
--  CREATED CONDITIONALLY. `realtime` is a Supabase-managed schema and does not
--  exist in the offline PGlite harness that verify:sql builds from these
--  migrations, so an unguarded CREATE FUNCTION referencing it fails there --
--  and a migration that cannot be applied to a fresh database is one that bites
--  whoever next rebuilds one.
-- ---------------------------------------------------------------------------

DO $mig$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'realtime.messages absent - skipping recover_ticker_items()';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.recover_ticker_items()
    RETURNS TABLE(name TEXT, tier TEXT, rarity TEXT, kind TEXT, last_seen TIMESTAMPTZ)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, realtime, pg_temp
    AS $body$
      SELECT DISTINCT ON (m.payload->>'item')
             m.payload->>'item',
             m.payload->>'tier',
             m.payload->>'rarity',
             m.payload->>'kind',
             m.inserted_at AT TIME ZONE 'UTC'
        FROM realtime.messages m
       WHERE m.payload ? 'item'
       ORDER BY m.payload->>'item', m.inserted_at DESC;
    $body$;
  $fn$;

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.recover_ticker_items() FROM anon, authenticated';
END
$mig$;
