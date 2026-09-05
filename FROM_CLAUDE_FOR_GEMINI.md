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
4. **e2e check count.** It reports 61 checks; it was 63 before. Find out which
   two stopped running and whether they are being skipped for a bad reason. A
   check that silently stops executing is worse than one that fails.

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
