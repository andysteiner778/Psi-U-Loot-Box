/**
 * PUT ITEMS IN BOXES BY WHAT THEY LOOK WORTH, NOT WHAT THEY COST
 *
 *   npm run retier            # show the moves
 *   npm run retier -- --fix   # apply them
 *
 * `tierForValue` assigns a box from `est_value`, and almost every item here is
 * priced at $0.01 on purpose — they are being given away. The result was 61 of
 * 67 objects sitting in the $0.50 box while the $30 box had nothing droppable
 * in it at all, so "pay more, win better" was simply untrue.
 *
 * `msrp` is what a player perceives, and it is the whole reason retail is
 * recorded. Tier on that instead. `est_value` is NOT touched: the house still
 * gives these away for a cent, and the EV engine still prices them that way.
 *
 * Reward rows (credit, free spins, vouchers) keep their tier — theirs is set by
 * face value, which is already the right basis. The shard prize is never
 * dropped and is skipped.
 */
import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { snapshot } from './backup';
import type { BoxTier } from '../lib/types';

denv({ path: '.env.local', quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--fix');
const pad = (s: string, n: number) => s.padEnd(n);

/**
 * Retail bands. Chosen against the actual catalogue so each box has a real
 * spread rather than one item: the $30 box wants the $30+ retail goods, the
 * $10 box the $10-30 range, and so on.
 */
export function tierForRetail(msrp: number): BoxTier {
  if (msrp >= 30) return 'tier_3';
  if (msrp >= 10) return 'tier_2';
  if (msrp >= 4) return 'tier_1';
  return 'tier_0';
}

async function main() {
  const { data: items } = await db
    .from('items')
    .select('id,name,est_value,msrp,box_tier,rarity,stock_qty,shard_cost,reward_credit,reward_voucher_tier')
    .order('msrp', { ascending: false, nullsFirst: false });

  const moves: { id: string; name: string; msrp: number; from: string; to: BoxTier }[] = [];
  let skipped = 0;

  for (const i of items ?? []) {
    if (Number(i.shard_cost ?? 0) > 0) { skipped++; continue; }
    if (i.reward_credit !== null || i.reward_voucher_tier !== null) { skipped++; continue; }
    const msrp = Number(i.msrp ?? 0);
    // No retail on file means no basis to move it on. Leave it where it is.
    if (!msrp) { skipped++; continue; }
    const to = tierForRetail(msrp);
    if (to !== i.box_tier) moves.push({ id: i.id, name: i.name, msrp, from: i.box_tier, to });
  }

  console.log('\n=================================================================');
  console.log(' RE-TIER BY RETAIL' + (APPLY ? '' : '   (dry run — pass --fix to apply)'));
  console.log('=================================================================\n');
  console.log('  bands: retail >= $30 -> tier_3, >= $10 -> tier_2, >= $4 -> tier_1, else tier_0');
  console.log('  skipped ' + skipped + ' (reward rows, the shard prize, and anything with no retail)\n');

  if (!moves.length) { console.log('  Every item is already in the right box.\n'); return; }

  console.log('  ' + pad('item', 32) + pad('retail', 9) + pad('est', 8) + 'move');
  for (const m of moves) {
    console.log('  ' + pad(m.name.slice(0, 30), 32) + pad('$' + m.msrp, 9) +
      pad('$' + (items ?? []).find((x) => x.id === m.id)!.est_value, 8) +
      m.from + '  ->  ' + m.to);
  }

  const after: Record<string, number> = {};
  for (const i of items ?? []) {
    if (Number(i.shard_cost ?? 0) > 0) continue;
    const mv = moves.find((m) => m.id === i.id);
    const t = mv ? mv.to : i.box_tier;
    after[t] = (after[t] ?? 0) + 1;
  }
  console.log('\n  rows per box afterwards: ' +
    (['tier_0', 'tier_1', 'tier_2', 'tier_3'] as const).map((t) => t + ' ' + (after[t] ?? 0)).join('   '));

  if (!APPLY) { console.log('\n  ' + moves.length + ' item(s) would move. Nothing was written.\n'); return; }

  const dir = await snapshot('pre-retier');
  console.log('\n  snapshot saved to ' + dir);

  let n = 0;
  for (const m of moves) {
    const { error } = await db.from('items').update({ box_tier: m.to }).eq('id', m.id);
    if (error) console.log('   failed on ' + m.name + ': ' + error.message);
    else n++;
  }
  console.log('  Moved ' + n + ' of ' + moves.length + '.');
  console.log('  Now re-run: npm run rebase-scrap -- --basis=retail --fix\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
