-- ============================================================================
--  HOUSE LOOT — SEED DATA
--  GENERATED FILE. Edit lib/catalog.ts and run `npm run seed:gen` instead.
-- ============================================================================

-- Idempotent: safe to re-run.
TRUNCATE public.drop_overrides, public.rolls, public.deposits CASCADE;
DELETE FROM public.items;

-- ---------------------------------------------------------------------------
--  Players. Everyone starts on PIN 1234 with must_change = TRUE, so the app
--  forces a change on first login. The first player is the admin.
-- ---------------------------------------------------------------------------
INSERT INTO public.profiles (name, role) VALUES ('Andy', 'admin')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Ben', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Caleb', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Dev', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Eli', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Finn', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Gabe', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Hank', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Ian', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Jack', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Kai', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Liam', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Mason', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Nate', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Owen', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Pat', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Quinn', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Reed', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Sam', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Theo', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Uri', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Vince', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Will', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Xavier', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Yusuf', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Zach', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Alex', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Blake', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Chris', 'player')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO public.profiles (name, role) VALUES ('Drew', 'player')
  ON CONFLICT (name) DO NOTHING;

-- Hash the default PIN for anyone who has no secret row yet.
INSERT INTO app_private.profile_secrets (profile_id, pin_hash, must_change)
SELECT p.id, extensions.crypt('1234', extensions.gen_salt('bf', 10)), TRUE
  FROM public.profiles p
 WHERE NOT EXISTS (SELECT 1 FROM app_private.profile_secrets s WHERE s.profile_id = p.id);

-- ---------------------------------------------------------------------------
--  The house. Rarity and tier are derived from value by lib/catalog.ts using
--  the spec's own bands, and purple/pink/gold carry scrap_value = 0 so the
--  database itself refuses to let them be recycled (anti-exploit rule 2).
-- ---------------------------------------------------------------------------
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Audioengine A5+ Speakers', 'Powered bookshelf speakers, excellent condition', 200, 'pink', 0, 1, 'tier_3');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('MCAT Prep Book Set', 'Full Kaplan set, lightly annotated', 120, 'purple', 0, 1, 'tier_3');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('144Hz Gaming Monitor', '27" 1080p 144Hz, no dead pixels', 100, 'purple', 0, 1, 'tier_2');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('1080p Monitor', '24" 60Hz secondary display', 70, 'blue', 700, 1, 'tier_2');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Standing Desk', 'Adjustable, minor scuffs on the legs', 50, 'blue', 500, 1, 'tier_2');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('MTG Bulk Collection', 'Several thousand commons plus a few rares', 40, 'blue', 400, 1, 'tier_2');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Hardshell Suitcase', 'Carry-on size, wheels intact', 30, 'blue', 300, 1, 'tier_1');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Drone Parts Lot', 'Props, spare motors, one intact frame', 8, 'grey', 80, 4, 'tier_1');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Desk Lamp', 'LED, adjustable arm', 8, 'grey', 80, 2, 'tier_1');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Mechanical Keyboard', 'Membrane switches, works fine', 12, 'grey', 120, 1, 'tier_1');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Cable Bundle', 'HDMI, USB-C, DisplayPort, assorted', 4, 'grey', 40, 8, 'tier_1');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Steam Game Key', 'Random unredeemed key from a bundle', 3, 'grey', 30, 10, 'tier_1');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('MTG Commons Box', 'Draft chaff by the pound', 4, 'grey', 40, 5, 'tier_1');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Kitchen Miscellany', 'Mugs, utensils, a decent pan', 6, 'grey', 60, 6, 'tier_1');
INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES
  ('Phone Charger', 'Assorted bricks and cables', 5, 'grey', 50, 6, 'tier_1');

-- ---------------------------------------------------------------------------
--  Catalog totals: 15 distinct items, 49 units, $818.00 of goods.
--    tier_3: 2 units worth $320.00
--    tier_2: 4 units worth $260.00
--    tier_1: 43 units worth $238.00
--
--  At a 20% house margin the pot needs roughly $1023 in deposits to clear all of it.
-- ---------------------------------------------------------------------------
