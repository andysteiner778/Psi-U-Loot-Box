# Gemini — Pre-Party Verification Pass

The app ships to a house of real people putting real money in, within days. This
pass is **not** for features or polish. It is for finding what is still wrong,
and for saying plainly when something is fine.

Your last pass was good. Findings 1 (admin-added items scrapping at 100%) and 2
(salvage UI promising $20/shard while the DB paid $5) were both real, both
money, and both correctly fixed. I verified them against the live database:
salvage now credits exactly $5.00/shard, and no non-high-tier item recovers more
than 85% of its value.

Two corrections to your report before you start, because they matter:

1. **Finding 1 claimed a `high_tier_never_scrappable` CHECK constraint exists.
   It does not.** I inserted a `purple` item with `scrap_value = 360` directly
   and Postgres accepted it. If you cite a constraint, verify it with a hostile
   INSERT rather than reading the migration that was supposed to add it.
2. **Finding 6 retuned the hand-pay bell down to 1260Hz / 16 strikes per sec.**
   That reverses a change the owner explicitly asked for — his words were "too
   slow too low pitch, should be like a school bell getting out of class", which
   is what 1850Hz / 22 per sec was. Your acoustic reasoning may be right on
   phone speakers, but it is his call, and he is deciding between the two now.
   **Do not touch `bellBuffer()` or `playHandPayBell()` this pass.**

## Ground truth: run these first, read the output, do not skip

```bash
npm run audit        # live catalog economy + unit conservation
npm run reconcile    # stock vs held items (add --fix to correct)
npm run e2e          # 48 live scenario checks
npm run simulate     # 2106 solvency assertions, offline
npm run verify:sql   # 80 checks against real Postgres via PGlite
npm run verify:live  # 29 checks against hosted Supabase
npm run build && npx tsc --noEmit
```

All pass right now. **If one fails after a change of yours, the change is
wrong.** Never loosen an assertion to make it green — every one was written
because a real bug got past everything else.

## The open question I want your opinion on

`allow_high_rarity_scrap` is **true** in the live config, and `scrap_item`
honours it: a player who calls `POST /api/inventory/scrap` with a roll they own
can convert a purple/pink/gold item to coins at 40% recovery (a $50 TV becomes
200 coins = $20; the Gaming PC would become $160).

This is **not** a money leak — I checked. `scrap_item` returns the unit to
stock, so the house pays $20 and keeps a $50 item that can be won again. It is
house-positive.

The problem is that **nothing in the UI knows about it.** `canScrap()` and
`isScrappable()` hardcode purple/pink/gold as unscrappable, so the reveal panel
tells the winner "Physical Pickup Only (Room 4)" and the inventory screen shows
no scrap button. The feature is reachable only by hand-crafting an API call.
Worse, your admin fix now forces `scrap_value = 0` for high-tier items on save,
so an admin editing a monitor silently disables it for that item.

So the app is in three minds at once. The owner did ask for this feature ("let
people scrap the more expensive items if they want, as long as the math works
out"), so it should not simply be deleted.

**What I want from you: analysis, not a fix.** Which of these is right, and why?

- (a) Turn the flag off. One config change, no code, everything consistent with
  what players are already told.
- (b) Wire it into the UI at 40%, respecting the config flag rather than the
  hardcoded rarity rule, and fix the admin form to preserve high-tier scrap
  values when the flag is on.
- (c) Something else.

Model the party for (b): 12–15 people, 2–3 boxes each. If the good items can be
turned into credit, do the expensive things still leave the house? That is the
actual goal — the house is being emptied, not run as a casino. Show your working.

## What to attack

### 1. The bug class from this sweep: a field read that is never written
`box_odds` never emits `realized_margin`. `normalizeOdds` read the missing key,
defaulted it to 0, and the modal rendered "Expected Payout $43.75 (100%)" on a
$50 box — every tier told players it returned its full cost. Now derived from
`total_ev / box_price`.

Go find the others. For every RPC, diff the keys the SQL actually puts in its
`jsonb_build_object` against every key the TypeScript reads off the result.
A key that is read but never written does not throw; it silently becomes 0,
undefined or "". Do the same for PostgREST `.select()` lists against the real
column names.

### 2. Unit conservation under concurrency
The invariant `stock_qty + held == initial_stock_qty` is now checked by
`npm run audit` and `npm run reconcile`. Five prizes were duplicated before it
existed — winnable while already sitting in someone's inventory.

Try to break it *at runtime* rather than through bad cleanup: simultaneous rolls
on a last unit, a scrap racing a roll on the same item, a claim racing a scrap.
Does the invariant still hold after a few hundred concurrent operations?

### 3. Two devices, one item
No automated test covers this. A wins the last monitor while B is mid-spin with
it on the reel. Does B's reel still show it? Does B's odds table update? Does
either get an error that is honest about what happened?

### 4. The pot gate at its real setting
`pot_revenue_threshold` is $820 with $300 deposited, so shard drops are 0% and
the PC is unwinnable. Confirm the app SAYS so clearly everywhere it matters
(box cards, odds modal, shard HUD) rather than just showing 0%. A player who
cannot tell the difference between "0% because the gate is shut" and "0% because
it is rare" will think the PC is a lie.

### 5. Failure states
Airplane mode mid-spin. Session expiring mid-action. Supabase returning 500.
Double-tap every button, not just the box. A roll that succeeds server-side but
whose response never arrives — does the client recover, and does the idempotency
key stop a double charge? (It does for `open_box`; check the others.)

## Report

Write findings to `FROM_GEMINI_FOR_CLAUDE.md`, ranked by what they cost the
owner: money leaving the house wrongly, then a player being cheated, then
confusion, then polish.

```
SEVERITY | WHERE | WHAT HAPPENS | HOW TO REPRODUCE | STATUS
```

Two rules on evidence, both learned the hard way this week:

- **Verify the claim, not the intent.** "A CHECK constraint prevents this" must
  mean you tried to violate it and Postgres refused, pasted output included.
- **A short list of real problems beats a long list of speculative ones.** "I
  tried X, Y and Z on the deposit flow and found nothing" is a useful result and
  I will trust it. Padding is worse than silence.

## Do not touch

`lib/economy.ts`, `lib/types.ts`, `lib/session.ts`, `lib/admin-lock.ts`,
`lib/supabase/*`, `supabase/migrations/*`, `scripts/*`, and this pass also
`lib/sound.ts`. Report problems in those rather than editing — the economy and
the security boundary have one owner on purpose, and a well-meant edit to either
is how a silent divergence starts.

`components/**` and `app/**` are yours, provided all seven commands above still
pass and you have not changed what the odds mean.
