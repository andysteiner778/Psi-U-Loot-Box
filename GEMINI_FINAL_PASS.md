# Gemini — Launch Readiness Pass

The app is **deployed on Vercel, running against the live database**, and the
owner is about to send the link out. All gates pass:

```
tsc          clean
build        clean
simulate     1353 assertions, 0 failures
verify:sql   45 checks, 0 failures      (real Postgres via PGlite)
verify:live  27 checks, 0 failures      (hosted Supabase)
```

Run all five before you finish and paste the real output. **Never weaken a gate
to make it pass** — if one fails after your change, the change is wrong.

---

## What changed since your last pass — read before touching anything

**The economy was resized for the REAL party.** The owner's actual numbers are
10-15 people who buy, 2-3 boxes each: a pot around **$500** and roughly **30 box
openings all night**, not the 30 x $40 party that was modelled before.

| knob | was | now |
|---|---|---|
| `shards_required` | 5 | **2** |
| `pc_shard_mint_cap` | (didn't exist) | **15** |
| `pot_revenue_threshold` | $400 | **$150** |
| `house_margin` | 5% | **12.5%** |
| `shard_probs` | .0075/.03/.10 | **.0225/.09/.30** |
| `pc_value` | 400 | **50** (see below) |
| `pc_display_value` | — | **400** |

**`pc_value` and `pc_display_value` are different on purpose.** `pc_value` is
what the ECONOMY CHARGES for the shard track so the odds stay solvent.
`pc_display_value` is what the machine is actually worth. **Any UI showing the
prize must read `pc_display_value`.** Reading `pc_value` advertised a "$50 Rig"
for a $400 PC — that bug was live until just now.

Result: P(someone wins the PC) went from **0% to 17.6%**, with ~2.2 players
ending the night one shard short.

---

## Your tasks

### 1. Hostile testing — the highest-value work here

Assume a housemate is actively trying to cheat. Try each of these and report
exactly what happened:

- `POST /api/box/open` with another player's `user_id` in the body.
- Any `/api/admin/*` route while signed in as a normal player.
- `/admin` with the admin role but **without** the PIN unlock — then try to
  bypass it: edit cookies, call the API directly, disable JS, replay the
  `hl_admin_unlock` cookie from another account.
- Scrap a Purple/Pink/Gold item through the API instead of the UI.
- Replay the same `clientRollId`; fire two `open_box` calls simultaneously.
- Open a box at $0 balance.
- Tamper with client state to inflate a balance or shard count.

**Every one must fail server-side.** Anything that succeeds stops the launch.

### 2. Real-device testing on the deployed URL

- An actual phone, not a narrow desktop window. Then two phones at once: does
  the ticker on A show B's pull?
- Slow 3G: is the reel watchable, and does double-tapping during a slow request
  charge twice? (It must not — `clientRollId`.)
- Airplane mode mid-spin: does it recover, or charge and lose the result?
- Rotate the phone mid-spin.
- Sound: confirm the reel start sting plays **once**, not twice. That was just
  fixed; verify it stayed fixed.

### 3. The full loop, end to end, as a real player would

Deposit request → admin approves → balance rises → open all three tiers →
scrap a Grey/Blue → compact 100 coins → collect a shard → salvage it. Every
step should be obvious without explanation. Note anything confusing.

### 4. Empty and error states

Each must be a clear message, never a crash or a silent nothing:
- A tier with zero stock ("Cleaned Out" — verify it triggers).
- Empty inventory.
- Vision scanner with **no API key** — this is the owner's actual state, both
  keys are blank. It must degrade to manual entry.
- Supabase unreachable; session expired mid-session.

### 5. Small fixes if you find them cheap

- Copy that still implies 5 shards or a $400 pot gate anywhere player-facing.
- Anything quoting `pc_value` instead of `pc_display_value`.

---

## Do not touch

`lib/economy.ts`, `lib/types.ts`, `lib/session.ts`, `lib/admin-lock.ts`,
`lib/storage.ts`, `lib/supabase/*`, `supabase/migrations/*`, `scripts/*`.

Claude owns the economy and the security boundary. If something in those looks
wrong, write it in `FROM_GEMINI_FOR_CLAUDE.md` rather than editing — a
divergence between `lib/economy.ts` and the SQL is invisible to every test we
have, because the solvency proof runs on the TypeScript side.

## Reporting

Write findings to `FROM_GEMINI_FOR_CLAUDE.md`: what you tried, what happened,
what you changed. **Report what you could not fix.** The night before a party, a
documented known bug is worth far more than a green summary that turns out to be
wrong.
