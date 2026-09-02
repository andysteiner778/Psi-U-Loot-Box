/**
 * WILL ANYONE ACTUALLY WIN THE PC?
 *
 *   npm run shards
 *
 * Shards are soulbound: they cannot be pooled or traded (anti-exploit rule 3).
 * So the PC is not won by "the house" collectively reaching 5 — it is won only
 * if ONE person independently accumulates all 5. With 30 people each spending a
 * modest amount, that is a much harder bar than the per-roll odds suggest, and
 * it is the thing that decides whether the headline prize is real or decorative.
 */

import { computeBoxOdds, DEFAULT_CONFIG } from '../lib/economy';
import { catalogAsItems } from '../lib/catalog';
import type { BoxTier, EconomyConfig } from '../lib/types';

const usd = (n: number) => '$' + n.toFixed(0);
const pct = (n: number) => (n * 100).toFixed(1) + '%';

const items = catalogAsItems();

/** Per-roll shard probability actually delivered by the engine for a tier. */
function shardProb(cfg: EconomyConfig, tier: BoxTier): number {
  const o = computeBoxOdds({
    tier,
    items: items.filter((i) => i.box_tier === tier || i.box_tier === 'tier_1'),
    config: cfg,
    potGateMet: true,
  });
  return o.p_shard;
}

/**
 * Simulate a realistic party: 30 players, each with a spend budget drawn from a
 * spread (a few whales, most casual), each buying a mix of tiers.
 * Returns the fraction of parties in which SOMEONE claims the PC.
 */
function partySim(cfg: EconomyConfig, avgSpend: number, trials = 4000): { claimed: number; maxShards: number } {
  const p: Record<BoxTier, number> = {
    tier_1: shardProb(cfg, 'tier_1'),
    tier_2: shardProb(cfg, 'tier_2'),
    tier_3: shardProb(cfg, 'tier_3'),
  };
  const need = cfg.shards_required;
  const supply = cfg.pc_total_supply * need;

  let claimed = 0;
  let maxSeen = 0;

  for (let t = 0; t < trials; t++) {
    let minted = 0;
    let anyone = false;
    for (let player = 0; player < 30; player++) {
      // Log-normal-ish spread: most people spend near the average, a few 3-4x it.
      const budget = Math.max(5, avgSpend * Math.exp((Math.random() - 0.5) * 1.4));
      let spent = 0;
      let shards = 0;
      while (spent < budget) {
        // Realistic tier mix: people chase the big box but mostly grind cheap ones.
        const r = Math.random();
        const tier: BoxTier = r < 0.55 ? 'tier_1' : r < 0.85 ? 'tier_2' : 'tier_3';
        const price = cfg.box_prices[tier];
        if (spent + price > budget) break;
        spent += price;
        if (minted < supply && shards < need && Math.random() < p[tier]) {
          shards++;
          minted++;
        }
      }
      if (shards > maxSeen) maxSeen = shards;
      if (shards >= need) anyone = true;
    }
    if (anyone) claimed++;
  }
  return { claimed: claimed / trials, maxShards: maxSeen };
}

console.log('\n================================================================');
console.log(' IS THE PC ACTUALLY WINNABLE?');
console.log('================================================================');
console.log(' Shards are soulbound, so ONE player must reach all ' + DEFAULT_CONFIG.shards_required + ' alone.\n');

// ---------------------------------------------------------------------------
console.log('--- Expected solo spend to collect a full set ---');
console.log(' (buying nothing but tier 3, the best shard odds available)\n');
console.log(' shard odds   P(shard)/roll   rolls needed   expected spend');
for (const mult of [1, 2, 3, 4, 6]) {
  const cfg: EconomyConfig = {
    ...DEFAULT_CONFIG,
    shard_probs: {
      tier_1: DEFAULT_CONFIG.shard_probs.tier_1 * mult,
      tier_2: DEFAULT_CONFIG.shard_probs.tier_2 * mult,
      tier_3: Math.min(0.6, DEFAULT_CONFIG.shard_probs.tier_3 * mult),
    },
  };
  const p = shardProb(cfg, 'tier_3');
  const rolls = p > 0 ? cfg.shards_required / p : Infinity;
  console.log(
    ' ' + (mult + 'x current').padEnd(13) + pct(p).padEnd(16) +
    rolls.toFixed(0).padEnd(15) + usd(rolls * cfg.box_prices.tier_3)
  );
}

// ---------------------------------------------------------------------------
console.log('\n--- Chance ANYONE claims it, across a whole 30-person party ---\n');
console.log(' avg spend/person   1x odds   2x      3x      4x      6x');
for (const avg of [25, 40, 60, 100]) {
  const row: string[] = [];
  for (const mult of [1, 2, 3, 4, 6]) {
    const cfg: EconomyConfig = {
      ...DEFAULT_CONFIG,
      shard_probs: {
        tier_1: DEFAULT_CONFIG.shard_probs.tier_1 * mult,
        tier_2: DEFAULT_CONFIG.shard_probs.tier_2 * mult,
        tier_3: Math.min(0.6, DEFAULT_CONFIG.shard_probs.tier_3 * mult),
      },
    };
    row.push(pct(partySim(cfg, avg).claimed).padEnd(8));
  }
  console.log(' ' + (usd(avg) + ' (pot ' + usd(avg * 30) + ')').padEnd(19) + row.join(''));
}

// ---------------------------------------------------------------------------
console.log('\n--- Fewer shards required, at current odds ---\n');
console.log(' shards needed   solo spend (tier 3)   P(anyone claims) @ $40/person');
for (const need of [5, 4, 3, 2]) {
  const cfg: EconomyConfig = { ...DEFAULT_CONFIG, shards_required: need };
  const p = shardProb(cfg, 'tier_3');
  const solo = p > 0 ? (need / p) * cfg.box_prices.tier_3 : Infinity;
  console.log(
    ' ' + String(need).padEnd(16) + usd(solo).padEnd(22) + pct(partySim(cfg, 40).claimed)
  );
}

// ---------------------------------------------------------------------------
console.log('\n================================================================');
console.log(' THE ARITHMETIC THAT DRIVES ALL OF THIS');
console.log('================================================================');
const budget3 = DEFAULT_CONFIG.box_prices.tier_3 * (1 - DEFAULT_CONFIG.house_margin);
const vShard = DEFAULT_CONFIG.pc_value / DEFAULT_CONFIG.shards_required;
console.log(' A tier-3 roll has ' + usd(budget3) + ' of payout budget.');
console.log(' Each shard is worth ' + usd(vShard) + ' (' + usd(DEFAULT_CONFIG.pc_value) +
  ' PC / ' + DEFAULT_CONFIG.shards_required + ').');
console.log('');
console.log(' Expected spend to win the PC = pc_value / (shard EV per dollar spent).');
console.log(' Shard EV per roll = P(shard) x ' + usd(vShard) + '.');
console.log('');
console.log(' So raising the odds does NOT make the PC cheaper in expectation --');
console.log(' it just moves budget from junk/respins into shards. What it changes');
console.log(' is VARIANCE: higher odds means someone actually gets there inside');
console.log(' one party instead of the prize going unclaimed.');
console.log('');
console.log(' The only levers that make the PC genuinely cheaper to reach are');
console.log(' lowering pc_value or lowering shards_required.');
console.log('================================================================\n');
