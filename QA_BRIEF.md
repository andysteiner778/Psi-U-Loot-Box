# QA Brief — House Loot

Full-app test pass. The goal is to find things that are **broken or dishonest**,
not to add features. Report findings; fix only what is clearly in your lane.

## Setup

```bash
npm install
npm run dev            # http://localhost:3000
```

The hosted Supabase database is already migrated and seeded (30 players, 16
items). `.env.local` is populated. Do **not** re-run `npm run db:migrate -- --seed`:
the seed truncates `rolls` and `deposits` and would wipe live test data.

**Test accounts:** every player is seeded with PIN `1234` and is forced to
choose a new one on first login. `Andy` is the admin. The admin panel has a
*second* lock — the `ADMIN_PIN` from `.env.local` (default `4242`).

If you lock an account out (5 wrong PINs = 15 minutes):

```bash
npm run pin -- status
npm run pin -- reset <Name>
```

## Gates — all four must pass when you finish

```bash
npm run verify:sql    # real Postgres via PGlite. Required for ANY .sql change.
npm run simulate      # economy solvency
npm run verify:live   # hosted Supabase
npm run build && npx tsc --noEmit
```

## Where things live

| Area | Files |
|---|---|
| Economy engine | `lib/economy.ts`, mirrored in `supabase/migrations/0002_functions.sql` |
| Frozen types | `lib/types.ts` |
| Auth / sessions | `lib/session.ts`, `app/api/auth/**`, `app/login/**` |
| Admin lock | `lib/admin-lock.ts`, `app/admin/_lib/guard.ts` |
| Reel + audio | `components/CaseReel.tsx`, `lib/reel.ts`, `lib/sound.ts` |
| Player app | `app/(player)/**`, `components/BoxCard.tsx`, `Ticker.tsx`, `ShardHud.tsx` |
| Admin | `app/admin/**`, `components/admin/**` |
| Contracts | `CONTRACT.md` (ownership + API), `RUNBOOK.md` (party night) |

## What to test

### 1. Auth
- Log in as a fresh player with `1234`; confirm the forced PIN change appears
  and refuses to accept `1234` again.
- Wrong PIN 5 times → locked for 15 minutes with a clear message (not a crash).
- After logging out, `/inventory` and `/admin` must not be reachable.
- **Critical:** confirm no API route accepts a `user_id` from the request body.
  Every one should take identity from the session cookie. Try tampering.

### 2. Admin lock
- `/admin` should show the PIN screen even when signed in as Andy.
- Wrong PIN → rejected, no hint about length or correctness.
- Correct PIN → unlocks; confirm it re-locks after 30 minutes.
- **Try to bypass it from devtools.** It must be impossible — the check is
  server-side. If you find any way around it, that is the highest-priority bug
  in the app.

### 3. Box opening
- Open all three tiers. Confirm the balance decrements exactly once.
- **Double-tap the open button fast.** It must charge once (idempotency via
  `clientRollId`). This is the most likely real-world bug at a party.
- Open with insufficient balance → clean "not enough credits", never a stack trace.
- Confirm the reel lands on the item the server actually returned.
- Spin ~15 times and check the near-miss appears on roughly half of spins, not
  every spin, and is not visually or textually marked as fake.
- Confirm the whoosh only plays on spins that actually have a near-miss card.

### 4. Inventory and anti-exploit rules
- Grey/Blue items show a Scrap button; **Purple/Pink/Gold must not.**
- Try to scrap a high-rarity item via the API directly — the server must refuse
  with 403. The DB has a CHECK constraint as a second line.
- Scrap Compactor at 100 coins.
- Shard HUD shows X/5 and the claim button only appears at 5/5.

### 5. Admin flows
- Deposit request → appears in the queue → approve → player's balance rises by
  exactly that amount → approving the same one twice is refused.
- Flash sale: prices drop, countdown runs, and prices restore when it expires.
  Verify expiry is enforced **server-side** (change the client clock; it must
  not matter).
- Manual drop override forces the next roll for that player, once.
- Player roster: rename, PIN reset, promote a co-admin.
- AI scanner: with and without an API key set. Without one it must degrade to
  manual entry, not crash.

### 6. Mobile — 30 people will be on phones
- Test at 375px wide. No horizontal page scroll anywhere.
- Tap targets ≥44px. The PIN pad must be usable one-handed.
- The reel must not overflow the viewport.
- Enable "reduce motion" in the OS and confirm the reel cross-fades instead of
  spinning for 5.5 seconds.

### 7. Honesty checks — treat these as bugs
Several have already been found and fixed; look for more of the same kind.
- The ticker must show only **real** rolls. It previously shipped fabricated
  wins with fake player names.
- The near-miss card must not be labelled or styled as fake.
- Displayed odds must match what `box_odds` actually returns.
- An empty tier must say so rather than silently refunding forever.

## Ground rules

**Do not edit:** `lib/economy.ts`, `lib/types.ts`, `lib/session.ts`,
`lib/admin-lock.ts`, `lib/storage.ts`, `lib/supabase/*`,
`supabase/migrations/*`, `scripts/*`. Report problems in those instead.

**Never weaken a check to make a test pass.** If `verify:sql` or `simulate`
fails, the code is wrong, not the gate.

**Report honestly.** Paste real command output. If something is broken and you
could not fix it, say so plainly — a known bug is far more useful than a
green summary that is wrong.
