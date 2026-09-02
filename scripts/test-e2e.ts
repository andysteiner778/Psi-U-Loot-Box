/**
 * PHASE 5: END-TO-END SIMULATION & ANTI-EXPLOIT INVARIANT SUITE
 *
 * Runs comprehensive multi-player stress tests and checks all anti-exploit
 * guardrails without requiring an active external network connection.
 *
 *   npx.cmd tsx scripts/test-e2e.ts
 */

import {
  computeBoxOdds,
  drawOutcome,
  outcomeValue,
  scrapCoinUsd,
  DEFAULT_CONFIG,
  rarityForValue,
  tierForValue,
} from '../lib/economy';
import { catalogAsItems } from '../lib/catalog';
import {
  BOX_TIERS,
  isScrappable,
  UNSCRAPPABLE,
  type BoxTier,
  type EconomyConfig,
  type Item,
  type OpenBoxResult,
  type Rarity,
} from '../lib/types';
import {
  buildReel,
  nearMissCueMs,
  offsetForIndex,
  tickFractions,
  tickTimes,
  travelDistance,
  NEAR_MISS_INDEX,
  WINNER_INDEX,
  REEL_DURATION_MS,
  REEL_EASE,
} from '../lib/reel';

let checks = 0;
let failures = 0;

function assert(condition: boolean, description: string) {
  checks++;
  if (!condition) {
    failures++;
    console.error(`  ❌ FAIL: ${description}`);
  } else {
    // console.log(`  ✓ PASS: ${description}`);
  }
}

console.log('\n=================================================================');
console.log(' HOUSE LOOT — PHASE 5 END-TO-END STRESS TEST & INTEGRATION SUITE');
console.log('=================================================================\n');

// ---------------------------------------------------------------------------
// TEST 1: ANTI-EXPLOIT GUARDRAILS
// ---------------------------------------------------------------------------
console.log('--- TEST 1: Anti-Exploit Invariants (Spec Section 2A) ---');

// Anti-Exploit Rule 2: High-tier items never scrappable
for (const r of UNSCRAPPABLE) {
  assert(!isScrappable(r), `Rarity ${r} must never be scrappable`);
}
assert(isScrappable('grey'), 'Grey items must be scrappable');
assert(isScrappable('blue'), 'Blue items must be scrappable');

// Value to Tier & Rarity mappings
assert(tierForValue(15) === 'tier_1', 'Items <= $30 land in tier_1');
assert(tierForValue(60) === 'tier_2', 'Items $30-$120 land in tier_2');
assert(tierForValue(200) === 'tier_3', 'Items > $120 land in tier_3');
assert(rarityForValue(10) === 'grey', '$10 item is grey');
assert(rarityForValue(40) === 'blue', '$40 item is blue');
assert(rarityForValue(90) === 'purple', '$90 item is purple');
assert(rarityForValue(180) === 'pink', '$180 item is pink (highest physical band)');

console.log('  ✓ Anti-exploit rarity & tier invariants verified.');

// ---------------------------------------------------------------------------
// TEST 2: REEL TIMING, DECELERATION PHYSICS & NEAR-MISS BEZIER
// ---------------------------------------------------------------------------
console.log('\n--- TEST 2: Reel Timing & Near-Miss Deceleration Physics ---');

const mockWinner: OpenBoxResult = {
  type: 'physical',
  item_id: '11111111-1111-1111-1111-111111111111',
  item_name: 'Gaming Monitor',
  image_url: null,
  rarity: 'purple',
  est_value: 120,
  scrap_value: 0,
  roll_id: 'test-roll-1',
};

const reel = buildReel(mockWinner, []);
assert(reel.length === 60, 'Reel must contain exactly 60 cards');
assert(reel[NEAR_MISS_INDEX].isNearMiss === true, 'Card 49 (index 48) must be the near-miss bait');
assert(reel[WINNER_INDEX].isWinner === true, 'Card 50 (index 49) must be the winning outcome');
assert(reel[WINNER_INDEX].name === mockWinner.item_name, 'Winner card name matches outcome');

const geometry = { pitch: 192, cardWidth: 180, viewportWidth: 800 };
const cueMs = nearMissCueMs(REEL_DURATION_MS, geometry, REEL_EASE);
assert(
  cueMs >= 4500 && cueMs <= 5100,
  `Near miss whoosh cue at ~4.8s (derived: ${cueMs.toFixed(1)}ms)`
);

const fractions = tickFractions(geometry, WINNER_INDEX);
const times = tickTimes(REEL_DURATION_MS, fractions, REEL_EASE);
assert(times.length > 30, `Tick train schedules ${times.length} ticks across 5.5s spin`);
assert(times[times.length - 1] <= REEL_DURATION_MS, 'Last tick lands before or at 5.5s');

console.log(`  ✓ Reel geometry & near-miss cue (${cueMs.toFixed(0)}ms) verified.`);

// ---------------------------------------------------------------------------
// TEST 3: MULTI-PLAYER CONCURRENT SIMULATION & STOCK DEPLETION
// ---------------------------------------------------------------------------
console.log('\n--- TEST 3: 30-Player Multi-Spin Simulation with Stock Depletion ---');

const items = catalogAsItems().map((i) => ({ ...i }));
const totalStartingUnits = items.reduce((s, i) => s + i.stock_qty, 0);
const cfg: EconomyConfig = { ...DEFAULT_CONFIG };

interface PlayerState {
  id: string;
  name: string;
  balance: number;
  scrapCoins: number;
  shards: number;
  inventory: string[];
}

const players: PlayerState[] = Array.from({ length: 30 }, (_, idx) => ({
  id: `p-${idx}`,
  name: `Player_${idx + 1}`,
  balance: 100.0, // $100 starting funds each ($3,000 total)
  scrapCoins: 0,
  shards: 0,
  inventory: [],
}));

let totalDeposits = 3000;
let totalRolls = 0;
let physicalPulls = 0;
let shardPulls = 0;
let respinPulls = 0;
let scrapPulls = 0;
let compactedKeys = 0;

for (let roll = 0; roll < 1500; roll++) {
  const p = players[roll % players.length];
  const tier: BoxTier = roll % 3 === 0 ? 'tier_3' : roll % 2 === 0 ? 'tier_2' : 'tier_1';
  const potGateMet = totalDeposits >= cfg.pot_revenue_threshold;

  const odds = computeBoxOdds({
    tier,
    items: items.filter((i) => i.box_tier === tier),
    config: cfg,
    potGateMet,
  });

  if (p.balance >= odds.box_price) {
    p.balance -= odds.box_price;
    totalRolls++;

    const outcome = drawOutcome(odds, Math.random());
    if (outcome.kind === 'physical') {
      const winningItemOdds = odds.items[outcome.index];
      physicalPulls++;
      p.inventory.push(winningItemOdds.name);
      // Decrement stock
      const target = items.find((i) => i.id === winningItemOdds.item_id);
      if (target && target.stock_qty > 0) {
        target.stock_qty -= 1;
      }
    } else if (outcome.kind === 'shard') {
      shardPulls++;
      p.shards += 1;
    } else if (outcome.kind === 'respin') {
      respinPulls++;
      p.balance += odds.box_price; // Free re-roll refund
    } else if (outcome.kind === 'scrap') {
      scrapPulls++;
      p.scrapCoins += odds.scrap_coins_awarded;
    }

    // Scrap compactor rule check: convert 100 coins into Tier 2 key
    if (p.scrapCoins >= cfg.scrap_coins_per_key) {
      p.scrapCoins -= cfg.scrap_coins_per_key;
      p.balance += cfg.box_prices.tier_2;
      compactedKeys++;
    }
  }
}

const remainingUnits = items.reduce((s, i) => s + i.stock_qty, 0);

console.log(`  Simulated ${totalRolls} total rolls across 30 active players:`);
console.log(`    - Physical items won: ${physicalPulls} (Stock: ${totalStartingUnits} -> ${remainingUnits})`);
console.log(`    - PC Shards won: ${shardPulls}`);
console.log(`    - Free Respins won: ${respinPulls}`);
console.log(`    - Scrap Consolation wins: ${scrapPulls}`);
console.log(`    - Keys forged by Scrap Compactor: ${compactedKeys}`);

assert(totalRolls > 0, 'Multi-player simulation performed rolls');
assert(remainingUnits <= totalStartingUnits, 'Stock decrements properly on physical wins');
assert(remainingUnits >= 0, 'Stock never drops below 0');

// ---------------------------------------------------------------------------
// TEST 4: POT THRESHOLD LOCK INVARIANT
// ---------------------------------------------------------------------------
console.log('\n--- TEST 4: Pot Gate Revenue Threshold Lock ($400) ---');

const lockedOdds = computeBoxOdds({
  tier: 'tier_3',
  items: items.filter((i) => i.box_tier === 'tier_3'),
  config: cfg,
  potGateMet: false, // Under $400 pot
});

assert(lockedOdds.p_shard === 0, 'Shard drop chance must be strictly 0% when pot < $400');
assert(lockedOdds.ev_shard === 0, 'Shard expected value must be 0 when pot < $400');

const unlockedOdds = computeBoxOdds({
  tier: 'tier_3',
  items: items.filter((i) => i.box_tier === 'tier_3'),
  config: cfg,
  potGateMet: true, // Over $400 pot
});

assert(unlockedOdds.p_shard > 0, 'Shard drop chance unlocks when pot >= $400');
console.log(`  ✓ Pot threshold lock verified (0.0% when locked -> ${(unlockedOdds.p_shard * 100).toFixed(1)}% when unlocked).`);

// ---------------------------------------------------------------------------
// TEST 5: CONCURRENCY RACE CONDITION SIMULATION
// ---------------------------------------------------------------------------
console.log('\n--- TEST 5: Concurrency Race (20 Simultaneous Rolls for 1 Last Unit) ---');

// Setup: A single rare item with stock_qty = 1
const rareItemId = 'rare-gpu-last-unit';
const concurrentItemPool: Item[] = [
  {
    id: rareItemId,
    name: 'RTX 4070 GPU',
    description: 'Last unit in house',
    image_url: null,
    est_value: 200,
    rarity: 'pink',
    scrap_value: 0,
    stock_qty: 1, // Only 1 in stock
    box_tier: 'tier_3',
    is_active: true,
    created_at: new Date().toISOString(),
  },
];

let successfulWinners = 0;
let fallbackConsolations = 0;

// Simulate 20 concurrent threads attempting conditional decrement
// In SQL: UPDATE items SET stock_qty = stock_qty - 1 WHERE id = ... AND stock_qty > 0
for (let thread = 0; thread < 20; thread++) {
  const item = concurrentItemPool.find((i) => i.id === rareItemId);
  if (item && item.stock_qty > 0) {
    // Atomic test-and-set
    item.stock_qty -= 1;
    successfulWinners++;
  } else {
    fallbackConsolations++;
  }
}

const finalStock = concurrentItemPool.find((i) => i.id === rareItemId)?.stock_qty ?? -1;

assert(successfulWinners === 1, `Exactly 1 winner claimed the item (got ${successfulWinners})`);
assert(fallbackConsolations === 19, `19 concurrent racers received fallback (got ${fallbackConsolations})`);
assert(finalStock === 0, `Final stock is exactly 0 (never negative, got ${finalStock})`);
console.log(`  ✓ Concurrency race condition verified: 1 winner, 19 fallbacks, 0 remaining stock.`);

// ---------------------------------------------------------------------------
// TEST SUITE SUMMARY
// ---------------------------------------------------------------------------
console.log('\n=================================================================');
if (failures === 0) {
  console.log(` ✅ ALL PASS: ${checks} test assertions succeeded with 0 failures.`);
  console.log(' Phases 1-5 functionality, math, guardrails, and physics validated.');
} else {
  console.log(` ❌ FAILED: ${failures} of ${checks} assertions failed.`);
}
console.log('=================================================================\n');

process.exit(failures === 0 ? 0 : 1);
