# Gemini — Final Pass Before Launch

The app is **deployed and working on Vercel** against the live Supabase database.
All four gates pass. This is the last pass before the owner sends the link to 30
housemates who will put real money in.

From here the bar changes: it is no longer "does it build", it is **"will this
survive 30 people on phones on one wifi connection, some of them drunk, some of
them actively trying to break it, all of them with real money in the pot."**

## Run these first and paste the real output

```bash
npm run build && npx tsc --noEmit
npm run simulate      # economy solvency  — 1353 assertions
npm run verify:sql    # real Postgres     — 44 checks
npm run verify:live   # hosted Supabase   — 27 checks
```

All four pass right now. If any of them fails after your changes, the change is
wrong — **never weaken a gate to make it pass.**

Then read `QA_BRIEF.md`, which is the full test matrix, and `CONTRACT.md` for
file ownership and the security invariants.

---

## Your tasks

### 1. Login should accept a typed name (the owner asked for this twice)

`app/login/login-form.tsx` currently uses a `<select>` dropdown of all 30 names.
The owner wants to type instead. Build a **combobox**: a text input that filters
the roster as you type, with keyboard navigation and click-to-select.

Requirements:
- Typing must still resolve to a real profile. Do **not** let a free-text name
  reach the API — an unmatched name should show "no such player", not attempt a
  login. The server looks names up exactly.
- Keep it usable one-handed on a phone: the list must not cover the PIN field.
- Preserve the existing forced-PIN-change flow.

### 2. "Tier 2 Key" is a misnomer — rename it

The Scrap Compactor says it produces a "Tier 2 Key", but `compact_scrap` credits
`$20` of ordinary balance, which is spendable on any tier. The owner noticed and
asked whether that breaks the math. **It does not** — a scrap coin is priced at
exactly `tier_2 price / 100 = $0.20`, and every tier pays out the same
`1 - margin`, so $20 of credit is $20 of credit wherever it is spent.

But the label is dishonest. Rename it to something accurate like
"Crush 100 Scrap → $20 Credit" everywhere it appears (`ScrapCompactor.tsx`,
inventory copy, the runbook). Do not change the RPC behaviour.

### 3. Hostile testing — assume a housemate is trying to cheat

For each of these, try it and report what happened:
- Call `/api/box/open` directly with a `user_id` for a different player in the body.
- Call `/api/admin/*` while signed in as a normal player.
- Reach `/admin` with the DB role but no admin PIN unlock, and try to bypass the
  lock from devtools (edit cookies, call the API directly, disable JS).
- Scrap a Purple/Pink/Gold item through the API rather than the UI.
- Replay the same `clientRollId` twice, and fire two `open_box` calls at once.
- Open a box with a balance of $0.
- Tamper with `localStorage` / any client state to inflate a balance.

**Every one of these must fail server-side.** If any succeeds, that is the
highest-priority bug in the repo and it stops the launch.

### 4. Real-conditions testing

- Load the deployed Vercel URL on an actual phone, not just a narrow browser window.
- Two devices at once: does the ticker on device A show device B's pull?
- Airplane-mode mid-spin: does it recover, or does it charge and lose the result?
- Slow 3G throttling: is the reel still watchable, and does double-tapping the
  open button during a slow request charge twice? (It must not — `clientRollId`.)
- Rotate the phone mid-spin.

### 5. Empty and error states

Every one of these should be a clear message, never a crash or a silent nothing:
- A tier with zero stock (should say "Cleaned Out" — verify it triggers).
- Inventory with no items.
- The vision scanner with no API key configured.
- Supabase unreachable.
- A player whose session expired mid-session.

---

## Do not touch

`lib/economy.ts`, `lib/types.ts`, `lib/session.ts`, `lib/admin-lock.ts`,
`lib/storage.ts`, `lib/supabase/*`, `supabase/migrations/*`, `scripts/*`.

Claude owns the economy and the security boundary. If you believe something in
those is wrong, **write it in `FROM_GEMINI_FOR_CLAUDE.md` rather than editing** —
a divergence between `lib/economy.ts` and the SQL is invisible to every test we
have, because the solvency proof runs on the TypeScript side.

## Known open item — do not try to fix it yourself

The PC is currently **unwinnable**: collecting 5 soulbound shards costs roughly
$2,500 of Tier-3 spend against a party pot of ~$1,200, so the simulated
probability that anyone claims it is ~0%. Claude is handling this with the owner;
it needs a design decision, not a code change.

## Reporting

Write findings to `FROM_GEMINI_FOR_CLAUDE.md`. Be specific: what you tried, what
happened, what you changed. **Report failures you could not fix** — a known,
documented bug is far more useful the night before a party than a green summary
that turns out to be wrong.
