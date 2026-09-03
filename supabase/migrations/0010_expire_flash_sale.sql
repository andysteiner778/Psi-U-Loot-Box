-- ============================================================================
--  HOUSE LOOT — 0010  SELF-EXPIRING FLASH SALE
-- ============================================================================
--  `box_odds` already ignored an expired sale when pricing a box, so players
--  were charged correctly. But the `flash_sale` flag itself stayed true forever,
--  and every surface that read the raw boolean -- the banner, the "20% OFF"
--  corner badges, the admin panel -- kept advertising a discount that was no
--  longer being given. Prices were right; the app was lying about them.
--
--  box_odds is STABLE and cannot write, so the flag is cleared here instead: a
--  tiny trigger-free housekeeping function, plus a call from open_box, which
--  runs constantly during a party. The flag therefore heals itself the first
--  time anyone opens a box after the window closes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.expire_flash_sale()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_changed INT;
BEGIN
  UPDATE public.config
     SET value = jsonb_set(value, '{flash_sale}', 'false')
   WHERE key = 'settings'
     AND COALESCE((value->>'flash_sale')::BOOLEAN, FALSE)
     AND NULLIF(value->>'flash_sale_ends_at', '') IS NOT NULL
     AND (value->>'flash_sale_ends_at')::TIMESTAMPTZ <= NOW();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed > 0;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.expire_flash_sale() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_flash_sale() TO service_role;

-- Clear the one that is already stale on this database.
SELECT public.expire_flash_sale();
