# Catalogue loss — 2026-09-07

## What happened

A cleanup script I ran used `name LIKE '__%'` to find test probe rows. In SQL,
`_` is a **single-character wildcard**, so `__%` matches any name of two or more
characters — not names beginning with two underscores. It deleted every row in
`items` (71) and the `profiles` row, plus their `rolls`.

The correct predicate was `LIKE '\_\_%'` with an escape, or matching the exact
generated probe names. It should never have run against production at all.

## What survived

| | |
|---|---|
| `storage.objects` | **285 item photos, intact** |
| `config` | both rows (`settings`, `clearance`) — all economy tuning intact |
| `vouchers` | 3 |
| `profiles` | Andy, re-created on next login (new id, admin, $0) |
| `items` | **0** |
| `rolls`, `deposits` | 0 |

Schema and all 47 migrations are intact and re-appliable. Every code change
made today is committed — bundling, crush-all, scrap denomination, the tier
lock. Only *data* was lost.

## Recovery, in order of preference

### 1. Supabase Point-in-Time Restore (recovers everything exactly)

Dashboard → project → **Database → Backups → Point in Time**. Restore to
**just before 2026-09-07 07:59 UTC** (autovacuum ran at 07:59:14, which is
after the delete — any target a few minutes earlier is safe).

Requires Pro plan or above.

### 2. Scheduled daily backup

Dashboard → **Database → Backups → Scheduled backups**. Available on all paid
plans. Loses whatever changed since the snapshot — which would include the
~20 items added and the $0.01 repricing done today.

### 3. Rebuild by hand

`supabase/seed.sql` still holds the ORIGINAL catalogue, but that is not the
list as curated — it predates the repricing and the recent additions. The
partial reconstruction below is closer.

## In-place recovery is NOT possible

Checked and ruled out:

- **Dead tuples** — `pg_stat_user_tables` shows `n_dead_tup = 0` and
  autovacuum ran at 07:59:14 UTC, after the delete. The old row versions are
  gone from the heap.
- **WAL replay** — `pg_walinspect` is available but not installed, and with
  the default replica identity a `DELETE` logs only the primary key, not the
  row contents. It cannot reconstruct the values.
- **Management API** — no `SUPABASE_ACCESS_TOKEN` is present and the CLI is not
  logged in, so a restore cannot be triggered from here. It needs the dashboard.

## Partial reconstruction (fallback only)

Names and values recovered from diagnostic output earlier in the session.
Incomplete — stock counts, rarities, images and the most recent edits are not
all here. Use only if no backup is available.

### Shard prize
- Gaming PC — est $400, msrp $600, `shard_cost` 4

### tier_3 (High Roller)
- Monitor 1 — $50
- $50 Favor — ask Andy — $50 *(bundled onto Desk)*
- Monitor 2 — $30, msrp $70
- Razer Gaming Mouse — $25, msrp $60
- Weed crocs — $25
- TV — $25
- Mcat Books + study guides — $25, msrp $120
- Desk — $15, msrp $40
- FREE $30 SPIN — reward voucher, tier_3 @ 100%

### tier_2 (Golden Chest)
- $30 Favor — ask Andy — $30 *(bundled onto Ti-83 Plus)*
- $20 Favor — ask Andy — $20 *(bundled onto Weed hat)*
- $20 Favor — ask Andy (2) — $20 *(bundled onto Garbage Extra Lock)*
- 50% OFF a $30 box — reward voucher, tier_3 @ 50%
- FREE $10 SPIN — reward voucher, tier_2 @ 100%
- Bulk magic cards + trash can — $5, msrp $50
- Ti-83 Plus — $0.01
- Weed hat — $0.01
- Garbage Extra Lock — $0.01

### tier_1 (Good Stuff)
- Bulk mtg cards + avatar set — $7, msrp $20
- Lava lamp 1 — $5, msrp $12
- Lava Lamp 2 — $5, msrp $12
- Muscle milk protein powder — $4
- Car BT adapter — $2, msrp $8
- Creatine — $2
- Kore 2 fitness tracker — $2
- $3 House Credit — reward credit $3
- FREE $3 SPIN — reward voucher, tier_1 @ 100%
- 50% OFF a $10 box — reward voucher, tier_2 @ 50%
- Type C cable, Funny alpaca, Water gun, Drone frame + parts,
  2 rechargable AA batteries, License plate, Wheels, Keys??!!?!,
  UW no smoking sign, Sunglasses, Cheeba Hut frisbee, Tazer,
  Led power cable, One cheeba hut coupon, Desk lamp, Audio adapter
  — mostly $0.01–$0.50, each carrying a 100%-off tier_1 bonus voucher

### tier_0 (OG Junk Box)
- $1 House Credit — reward credit $1
- 50% OFF a $3 box — reward voucher, tier_1 @ 50%
- 3 AAA batteries, Drone parts, Alcohol Wipes, Stack of paper, TV remote,
  Deck of cards, Foot deoderant, One rainer, Micro USB cable type B,
  One condom, Stupid tiktok game, Seahawks ball, One doorstop,
  One blunt wrap, Red Sharpie, Usb C cable, Smoke detector, UW bag
  — $0.01–$0.50, each carrying a 100%-off tier_0 bonus voucher

Note: "Keys??!!?!" had an msrp of $676,767, which is almost certainly a joke
entry — it renders as a $676k prize in the ticker.

## After the restore

Two data steps need re-running (both one command, both safe):

```
npm run rebase-scrap -- --fix   # scrap values follow the $0.01 coin
```

and re-attaching the favor bundles — the script for that is described in the
commit for migration 0045. Then `npm run audit` and `npm run reconcile` to
confirm the catalogue is consistent.
