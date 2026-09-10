/**
 * REBASE SCRAP VALUES
 *
 *   npm run rebase-scrap           # show what would change
 *   npm run rebase-scrap -- --fix  # apply
 *
 * `scrap_value` is stored in COINS and set when an item is created. Edit the
 * item's est_value afterwards -- which happens constantly while the catalogue
 * is being priced -- and the two drift apart: the audit then reports "scraps
 * for 10%, but config promises 40%".
 *
 * This recomputes every scrappable row from its CURRENT value at the configured
 * recovery rate, and never lets a payout exceed what the item is worth (a coin
 * is worth more than a 1c giveaway item, so the floor of one coin would
 * otherwise mint money).
 */
import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { scrapCoinUsd, DEFAULT_CONFIG } from '../lib/economy';
import { scrapValueCoins, RETAIL_RATE, CAP_OF_BOX } from '../lib/scrap';
import type { EconomyConfig, BoxTier, Rarity } from '../lib/types';

denv({ path: '.env.local', quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--fix');
/*
 * --basis=retail prices scrap off `msrp` instead of `est_value`.
 *
 * The owner deliberately prices give-away junk at $0.01, so a scrap payout
 * derived from est_value is worth a cent and scrapping feels pointless. Retail
 * is what a player thinks the thing is worth, so it is the number that makes
 * the compactor feel worth using.
 *
 * It is also the dangerous basis: retail and est_value are decoupled on
 * purpose here (a $0.01 item can carry a $40 retail), so an uncapped retail
 * rate hands out more than the box that produced it cost. Hence CAP_OF_BOX.
 */
const BASIS: 'est' | 'retail' = process.argv.some((a) => a === '--basis=retail') ? 'retail' : 'est';
/*
 * RETAIL_RATE and CAP_OF_BOX now come from lib/scrap, which is also what the
 * admin create and edit forms call. They used to be declared here, and this
 * script was the only place the retail rule existed -- so an item added
 * through the form was priced by a different rule until someone remembered to
 * re-run this. Two copies of one formula is the bug that has already produced
 * a ten-times-wrong coin in this codebase four separate times.
 */
const HIGH = ['purple', 'pink', 'gold'];
const pad = (s: string, n: number) => s.padEnd(n);

async function main() {
  const { data: cfgRow } = await db.from('config').select('value').eq('key', 'settings').single();
  const cfg = cfgRow!.value as Record<string, any>;
  /*
   * scrapCoinUsd is the ONE definition of what a coin is worth. Computing it
   * inline here is how this codebase already produced a 10x error: the admin
   * item route divides the KEY TIER'S BOX PRICE by coins-per-key ($10/50 =
   * $0.20) while the engine, box_odds and the audit divide scrap_key_usd
   * ($1/50 = $0.02). Same name, ten times apart.
   */
  const fullCfg = { ...DEFAULT_CONFIG, ...(cfg as Partial<EconomyConfig>) } as EconomyConfig;
  const coin = scrapCoinUsd(fullCfg);
  const lowRate = Number(cfg.scrap_recovery_frac ?? 0.6);
  const highRate = Number(cfg.scrap_recovery_high ?? 0.4);
  const highOk = cfg.allow_high_rarity_scrap === true;

  const prices = (cfg.box_prices ?? {}) as Record<string, number>;
  const { data: items } = await db
    .from('items')
    .select('id,name,est_value,msrp,box_tier,rarity,scrap_value,shard_cost,reward_credit,reward_voucher_tier')
    .order('est_value', { ascending: false });

  console.log('\n=================================================================');
  console.log(' SCRAP REBASE' + (APPLY ? '' : '   (dry run — pass --fix to apply)'));
  console.log('=================================================================\n');
  console.log('  a coin is worth $' + coin.toFixed(4) +
              '   rates: ' + (lowRate * 100).toFixed(0) + '% common/rare, ' +
              (highRate * 100).toFixed(0) + '% legendary+' + (highOk ? '' : ' (disabled)'));
  console.log('  basis: ' + (BASIS === 'retail'
    ? (RETAIL_RATE + ' coins per $1 retail, capped at ' + (CAP_OF_BOX * 100).toFixed(0) + '% of the box price')
    : 'est_value'));
  console.log('');

  const changes: { id: string; name: string; from: number; to: number; val: number; retail: number; capped: boolean }[] = [];
  for (const i of items ?? []) {
    if (i.shard_cost && Number(i.shard_cost) > 0) continue; // shard prizes are never scrapped
    /*
     * Reward rows -- house credit, free spins, discount vouchers -- are
     * promises, not objects. They pay out as credit or a voucher and never
     * reach an inventory shelf, so there is nothing to recycle. Giving them a
     * scrap value would be inventing a payout the compactor can never make.
     */
    /*
     * Reward rows can never be scrapped: they pay as credit or a voucher and
     * never reach an inventory shelf. Skipping them left stale scrap values on
     * the rows, which the audit then read as a farmable payout. Zero them
     * explicitly instead of looking away.
     */
    if (i.reward_credit !== null || i.reward_voucher_tier !== null) {
      if (i.scrap_value !== 0) {
        changes.push({
          id: i.id, name: i.name, from: i.scrap_value, to: 0,
          val: Number(i.est_value), retail: Number(i.msrp ?? 0), capped: false,
        });
      }
      continue;
    }
    const val = Number(i.est_value);
    const retail = Number(i.msrp ?? 0);
    const isHigh = HIGH.includes(i.rarity);
    let want: number;
    if (isHigh && !highOk) want = 0;
    else if (BASIS === 'retail') {
      // The shared rule, byte for byte the one the admin forms apply.
      want = scrapValueCoins(
        {
          est_value: val,
          msrp: retail,
          rarity: i.rarity as Rarity,
          box_tier: i.box_tier as BoxTier,
          shard_cost: i.shard_cost,
          reward_credit: i.reward_credit,
          reward_voucher_tier: i.reward_voucher_tier as BoxTier | null,
        },
        fullCfg
      );
    } else {
      const rate = isHigh ? highRate : lowRate;
      // Never pay out more than the item is worth, even to honour the 1-coin floor.
      want = Math.min(Math.max(1, Math.round((val * rate) / coin)), Math.floor(val / coin));
    }
    if (want !== i.scrap_value) {
      const boxCap = (prices[i.box_tier] ?? 0) * CAP_OF_BOX;
      changes.push({
        id: i.id, name: i.name, from: i.scrap_value, to: want, val, retail,
        capped: BASIS === 'retail' && retail * RETAIL_RATE > boxCap,
      });
    }
  }

  if (!changes.length) {
    console.log('  Every scrap value already matches its item.\n');
    return;
  }

  console.log('  ' + pad('item', 32) + pad('value', 9) + pad('now', 8) + pad('should be', 11) + 'pays');
  for (const c of changes) {
    console.log('  ' + pad(c.name.slice(0, 30), 32) + pad('$' + c.val.toFixed(2), 9) +
      pad(String(c.from), 8) + pad(String(c.to), 11) +
      '$' + (c.to * coin).toFixed(2) +
      (c.to === 0
        ? '  (too cheap to scrap)'
        : BASIS === 'retail'
          ? '  (' + ((c.to * coin) / Math.max(1e-9, c.retail) * 100).toFixed(0) + '% of retail $' +
            c.retail + (c.capped ? ', CAPPED by the box' : '') + ')'
          : '  (' + ((c.to * coin) / c.val * 100).toFixed(0) + '%)'));
  }

  if (!APPLY) {
    console.log('\n  ' + changes.length + ' item(s) would change. Nothing was written.\n');
    return;
  }

  let n = 0;
  for (const c of changes) {
    const { error } = await db.from('items').update({ scrap_value: c.to }).eq('id', c.id);
    if (error) console.log('   failed on ' + c.name + ': ' + error.message);
    else n++;
  }
  console.log('\n  Rebased ' + n + ' of ' + changes.length + ' item(s).\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
