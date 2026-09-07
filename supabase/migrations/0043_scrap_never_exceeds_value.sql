-- ---------------------------------------------------------------------------
--  0043 — a scrap payout may not exceed what the item is worth
--
--  scrap_value carried a Math.max(1, ...) floor so that anything scrappable
--  was worth at least one coin. Once the owner started pricing giveaway junk
--  at $0.01 that floor inverted: a coin is $0.02, so a 1c item recycled for 2c
--  and the compactor became a (very slow) money printer. e2e caught it at 200%.
--
--  Clamp existing rows to what they are actually worth. Anything below one
--  coin becomes unscrappable, which the inventory already renders as "not worth
--  enough to scrap — take it home instead" — the right answer for something you
--  would rather a guest simply carried out of the house.
-- ---------------------------------------------------------------------------

UPDATE public.items i
   SET scrap_value = LEAST(
         i.scrap_value,
         FLOOR(i.est_value / ((c.value->'box_prices'->>(c.value->>'scrap_key_tier'))::NUMERIC
                              / (c.value->>'scrap_coins_per_key')::NUMERIC))::INT
       )
  FROM public.config c
 WHERE c.key = 'settings'
   AND i.scrap_value > 0;
