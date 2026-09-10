-- ============================================================================
--  0061  FOUR SERVER-ONLY FUNCTIONS WERE CALLABLE WITH THE PUBLIC KEY
-- ============================================================================
--
--  The anon key ships in every visitor's browser (the live ticker needs it), and
--  PostgREST exposes every public-schema function it may execute at
--  /rest/v1/rpc/<name>. These four were executable by it:
--
--    grant_welcome_vouchers(uuid)   mints the 3 welcome spins -- callable over
--                                   and over, from an existing account, for
--                                   unlimited free spins. The Players list would
--                                   look completely normal.
--    preview_box(uuid, text)        a free test spin for ANY account id; each one
--                                   runs a real open_box and rolls it back, which
--                                   still costs Disk IO. A spam vector on the
--                                   free tier's IO budget.
--    compact_scrap(uuid, boolean)   converts any player's coins to their own
--                                   credit. Pays nobody else, but not the
--                                   caller's business.
--    recover_ticker_items()         read-only roll history from the ticker log.
--
--  WHY THE OLD REVOKES DID NOT WORK. 0041 wrote
--      REVOKE EXECUTE ... FROM anon, authenticated;
--  but Postgres grants EXECUTE on every new function to PUBLIC by default, and
--  anon inherits from PUBLIC. The ACL read {=X/postgres,...} -- "everyone may
--  execute" -- so revoking the named roles changed nothing. compact_scrap also
--  carried an explicit anon grant from Supabase's default privileges. Revoking
--  FROM PUBLIC as well is what actually closes it; open_box and scrap_item
--  already do exactly this, which is why they were not affected.
--
--  Nothing in the app calls these with the anon key. Every caller is a server
--  route using the service-role client (import 'server-only'), which keeps its
--  grant below. Functions that call them internally (auth_login_or_register ->
--  grant_welcome_vouchers) are SECURITY DEFINER, so the inner call is checked
--  against the definer, not the visitor, and is unaffected.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.grant_welcome_vouchers(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.preview_box(uuid, text)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compact_scrap(uuid, boolean)        FROM PUBLIC, anon, authenticated;

GRANT  EXECUTE ON FUNCTION public.grant_welcome_vouchers(uuid)        TO service_role;
GRANT  EXECUTE ON FUNCTION public.preview_box(uuid, text)             TO service_role;
GRANT  EXECUTE ON FUNCTION public.compact_scrap(uuid, boolean)        TO service_role;

-- 0048 only creates this where Supabase's realtime.messages exists, so a bare
-- Postgres (the offline verify:sql harness) never has it. Same guard here.
DO $lock$
BEGIN
  IF to_regprocedure('public.recover_ticker_items()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.recover_ticker_items() FROM PUBLIC, anon, authenticated;
    GRANT  EXECUTE ON FUNCTION public.recover_ticker_items() TO service_role;
  END IF;
END
$lock$;
