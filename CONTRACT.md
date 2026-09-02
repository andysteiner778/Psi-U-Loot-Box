# Workstream Contract

Four agents work in parallel on House Loot. This file is what stops them writing
four incompatible versions of the same thing.

## The one rule

**`lib/types.ts` is frozen.** Every workstream imports from it. Nobody edits it.
If you need a change, say so — it gets made once, centrally, and everyone picks
it up. A workstream that redefines `OpenBoxResult` locally has broken the build
for the other three.

## File ownership

Touch only the files your workstream owns. If you need something outside your
lane, ask rather than reaching across.

| # | Workstream | Owns exclusively |
|---|---|---|
| 1 | **DB & Math** | `supabase/**`, `lib/economy.ts`, `lib/catalog.ts`, `scripts/**` |
| 2 | **Reel & Audio** | `lib/sound.ts`, `lib/reel.ts`, `components/CaseReel.tsx`, `components/ItemCard.tsx`, `components/reel/**` |
| 3 | **App Core** | `app/(player)/**`, `app/api/auth/**`, `app/api/box/**`, `app/api/inventory/**`, `components/Ticker.tsx`, `components/ShardHud.tsx` |
| 4 | **Admin & Vision** | `app/admin/**`, `app/api/admin/**`, `app/api/vision/**`, `lib/vision/**` |

**Shared, centrally owned — do not edit:** `lib/types.ts`, `lib/session.ts`,
`lib/supabase/*`, `app/layout.tsx`, `app/globals.css`, `package.json`,
`tsconfig.json`, `next.config.ts`.

## Security invariants — non-negotiable

These are the difference between a working game and a looted one. They apply to
every workstream:

1. **Identity comes from the session cookie, never from the request body.**
   Every RPC call passes `(await requireUser()).id`. A route that accepts a
   `user_id` from the client lets any player roll as, or drain, any other.
2. **The service-role key never reaches the browser.** Import `lib/supabase/server`
   only from route handlers and server components. It carries `import 'server-only'`,
   so a mistake fails the build rather than shipping silently.
3. **Never add `NEXT_PUBLIC_` to a secret.** That prefix inlines the value into
   the client bundle.
4. **Money and rules live in SQL.** Balance changes, stock decrements and the
   anti-exploit rules happen inside the RPCs, atomically. A client-side check is
   a suggestion; a `CHECK` constraint is a rule.
5. **`/api/vision/scan-item` requires `requireAdmin()`.** Unguarded, it is a free
   AI proxy billed to the house.

## Auth helpers (use these; do not hand-roll)

 is invisible to PostgREST by design, so supabase-js cannot touch the
sessions or PIN tables directly. Migration 0004 exposes single-verb SECURITY DEFINER
wrappers in , and  wraps those:

| Helper | Does |
|---|---|
|  | Verifies the PIN **and** opens the session. Returns . Throws with  when locked out. |
|  | First-login PIN change. |
|  |  for the login dropdown. Server-side only. |
|  |  — adds . |
|  /  | Throw 401 / 403. |
|  | Sign out. |

## Server contract

All of these are `POST` unless noted, and all read identity from the cookie.

| Route | Body | Returns |
|---|---|---|
| `/api/auth/login` | `{ name, pin }` | `SessionUser` — sets the cookie |
| `/api/auth/logout` | — | `{ ok }` |
| `/api/auth/pin` | `{ pin }` | `{ ok }` — first-login PIN change |
| `/api/box/open` | `{ tier, clientRollId }` | `OpenBoxResult` |
| `/api/box/odds?tier=` (GET) | — | `BoxOdds` |
| `/api/inventory` (GET) | — | `Roll[]` |
| `/api/inventory/scrap` | `{ rollId }` | `{ ok, scrap_gained }` |
| `/api/inventory/compact` | — | `{ ok, credit }` |
| `/api/inventory/claim-pc` | — | `{ ok }` |
| `/api/admin/deposits` (GET) | — | `Deposit[]` |
| `/api/admin/deposits/approve` | `{ depositId }` | `{ ok, amount }` |
| `/api/vision/scan-item` | image | `ScanResult` |

`clientRollId` is a UUID the client generates per spin. It makes `open_box`
idempotent, so a double-tap on a phone or a retried fetch returns the original
result instead of charging twice. Always send it.

## Errors

RPCs raise distinct SQLSTATEs so the UI can tell "not enough credits" from a
real bug. `rpcErrorStatus()` in `lib/supabase/server.ts` maps them.

| Code | HTTP | Meaning |
|---|---|---|
| `PT400` | 400 | Bad input |
| `PT402` | 402 | Insufficient balance / scrap / shards |
| `PT403` | 403 | Not yours, or restricted (e.g. scrapping a Covert item) |
| `PT404` | 404 | No such record |
| `PT409` | 409 | Wrong state (already approved, already scrapped) |
| `PT429` | 429 | PIN locked out — 5 failed attempts, 15 minutes |

## Realtime

The ticker subscribes to the **broadcast** topic `house_ticker`, event `roll`.
It is not `postgres_changes` — no table is readable by the browser. The payload
is `TickerEvent` from `lib/types.ts`, composed by a database trigger, and already
carries the player's display name.

```ts
supabase.channel(TICKER_TOPIC)
  .on('broadcast', { event: 'roll' }, ({ payload }) => render(payload as TickerEvent))
  .subscribe();
```

## Commands

```bash
npm run dev          # dev server
npm run simulate     # economy solvency gate — must pass before any economy change lands
npm run seed:gen     # regenerate supabase/seed.sql from lib/catalog.ts
npm run db:push      # apply migrations to the hosted project
```
