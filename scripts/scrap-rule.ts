/**
 * ONE SCRAP RULE, AND THE ADMIN FORM OBEYS IT.
 *
 *   npm run scrap-rule
 *
 * "What an item scraps for" has been written down independently four times in
 * this codebase, and two of those copies divided by the wrong number -- so every
 * item created or edited through the admin panel was worth a tenth of what the
 * engine thought, and scrapping felt worthless across the whole catalogue. The
 * fix was one shared module; this is what stops a fifth copy appearing.
 *
 * Two guards:
 *   1. lib/scrap.ts still produces the numbers the owner agreed to.
 *   2. Nothing outside it derives a scrap value from a locally written formula.
 *
 * Offline and read-only: no database, no writes.
 */
import { readFileSync } from 'fs';
import { scrapValueCoins, tierForRetail, RETAIL_RATE, CAP_OF_BOX } from '../lib/scrap';
import { DEFAULT_CONFIG, scrapCoinUsd } from '../lib/economy';
import type { BoxTier, EconomyConfig, Rarity } from '../lib/types';

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };

const cfg = {
  ...DEFAULT_CONFIG,
  scrap_key_usd: 10,
  scrap_coins_per_key: 100,
  box_prices: { tier_0: 0.5, tier_1: 3, tier_2: 10, tier_3: 30 },
  allow_high_rarity_scrap: true,
} as EconomyConfig;

const coin = scrapCoinUsd(cfg);
console.log('\n  a coin is worth $' + coin.toFixed(2) +
  '   rule: ' + (RETAIL_RATE * 100).toFixed(0) + '% of retail, capped at ' +
  (CAP_OF_BOX * 100).toFixed(0) + '% of the box price\n');
ok(Math.abs(coin - 0.1) < 1e-9, 'the coin is 10c, so 100 scrap is $10');

const item = (msrp: number, box_tier: BoxTier, rarity: Rarity = 'grey') =>
  ({ est_value: 0.01, msrp, rarity, box_tier });

// The worked examples from the tuning plan, in dollars paid out.
const paid = (msrp: number, t: BoxTier, r: Rarity = 'grey') =>
  scrapValueCoins(item(msrp, t, r), cfg) * coin;

ok(Math.abs(paid(10, 'tier_2') - 5) < 1e-9, 'a $10 retail item in the $10 box pays $5.00 (capped by the box)');
ok(Math.abs(paid(40, 'tier_3') - 15) < 1e-9, 'a $40 retail item in the $30 box pays $15.00 (capped)');
// The cap is 25c, but coins are 10c and the cap is FLOORED, so it pays 20c.
// Rounding to the nearest coin would pay 30c against a 25c cap.
ok(Math.abs(paid(0.5, 'tier_0') - 0.2) < 1e-9, 'a 50c item in the 50c box pays 20c -- the 25c cap, floored to whole coins');
ok(Math.abs(paid(2, 'tier_0') - 0.2) < 1e-9, 'a $2 retail item in the 50c box pays 20c, not 90% of $2');
ok(paid(999999, 'tier_0') <= 0.5 * CAP_OF_BOX + 1e-9, 'the joke retail on Keys?!!???!!?! cannot mint money');

/*
 * FLOOR, not round. A $0.25 cap against a 10c coin rounds 2.5 up to 3 coins =
 * $0.30 -- quietly breaking the very cap it is applying, which is the only
 * thing standing between the compactor and a farm loop.
 */
ok(paid(0.5, 'tier_0') <= 0.5 * CAP_OF_BOX + 1e-9, 'the cap is floored, never rounded past itself');

// Never more than the box it drops from, at any retail, in any tier.
let breach = '';
for (const t of ['tier_0', 'tier_1', 'tier_2', 'tier_3'] as BoxTier[]) {
  for (const m of [0, 0.01, 1, 4, 10, 30, 100, 999999]) {
    const p = scrapValueCoins(item(m, t), cfg) * coin;
    const cap = (cfg.box_prices as Record<string, number>)[t] * CAP_OF_BOX;
    if (p > cap + 1e-9) breach = t + ' at retail $' + m + ' pays $' + p.toFixed(2) + ' over a $' + cap.toFixed(2) + ' cap';
  }
}
ok(!breach, 'no retail in any tier ever beats half its box price' + (breach ? ' -- ' + breach : ''));

// Things that are not objects pay nothing.
ok(scrapValueCoins({ ...item(40, 'tier_3'), shard_cost: 4 }, cfg) === 0, 'a shard-locked prize scraps for nothing');
ok(scrapValueCoins({ ...item(40, 'tier_3'), reward_credit: 5 }, cfg) === 0, 'a house-credit reward scraps for nothing');
ok(scrapValueCoins({ ...item(40, 'tier_3'), reward_voucher_tier: 'tier_1' }, cfg) === 0, 'a voucher scraps for nothing');
ok(scrapValueCoins(item(40, 'tier_3', 'gold'), { ...cfg, allow_high_rarity_scrap: false }) === 0,
  'legendary+ scraps for nothing while allow_high_rarity_scrap is off');
ok(scrapValueCoins({ est_value: 0.01, msrp: null, rarity: 'grey', box_tier: 'tier_0' }, cfg) === 0,
  'an unpriced item scraps for nothing rather than throwing');

// Tier by retail, matching scripts/retier-by-retail.ts.
ok(tierForRetail(30) === 'tier_3' && tierForRetail(29.99) === 'tier_2', 'the $30 line puts an item in High Roller');
ok(tierForRetail(10) === 'tier_2' && tierForRetail(9.99) === 'tier_1', 'the $10 line puts an item in Golden Chest');
ok(tierForRetail(4) === 'tier_1' && tierForRetail(3.99) === 'tier_0', 'the $4 line puts an item in Good Stuff');
ok(tierForRetail(0) === 'tier_0', 'unpriced junk lands in the OG JunkBox');

/*
 * And no second copy of the rule. A scrap value derived from a division by a
 * coin, anywhere but lib/scrap.ts, is the shape of the bug this file exists to
 * prevent -- comments stripped first so documenting the history is not a
 * failure.
 */
const SUSPECTS = [
  'app/api/admin/items/route.ts',
  'app/api/admin/items/[id]/route.ts',
  'scripts/rebase-scrap.ts',
];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const f of SUSPECTS) {
  const code = strip(readFileSync(f, 'utf8'));
  ok(code.includes('scrapValueCoins'), f + ' asks lib/scrap for the answer');
  ok(!/(0\.6|0\.4|0\.9|RETAIL_RATE|CAP_OF_BOX)\s*\)?\s*\/\s*coin/.test(code) &&
     !/scrap_value\s*[:=][^;]*\/\s*coin/.test(code),
     f + ' has no scrap formula of its own');
}

console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'one scrap rule, and every writer of scrap_value obeys it') + '\n');
process.exit(fails ? 1 : 0);
