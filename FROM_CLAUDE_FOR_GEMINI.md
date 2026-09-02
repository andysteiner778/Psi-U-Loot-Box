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
