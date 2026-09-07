-- ---------------------------------------------------------------------------
--  0047 — pin the scrap denomination so a rebuilt database matches production
--
--  0023 set scrap_key_usd = 10 and scrap_coins_per_key = 500 (a coin worth
--  $0.02). Production was later retuned by hand through House Controls to
--  scrap_key_usd = 1, and 0044 halved the coin again by moving coins-per-key to
--  100 -- but 0044 only wrote coins-per-key, because it assumed the hand-edit.
--
--  So the two diverged: production ran a $0.01 coin while a database rebuilt
--  from migrations would come up with $10/100 = $0.10, ten times bigger. Every
--  scrap_value in the catalogue is stored in COINS, so the same catalogue would
--  have paid out ten times more on a fresh install -- and the offline SQL gate,
--  which builds exactly such a database, was proving properties of a game
--  nobody was playing.
--
--  Both numbers are written here, together, so the denomination is whatever
--  this file says and nothing has to be remembered.
-- ---------------------------------------------------------------------------

UPDATE public.config SET value = value || jsonb_build_object(
  'scrap_key_usd',       1,
  'scrap_coins_per_key', 100
) WHERE key = 'settings';
