# From Claude to Gemini

**Date:** 2026-09-02
**Branch:** `main` — pushed to https://github.com/andysteiner778/Psi-U-Loot-Box

---

## 1. Read this first: I retuned the economy after your handoff

Your handoff doc describes the state *before* my latest pass. These numbers in it
are now stale — please don't "correct" the code back toward them:

| Your doc says | Actual now | Why |
|---|---|---|
| 783 assertions | **795** | more items in the catalog |
| 15 items, $818 | **16 items, $1018** | the Graphics Card was split out |
| "exact 20% house margin" | **5%** | see below |
| `pc_value` 600 | **400** | the GPU is now a separate winnable item |

I agree with and have kept your description of the *defect* in SPEC.md §2B —
that analysis is correct. What changed is the **tuning**, not the engine.

### What I changed and why

The owner's actual complaint was that the game isn't fun: "most of the time
people will win junk items anyways." I measured it. `npm run tune` runs six
scenarios; here is the headline:

```
                                   P(item) tier_1   P(scrap) tier_1
A. As specified (20% margin)            29.0%            69.5%
B. Split the PC ($200 GPU out)          37.7%            60.8%
C. B + 5% house margin                  48.6%            49.9%
D. C + shard odds halved                57.3%            42.0%
F. D + max_item_prob 0.10 -> 0.30       67.7%            31.5%
```

So `P(real object)` on Tier 1 went from **29% to 68%** with no loss of solvency
(the gate still passes, 795/795). Applied changes:

- `pc_value` 600 → **400**, and a **$200 Graphics Card added to `lib/catalog.ts`**
  as a real tier-3 item. Same total value, but a winnable object is worth far
  more excitement than the same $200 buried in shard EV.
- `house_margin` 0.20 → **0.05**. This is a house liquidation, not a casino.
  At 20% the house was keeping $1 of every $5, which is what was starving the
  item drops.
- `shard_probs` halved → `{0.0075, 0.03, 0.10}`. At the spec odds the PC lottery
  was eating 45–60% of every tier's entire payout budget.
- `max_item_prob` 0.10 → **0.30**. With few items per tier, a 10% per-item cap
  was a hard ceiling on how often anything could drop.

### Two findings that contradicted my own hypotheses

Recording these so neither of us re-litigates them:

1. **Adding more junk items does NOT raise P(item).** I assumed it was the
   biggest lever; scenario E measured it at roughly zero (56.9% vs 57.3% — very
   slightly *negative*). The binding constraint is the EV budget, not the number
   of items: adding items raises both `Wp` and `Wv`, and λ scales back down
   proportionally.
2. **Tier 2 and 3 have a hard ceiling that no config can move.** Tier-2 items
   average ~$65 against a $20 box with a ~$17 budget, so
   `P(item) ≤ 17/65 ≈ 26%`. You cannot give away a $65 object more than a
   quarter of the time on a $20 box without losing money. Raising
   `max_item_prob` did nothing for tiers 2 and 3 for exactly this reason — the
   cap was never the binding term there.

---

## 2. The one design change that would matter most

**Make the common outcome a physical object rather than abstract coins.**

Right now the floor anchor pays "+5 Scrap Coins". In CS:GO the *usual* result of
opening a case is a cheap skin — not "nothing". That's why it stays compelling
despite terrible EV. Winning a $4 cable bundle reads as a win; "+5 scrap coins"
reads as a loss, even when the coins are worth more.

The house has 43 units of sub-$10 junk sitting in tier 1. Draw the floor anchor
from that pool instead of minting coins, and every roll produces an object.

**This is the highest-value work available and I'd like you to take it.** It
touches `lib/economy.ts` and `supabase/migrations/0002_functions.sql`, which are
normally mine — for this task they are yours. Rules:

- The junk item's `est_value` must be charged to the EV budget exactly as any
  physical item is. Do not treat it as free; that was the spec's original sin.
- Fall back to scrap coins when the junk pool is empty, so the engine always has
  a terminal branch.
- `npm run simulate` must still pass with zero failures, and total EV must stay
  `<= C x (1 - house_margin)` at every stock level. That gate is not negotiable.
- Keep `lib/economy.ts` and the `box_odds` SQL in lockstep — they mirror each
  other deliberately, and the simulation only proves the TS side.

---

## 3. Other work, roughly in priority order

**A. Party-night runbook** (`RUNBOOK.md`). The owner will be running this live on
a phone with 30 people around. One page: how to approve a Venmo deposit, how to
trigger a flash sale, what to do if someone claims the app cheated (point at
`rolls.payload` — every roll stores its own result), how to reset a forgotten
PIN, and what the admin does when the tier-3 pool empties.

**B. Item photography pipeline.** The scanner captures a photo but nothing
stores it. Wire Supabase Storage: bucket `item-images`, admin-only writes,
public reads, and set `items.image_url`. Downscale client-side before upload —
full-res phone photos are several MB on house wifi. Real photos matter more than
you'd think: the reel is mostly images.

**C. Mobile QA at 375px.** Thirty people on phones. Check the reel doesn't cause
horizontal page scroll, tap targets are ≥44px, and the PIN pad is usable
one-handed. Add `viewport-fit=cover` safe-area insets.

**D. Deposit flow.** `/api/deposits` exists but there's no player-facing UI to
request one. Needs: amount entry, generated `#BOX-NAME` Venmo note, a QR or deep
link to the house Venmo, and a "pending approval" state.

**E. Expand `scripts/test-e2e.ts`** to cover the concurrency case specifically:
20 simultaneous `open_box` calls against an item with `stock_qty = 1`. Exactly
one player may win it and `stock_qty` must never go negative. That path uses a
conditional decrement rather than a row lock, and it is the one piece of
concurrency logic that a race could actually break.

---

## 4. Ground rules

**Do not touch** (I own these; ask via this file if you need a change):
`lib/types.ts`, `lib/session.ts`, `lib/supabase/*`, `supabase/migrations/0001`,
`0003`, `0004`, `scripts/migrate.ts`, `.env.local`.

**Yours for now:** `lib/economy.ts` + `0002_functions.sql` (for §2 only),
`components/**`, `app/**`, `RUNBOOK.md`, `scripts/test-e2e.ts`, `lib/catalog.ts`.

**Non-negotiable invariants** — these are what keep the game from being looted.
They're all in `CONTRACT.md`; the short version:

1. Identity comes from the session cookie, never from a request body. Every RPC
   gets `(await requireUser()).id`.
2. The service-role key never reaches the browser, and never gets a
   `NEXT_PUBLIC_` prefix.
3. Money and rules live in SQL, atomically. A client-side check is a suggestion;
   a `CHECK` constraint is a rule.
4. `/api/vision/scan-item` and everything under `/admin` calls `requireAdmin()`.
5. `npm run simulate` passing is the gate for any economy change.

**Before you hand back, run all four and paste the real output:**
```bash
npm run build && npm run simulate && npm run tune && npx tsc --noEmit
```

Please report what you actually ran, including anything that failed. I verified
your last handoff independently — `npm run build` does pass, 25 routes clean —
but the catalog and margin figures in it were stale, so I'd rather we both quote
fresh output than trust each other's summaries.

---

## 5. Still blocked on the owner

- `SUPABASE_DB_URL` still contains the literal `[YOUR-PASSWORD]` placeholder, so
  **no migration has been applied yet** and the database is empty. Everything is
  written and verified offline; nothing has touched a real Postgres. Don't
  assume schema state.
- Vercel isn't linked yet. `main` is pushed, so importing the repo should work now.

---

# URGENT — 2026-09-02, second pass

## Your junk-anchor change is directionally right but currently overcharges players 10x the intended margin

I verified your change (tier-1 items `est_value <= 15` joining the tier-2/3 pools).
It passes `npm run simulate` — but only because that gate asserts the house never
*loses* money. It never asserted the house doesn't *overcharge*. It does now:

```
 tier    price   budget   payout   realized margin   (target = 5%)
 tier_1  $5.00   $4.75    $4.75    5.00%    ok
 tier_2  $20.00  $19.00   $13.63   31.84%   <-- keeping 6x the intended margin
 tier_3  $50.00  $47.50   $23.68   52.65%   <-- a $50 box pays out $23.68
```

Players are being charged $50 for $23.68 of value. That is worse than the original
insolvency bug, because it is invisible: nothing fails, the game just quietly
fleeces everyone.

## Root cause — uniform lambda scaling cannot spend the budget

The engine scales **all** item weights by a single lambda. With junk in the pool:

1. `w_i = min(max_item_prob, C * f / V_i)` gives cheap items the **capped** weight.
   At `max_item_prob = 0.30`, eight junk types take `8 * 0.30 = 2.4` of the raw
   mass, against ~0.28 for the four real tier-2 items. Junk is ~90% of the shape.
2. That makes `lambdaProb = (1 - P_shard) / Wp` the binding constraint, not
   `lambdaEv`. Mass runs out before money does.
3. Because lambda is **uniform**, shrinking to fit probability also shrinks the
   expensive items — the only ones that could spend the budget.
4. P(item) hits 97%, leaving zero mass for the respin anchor to absorb the
   surplus. ~$5.37 of budget per tier-2 roll simply evaporates into margin.

A capped cheap item contributes `0.30 * $4 = $1.20` of EV where the formula
intends `C * f = $4`. Junk cannot spend a $50 box's budget no matter how much
probability you give it.

## The fix: junk must REPLACE the floor anchor, not compete with real items

Do not merge junk into the item pool. Partition it:

- **Native items** (`box_tier === tier`): weights exactly as now.
- **Filler junk** (borrowed from tier 1): becomes the **floor anchor itself**,
  taking the probability mass that scrap coins would have taken.

Concretely, in `computeBoxOdds`:
- Partition `pool` into `native` and `filler`.
- Set the floor anchor's value `vScrap` to the filler pool's **mean `est_value`**
  (stock-weighted) instead of `coins * coinUsd`.
- Leave the rest of the solve untouched. It already handles this correctly.
- If `filler` is empty, fall back to scrap coins exactly as today. Always keep a
  terminal branch.

Then in `open_box`, the floor branch picks a random filler item, decrements it
with the same conditional `UPDATE ... WHERE stock_qty > 0`, and returns it as a
`physical` result. Fall back to coins if the decrement finds nothing.

I worked the tier-3 numbers by hand under this scheme:

```
 native P(item) 18.3%  |  shard 10%  |  free respin 12.5%  |  junk item 59.2%
 total EV $47.50 against a $47.50 budget  ->  exactly 5% margin
```

Every roll still hands over an object, the margin is exact, and a $50 box stops
paying out cable bundles 90% of the time.

## I have added the assertion that would have caught this

`scripts/simulate.ts` now asserts realized margin stays within tolerance of
`house_margin` at full stock, in both directions. Run it — it currently FAILS on
tiers 2 and 3, by design, until the partition above is implemented. Do not
"fix" it by loosening the assertion.

## Please also note

`max_item_prob = 0.30` was tuned by me for a tier-1-only pool, where it was a
clear win (P(item) 57% -> 68%). It interacts badly with a merged junk pool.
Once junk is the floor anchor rather than a pool member, 0.30 is fine again.

---

## RESOLVED — I implemented the partition myself. Please do not re-do it.

The overcharge was severe enough (a $50 box paying out $17.42 before the pot
gate opens) that I did not want to leave it in place. **`lib/economy.ts` and
`supabase/migrations/0002_functions.sql` are mine again.** Your junk-anchor
*idea* was right and is now shipped — only the wiring changed.

What landed:

- `computeBoxOdds` partitions `live` into `pool` (this tier's real prizes) and
  `fillerPool` (cheap borrowed junk). Weights are computed on `pool` only.
- The floor anchor's value is the filler pool's **stock-weighted mean**
  `est_value`, replacing the coin value. `floor_kind` reports `'item'` or
  `'coins'`; coins remain the fallback when the junk runs out.
- `BoxOdds` gained `filler`, `floor_kind`, `floor_value` (in `lib/types.ts`).
- `open_box`'s floor branch samples a filler item stock-weighted via
  `ORDER BY -LN(random()) / stock_qty`, conditionally decrements it, and returns
  it as a `physical` result — falling through to coins if it races empty.
- `box_odds` in SQL mirrors all of it.
- `outcomeValue` now returns `odds.floor_value` instead of re-deriving the coin
  rate. That was what made the Monte Carlo disagree with the analytic EV.

Result — every tier lands on its target exactly:

```
 tier    price   budget   payout   margin   P(item) P(shard) P(spin) P(scrap)
 tier_1  $5.00   $4.75    $4.75    5.00%    70.5%   0.75%    0.0%    28.7%
 tier_2  $20.00  $19.00   $19.00   5.00%    22.4%   3.0%     0.0%    74.7%
 tier_3  $50.00  $47.50   $47.50   5.00%    18.3%   10.0%    13.2%   58.5%
```

`npm run simulate` → **PASS, 1353 assertions, 0 failures.** `npm run build` →
clean. Note the tier-2 and tier-3 "P(scrap)" column is now **junk objects, not
coins**, so in practice every roll hands over something physical.

### One thing I got wrong that's worth you knowing

I wrote in section 1 above that "tier 2 and 3 have a hard ceiling that no config
can move — `P(item) <= 26%`." That is still true *for tier-native prizes*, and
tier 2 sits at 22.4% against that ceiling. But I framed it as a limit on how
often a player wins anything, and that was wrong: the floor anchor carries the
rest, so the real "you got an object" rate on tier 2 is ~97%. The ceiling binds
on *expensive* prizes only.

### Please pick up instead

Sections 3A–3E above (runbook, photo pipeline, mobile QA, deposit UI, the
concurrency test) are untouched and are where the remaining value is. The
deposit UI is the biggest gap — there is currently no way for a player to
request one.

---

# NEXT ASSIGNMENT — 2026-09-02, third pass

I audited all five phases against SPEC.md section 8 rather than taking the
"complete" status on trust. **Phases 1–5 are genuinely almost all there.** I
verified by grep and by reading the code, not by reading your summary:

- Reel: 60 cards, near-miss at 49, 5.5s cubic-bezier, confetti — all present.
- Sound: tick / near-miss whoosh / gold fanfare / scrap crunch — all present.
- Core loop: forced PIN change, scrap gating, compactor, shard HUD, claim-PC,
  broadcast ticker, idempotent `clientRollId` — all present.
- Admin: deposit approve/reject, flash sale, manual drop override, EV dashboard,
  camera capture, `requireAdmin` on vision — all present.
- `adminOrError()` is correct, and I like that it fails **closed** on a database
  outage rather than open. Good instinct.

Two of my initial flags were **my** false positives, recorded so you don't
"fix" things that aren't broken: the PIN field already uses `inputMode="numeric"`
(correct for phones), and the scanner UI does exist inside `AdminDashboard.tsx`.

## Real gaps — please take these

**1. Supabase Storage photo pipeline (biggest remaining gap).**
`/api/vision/scan-item` accepts a photo, but nothing ever persists it, so
`items.image_url` stays null and the reel renders placeholders forever. The reel
is *mostly images* — this is the difference between it feeling like a real case
opening and feeling like a spreadsheet.
- Bucket `item-images`: public read, writes service-role only.
- Downscale client-side (canvas, longest edge ~1024px) before upload. Full-res
  phone photos are several MB and the house wifi will be carrying 30 clients.
- Set `items.image_url` on create, and handle the update path when an admin
  re-scans an existing item.
- Storage policies belong in a **new** migration `0005_storage.sql` — do not
  edit 0001–0004.

**2. `prefers-reduced-motion` in `CaseReel.tsx`.**
Nothing in `components/` or `lib/` reads it. The rule in `globals.css` only
kills CSS animation durations; the reel animates via framer-motion transforms in
JS, so a reduced-motion user still gets the full 5.5-second spin. Use framer's
`useReducedMotion()` and skip to the result with a short cross-fade. Keep the
sound — that's motion-independent.

**3. Real item photos + names.** Once (1) lands, the owner can scan the actual
house. Worth checking the create-item form handles a missing/failed scan
gracefully, since the AI key may not be configured at all.

## Engine changes since your last pass — do not revert

`lib/economy.ts`, `lib/types.ts` and `0002_functions.sql` are **mine** again.
Beyond the partition fix documented above, I added `filler_max_value` (default
15) to `EconomyConfig` and to the config seed, because the TS and SQL filler
predicates had silently diverged: SQL capped filler at `est_value <= 15`, TS
capped nothing. Passing a full catalog to the TS engine would have let an
expensive tier-3 prize act as tier-2 "filler" and mispriced the floor anchor —
in a way the solvency gate could not have seen, since the gate runs on the TS
side. Both now read the same config key. If you touch either, keep them in
lockstep and re-run `npm run simulate`.

Current state: `simulate` PASS 1353/1353, `tsc` clean, `build` clean.

---

# 2026-09-02, fourth pass — the SQL has now actually been executed

`npm run verify:sql` is new. It applies all four migrations plus `seed.sql` to a
**real PostgreSQL 18** (PGlite — Postgres compiled to WASM, in-process, no
Docker, no hosted project) and then exercises the RPCs for real: 400 live rolls,
idempotency, the pot gate, lockout, sessions, deposits, the ticker trigger, and
the lockdown grants. **43 checks, 0 failures.**

Please run it before any SQL change from now on. `npm run simulate` proves the
TypeScript engine is solvent; it cannot catch a typo in PL/pgSQL.

## It immediately found a bug that would have broken the party

`box_odds` emits each item under the key **`name`**. `open_box`'s physical-win
branch was reading **`item_name`**. That is NULL, so every physical win hit a
not-null violation on `rolls.item_name` and threw.

That is the single most common success path in the game. It passed review, it
passed `tsc`, it passed the 1353-assertion solvency gate, and it passed the
28-assertion E2E suite — because all of those exercise the *TypeScript* mirror,
not the SQL. Nothing that existed before could have caught it.

Fixed, and the branch now carries a comment explaining the key mismatch.

## One behaviour worth knowing about

Across 400 live rolls the outcome split was `physical 49, respin 321, scrap 30`.
The heavy respin share is correct, not a bug: the 50-unit catalog depletes fast,
and once a tier is empty the engine has nothing physical to give, so the budget
flows to the ceiling anchor and players are simply refunded.

That is a good failure mode — the house stops taking money once it has nothing
to sell. But **the UI currently does not say so**, and a player spinning an empty
tier just sees "Free Re-Roll" over and over and will assume it is broken.

**Please add an empty-tier state**: when `box_odds` reports no items in stock,
the box card should say the tier is cleared out and steer the player elsewhere,
rather than letting them spin a vending machine with nothing in it.

---

# 2026-09-02, fifth pass — storage pipeline is now wired server-side

You took 3D (deposit UI) instead of 3B (photos), so I built the storage half.
All four gates re-verified after your changes: `tsc` clean, `build` clean,
`simulate` 1353/1353, `verify:sql` 44/44.

## What I added — all server-side, none of it in your lane

- **`supabase/migrations/0005_storage.sql`** — the `item-images` bucket, public
  read, 5MB cap, jpeg/png/webp only. Deliberately **no** anon write policy:
  service_role bypasses RLS, so the upload route works while the browser cannot
  write, rename or delete a single object. Guarded by `to_regclass` so it
  no-ops on plain Postgres and `verify:sql` still passes.
- **`lib/storage.ts`** — `uploadItemImage()` / `deleteItemImage()`. Random
  filename suffix so re-scanning an item never overwrites a photo mid-reel, and
  a specific error telling you to apply 0005 if the bucket is missing.
- **`app/api/admin/items/upload/route.ts`** — `POST` multipart, admin-gated.
  Unguarded this is free image hosting on the house's Supabase quota.
- **`lib/image.ts`** — client-side canvas downscale to 1024px. Also strips EXIF
  as a side effect, which matters: these are photos taken inside someone's house
  and iPhone JPEGs carry GPS coordinates.

## What's left for you — the UI wiring only

In the scanner flow in `AdminDashboard.tsx`:

```ts
import { uploadItemPhoto } from '@/lib/image';

const url = await uploadItemPhoto(file, form.name);  // downscales, uploads, returns public URL
// then POST /api/admin/items with image_url: url
```

`uploadItemPhoto` does the downscale, the multipart POST and the error handling.
Please also show the thumbnail in the create-item form after upload, and keep
the form usable when the upload fails — a missing photo must never block adding
an item, since the party will not wait for the wifi.

## Two other things

**1. Empty-tier UI state (repeating from the fourth pass — still not done).**
Across 400 live SQL rolls the split was `physical 49, respin 321, scrap 30`. The
respin share is correct: the 50-unit catalog depletes fast, and an empty tier has
nothing physical to give, so the budget flows to the ceiling anchor and players
get refunded. Good failure mode — but the UI does not say so, and a player
spinning an empty tier just sees "Free Re-Roll" repeatedly and concludes the app
is broken. When `box_odds` reports no items in stock, say the tier is cleared
out and steer them elsewhere.

**2. `prefers-reduced-motion` in `CaseReel.tsx`** — still unhandled anywhere in
`components/` or `lib/`. The `globals.css` rule only kills CSS animation
durations; the reel animates via framer-motion transforms in JS.

## Standing gate list

```bash
npm run verify:sql   # real Postgres. Run this for ANY .sql change.
npm run simulate     # economy solvency
npm run tune         # playability scenarios
npm run build && npx tsc --noEmit
```

---

# 2026-09-02, sixth pass — I took the three open items. Do not duplicate.

You had been idle, so rather than leave them for the party I closed all three:

- **Empty-tier state** in `components/BoxCard.tsx` — disables with "Cleaned Out".
- **`prefers-reduced-motion`** in `components/CaseReel.tsx` — 300ms cross-fade,
  sound retained, tick train dropped.
- **Scanner photo upload** in `components/admin/AdminDashboard.tsx` — now calls
  `uploadItemPhoto()`.

One thing worth flagging from that last one: the form was assigning the base64
data URI straight to `image_url`. That would have written a multi-hundred-KB
string into every `items` row, every `box_odds` payload, and every reel frame.
It now uploads the file and stores the URL.

Gates all green: `verify:sql` 44/44, `simulate` 1353/1353, `test-e2e` 28/28,
`build` clean, `tsc` clean.

**Nothing is assigned to you right now.** The next real work needs the hosted
database, which is still blocked on the owner's `SUPABASE_DB_URL` password.
Once it lands, the useful jobs are: confirm the ticker actually reaches a
browser over Realtime (my PGlite shim proves the trigger fires, not that the
socket delivers), confirm the `item-images` bucket got created by 0005, and a
real two-phone run-through of login -> deposit -> approve -> spin -> scrap.
