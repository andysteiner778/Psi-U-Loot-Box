# Gemini — Voucher UI staleness, and a verification pass

Two jobs. The first is a real user-facing bug; the second is verification.

## Context: what I just changed (do not redo any of it)

- `fetchOdds` now passes `p_user_id`, so published shard odds match what that
  player actually faces (30/20/10/1% by shards held, not a flat 35%).
- `lib/reel.ts` sprinkles Legendary+ into the reel filler (`BAIT_IN_FILLER_RATE`).
- Migration 0035: `clearance_claim` refuses shard-locked items, so the Gaming PC
  cannot be bought or won in a custom spin.
- Venmo -> `@andaysmonay`, note `loot box - <name>`.
- Tier names -> Mostly Junk, Some Goodies / Good Stuff / Golden Chest / High Roller.
- `PrizeShowcase` quotes `msrp` rather than `est_value`.

## JOB 1 — the voucher badge is stale (this is the bug the owner reported)

The owner reports: *"free picked spin is forever applied, and the 100 off
voucher is permanent giving unlimited spins; the first free spin disappears at
the top of the page but is still in the menu."*

**The server is CORRECT — I verified it.** A 100%-off voucher makes spin 1 cost
$0.00 and spin 2 cost the full $3.00. `open_box` burns the voucher
(`redeemed_at`) immediately after the charge succeeds. There is no money leak.

So this is a CLIENT CACHE problem, and it appears in two places that disagree:

1. The voucher badge / discounted price on the box card does not clear after the
   spin that spent it.
2. The count at the top of the page and the count in the menu are read from
   different places and drift apart.

Find where vouchers reach the client (`fetchVouchers` in
`app/(player)/_lib/queries.ts`, the boxes page, `components/BoxCard.tsx`, and
the player store) and make there be ONE source of truth that refreshes after
every roll. `BoxCard` already calls `router.refresh()` when a spin ends — check
whether the voucher counts are on a path that refresh actually updates, or
whether they are frozen in a `useMemo` / server prop that never re-reads.

**Acceptance test, and I want the output pasted:** give a player one 100%-off
voucher for a tier. Spin that tier. The badge must be gone from BOTH the box
card and the menu without a manual page reload, and the next spin must show and
charge full price. Then do it with two vouchers and confirm the count goes 2 ->
1 -> 0.

Do NOT "fix" this by changing what the server charges. The server is right.

## JOB 2 — verification

Re-run all of these and read the output:

```bash
npm run audit && npm run reconcile && npm run e2e && npm run simulate
npm run verify:sql && npm run verify:live && npm run build && npx tsc --noEmit
```

All pass right now (94 SQL, 29 live, 61 e2e, 2106 solvency). **If one fails
after a change of yours, the change is wrong.** Never loosen an assertion —
point it at the right source of truth and say why in a comment.

Then check these specifically:

1. **Odds honesty.** With a player holding 0, 1, 2, 3 shards, does every surface
   (box card, odds modal, loot page) show the shard % that player actually
   faces? Any surface still showing a flat 35% is a bug I missed.
2. **The reel.** Do all four boxes now visibly show their Legendary/Mythic/
   Exotic items while spinning? Does the near-miss still feel distinct, or does
   it get lost now that high rarities appear in the filler? This is a judgement
   call — say what you actually see.
3. **Clearance.** With Clearance Mode ON, confirm the Gaming PC appears in
   neither the buyout list nor the custom-box picker. Then try to buy it with a
   hand-made API call and paste what comes back.
4. **e2e check count — read this before you panic about it.**
   `npm run e2e` prints one `ok`/`FAIL` line per assertion and ends with
   `PASS — N checks, 0 failures`. **N should be 63.** I saw 61 once and wrongly
   flagged it as two checks silently disappearing; it was self-inflicted. I had
   probe scripts mutating balances and deleting vouchers in the same database
   while the suite was running, so a section bailed early. Three consecutive
   clean runs all report 63.

   The rule this gives you: **run the suite with nothing else touching the
   database.** Never run e2e concurrently with your own probes, and never run
   two copies at once. If you see a number other than 63, first ask what else
   was writing at the time, then look for a section that bailed — the run is
   not deterministic in content (racer names and won item names vary), only in
   count.

   If N is genuinely not 63 on a quiet database, that IS worth chasing: a check
   that stops executing protects nothing, and is worse than one that fails.


## JOB 3 — make the ladder visible (this replaces an idea we rejected)

The owner wants players to climb: win on a cheap box, end up wanting the dear
one. The obvious version -- bundling "50% off the next tier up" onto junk items
-- was modelled and REJECTED, and you should not re-add it. Numbers, so nobody
re-litigates it: applying it to items under $0.25 drops the $0.50 box's item
rate from 63% to 29% and units-out-the-door per $20 from 83 to 49, because a
50%-off-$3 voucher is worth three times the entire $0.50 box and can only be
paid for out of the prize budget.

The ladder already exists as real catalogue items -- `50% OFF a $3 box`,
`50% OFF a $10 box`, `50% OFF a $30 box`, `FREE $3 SPIN`, `FREE $10 SPIN`,
`FREE $30 SPIN`. The problem is purely that winning one is not exciting or
obvious enough. **This is a presentation job, not an economy job.**

What to do:

1. When a player wins a cross-tier voucher, the reveal should sell the
   destination, not the discount: name the box it unlocks, show what is in it
   (the best item still in that tier), and offer a button that takes them
   straight there with the voucher applied. Right now it renders as one line of
   mono text.
2. A held voucher should be visible on the target box card as a call to action
   -- "You have 50% off this box" with the struck-through price -- not just a
   small badge.
3. The `+$0.10 credit` consolation on the $0.50 box reads as nothing. We are
   NOT raising it (that trade costs 11% of the item rate). Make the reveal
   honest and warm instead of apologetic -- it is 20% of the box price back.

Do not change what anything is worth, what the server charges, or any drop rate.
Copy, layout and navigation only.

## What NOT to change (settled, with reasons)

- **Do not bundle higher-tier vouchers onto junk.** Measured above.
- **Do not raise `scrap_ev_frac`.** 0.20 -> 0.50 makes the $0.50 box pay $0.26
  instead of $0.10, but it fires more often (47% vs 37%) and costs 11 points of
  item rate. It buys a nicer-looking consolation with the stock the party exists
  to clear.
- **Do not change what the server charges for a voucher.** Verified correct.
- The shard curve (30/20/10/1) and `pc_value` are deliberate. The PC is meant to
  be nearly unwinnable and must not be charged to the other boxes.

## Report

Write findings to `FROM_GEMINI_FOR_CLAUDE.md`, ranked by cost to the owner.

```
SEVERITY | WHERE | WHAT HAPPENS | HOW TO REPRODUCE | STATUS
```

**Verify the claim, not the intent** — "it refreshes now" must mean you watched
it refresh, with the output pasted.

**Clean up by ID, not by timestamp.** Snapshot roll and voucher ids before your
probes and delete exactly those; restore stock for anything you won. A timestamp
filter destroyed three real rolls in this project last week. Finish with
`npm run reconcile`.

## Do not touch

`lib/economy.ts`, `lib/types.ts`, `lib/session.ts`, `lib/admin-lock.ts`,
`lib/supabase/*`, `supabase/migrations/*`, `scripts/*`, `lib/sound.ts`,
`lib/reel.ts`. Report problems in those rather than editing.

`components/**` and `app/**` are yours, provided all eight commands above still
pass and you have not changed what the odds mean or what the server charges.
