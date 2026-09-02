/**
 * PRE-PARTY RESET
 *
 *   npm run reset -- --dry     # show what would change, touch nothing
 *   npm run reset -- --confirm # actually do it
 *
 * Testing leaves real rows behind: approved deposits inflate the gross pot (and
 * can push it past the shard gate before anyone has played), rolls sit in
 * people's inventories, stock is decremented, and minted shards count against
 * the global cap. None of that is obvious from the admin screen, and all of it
 * changes the odds on the night.
 *
 * This clears play history and restores the catalog to its seeded stock WITHOUT
 * touching player names, roles, or PINs — so a roster you have already renamed
 * survives.
 *
 * Deliberately requires --confirm. It deletes rows on a live database.
 */

import { config } from 'dotenv';
import { Client } from 'pg';
import { RESOLVED_CATALOG } from '../lib/catalog';

config({ path: '.env.local', quiet: true });

const DRY = !process.argv.includes('--confirm');

async function main() {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const before = await c.query(`
    SELECT
      (SELECT count(*) FROM rolls)::int                                        AS rolls,
      (SELECT count(*) FROM deposits)::int                                     AS deposits,
      (SELECT COALESCE(sum(amount),0) FROM deposits WHERE status='approved')   AS pot,
      (SELECT COALESCE(sum(balance),0) FROM profiles)                          AS balances,
      (SELECT COALESCE(sum(scrap_coins),0) FROM profiles)::int                 AS coins,
      (SELECT COALESCE(sum(pc_shards),0) FROM profiles)::int                   AS shards,
      (SELECT COALESCE(sum(stock_qty),0) FROM items)::int                      AS stock,
      (SELECT value->>'pc_shards_minted' FROM config WHERE key='settings')     AS minted
  `);
  const b = before.rows[0];

  console.log('\n=================================================================');
  console.log(' PRE-PARTY RESET' + (DRY ? '  (dry run — nothing will change)' : ''));
  console.log('=================================================================\n');
  console.log('  rolls logged            ' + b.rolls);
  console.log('  deposit requests        ' + b.deposits + '  (approved pot $' + Number(b.pot).toFixed(2) + ')');
  console.log('  credits held by players $' + Number(b.balances).toFixed(2));
  console.log('  scrap coins held        ' + b.coins);
  console.log('  PC shards held          ' + b.shards + '  (globally minted ' + b.minted + ')');
  console.log('  item units in stock     ' + b.stock);

  console.log('\n  WILL CLEAR:   rolls, deposits, balances, scrap coins, shards,');
  console.log('                the global shard mint counter, and any drop overrides.');
  console.log('  WILL RESTORE: every item to its seeded stock quantity.');
  console.log('  WILL KEEP:    player names, roles, and PINs.\n');

  if (DRY) {
    console.log('  Re-run with --confirm to apply.\n');
    await c.end();
    return;
  }

  await c.query('BEGIN');
  try {
    await c.query('DELETE FROM drop_overrides');
    await c.query('DELETE FROM rolls');
    await c.query('DELETE FROM deposits');
    await c.query('UPDATE profiles SET balance = 0, scrap_coins = 0, pc_shards = 0');
    await c.query(
      `UPDATE config SET value = jsonb_set(value, '{pc_shards_minted}', '0') WHERE key = 'settings'`
    );

    // Restore stock from the catalog rather than a blanket number, so items the
    // admin added through the scanner keep whatever quantity they were given.
    for (const item of RESOLVED_CATALOG) {
      await c.query('UPDATE items SET stock_qty = $1, is_active = TRUE WHERE name = $2', [
        item.stock_qty,
        item.name,
      ]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('  FAILED, rolled back: ' + (e as Error).message);
    await c.end();
    process.exit(1);
  }

  const after = await c.query(`
    SELECT (SELECT count(*) FROM rolls)::int AS rolls,
           (SELECT COALESCE(sum(amount),0) FROM deposits WHERE status='approved') AS pot,
           (SELECT COALESCE(sum(stock_qty),0) FROM items)::int AS stock`);
  const a = after.rows[0];
  console.log('  done. rolls ' + a.rolls + ', pot $' + Number(a.pot).toFixed(2) + ', stock ' + a.stock + ' units.');
  console.log('  The shard gate is shut again until real deposits cross the threshold.\n');

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
