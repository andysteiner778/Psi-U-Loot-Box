-- ---------------------------------------------------------------------------
--  0042 — the signup package is one spin on each of the bottom three boxes
--
--  0041 read "2 lowest tier, 1 3 tier" as two spins on tier_0 plus one on
--  tier_3. It meant the two lowest TIERS, one each, plus the third box --
--  Golden Chest, which is tier_2. So the package handed out a free High Roller
--  roll instead of a free Golden Chest one.
--
--  That was also the expensive reading: a tier_3 roll gives away $13.23 of
--  goods on average, so fifteen players started the night with ~$200 of stock
--  already spoken for. One each of OG Junk Box, Good Stuff and Golden Chest
--  costs about $6.60 a head and walks the player up the ladder, which is what
--  the package is for.
-- ---------------------------------------------------------------------------

UPDATE public.config SET value = value || jsonb_build_object(
  'welcome_vouchers', jsonb_build_object('tier_0', 1, 'tier_1', 1, 'tier_2', 1)
) WHERE key = 'settings';
