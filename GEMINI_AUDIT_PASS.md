# Gemini — Adversarial Audit Pass

The app is **live on Vercel against the real database with the real catalog**
(60 items, ~$1,075 of goods). The owner is about to send the link to a house of
people who will put real money in.

Your job this pass is **not** to add features. It is to find what is wrong, and
to say so plainly even when the answer is "this is fine".

## Ground truth: run these first and read the output

```bash
npm run audit        # economy against the LIVE catalog
npm run e2e          # 45 live scenario checks, uses throwaway probe accounts
npm run simulate     # 1377 solvency assertions, offline
npm run verify:sql   # 55 checks against real Postgres via PGlite
npm run verify:live  # 29 checks against hosted Supabase
npm run build && npx tsc --noEmit
```

All of these pass right now. **If one fails after a change of yours, the change
is wrong.** Never loosen an assertion to make it green — every one of them was
written because a real bug got past everything else.

## The bugs found so far, so you know the shape of them

These are all fixed. They are listed because the same *kinds* of mistake are
probably still in there somewhere:

1. **A number the player sees was also a number the odds depended on.** Setting
   an item's price to "look better" made it drop 40% less often. Fixed by
   splitting `est_value` (drives odds) from `msrp` (display only). Same split
   exists for `pc_value` vs `pc_display_value`.
2. **Two engines describing different games.** `lib/economy.ts` and the SQL
   `box_odds` must stay identical. The solvency proof only runs on the
   TypeScript one, so a divergence is invisible to every test.
3. **Scrapping paid 2x an item's value** — a money printer, missed because every
   gate modelled the ROLL and not what a player does with the item afterwards.
4. **A currency too coarse to express its own rule.** $1 coins meant 60% of a
   $3 item floored to 33%, and $1 items got nothing. Coins are $0.10 now.
5. **Stale client state.** Odds were fetched once on page load, so a won item
   kept being offered and kept scrolling past on the reel.
6. **The admin panel silently deleting config keys** it did not model, which
   turned shard drops off entirely and surfaced as a completely unrelated
   symptom hours later.
7. **Fabricated content presented as real** — the ticker shipped invented wins by
   players who do not exist, and the near-miss card was literally labelled
   "BAIT".

## What to attack

### 1. Hunt for more of category 1 and 2
Grep for any place a displayed number and a computed number could be the same
field. Diff `lib/economy.ts` against `box_odds` in the newest migration line by
line — they were last synced at 0013/0015, and any drift is silent.

### 2. Money conservation over a long session
Write a scenario that runs a few hundred rolls through probe accounts and
asserts the books balance: money in equals money out plus house margin, no
balance goes negative, no stock goes negative, no roll is unaccounted for. The
existing e2e checks single actions; nothing yet checks that the ledger holds
over time.

### 3. The player journey on a real phone
The deployed URL on an actual device, not an emulator. Login, deposit request,
open all three tiers, scrap, compact, check the ticker. Audio needs a user
gesture to unlock on iOS — confirm the first tap does it. Rotate mid-spin.
Background the tab mid-spin and come back.

### 4. Two devices at once
Does A's win appear on B's ticker? Do both see stock decrease? This is the one
thing no automated test here covers.

### 5. Failure states
Airplane mode mid-spin. A dead Supabase. An expired session mid-action. A
double-tap on every button in the app, not just the box.

## Report

Write findings to `FROM_GEMINI_FOR_CLAUDE.md` as a ranked list:

```
SEVERITY | WHERE | WHAT HAPPENS | HOW TO REPRODUCE
```

Rank by **what it costs the owner**: money leaving the house incorrectly first,
then a player being cheated, then confusion, then polish. Include things you
chose not to fix and why.

**A short list of real problems beats a long list of speculative ones.** If you
genuinely cannot find anything in an area, say that — "I tried X, Y, Z on the
deposit flow and found nothing" is a useful result and I will trust it.

## Do not touch

`lib/economy.ts`, `lib/types.ts`, `lib/session.ts`, `lib/admin-lock.ts`,
`lib/supabase/*`, `supabase/migrations/*`, `scripts/*`. Report issues in those
rather than editing — the economy and the security boundary have one owner on
purpose, and a well-meant edit to either is how a silent divergence starts.

Anything in `components/**` and `app/**` is yours, provided all six commands
above still pass.
