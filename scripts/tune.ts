/**
 * ECONOMY TUNING — what actually makes this fun?
 *
 *   npm run tune
 *
 * The solvency gate (scripts/simulate.ts) proves the house cannot lose money.
 * This asks the different question: how often does a player feel like they won?
 *
 * The headline metric is P(physical) — the chance a roll produces a real object
 * you can carry to your room. Everything else (respin, scrap coins) is a
 * consolation, and a game that pays consolations 80% of the time is not fun no
 * matter how correct the arithmetic is.
 */

import { computeBoxOdds, DEFAULT_CONFIG } from '../lib/economy';
import { catalogAsItems } from '../lib/catalog';
import { BOX_TIERS, type BoxTier, type EconomyConfig, type Item } from '../lib/types';

const pct = (n: number) => (n * 100).toFixed(1) + '%';
const usd = (n: number) => '$' + n.toFixed(0);

interface Scenario {
  name: string;
  note: string;
  cfg: Partial<EconomyConfig>;
  extraItems?: Item[];
}

const mkItem = (name: string, v: number, tier: BoxTier, qty = 1): Item => ({
  id: 'x-' + name.replace(/\W/g, ''),
  name,
  description: null,
  image_url: null,
  est_value: v,
  rarity: v >= 150 ? 'pink' : v >= 90 ? 'purple' : v >= 25 ? 'blue' : 'grey',
  scrap_value: v >= 90 ? 0 : Math.round(v * 10),
  stock_qty: qty,
  box_tier: tier,
  is_active: true,
  created_at: new Date(0).toISOString(),
});

/** 20 more units of sub-$10 junk — the kind of thing already in the house. */
const moreJunk: Item[] = [
  mkItem('Board Game', 8, 'tier_1', 3),
  mkItem('Posters & Wall Art', 5, 'tier_1', 5),
  mkItem('Bluetooth Speaker (small)', 12, 'tier_1', 2),
  mkItem('Textbook', 9, 'tier_1', 4),
  mkItem('Storage Bins', 6, 'tier_1', 4),
  mkItem('Extension Cords', 4, 'tier_1', 5),
];

const SCENARIOS: Scenario[] = [
  {
    name: 'A. As specified',
    note: '$600 PC as a single 5-shard prize, 20% house margin',
    cfg: {},
  },
  {
    name: 'B. Split the PC',
    note: 'your idea: $200 GPU becomes a real tier-3 item, $400 PC stays the shard prize',
    cfg: { pc_value: 400 },
    extraItems: [mkItem('Graphics Card', 200, 'tier_3')],
  },
  {
    name: 'C. Split + 5% margin',
    note: 'this is a liquidation, not a casino — the house does not need 20%',
    cfg: { pc_value: 400, house_margin: 0.05 },
    extraItems: [mkItem('Graphics Card', 200, 'tier_3')],
  },
  {
    name: 'D. C + softer shards',
    note: 'shard odds halved, so the PC stops eating the whole payout budget',
    cfg: {
      pc_value: 400,
      house_margin: 0.05,
      shard_probs: { tier_1: 0.0075, tier_2: 0.03, tier_3: 0.1 },
    },
    extraItems: [mkItem('Graphics Card', 200, 'tier_3')],
  },
  {
    name: 'E. D + more junk scanned',
    note: '23 more units of sub-$12 stuff — tests whether volume helps',
    cfg: {
      pc_value: 400,
      house_margin: 0.05,
      shard_probs: { tier_1: 0.0075, tier_2: 0.03, tier_3: 0.1 },
    },
    extraItems: [mkItem('Graphics Card', 200, 'tier_3'), ...moreJunk],
  },
  {
    name: 'F. E + raise the per-item cap',
    note: 'max_item_prob 0.10 -> 0.30. With only 4 items, a 10% cap ceilings tier 2 at 40%',
    cfg: {
      pc_value: 400,
      house_margin: 0.05,
      shard_probs: { tier_1: 0.0075, tier_2: 0.03, tier_3: 0.1 },
      max_item_prob: 0.3,
    },
    extraItems: [mkItem('Graphics Card', 200, 'tier_3'), ...moreJunk],
  },
];

console.log('\n================================================================');
console.log(' WHAT MAKES A ROLL FEEL LIKE A WIN');
console.log('================================================================');
console.log(' P(item) = chance of a real physical object.');
console.log(' Everything else is a consolation. Higher is more fun.\n');

for (const s of SCENARIOS) {
  const cfg: EconomyConfig = { ...DEFAULT_CONFIG, ...s.cfg };
  const items = [...catalogAsItems(), ...(s.extraItems ?? [])];

  console.log('----------------------------------------------------------------');
  console.log(' ' + s.name);
  console.log('   ' + s.note);
  console.log('   tier    P(item)   P(shard)  P(respin) P(scrap)  shard eats');

  for (const tier of BOX_TIERS) {
    const pool = items.filter(
      (i) => i.box_tier === tier || (tier !== 'tier_1' && i.box_tier === 'tier_1' && i.est_value <= 15)
    );
    const o = computeBoxOdds({ tier, items: pool, config: cfg, potGateMet: true });
    const budget = o.box_price * (1 - cfg.house_margin);
    const eats = budget > 0 ? o.ev_shard / budget : 0;
    console.log(
      '   ' + tier.padEnd(8) +
      pct(o.p_physical).padEnd(10) + pct(o.p_shard).padEnd(10) +
      pct(o.p_respin).padEnd(10) + pct(o.p_scrap).padEnd(10) +
      pct(eats)
    );
  }

  const total = items.reduce((a, i) => a + i.est_value * i.stock_qty, 0) + cfg.pc_value;
  console.log(
    '   goods in play ' + usd(total) +
    '  |  deposits needed to clear it ' + usd(total / (1 - cfg.house_margin)) +
    '  (' + usd(total / (1 - cfg.house_margin) / 30) + '/person)'
  );
  console.log('');
}

console.log('================================================================');
console.log(' WHY THE SCRAP RATE IS STUBBORN');
console.log('================================================================');
const t1 = catalogAsItems().filter((i) => i.box_tier === 'tier_1');
const t1value = t1.reduce((a, i) => a + i.est_value * i.stock_qty, 0);
console.log(' Tier 1 holds ' + usd(t1value) + ' of goods across ' +
  t1.reduce((a, i) => a + i.stock_qty, 0) + ' units.');
console.log(' Each $5 roll owes the player ' + usd(5 * 0.8) + ' of value.');
console.log(' So the entire tier-1 catalog is exhausted after ~' +
  Math.round(t1value / 4) + ' rolls.');
console.log('');
console.log(' Past that point there is physically nothing left to give, so the');
console.log(' engine MUST pay consolations. That is arithmetic, not a bug: a high');
console.log(' scrap rate means money is flowing through faster than goods exist.');
console.log('');
console.log(' Three real fixes, in order of effect:');
console.log('   1. Scan more items. 23 extra junk units moves P(item) more than');
console.log('      any config change (compare D to E above).');
console.log('   2. Split the PC. A $200 GPU as a winnable tier-3 item is worth');
console.log('      more excitement than the same $200 buried in shard EV.');
console.log('   3. Drop the margin to ~5%. You are liquidating a house, not');
console.log('      running a casino, and 20% is $1 of every $5 kept back.');
console.log('');
console.log(' And make the common outcome a real object, not abstract coins.');
console.log(' In CS:GO the usual result is a cheap skin, not "nothing" — winning');
console.log(' a $4 cable bundle reads as a win; "+5 scrap coins" reads as a loss.');
console.log('================================================================\n');
