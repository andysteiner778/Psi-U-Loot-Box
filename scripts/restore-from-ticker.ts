/**
 * REBUILD THE CATALOGUE FROM THE TICKER LOG
 *
 *   npm run restore:ticker            # write recovered-items.json, change nothing
 *   npm run restore:ticker -- --fix   # insert the rows
 *
 * The `items` table was destroyed by a bad DELETE on 2026-09-07 and the project
 * is on the free tier, which has no backups. This recovers what it can from
 * `realtime.messages`: every roll is broadcast to the house ticker, and each
 * broadcast carries the item's NAME, TIER and RARITY. Names that were never
 * rolled are unrecoverable and are simply absent.
 *
 * WHAT IS RECOVERED EXACTLY
 *   name, box_tier, rarity          -- straight from the last broadcast for it
 *
 * WHAT IS NOT INFERRED, DELIBERATELY
 *   est_value  -- rarity looks like it could be inverted back to a value band,
 *                 but the owner sets rarity for COOLNESS, not worth ("it's fine
 *                 to win a $2 exotic from the low tier box"). Inverting it gave
 *                 a $50 Audio adapter and a $100 Beer light, which would have
 *                 silently unbalanced every box.
 *
 *                 So everything comes back at $0.01 unless its NAME states a
 *                 value ($20 Favor, $3 House Credit, 50% OFF a $10 box). A
 *                 catalogue that is too cheap pays out too little and is
 *                 obvious on the odds page; one that is too expensive quietly
 *                 bankrupts the night.
 *
 * WHAT IS LOST
 *   msrp, stock_qty, scrap_value, image_url, and the reward/bonus wiring
 *   (house credit, free spins, discount vouchers, bundled favors). Reward rows
 *   are detected by NAME below and re-wired, because their names encode exactly
 *   what they do. Everything else comes back as a plain object with stock 1.
 *
 * Every row is marked `needs_review` in its description so nothing pretends to
 * be authoritative. Re-price in House Controls, then run:
 *   npm run rebase-scrap -- --fix
 */
import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import type { BoxTier, Rarity } from '../lib/types';

denv({ path: '.env.local', quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--fix');

/**
 * Reward rows encode their behaviour in their name, so they can be rewired
 * exactly rather than guessed at. `$3 House Credit` pays $3; `FREE $10 SPIN`
 * is a 100%-off voucher for whichever tier costs $10; `50% OFF a $30 box` is a
 * half-price voucher for the $30 tier.
 */
function rewardWiring(name: string, prices: Record<string, number>) {
  const tierFor = (dollars: number): BoxTier | null => {
    const hit = (Object.entries(prices) as [BoxTier, number][]).find(
      ([, p]) => Math.abs(p - dollars) < 0.001
    );
    return hit ? hit[0] : null;
  };

  // "$20 Favor — ask Andy" and "$20 Favor — ask Andy (2)" both state their worth.
  let m = /^\$([\d.]+) Favor/i.exec(name);
  if (m) return { est_value: Number(m[1]) };

  m = /^\$([\d.]+) House Credit$/i.exec(name);
  if (m) return { reward_credit: Number(m[1]), est_value: Number(m[1]) };

  m = /^FREE \$([\d.]+) SPIN$/i.exec(name);
  if (m) {
    const t = tierFor(Number(m[1]));
    if (t) return { reward_voucher_tier: t, reward_voucher_pct: 1, est_value: Number(m[1]) };
  }

  m = /^(\d+)% OFF a \$([\d.]+) box$/i.exec(name);
  if (m) {
    const t = tierFor(Number(m[2]));
    if (t) {
      const pct = Number(m[1]) / 100;
      return { reward_voucher_tier: t, reward_voucher_pct: pct, est_value: Number(m[2]) * pct };
    }
  }
  return null;
}

async function main() {
  const { data: cfgRow } = await db.from('config').select('value').eq('key', 'settings').single();
  const prices = (cfgRow!.value as any).box_prices as Record<string, number>;

  const { data: existing } = await db.from('items').select('name');
  const have = new Set((existing ?? []).map((i) => i.name));

  // Latest broadcast per name wins: it reflects the item's final state.
  const { data: msgs, error } = await db.rpc('recover_ticker_items');
  if (error) throw new Error('recover_ticker_items RPC missing: ' + error.message);

  const rows = (msgs as any[]).filter(
    (r) => r.kind === 'physical' && !/^(__|zz-e2e)/.test(r.name)
  );

  const plan = rows.map((r) => {
    const rarity = r.rarity as Rarity;
    const reward = rewardWiring(r.name, prices);
    const est_value = reward?.est_value ?? 0.01;
    return {
      name: r.name,
      box_tier: r.tier as BoxTier,
      // The owner's own rarity choice, kept verbatim. It is set for effect
      // rather than derived from value, so recomputing it here would throw away
      // the one piece of curation the ticker preserved.
      rarity,
      est_value,
      msrp: null as number | null,
      stock_qty: 1,
      initial_stock_qty: 1,
      scrap_value: 0,
      is_active: true,
      description: 'needs_review — recovered from the ticker log; value is a placeholder unless the name states one',
      reward_credit: reward?.reward_credit ?? null,
      reward_voucher_tier: reward?.reward_voucher_tier ?? null,
      reward_voucher_pct: reward?.reward_voucher_pct ?? null,
    };
  });

  const fresh = plan.filter((p) => !have.has(p.name));
  writeFileSync('recovered-items.json', JSON.stringify(plan, null, 2));

  console.log('\n=================================================================');
  console.log(' CATALOGUE RECOVERY' + (APPLY ? '' : '   (dry run — pass --fix to insert)'));
  console.log('=================================================================\n');
  console.log('  recovered from ticker : ' + plan.length + ' item(s)');
  console.log('  already in the table  : ' + (plan.length - fresh.length));
  console.log('  would be inserted     : ' + fresh.length);
  console.log('  written to            : recovered-items.json\n');

  for (const p of fresh) {
    const tag = p.reward_credit ? 'credit' : p.reward_voucher_tier ? 'voucher' : 'object';
    console.log(
      '  ' + p.name.slice(0, 32).padEnd(34) + p.box_tier.padEnd(8) +
      p.rarity.padEnd(8) + ('$' + p.est_value).padEnd(9) + tag
    );
  }

  if (!APPLY) {
    console.log('\n  Nothing was written. Review recovered-items.json first —');
    console.log('  every value is a guess from the rarity band and needs your eye.\n');
    return;
  }

  let n = 0;
  for (const p of fresh) {
    const { error: e } = await db.from('items').insert(p);
    if (e) console.log('   failed on ' + p.name + ': ' + e.message);
    else n++;
  }
  console.log('\n  Inserted ' + n + ' of ' + fresh.length + '.');
  console.log('  Now: re-price in House Controls, then npm run rebase-scrap -- --fix\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
