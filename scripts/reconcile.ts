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
  /** Set on consumable rewards (credit / free spin / discount voucher). */
  reward_credit: number | null;
  reward_voucher_tier: string | null;
}

async function main() {
  const { data: items, error: itemsErr } = await db
    .from('items')
    .select('id,name,stock_qty,initial_stock_qty,reward_credit,reward_voucher_tier');
  if (itemsErr) throw itemsErr;

  // Held = rolls, NOT a table called `inventory`. See the header.
  const { data: held, error: heldErr } = await db
    .from('rolls')
    .select('item_name')
    .eq('status', 'inventory')
    .eq('kind', 'physical');
  if (heldErr) throw heldErr;

  // Reward items are matched by item_id on the roll, not by name in heldBy.
  const { data: allRolls, error: rollsErr } = await db
    .from('rolls')
    .select('item_id');
  if (rollsErr) throw rollsErr;
  const rewardUses = new Map<string, number>();
  for (const r of allRolls ?? []) {
    const id = (r as { item_id: string | null }).item_id;
    if (id) rewardUses.set(id, (rewardUses.get(id) ?? 0) + 1);
  }

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
    // REWARD ITEMS ARE CONSUMED, NOT HELD. Winning a "FREE $3 SPIN" decrements
    // its stock and issues a voucher; the roll is kind='respin', so it is never
    // counted in heldBy. Reconciling them would compute should = initial - 0
    // and --fix would RESTORE the stock -- resurrecting a voucher a player has
    // already spent, and minting a free spin every time this script is run.
    // REWARD ITEMS ARE CONSUMED, NOT HELD -- but they are still finite, and
    // until now nothing checked them at all. `stock + held == initial` cannot
    // work for them (the roll is kind='respin', never counted in heldBy), so
    // they were skipped entirely. That blind spot let a bad cleanup script
    // drain $3 House Credit 20 -> 0, 50% OFF a $10 box 12 -> 0 and FREE $3 SPIN
    // 12 -> 0 while this reported "everything balances".
    //
    // They CAN be checked, just differently: the roll row records item_id even
    // though the returned payload omits it, so the invariant is
    // `stock + rolls-that-reference-it == initial`.
    if (raw.reward_credit !== null || raw.reward_voucher_tier !== null) {
      const used = rewardUses.get(raw.id) ?? 0;
      const want = Math.max(0, raw.initial_stock_qty - used);
      if (raw.stock_qty !== want) {
        drift.push({ row: raw, held: used, should: want });
      }
      continue;
    }
    const h = heldBy.get(raw.name) ?? 0;
    const should = Math.max(0, raw.initial_stock_qty - h);
    if (raw.stock_qty !== should) drift.push({ row: raw, held: h, should });
  }

  if (drift.length === 0) {
    console.log(' Everything balances. Every unit is either in stock or in a player inventory.\n');
    await checkShardMint(APPLY);
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
    await checkShardMint(APPLY);
    return;
  }

  let n = 0;
  for (const d of drift) {
    const { error } = await db.from('items').update({ stock_qty: d.should }).eq('id', d.row.id);
    if (error) console.log('   failed on ' + d.row.name + ': ' + error.message);
    else n++;
  }
  console.log('\n Corrected ' + n + ' of ' + drift.length + ' item(s).\n');
  await checkShardMint(APPLY);
}


/**
 * The global shard mint counter against what players actually hold.
 *
 * `config.pc_shards_minted` is the only thing enforcing `pc_shard_mint_cap` --
 * the guard limiting how many PC shards can be in circulation at once. Three
 * things move it, and only two of them move it in the same direction:
 *
 *   open_box       mints a shard      +1 counter, +1 held
 *   salvage_shards destroys one       -1 counter, -1 held
 *   claim_pc       spends four        counter unchanged, held -4
 *
 * So the counter tracks shards IN CIRCULATION, and the invariant is
 *
 *     counter == held by players + shards_required x PCs claimed
 *
 * Counting `kind = 'shard'` rolls does NOT work: claim_pc writes one of those
 * too (item_name 'Gaming PC', status 'claimed'), and salvage leaves no row at
 * all, so the roll log cannot reconstruct the total on its own.
 */
async function checkShardMint(APPLY: boolean): Promise<void> {
  const { data: cfgRow } = await db.from('config').select('value').eq('key', 'settings').maybeSingle();
  if (!cfgRow) return;
  const cfg = (cfgRow.value ?? {}) as Record<string, unknown>;
  const minted = Number(cfg.pc_shards_minted ?? 0);
  const required = Number(cfg.shards_required ?? 4);

  const { data: profs } = await db.from('profiles').select('pc_shards');
  const held = (profs ?? []).reduce((sum, pr) => sum + Number(pr.pc_shards ?? 0), 0);

  const { count: claimCount } = await db
    .from('rolls').select('id', { count: 'exact', head: true })
    .eq('kind', 'shard').eq('status', 'claimed');
  const claims = claimCount ?? 0;

  const expected = held + required * claims;

  console.log('\n=================================================================');
  console.log(' PC SHARD MINT COUNTER');
  console.log('=================================================================\n');
  console.log('  held by players           ' + held);
  console.log('  PCs claimed               ' + claims + '  (x' + required + ' shards = ' + required * claims + ')');
  console.log('  counter should read       ' + expected);
  console.log('  config.pc_shards_minted   ' + minted);
  console.log('  mint cap                  ' + (cfg.pc_shard_mint_cap ?? '(derived)'));

  if (minted === expected) {
    console.log('\n  Counter matches circulation.\n');
    return;
  }

  console.log('\n  !!  counter is ' + (minted < expected ? 'BEHIND' : 'AHEAD OF') +
              ' circulation by ' + Math.abs(expected - minted) + '.');
  console.log(minted < expected
    ? '      The cap counts from behind, so more shards can be minted than intended.'
    : '      The cap counts ahead, so shards stop dropping earlier than intended.');

  if (!APPLY) {
    console.log('\n  Nothing was changed. Re-run with --fix to set it to ' + expected + '.\n');
    return;
  }
  const { data: fresh } = await db.from('config').select('value').eq('key', 'settings').single();
  const next = { ...(fresh!.value as Record<string, unknown>), pc_shards_minted: expected };
  const { error } = await db.from('config').update({ value: next }).eq('key', 'settings');
  console.log(error ? '\n  failed: ' + error.message + '\n'
                    : '\n  Corrected to ' + expected + '.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
