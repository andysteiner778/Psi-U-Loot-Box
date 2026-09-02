-- ============================================================================
--  HOUSE LOOT — 0001  SCHEMA
-- ============================================================================
--  Differences from SPEC.md section 3, and why:
--
--   * `profiles.pin` DOES NOT EXIST. The spec put a plaintext 4-digit credential
--     in the same row as the account balance. PINs live hashed in
--     app_private.profile_secrets, a schema PostgREST does not expose at all,
--     so no future policy mistake or added view can leak one.
--
--   * `rolls.kind` is new. The spec overloaded `status='scrapped'` to mean both
--     "player recycled this item" and "consolation coins", which makes the
--     inventory query and the ticker ambiguous.
--
--   * `rolls.box_price` / `rolls.payload` are new: the audit trail for the
--     inevitable "the app cheated me" conversation.
--
--   * `rolls.client_roll_id` is new and UNIQUE: idempotency. A double-tap on a
--     phone, or a retried fetch, must not charge twice.
--
--   * `items.est_value > 0` is a CHECK. A single $0.00 item from a bad vision
--     scan would divide-by-zero the odds engine and brick the whole tier.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
--  Private schema: never exposed through PostgREST
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
--  Profiles & balances
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  balance     NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  scrap_coins INT NOT NULL DEFAULT 0 CHECK (scrap_coins >= 0),
  pc_shards   INT NOT NULL DEFAULT 0 CHECK (pc_shards >= 0),
  role        TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_private.profile_secrets (
  profile_id      UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash        TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  must_change     BOOLEAN NOT NULL DEFAULT TRUE
);

-- Server-side sessions. Only the SHA-256 of the cookie is stored, so a database
-- read cannot be replayed as a login. Revocable, which a stateless JWT is not.
CREATE TABLE app_private.sessions (
  token_hash TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_profile_idx ON app_private.sessions (profile_id);
CREATE INDEX sessions_expiry_idx  ON app_private.sessions (expires_at);

-- ---------------------------------------------------------------------------
--  Items
-- ---------------------------------------------------------------------------
CREATE TABLE public.items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  image_url   TEXT,
  est_value   NUMERIC(10,2) NOT NULL CHECK (est_value > 0),
  rarity      TEXT NOT NULL CHECK (rarity IN ('grey','blue','purple','pink','gold')),
  scrap_value INT NOT NULL DEFAULT 0 CHECK (scrap_value >= 0),
  stock_qty   INT NOT NULL DEFAULT 1 CHECK (stock_qty >= 0),
  box_tier    TEXT NOT NULL CHECK (box_tier IN ('tier_1','tier_2','tier_3')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ANTI-EXPLOIT RULE 2, enforced by the database rather than by a React `if`.
  -- Purple/pink/gold cannot carry a scrap value, so they can only ever be
  -- claimed physically. This is what stops a lucky player recycling a $200
  -- speaker into enough spins to clear the rest of the house.
  CONSTRAINT high_tier_never_scrappable
    CHECK (rarity NOT IN ('purple','pink','gold') OR scrap_value = 0)
);

CREATE INDEX items_pool_idx ON public.items (box_tier, is_active, stock_qty)
  WHERE is_active AND stock_qty > 0;

-- ---------------------------------------------------------------------------
--  Rolls
-- ---------------------------------------------------------------------------
CREATE TABLE public.rolls (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  box_tier       TEXT NOT NULL CHECK (box_tier IN ('tier_1','tier_2','tier_3')),
  kind           TEXT NOT NULL CHECK (kind IN ('physical','shard','respin','scrap')),
  item_id        UUID REFERENCES public.items(id) ON DELETE SET NULL,
  item_name      TEXT NOT NULL,
  item_rarity    TEXT NOT NULL CHECK (item_rarity IN ('grey','blue','purple','pink','gold')),
  status         TEXT NOT NULL DEFAULT 'inventory'
                   CHECK (status IN ('inventory','scrapped','claimed','consumed')),
  box_price      NUMERIC(10,2) NOT NULL DEFAULT 0,
  payload        JSONB,
  client_roll_id UUID UNIQUE,
  rolled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX rolls_user_idx   ON public.rolls (user_id, rolled_at DESC);
CREATE INDEX rolls_recent_idx ON public.rolls (rolled_at DESC);

-- ---------------------------------------------------------------------------
--  Deposits
-- ---------------------------------------------------------------------------
CREATE TABLE public.deposits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  venmo_note  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX deposits_status_idx ON public.deposits (status, created_at DESC);

-- ---------------------------------------------------------------------------
--  Config
-- ---------------------------------------------------------------------------
CREATE TABLE public.config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Every tunable the economy reads. Nothing is hardcoded in the RPC, so all of
-- this is hot-editable mid-party from the admin dashboard.
INSERT INTO public.config (key, value) VALUES ('settings', jsonb_build_object(
  'house_margin',          0.05,
  'pot_revenue_threshold', 400.00,
  'box_prices',            jsonb_build_object('tier_1', 5, 'tier_2', 20, 'tier_3', 50),
  'shard_probs',           jsonb_build_object('tier_1', 0.0075, 'tier_2', 0.03, 'tier_3', 0.10),
  'pc_value',              400,
  'shards_required',       5,
  'pc_total_supply',       1,
  'pc_shards_minted',      0,
  'max_item_prob',         0.30,
  'ev_weight_factor',      0.20,
  'scrap_ev_frac',         0.05,
  'scrap_coins_per_key',   100,
  'scrap_key_tier',        'tier_2',
  'flash_sale',            false,
  'flash_sale_pct',        0.20,
  'flash_sale_ends_at',    NULL
));

-- Forced manual drop: admin queues an item for a specific player's next roll.
-- Server-side only, or it becomes the exploit it is meant to replace.
CREATE TABLE public.drop_overrides (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
