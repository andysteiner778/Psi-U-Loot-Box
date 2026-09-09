@AGENTS.md

# Destructive operations against the live database

On 2026-09-07 a cleanup script ran `DELETE ... WHERE name LIKE '__%'` against
production to remove test probes. `_` is a **single-character wildcard** in SQL,
so `'__%'` matched every name of two or more characters and destroyed the entire
`items` table — 71 rows, the owner's whole catalogue, hours before a party. The
project is on Supabase's free tier: no point-in-time recovery, no scheduled
backups, and the dead tuples were vacuumed within minutes. It was only partly
recoverable, from the ticker broadcast log.

These rules exist because of that. They are not optional.

## Before anything that deletes or overwrites rows

1. **Take a snapshot.** `npm run backup -- <label>`. It writes every table,
   including `app_private.profile_secrets` (PIN hashes — omitting it locks
   everyone out, which also happened). Print the restore command afterwards.
2. **Dry run first, and show the rows.** Every destructive script defaults to a
   dry run and only acts with `--fix`. Print what will be affected and what will
   be spared, by name, before touching anything.
3. **Delete by id, never by pattern.** Enumerate the exact rows with a SELECT,
   confirm the count is what you expect, then delete those ids one at a time.
   A `LIKE`, a prefix match or a `neq` filter can match more than you think —
   that is precisely the bug that caused this.
4. **Never bulk-delete from production to clean up test data.** Probes belong in
   a rolled-back transaction (`BEGIN` / `ROLLBACK`), which is how the other
   gates do it. `npm run race` is the exception that touches live rows, and it
   snapshots stock and restores every unit it consumes.

## Foreign keys and cascades

`app_private.profile_secrets` cascades from `profiles`. `rolls` reference
`items`. Deleting a parent silently takes children with it, so:

- An item any `rolls` row points at is **deactivated** (`is_active = false`),
  never deleted — deleting it orphans somebody's inventory.
- Anything restoring `profiles` must restore `profile_secrets` in the same
  transaction, parent first.

## Verifying a backup

A backup nobody has restored from is not a backup, and a row-count check is not
a restore test — the first version of `backup:verify` passed while destroying
every PIN, because counts cannot tell you a hash still authenticates.
`npm run backup:verify` wipes the items table and the PIN table on purpose,
restores, and then calls `verify_pin` with a known credential.

## Useful commands

| | |
|---|---|
| `npm run backup -- <label>` | snapshot every table to `backups/` |
| `npm run backup -- --restore <dir>` | put a snapshot back (snapshots current state first) |
| `npm run backup:verify` | prove the restore path actually works |
| `npm run reconcile` | stock and shard-counter integrity |
| `npm run audit` | live economy sanity |
| `npm run rebase-scrap -- --fix` | scrap values follow current item values |
