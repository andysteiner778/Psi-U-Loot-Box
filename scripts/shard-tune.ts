/**
 * SHARD ECONOMY TUNER
 *
 *   npm run shards:tune
 *
 * Answers the only question that matters about the PC: does a real party
 * actually produce a winner, and what does it cost the house?
 *
 * THE STRUCTURAL TRAP
 * The global mint cap is pc_total_supply x shards_required. With 1 PC and 5
 * shards, exactly 5 shards ever exist -- so if they land on five different
 * people, the PC is unwinnable by construction no matter how generous the odds
 * are. Decoupling the mint cap from the completion requirement is what makes
 * the chase work: more shards circulate than any one player needs, and the
 * first to assemble a set claims the machine.
 *
 * A shard's HONEST value is its salvage value (one free Tier-2 roll), because
 * that is what it is guaranteed to be worth. The PC on top of that is a prize
 * the house funds deliberately, not something players are individually charged
 * the full price of.
 */

import { DEFAULT_CONFIG } from '../lib/economy';
import type { BoxTier } from '../lib/types';

const usd = (n: number) => '$' + n.toFixed(0);
const pct = (n: number) => (n * 100).toFixed(1) + '%';

interface Candidate {
  label: string;
  need: number;          // shards to complete a PC
  mintCap: number;       // how many shards may exist in total
  p: Record<BoxTier, number>;
}

const PRICES = DEFAULT_CONFIG.box_prices;
const SALVAGE = PRICES.tier_1;          // a shard is guaranteed to be worth one free tier-2 roll
const PC_REAL = 400;
/** The owner's real estimate: 10-15 people who actually buy, 2-3 boxes each. */
const PLAYERS = 12;                    // what the machine is actually worth

/** Simulate one party. Returns whether anyone completed, and shard spread. */
function party(c: Candidate, boxesEach: number, players = PLAYERS) {
  let minted = 0;
  const held = new Array<number>(players).fill(0);
  let winner = -1;

  // Everyone plays in interleaved rounds rather than one player at a time, so
  // shard scarcity is contested the way it will be on the night.
  // Budget expressed in BOXES, not dollars: the owner's estimate is
  // "2-3 boxes per person", which is a very different thing from a dollar
  // budget when box prices span 10x.
  const quota = Array.from({ length: players }, () =>
    Math.max(1, Math.round(boxesEach * Math.exp((Math.random() - 0.5) * 0.9)))
  );
  const rolled = new Array<number>(players).fill(0);
  const spent = new Array<number>(players).fill(0);
  let active = true;

  while (active) {
    active = false;
    for (let i = 0; i < players; i++) {
      if (winner >= 0 && held[i] < c.need) continue;
      if (rolled[i] >= quota[i]) continue;
      const r = Math.random();
      const tier: BoxTier = r < 0.55 ? 'tier_1' : r < 0.85 ? 'tier_2' : 'tier_3';
      spent[i] += PRICES[tier];
      rolled[i]++;
      active = true;

      if (minted < c.mintCap && Math.random() < c.p[tier]) {
        minted++;
        held[i]++;
        if (held[i] >= c.need && winner < 0) winner = i;
      }
    }
  }

  const totalSpent = spent.reduce((a, b) => a + b, 0);
  const near = held.filter((h) => h >= c.need - 1 && h < c.need).length;
  return { won: winner >= 0, minted, totalSpent, near, maxHeld: Math.max(...held) };
}

function evaluate(c: Candidate, boxesEach: number, trials = 3000) {
  let won = 0, minted = 0, spentTot = 0, near = 0;
  for (let t = 0; t < trials; t++) {
    const r = party(c, boxesEach);
    if (r.won) won++;
    minted += r.minted;
    spentTot += r.totalSpent;
    near += r.near;
  }
  const pWon = won / trials;
  const avgMinted = minted / trials;
  const pot = spentTot / trials;

  // House cost: every minted shard owes a free tier-2 roll if salvaged, plus
  // the machine itself whenever someone completes.
  const shardCost = avgMinted * SALVAGE * (1 - DEFAULT_CONFIG.house_margin);
  const pcCost = pWon * PC_REAL;
  const margin = pot * DEFAULT_CONFIG.house_margin;

  return { pWon, avgMinted, pot, near: near / trials, shardCost, pcCost, margin,
           net: margin - pcCost - shardCost * 0 };
}

const CANDIDATES: Candidate[] = [
  {
    label: 'current (5 need, cap 5)',
    need: 5, mintCap: 5,
    p: { tier_1: 0.0075, tier_2: 0.03, tier_3: 0.10 },
  },
  {
    label: '3 need, cap 12, 2x odds',
    need: 3, mintCap: 12,
    p: { tier_1: 0.015, tier_2: 0.06, tier_3: 0.20 },
  },
  {
    label: '3 need, cap 20, 4x odds',
    need: 3, mintCap: 20,
    p: { tier_1: 0.03, tier_2: 0.12, tier_3: 0.40 },
  },
  {
    label: '3 need, cap 30, 6x odds',
    need: 3, mintCap: 30,
    p: { tier_1: 0.045, tier_2: 0.18, tier_3: 0.55 },
  },
  {
    label: '3 need, cap 40, 8x odds',
    need: 3, mintCap: 40,
    p: { tier_1: 0.06, tier_2: 0.24, tier_3: 0.60 },
  },
  {
    label: '2 need, cap 15, 3x odds',
    need: 2, mintCap: 15,
    p: { tier_1: 0.0225, tier_2: 0.09, tier_3: 0.30 },
  },
  {
    label: '2 need, cap 25, 5x odds',
    need: 2, mintCap: 25,
    p: { tier_1: 0.0375, tier_2: 0.15, tier_3: 0.50 },
  },
];

console.log('\n================================================================');
console.log(' SHARD ECONOMY — DOES ANYONE ACTUALLY WIN THE PC?');
console.log('================================================================');
console.log(' PC is really worth ' + usd(PC_REAL) + '. A shard is guaranteed to be worth');
console.log(' ' + usd(SALVAGE) + ' (one free Tier-1 roll) via salvage.\n');

for (const avg of [2.5, 4, 8]) {
  console.log('--- ' + PLAYERS + ' players x ~' + avg + ' boxes each ---');
  console.log(' config                      P(won)   shards minted   players at need-1   pot            PC cost');
  for (const c of CANDIDATES) {
    const r = evaluate(c, avg);
    console.log(
      ' ' + c.label.padEnd(28) +
      pct(r.pWon).padEnd(9) +
      r.avgMinted.toFixed(1).padEnd(16) +
      r.near.toFixed(2).padEnd(20) +
      usd(r.pot).padEnd(15) +
      usd(r.pcCost)
    );
  }
  console.log('');
}

console.log('================================================================');
console.log(' READING THIS');
console.log('================================================================');
console.log(' "players at need-1" is the tension metric: how many people end the');
console.log(' night one shard short. That is the number that makes people keep');
console.log(' spending, and it is what the current config cannot produce.');
console.log('');
console.log(' "PC cost" is the expected real-dollar cost to the house of giving');
console.log(' the machine away. Compare it to "house margin": if PC cost exceeds');
console.log(' margin, the house is funding the PC out of pocket -- which may be');
console.log(' fine (it is the headline draw) but should be a choice, not a surprise.');
console.log('================================================================\n');
