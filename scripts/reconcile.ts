/**
 * STOCK RECONCILIATION
 *
 *   npm run reconcile          # show what is wrong, change nothing
 *   npm run reconcile -- --fix # correct it
 *
 * Every physical unit should be in exactly one of two places: on the shelf
 * (`items.stock_qty`) or in somebody's hands (a roll with status='inventory'
 * and kind='physical'). So for every item:
 *
 *     stock_qty + held  ==  initial_stock_qty
 *
 * Two ways that breaks, both of which have actually happened here:
 *
 *   TOO FEW — a roll won an item, decrementing stock, and the roll row was
 *   later deleted. `npm run e2e` does this on every run: its probe accounts
 *   buy boxes, win things, and are then deleted. The physical object never
 *   left the house, but the app now believes it is gone.
 *
 *   TOO MANY — stock was restored from initial_stock_qty without subtracting
 *   what players already hold. The same monitor is then in someone's inventory
 *   AND back in the drop pool, so two people can win it. This is the dangerous
 *   direction: you find out at the pickup table, in front of both of them.
 *
 * THE TRAP THAT CAUSED IT: there is no `inventory` TABLE. Held items are rows
 * in `rolls`. `db.from('inventory')` does not throw — it returns
 * `{ data: null, error }`, and `(data ?? []).length === 0` then reads as
 * "nobody holds anything", which is how five prizes got duplicated.
 */

import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

denv({ path: '.env.local', quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--fix');
const pad = (s: string, n: number) => s.padEnd(n);

interface ItemRow {
  id: string;
  name: string;
  stock_qty: number;
  initial_stock_qty: number | null;
}

async function main() {
  const { data: items, error: itemsErr } = await db
    .from('items')
    .select('id,name,stock_qty,initial_stock_qty');
  if (itemsErr) throw itemsErr;

  // Held = rolls, NOT a table called `inventory`. See the header.
  const { data: held, error: heldErr } = await db
    .from('rolls')
    .select('item_name')
    .eq('status', 'inventory')
    .eq('kind', 'physical');
  if (heldErr) throw heldErr;

  const heldBy = new Map<string, number>();
  for (const r of held ?? []) {
    const n = (r as { item_name: string | null }).item_name ?? '';
    heldBy.set(n, (heldBy.get(n) ?? 0) + 1);
  }

  console.log('\n================================================================');
  console.log(' STOCK RECONCILIATION' + (APPLY ? '  (applying fixes)' : '  (dry run — pass --fix to apply)'));
  console.log('================================================================\n');
  console.log(' ' + (items ?? []).length + ' items, ' + (held ?? []).length + ' physical unit(s) held by players\n');

  const drift: { row: ItemRow; held: number; should: number }[] = [];
  for (const raw of (items ?? []) as ItemRow[]) {
    if (raw.initial_stock_qty === null || raw.initial_stock_qty === undefined) continue;
    const h = heldBy.get(raw.name) ?? 0;
    const should = Math.max(0, raw.initial_stock_qty - h);
    if (raw.stock_qty !== should) drift.push({ row: raw, held: h, should });
  }

  if (drift.length === 0) {
    console.log(' Everything balances. Every unit is either in stock or in a player inventory.\n');
    return;
  }

  console.log(' ' + pad('item', 32) + pad('initial', 9) + pad('held', 6) + pad('stock', 7) + pad('should be', 11) + 'meaning');
  for (const d of drift) {
    const tooMany = d.row.stock_qty > d.should;
    console.log(
      ' ' + pad(d.row.name.slice(0, 30), 32) + pad(String(d.row.initial_stock_qty), 9) +
      pad(String(d.held), 6) + pad(String(d.row.stock_qty), 7) + pad(String(d.should), 11) +
      (tooMany ? 'DUPLICATED — two people could win it' : 'lost to a deleted roll')
    );
  }

  if (!APPLY) {
    console.log('\n Nothing was changed. Re-run with --fix to correct these.\n');
    return;
  }

  let n = 0;
  for (const d of drift) {
    const { error } = await db.from('items').update({ stock_qty: d.should }).eq('id', d.row.id);
    if (error) console.log('   failed on ' + d.row.name + ': ' + error.message);
    else n++;
  }
  console.log('\n Corrected ' + n + ' of ' + drift.length + ' item(s).\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
