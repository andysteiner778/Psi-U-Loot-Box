-- ---------------------------------------------------------------------------
--  0056 — margins that every tier can actually meet
--
--  tier_3 at an 80% margin budgets $6.00 on a $30 box, and its floor anchor --
--  the cheap object it hands over when nothing else lands -- is worth $6.00 by
--  itself. The audit called it correctly: INSOLVENT CONFIG, the floor exceeds
--  the budget before a single prize drops. The EV solve responded by pushing
--  42% of tier_3 rolls onto the floor branch.
--
--  Flattening to 55% gives every tier a budget comfortably above its own floor:
--
--      tier_0  75% item   5% free roll   0% floor
--      tier_1  75% item   5% free roll   0% floor
--      tier_2  75% item   5% free roll   0% floor
--      tier_3  65% item   5% free roll   0% floor
--
--  These are margins in est_value terms, which is close to meaningless when the
--  goods are deliberately priced at a cent to be given away. Their only job is
--  to stop the solver inventing payouts the catalogue cannot fund. What a
--  player receives is unchanged: an item, three times out of four.
-- ---------------------------------------------------------------------------

UPDATE public.config SET value = value || jsonb_build_object(
  'house_margin', 0.55,
  'tier_margins', jsonb_build_object(
    'tier_0', 0.40, 'tier_1', 0.55, 'tier_2', 0.55, 'tier_3', 0.55
  )
) WHERE key = 'settings';
