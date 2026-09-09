-- ---------------------------------------------------------------------------
--  0052 — 100 scrap = $10
--
--  Scrapping felt pointless: a coin was worth $0.01 and give-away junk is
--  priced at $0.01, so recycling a thing returned a single cent. The owner
--  asked for "9 scrap per $1 of retail, and 100 scrap gives $10".
--
--      a coin            $10 / 100        = $0.10
--      an item returns   retail x 9 coins = 90% of retail in dollars
--      capped at         50% of the price of the box it drops from
--
--  The cap is the whole safety story. Retail and est_value are decoupled here
--  ON PURPOSE -- a $0.01 item can carry a $40 retail -- so an uncapped retail
--  rate hands back more than the box that produced it cost, and the compactor
--  becomes a money printer. At 100% of the box price it is break-even and a
--  patient player farms it; at 50% it is a good deal on a lucky pull and never
--  free money.
--
--  scrap_value is stored in COINS, so every row must be recomputed against the
--  new denomination or the payouts silently change by 10x:
--      npm run rebase-scrap -- --basis=retail --fix
--  The audit's SCRAP RECOVERY gate fails loudly if they drift apart.
-- ---------------------------------------------------------------------------

UPDATE public.config SET value = value || jsonb_build_object(
  'scrap_key_usd',       10,
  'scrap_coins_per_key', 100
) WHERE key = 'settings';
