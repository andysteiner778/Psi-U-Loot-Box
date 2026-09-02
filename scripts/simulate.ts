/**
 * SOLVENCY GATE
 *
 * Runs entirely offline against lib/economy.ts — no database, no network.
 * If this fails, the SQL is wrong too, because the RPC mirrors this engine.
 *
 *   npm run simulate
 *
 * Asserts, for every tier and at every stock level down to empty:
 *   1. Probabilities sum to exactly 1.0
 *   2. No probability is negative
 *   3. Expected payout never exceeds C x (1 - house_margin)
 *   4. Every in-stock item remains reachable (the spec's ORDER BY bug)
 *   5. Monte-Carlo realized payout matches analytic EV
 */

import { computeBoxOdds, drawOutcome, outcomeValue, scrapCoinUsd, DEFAULT_CONFIG } from '../lib/economy';
import { catalogAsItems } from '../lib/catalog';
import { BOX_TIERS, type BoxTier, type EconomyConfig, type Item } from '../lib/types';

const EPS = 1e-9;
const ROLLS = 100_000;

let failures = 0;
let checks = 0;

function assert(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error('  FAIL  ' + msg);
  }
}

const usd = (n: number) => '$' + n.toFixed(2);
const pct = (n: number) => (n * 100).toFixed(2) + '%';

// ---------------------------------------------------------------------------
// The spec's formula, implemented literally, for the before/after comparison.
// ---------------------------------------------------------------------------
function specFormula(tier: BoxTier, items: Item[], cfg: EconomyConfig, potGate: boolean) {
  const C = cfg.box_prices[tier];
  const target = C * (1 - cfg.house_margin);
  const pool = items.filter((i) => i.box_tier === tier && i.is_active && i.stock_qty > 0);
  const pShard = potGate ? cfg.shard_probs[tier] : 0;
  const vShard = cfg.pc_value / cfg.shards_required;
  const P = pool.map((i) => Math.min(cfg.max_item_prob, (C * cfg.ev_weight_factor) / i.est_value));
  const sumP = P.reduce((a, b) => a + b, 0);
  const evPhys = P.reduce((a, p, k) => a + p * pool[k].est_value, 0);
  const pRespin = Math.max(0, (target - evPhys) / C);
  const pScrap = 1 - (sumP + pRespin + pShard);
  // The spec calls the floor anchor $0, but 15 coins is real money.
  const vScrap = 15 * scrapCoinUsd(cfg);
  const payout = evPhys + pRespin * C + pShard * vShard + Math.max(0, pScrap) * vScrap;
  return { C, target, sumP, payout, pRespin, pScrap, pShard, nItems: pool.length };
}

// ---------------------------------------------------------------------------
console.log('\n=================================================================');
console.log(' HOUSE LOOT - ECONOMY SOLVENCY REPORT');
console.log('=================================================================');

const cfg = { ...DEFAULT_CONFIG };
const allItems = catalogAsItems();

console.log('\nConfig: margin ' + pct(cfg.house_margin) + ' | PC ' + usd(cfg.pc_value) + ' / ' + cfg.shards_required +
  ' shards = ' + usd(cfg.pc_value / cfg.shards_required) + ' per shard | scrap coin = ' + usd(scrapCoinUsd(cfg)));

// ---------------------------------------------------------------------------
console.log('\n-----------------------------------------------------------------');
console.log(' 1. SPEC SECTION 2B, AS WRITTEN  (pot gate open, full stock)');
console.log('-----------------------------------------------------------------');
console.log(' tier    price   budget   items   sumP     payout    result');
for (const tier of BOX_TIERS) {
  const s = specFormula(tier, allItems, cfg, true);
  const ratio = s.payout / s.C;
  const verdict = s.payout > s.C ? 'HOUSE LOSES ' + usd(s.payout - s.C) + '/roll' : 'ok';
  console.log(
    ' ' + tier.padEnd(8) + usd(s.C).padEnd(8) + usd(s.target).padEnd(9) +
    String(s.nItems).padEnd(8) + s.sumP.toFixed(3).padEnd(9) +
    (usd(s.payout) + ' (' + (ratio * 100).toFixed(0) + '%)').padEnd(10) + '  ' + verdict
  );
}

// ---------------------------------------------------------------------------
console.log('\n-----------------------------------------------------------------');
console.log(' 2. CORRECTED ENGINE  (pot gate open, full stock)');
console.log('-----------------------------------------------------------------');
console.log(' tier    price   budget   payout   margin   P(item) P(shard) P(spin) P(scrap) scale');
for (const tier of BOX_TIERS) {
  const o = computeBoxOdds({
    tier,
    items: allItems.filter((i) => i.box_tier === tier || (tier !== 'tier_1' && i.box_tier === 'tier_1' && i.est_value <= 15)),
    config: cfg,
    potGateMet: true,
  });
  console.log(
    ' ' + tier.padEnd(8) + usd(o.box_price).padEnd(8) + usd(o.target_ev).padEnd(9) +
    usd(o.total_ev).padEnd(9) + pct(o.realized_margin).padEnd(9) +
    pct(o.p_physical).padEnd(8) + pct(o.p_shard).padEnd(9) +
    pct(o.p_respin).padEnd(8) + pct(o.p_scrap).padEnd(9) + o.scale_factor.toFixed(3)
  );
  for (const w of o.warnings) console.log('          note: ' + w);
}

// ---------------------------------------------------------------------------
console.log('\n-----------------------------------------------------------------');
console.log(' 3. INVARIANTS AT EVERY STOCK LEVEL (full -> empty, gate open+shut)');
console.log('-----------------------------------------------------------------');

for (const tier of BOX_TIERS) {
  for (const potGateMet of [false, true]) {
    let pool = allItems
      .filter((i) => i.box_tier === tier || (tier !== 'tier_1' && i.box_tier === 'tier_1' && i.est_value <= 15))
      .map((i) => ({ ...i }));
    // Deplete one unit at a time until the tier is empty.
    for (let step = 0; ; step++) {
      const o = computeBoxOdds({ tier, items: pool, config: cfg, potGateMet });
      const label = tier + ' gate=' + (potGateMet ? 'open' : 'shut') + ' step=' + step;

      const sum = o.p_physical + o.p_shard + o.p_respin + o.p_scrap;
      assert(Math.abs(sum - 1) < EPS, label + ': probabilities sum to ' + sum.toFixed(12) + ', not 1.0');
      assert(o.p_respin >= -EPS && o.p_scrap >= -EPS && o.p_physical >= -EPS, label + ': negative probability');
      assert(o.total_ev <= o.target_ev + 1e-6,
        label + ': payout ' + usd(o.total_ev) + ' exceeds budget ' + usd(o.target_ev));

      // The gate above only catches the house LOSING money. It never caught the
      // house OVERCHARGING, which is the more insidious failure: nothing errors,
      // the game just quietly fleeces everyone. At full stock the engine has
      // every item available and no excuse for leaving budget unspent, so the
      // realized margin must land near house_margin from BOTH sides.
      //
      // (Only at step 0. Once stock depletes there is genuinely nothing left to
      // give, and underspending is unavoidable rather than a bug.)
      if (step === 0) {
        assert(
          o.realized_margin <= cfg.house_margin + 0.05,
          label + ': realized margin ' + pct(o.realized_margin) + ' far exceeds the intended ' +
            pct(cfg.house_margin) + ' — players are being overcharged. Payout ' +
            usd(o.total_ev) + ' against a ' + usd(o.target_ev) + ' budget leaves ' +
            usd(o.target_ev - o.total_ev) + ' unspent per roll.'
        );
      }
      for (const it of o.items) {
        assert(it.probability > 0, label + ': item "' + it.name + '" is unreachable (P=0) despite being in stock');
      }

      const live = pool.filter((i) => i.stock_qty > 0);
      if (live.length === 0) break;
      live[step % live.length].stock_qty -= 1;
    }
  }
}
console.log(' checked ' + checks + ' invariants across all tiers, stock levels, and gate states');

// ---------------------------------------------------------------------------
console.log('\n-----------------------------------------------------------------');
console.log(' 4. MONTE CARLO  (' + ROLLS.toLocaleString() + ' rolls/tier, stock replenished)');
console.log('-----------------------------------------------------------------');
console.log(' tier    in         out        realized   analytic   delta');

for (const tier of BOX_TIERS) {
  const pool = allItems.filter(
    (i) => i.box_tier === tier || (tier !== 'tier_1' && i.box_tier === 'tier_1' && i.est_value <= 15)
  );
  const odds = computeBoxOdds({ tier, items: pool, config: cfg, potGateMet: true });
  let paidIn = 0;
  let paidOut = 0;
  for (let n = 0; n < ROLLS; n++) {
    paidIn += odds.box_price;
    const o = drawOutcome(odds, Math.random());
    paidOut += outcomeValue(odds, o, cfg);
  }
  const realized = 1 - paidOut / paidIn;
  const delta = realized - odds.realized_margin;
  assert(Math.abs(delta) < 0.02, tier + ': realized margin ' + pct(realized) + ' drifts from analytic ' + pct(odds.realized_margin));
  console.log(
    ' ' + tier.padEnd(8) + usd(paidIn).padEnd(13) + usd(paidOut).padEnd(13) +
    pct(realized).padEnd(11) + pct(odds.realized_margin).padEnd(11) + (delta >= 0 ? '+' : '') + pct(delta)
  );
}

// ---------------------------------------------------------------------------
console.log('\n-----------------------------------------------------------------');
console.log(' 5. HOUSE MARGIN SWEEP  (what the party actually feels like)');
console.log('-----------------------------------------------------------------');
console.log(' margin   t1 scrap%  t2 scrap%  t3 scrap%   <- lower margin = fewer dud rolls');
for (const m of [0.3, 0.2, 0.15, 0.1, 0.05, 0.0]) {
  const c = { ...cfg, house_margin: m };
  const row = BOX_TIERS.map((t) => {
    const o = computeBoxOdds({ tier: t, items: allItems.filter((i) => i.box_tier === t), config: c, potGateMet: true });
    return pct(o.p_scrap).padEnd(11);
  });
  console.log(' ' + pct(m).padEnd(9) + row.join(''));
}

// ---------------------------------------------------------------------------
console.log('\n-----------------------------------------------------------------');
console.log(' 6. PC SHARD CALIBRATION  (the dominant lever on how this feels)');
console.log('-----------------------------------------------------------------');
console.log(' A shard is worth ' + usd(cfg.pc_value / cfg.shards_required) + '. At the spec odds it eats this much');
console.log(' of each tier\'s payout budget, leaving that much less for real item drops:');
console.log('');
console.log(' shard odds        t1        t2        t3     | P(item) t1/t2/t3   P(scrap) t1/t2/t3');
for (const mult of [1, 0.75, 0.5, 0.25, 0.1]) {
  const c = { ...cfg, shard_probs: {
    tier_1: cfg.shard_probs.tier_1 * mult,
    tier_2: cfg.shard_probs.tier_2 * mult,
    tier_3: cfg.shard_probs.tier_3 * mult,
  } };
  const eaten = BOX_TIERS.map((t) => {
    const budget = c.box_prices[t] * (1 - c.house_margin);
    return ((c.shard_probs[t] * (c.pc_value / c.shards_required)) / budget * 100).toFixed(0) + '%';
  });
  const odds = BOX_TIERS.map((t) =>
    computeBoxOdds({ tier: t, items: allItems.filter((i) => i.box_tier === t), config: c, potGateMet: true })
  );
  const label = mult === 1 ? 'spec (1.5/6/20%)' : (mult * 100).toFixed(0) + '% of spec';
  console.log(
    ' ' + label.padEnd(18) + eaten.map((e) => e.padEnd(10)).join('') + '| ' +
    odds.map((o) => pct(o.p_physical)).join(' / ').padEnd(22) + '  ' +
    odds.map((o) => pct(o.p_scrap)).join(' / ')
  );
}
console.log('');
console.log(' Every shard the house mints is real money out the door, so this is a');
console.log(' genuine tradeoff, not a bug. Tune shard_probs and house_margin live from');
console.log(' the admin dashboard once you see how fast the pot is actually filling.');

// ---------------------------------------------------------------------------
console.log('\n=================================================================');
if (failures === 0) {
  console.log(' PASS - ' + checks + ' assertions, 0 failures. Economy is solvent.');
} else {
  console.log(' FAIL - ' + failures + ' of ' + checks + ' assertions failed.');
}
console.log('=================================================================\n');
process.exit(failures === 0 ? 0 : 1);
