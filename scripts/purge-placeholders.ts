/**
 * REMOVE THE RECOVERED PLACEHOLDER OBJECTS, KEEP THE REWARD ECONOMY
 *
 *   npm run purge:placeholders           # show exactly what would go
 *   npm run purge:placeholders -- --fix  # delete them
 *
 * After the catalogue was rebuilt from the ticker log, the physical items came
 * back as names with no value, stock, photo or tier worth trusting. They are
 * being re-entered by hand, so the placeholders are in the way.
 *
 * KEPT, always:
 *   - reward rows       house credit, free spins, discount vouchers
 *   - favors            "$20 Favor — ask Andy" and friends
 *   - the shard prize   anything with shard_cost > 0 (the Gaming PC)
 *   - anything a player is holding, or that has ever been rolled
 *
 * That last rule matters: deleting an item that a `rolls` row points at would
 * either fail on the foreign key or orphan somebody's inventory. Those are
 * deactivated instead of deleted, so they stop appearing in boxes while the
 * history stays intact.
 *
 * A snapshot is taken before anything is removed, and the exact restore command
 * is printed at the end. This script exists BECAUSE a careless bulk delete
 * destroyed this table once already.
 */
import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { snapshot } from './backup';

denv({ path: '.env.local', quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--fix');
const pad = (s: string, n: number) => s.padEnd(n);

async function main() {
  const { data: items } = await db
    .from('items')
    .select('id,name,est_value,box_tier,rarity,stock_qty,shard_cost,reward_credit,reward_voucher_tier,bundle_only')
    .order('name');

  const { data: rolls } = await db.from('rolls').select('item_id');
  const referenced = new Set((rolls ?? []).map((r) => r.item_id).filter(Boolean));

  const keep: any[] = [];
  const deactivate: any[] = [];
  const remove: any[] = [];

  for (const i of items ?? []) {
    const isReward = i.reward_credit !== null || i.reward_voucher_tier !== null;
    const isFavor = /favor/i.test(i.name);
    const isShardPrize = Number(i.shard_cost ?? 0) > 0;

    if (isReward || isFavor || isShardPrize) keep.push(i);
    else if (referenced.has(i.id)) deactivate.push(i);
    else remove.push(i);
  }

  const line = (i: any) =>
    '  ' + pad(String(i.name).slice(0, 32), 34) + pad(i.box_tier, 8) +
    pad(i.rarity, 8) + pad('$' + i.est_value, 9) + 'stock ' + i.stock_qty;

  console.log('\n=================================================================');
  console.log(' PLACEHOLDER PURGE' + (APPLY ? '' : '   (dry run — pass --fix to apply)'));
  console.log('=================================================================');

  console.log('\n KEEPING ' + keep.length + ' — rewards, favors and the shard prize\n');
  for (const i of keep) console.log(line(i));

  if (deactivate.length) {
    console.log('\n DEACTIVATING ' + deactivate.length + ' — referenced by a roll, so the');
    console.log(' history would break if they were deleted\n');
    for (const i of deactivate) console.log(line(i));
  }

  console.log('\n DELETING ' + remove.length + ' — recovered placeholders, never rolled\n');
  for (const i of remove) console.log(line(i));

  console.log('\n  keep ' + keep.length + '   deactivate ' + deactivate.length +
              '   delete ' + remove.length + '   (total ' + (items ?? []).length + ')');

  if (!APPLY) {
    console.log('\n  Nothing was changed. Re-run with --fix to apply.\n');
    return;
  }

  const dir = await snapshot('pre-purge');
  console.log('\n  snapshot saved to ' + dir);

  let deact = 0;
  for (const i of deactivate) {
    const { error } = await db.from('items').update({ is_active: false }).eq('id', i.id);
    if (error) console.log('   failed to deactivate ' + i.name + ': ' + error.message);
    else deact++;
  }

  // Deleted BY ID, one at a time. Never a pattern, never a filter that could
  // match more than it was shown to match above.
  let del = 0;
  for (const i of remove) {
    const { error } = await db.from('items').delete().eq('id', i.id);
    if (error) console.log('   failed to delete ' + i.name + ': ' + error.message);
    else del++;
  }

  const { count } = await db.from('items').select('id', { count: 'exact', head: true });
  console.log('\n  deactivated ' + deact + ', deleted ' + del + ', ' + count + ' item(s) remain.');
  console.log('  undo:  npm run backup -- --restore ' + dir + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
