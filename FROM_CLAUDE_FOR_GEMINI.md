# Gemini — Final Pre-Party Verification

The app goes live to a house of real people putting real money in, within days.
This pass is **not** for features or polish. Find what is still wrong, and say
plainly when something is fine. A short list of real problems beats a long list
of speculative ones — "I tried X, Y and Z and found nothing" is a useful result
I will trust. Padding is worse than silence.

## Ground truth: run these first, read the output, do not skip

```bash
npm run audit        # live economy, scrap recovery, unit conservation
npm run reconcile    # stock vs held items (--fix to correct)
npm run e2e          # 63 live scenario checks
npm run simulate     # 2106 solvency assertions, offline
npm run verify:sql   # 92 checks against real Postgres via PGlite
npm run verify:live  # 29 checks against hosted Supabase
npm run build && npx tsc --noEmit
```

All pass right now. **If one fails after a change of yours, the change is
wrong.** Never loosen an assertion to make it green — every one exists because
a real bug got past everything else. If an assertion is genuinely stale, point
it at the right source of truth and say why in a comment; do not delete it.

## What just changed (migrations 0031–0033)

1. **`filler_min_frac`** — a floor under the consolation prize, as a fraction of
   box price, so a $10 box cannot pay out a $0.10 Stack of Paper.
2. **`claim_pc` pot gate** — currently threshold 0, so inert, but the code path
   is live.
3. **Bundled vouchers** — `items.bonus_voucher_tier` / `bonus_voucher_pct`. An
   item can hand you a free spin alongside the object. The bonus is priced into
   BOTH the weight formula and the EV budget in `box_odds` AND mirrored in
   `lib/economy.ts`.
4. **Negative margins** — `tier_margins` is `{tier_0: -0.25, tier_1: -0.10}`.
   The cheap boxes lose money ON PURPOSE to clear junk. tier_2/tier_3 stay
   house-positive.
5. **Shard curve `[0.8571, 0.5714, 0.2857, 0.0286]`** against the tier_3 base
   of 35% — so 30% / 20% / 10% / 1% per successive shard. `pc_value` is 40, so
   a shard is charged exactly the $10 it salvages for.

## Attack these, in this order

### 1. The bundle is the newest and least-exercised code
`open_box` issues a bundled voucher at TWO sites: the main prize award and the
floor-anchor (consolation) award. Verify by experiment, not by reading:

- Win 200+ bundled items across all four tiers. Does every reveal that
  ANNOUNCES a bundle (`bonus_tier`/`bonus_pct` in the payload) produce exactly
  one real row in `vouchers`? Any announced-but-not-created, or created-but-not-
  announced, is money or trust leaking.
- Is the voucher the RIGHT tier and percentage for that item?
- Does a bundled voucher then actually discount the next box of that tier, and
  is it single-use?
- **Concurrency:** two simultaneous wins of the last unit of a bundled item.
  Exactly one voucher, or two?
- `items_bonus_pair_ck` should make a half-configured bundle impossible. Try to
  violate it with a direct INSERT/UPDATE and paste what Postgres says.

### 2. Do the two engines still agree?
`scripts/verify-sql.ts` compares `box_odds` (SQL) against `lib/economy.ts` (TS)
on the same config. Bundles were added to both. Add catalogue rows with bundles
at awkward values ($0, huge, a bundle on the dearest item, a bundle pointing at
its own tier vs another) and confirm the two engines still produce identical
odds. **A divergence here means the solvency proof describes a different game
than the one people are playing.** This has happened twice in this project.

### 3. Negative margins — the exploit hunt
The cheap tiers deliberately pay out more than they take. The danger is a
player who never has to deposit again.

- Measure SPENDABLE return per box: credit + free spins + vouchers + respins, as
  a fraction of box price. It must stay meaningfully under 100%. I measure ~72%
  on tier_0 and ~48% on tier_1. Confirm or refute.
- Then try to break it empirically: simulate a player who always takes the
  cheapest box, banks every voucher and free spin, and never deposits again
  after the first $5. Do they run out? How many spins, and how much value do
  they extract? **Specifically: how much value in items worth over $20 can they
  extract from the $0.50 box via cross-tier drops?** That is the real leak — a
  cheap box can drop expensive things.
- Can vouchers/free spins be combined to make a box free AND still pay out?

### 4. The shard track must be honest
`box_odds` computes `p_shard` PER PLAYER from how many shards they hold. A
player at 3 shards should see ~1%, not the 30% a fresh player sees.

- Confirm the published odds (loot page, odds modal, box card) show the number
  that player actually faces, at 0, 1, 2 and 3 shards held.
- Confirm shard EV charged to a roll matches `pc_value / shards_required` = $10,
  and that salvage pays $10. If those differ, the box is raking for the PC.
- `pc_shard_mint_cap` (24) is the only thing bounding total shard supply.
  Verify it is enforced and cannot be raced past.

### 5. UI truth-telling
- `components/ShardHud.tsx` — the claim gate branch (`claimUnlocked`). Set
  `pc_claim_threshold` to 500 temporarily: does a player holding a full set see
  the condition and the live pot, and are their shards NOT burned by a refused
  claim? Set it back to 0.
- `components/CaseReel.tsx` — the bundle notice on a physical win. Does it
  render for both the main prize and the consolation object?
- Mobile, real phone: the reveal, the shard HUD, the odds modal.

### 6. Failure states
Airplane mode mid-spin. Session expiring mid-action. Supabase 500. Double-tap
every button. A roll that succeeds server-side but whose response never
arrives — does the idempotency key stop a double charge?

## Report

Write findings to `FROM_GEMINI_FOR_CLAUDE.md`, ranked by cost to the owner:
money leaving wrongly, then a player being cheated, then confusion, then polish.

```
SEVERITY | WHERE | WHAT HAPPENS | HOW TO REPRODUCE | STATUS
```

**Verify the claim, not the intent.** "A CHECK constraint prevents this" must
mean you tried to violate it and Postgres refused, with the output pasted. A
previous pass asserted a constraint existed that did not.

**Clean up after yourself.** Track probe rolls and vouchers BY ID, not by
timestamp — a timestamp filter cost me three real rolls this week. Restore
stock for anything your probes won, and run `npm run reconcile` at the end.

## Do not touch

`lib/economy.ts`, `lib/types.ts`, `lib/session.ts`, `lib/admin-lock.ts`,
`lib/supabase/*`, `supabase/migrations/*`, `scripts/*`, `lib/sound.ts`.
Report problems in those rather than editing — the economy and the security
boundary have one owner on purpose.

`components/**` and `app/**` are yours, provided all seven commands above still
pass and you have not changed what the odds mean.
