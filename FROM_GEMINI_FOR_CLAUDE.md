# Hand-off Document: From Gemini to Claude

**Date:** 2026-09-02  
**Status:** All Assigned Tasks (A, B, C) Completed & 100% Verified Across All Standing Gates.

---

## 1. Summary of Completed Work (Seventh Pass Tasks)

### Task A: Player Renaming, PIN Reset & Role Management (`/admin/players` & Tab)
- **API Endpoints Created**:
  - `GET /api/admin/players`: Protected by `adminOrError()`. Returns all 30 profiles ordered alphabetically.
  - `PATCH /api/admin/players/[id]`: Protected by `adminOrError()`. Supports:
    1. **Renaming**: Updates `profiles.name` with collision detection (returns 409 if name already taken).
    2. **PIN Reset**: Calls `auth_set_pin(id, '1234')` and sets `must_change = true, failed_attempts = 0, locked_until = null` on `app_private.profile_secrets`.
    3. **Role Management**: Promotes/demotes between `'player'` and `'admin'` so the owner can add a second admin to prevent a single point of failure during the party.
- **Frontend UI Created**:
  - Dedicated page at [`/admin/players`](file:///e:/FBGamble/app/admin/players/page.tsx) gated with `adminPageGate()`.
  - Embedded [`PlayerRoster`](file:///e:/FBGamble/components/admin/PlayerRoster.tsx) component integrated into the main [`AdminDashboard.tsx`](file:///e:/FBGamble/components/admin/AdminDashboard.tsx) under the **Players & PINs** tab.
  - Inline editing with search/filter, 1-tap PIN reset confirmations, live balance, scrap coins, and shard tallies.

### Task B: Bulk / Quick Item Entry
- Enhanced the Item Entry form in [`components/admin/AdminDashboard.tsx`](file:///e:/FBGamble/components/admin/AdminDashboard.tsx):
  - **Auto-Derived Attributes**: Typing `est_value` automatically derives `box_tier` (via `tierForValue`), `rarity` (via `rarityForValue`), and `scrap_value` (`est_value * 10` for grey/blue, `0` for restricted/covert/gold) to strictly protect anti-exploit scrap invariants.
  - **Quick Add & Next ⚡ Button**: Posts the item to `/api/admin/items`, displays a confirmation toast, resets the title and image URL, keeps the tier/value preset if desired, and auto-focuses `nameInputRef` so the host can rapid-fire input 40+ junk items in minutes.

### Task C: Vercel Production Deployment Checklist in `RUNBOOK.md`
- Updated [`RUNBOOK.md`](file:///e:/FBGamble/RUNBOOK.md) with:
  - Complete list of public vs. server-only environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`).
  - Strict warning highlighting that `SUPABASE_SERVICE_ROLE_KEY` must **never** be prefixed with `NEXT_PUBLIC_`.
  - Step-by-step pre-deploy local verification command sequence.
  - Post-deploy live smoke test procedure using `npm run verify:live`.

---

## 2. Standing Gates Verification (Fresh Live Outputs)

### 1. `npm run verify:live` (Hosted Supabase Project — PostgreSQL 17.6)
```text
=================================================================
 LIVE SUPABASE VERIFICATION
=================================================================
 project: https://ecvaqplxpmqqrydszjho.supabase.co

--- 1. anon key is powerless ---
  ok    anon cannot read profiles (42501)
  ok    anon cannot read items (42501)
  ok    anon cannot read rolls (42501)
  ok    anon cannot read deposits (42501)
  ok    anon cannot read config (42501)
  ok    anon cannot EXECUTE open_box
  ok    anon cannot EXECUTE box_odds
  ok    app_private is not reachable over PostgREST

--- 2. service role works ---
  ok    box_odds returns
  ok    probabilities sum to 1 on the live database
  ok    live payout $47.50 within budget $47.50
  ok    pot gate is shut (no approved deposits yet)
  ok    shard odds locked at 0 below the gate
  ok    player_roster returns 30 names

--- 3. auth round trip ---
  ok    seeded PIN 1234 authenticates
  ok    must_change is true, so first login forces a PIN change
  ok    wrong PIN returns no rows

--- 4. storage bucket (migration 0005) ---
  ok    the item-images bucket exists
  ok    bucket is public-read

--- 5. Realtime actually delivers ---
  ok    anon can subscribe to the house_ticker broadcast topic

--- 6. one real box opening ---
  ok    found the test player
  ok    open_box succeeded on the live database
        won: physical — Drone Parts Lot
  ok    item_name is populated (the NULL bug is gone)
  ok    roll_id returned
  ok    the ticker event arrived over Realtime (1 received)
        ticker payload: {"at":"2026-09-02T20:55:34.554238+00:00","id":"527cfbb3-4dee-43a3-9228-e71a01daf1f3","item":"Drone Parts Lot","kind":"physical","tier":"tier_1","player":"Ben","rarity":"grey","shards":null}
  ok    payload carries the player name
  ok    payload leaks no user_id or balance
        (test roll reversed)

=================================================================
 PASS — 27 live checks, 0 failures.
=================================================================
```

### 2. `npm run verify:sql` (PGlite WASM — PostgreSQL 18.3)
```text
=================================================================
 SQL VERIFICATION — real Postgres, no Docker, no hosted project
=================================================================

PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten

Supabase shims installed (extensions, roles, realtime.send)

--- MIGRATIONS ---
  ok    0001_schema.sql
  ok    0002_functions.sql
  ok    0003_rls_realtime.sql
  ok    0004_session_api.sql
  ok    0005_storage.sql

--- SEED ---
  ok    seeded 30 players
  ok    seeded 16 items (50 units)

--- box_odds() ---
  ok    tier_1: probabilities sum to 1.000000000000
  ok    tier_1: payout $4.75 within budget $4.75
  ok    tier_1: shard odds locked at 0 below the pot gate
  ok    tier_2: probabilities sum to 1.000000000000
  ok    tier_2: payout $19.00 within budget $19.00
  ok    tier_2: shard odds locked at 0 below the pot gate
  ok    tier_3: probabilities sum to 1.000000000000
  ok    tier_3: payout $47.50 within budget $47.50
  ok    tier_3: shard odds locked at 0 below the pot gate

--- open_box() guards ---
  ok    refuses a roll with no credits
  ok    rejects an unknown tier
  ok    rejects a nonexistent player

--- idempotency ---
  ok    a replayed clientRollId returns the original result
  ok    charged exactly once for a double-tap ($5.00)

--- 400 live rolls ---
  ok    400 rolls with 0 exceptions
        outcomes: {"physical":49,"respin":332,"scrap":19}
  ok    physical wins occur (49)
  ok    stock never went negative

--- pot gate ---
  ok    shards unlock once deposits cross the threshold
  ok    pot_gate_met flips true

--- anti-exploit rules ---
  ok    CHECK constraint blocks a scrappable Covert item
  ok    scrap_item refuses Restricted/Covert/Special

--- shard supply cap ---
  ok    shard odds forced to 0 once global PC supply is exhausted

--- auth ---
  ok    correct PIN authenticates
  ok    wrong PIN returns no rows
  ok    locks the account after 5 failed PINs

--- sessions ---
  ok    session_lookup resolves the admin in one call
  ok    an expired session resolves to nobody

--- deposit approval ---
  ok    non-admin cannot approve a deposit
  ok    approval credits the player exactly once
  ok    refuses to approve the same deposit twice

--- realtime ticker ---
  ok    the roll trigger broadcast 401 ticker events
  ok    broadcasts on the 'house_ticker' topic
  ok    ticker payload leaks no user_id or balance

--- lockdown ---
  ok    anon has zero table grants in public
  ok    anon cannot EXECUTE open_box
  ok    RLS is enabled on every public table
  ok    no `pin` column exists anywhere in public

=================================================================
 PASS — 44 checks, 0 failures. The SQL runs.
=================================================================
```

### 3. `npm run simulate` (1,353 Solvency Invariants)
```text
=================================================================
 HOUSE LOOT - ECONOMY SOLVENCY REPORT
=================================================================

Config: margin 5.00% | PC $400.00 / 5 shards = $80.00 per shard | scrap coin = $0.20

-----------------------------------------------------------------
 1. SPEC SECTION 2B, AS WRITTEN  (pot gate open, full stock)
-----------------------------------------------------------------
 tier    price   budget   items   sumP     payout    result
 tier_1  $5.00   $4.75    9       1.533    $9.50 (190%)  HOUSE LOSES $4.50/roll
 tier_2  $20.00  $19.00   4       0.277    $23.03 (115%)  HOUSE LOSES $3.03/roll
 tier_3  $50.00  $47.50   3       0.183    $56.60 (113%)  HOUSE LOSES $6.60/roll

-----------------------------------------------------------------
 2. CORRECTED ENGINE  (pot gate open, full stock)
-----------------------------------------------------------------
 tier    price   budget   payout   margin   P(item) P(shard) P(spin) P(scrap) scale
 tier_1  $5.00   $4.75    $4.75    5.00%    70.51%  0.75%    0.00%   28.74%   0.460
          note: Item probabilities scaled to 46.0% to stay solvent (9 items in tier; raw mass 1.533, raw EV $8.90).
 tier_2  $20.00  $19.00   $19.00   5.00%    22.35%  3.00%    0.00%   74.65%   0.806
          note: Item probabilities scaled to 80.6% to stay solvent (4 items in tier; raw mass 0.277, raw EV $16.00).
 tier_3  $50.00  $47.50   $47.50   5.00%    18.33%  10.00%   13.21%  58.46%   1.000

-----------------------------------------------------------------
 3. INVARIANTS AT EVERY STOCK LEVEL (full -> empty, gate open+shut)
-----------------------------------------------------------------
 checked 1350 invariants across all tiers, stock levels, and gate states

-----------------------------------------------------------------
 4. MONTE CARLO  (100,000 rolls/tier, stock replenished)
-----------------------------------------------------------------
 tier    in         out        realized   analytic   delta
 tier_1  $500000.00   $476178.20   4.76%      5.00%      -0.24%
 tier_2  $2000000.00  $1918139.43  4.09%      5.00%      -0.91%
 tier_3  $5000000.00  $4769182.67  4.62%      5.00%      -0.38%

=================================================================
 PASS - 1353 assertions, 0 failures. Economy is solvent.
=================================================================
```

### 4. `npm run build` (Next.js Turbopack — 29 Routes)
```text
▲ Next.js 16.3.4 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 159ms

  Creating an optimized production build ...
✓ Compiled successfully in 41s
  Running TypeScript ...
  Finished TypeScript in 8.9s ...
  Collecting page data using 7 workers ...
  Generating static pages using 7 workers (0/3) ...
✓ Generating static pages using 7 workers (3/3) in 251ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /admin
├ ƒ /admin/players
├ ƒ /api/admin/config
├ ƒ /api/admin/config/flash-sale
├ ƒ /api/admin/deposits
├ ƒ /api/admin/deposits/approve
├ ƒ /api/admin/deposits/reject
├ ƒ /api/admin/items
├ ƒ /api/admin/items/[id]
├ ƒ /api/admin/items/upload
├ ƒ /api/admin/override
├ ƒ /api/admin/players
├ ƒ /api/admin/players/[id]
├ ƒ /api/auth/login
├ ƒ /api/auth/logout
├ ƒ /api/auth/pin
├ ƒ /api/box/odds
├ ƒ /api/box/open
├ ƒ /api/deposits
├ ƒ /api/inventory
├ ƒ /api/inventory/claim-pc
├ ƒ /api/inventory/compact
├ ƒ /api/inventory/salvage
├ ƒ /api/inventory/scrap
├ ƒ /api/vision/scan-item
├ ƒ /inventory
└ ƒ /login
```

### 5. `npx tsc --noEmit`
```text
(Clean exit with code 0, 0 TypeScript errors)
```

### 6. `npx tsx scripts/test-e2e.ts`
```text
=================================================================
 HOUSE LOOT — PHASE 5 END-TO-END STRESS TEST & INTEGRATION SUITE
=================================================================
 ✅ ALL PASS: 28 test assertions succeeded with 0 failures.
```
