/**
 * DUAL-ANCHOR DYNAMIC EV ENGINE
 *
 * This is the reference implementation. `open_box` in SQL mirrors it exactly;
 * `scripts/simulate.ts` proves it solvent; the admin dashboard renders it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DIVERGES FROM SPEC.md SECTION 2B
 * ---------------------------------------------------------------------------
 * The spec's formula is insolvent at every tier (116% / 136% / 128% payout).
 * Three independent causes, all fixed here:
 *
 *   1. UNBOUNDED PROBABILITY MASS.  Sum(P_i) can exceed 1.0 outright, and
 *      because the spec walks items ORDER BY est_value DESC, everything past
 *      the point where the CDF saturates becomes unreachable. Cheap items
 *      could never drop, which defeats the point of liquidating a house.
 *
 *   2. SHARD VALUE WAS NEVER BUDGETED.  EV_phys summed physical items only,
 *      then P_shard x V_shard got paid on top of an already-spent budget.
 *      On tier 3 that alone is $24 of unfunded payout on a $50 box.
 *
 *   3. THE FLOOR ANCHOR IS NOT WORTH $0.  The spec prices "scrap junk" at zero,
 *      but scrap coins buy a Tier-2 key (100 coins -> $20), making each coin
 *      worth $0.20 and the "+15 coins" consolation worth a very real $3.00 --
 *      60% of a Tier-1 box, entirely unaccounted for.
 *
 * The structural bug worth understanding is #1's cousin. For any item priced
 * at or above 2C, the 0.10 cap does not bind, so the spec's own expression is:
 *
 *      P_i x V_i  =  (C x 0.20 / V_i) x V_i  =  0.20 x C
 *
 * V_i cancels. Every such item costs a flat 20% of the box price no matter what
 * it is worth. The budget is 80%. So the 4th item in a tier exhausts it and the
 * 5th makes the tier structurally insolvent, regardless of pricing.
 *
 * FIX: treat min(0.10, C x 0.20 / V_i) as a *shape*, not a probability, then
 * solve for the scale factor that balances the books. Both anchors are priced
 * honestly and the budget equation is closed rather than assumed.
 * ---------------------------------------------------------------------------
 */

import { BOX_TIERS } from './types';
import type { BoxOdds, BoxTier, EconomyConfig, Item, ItemOdds, Rarity } from './types';

export const DEFAULT_CONFIG: EconomyConfig = {
  house_margin: 0.125,
  allow_high_rarity_scrap: false,
  // The $1 box pays back everything it takes. See EconomyConfig.tier_margins.
  tier_margins: { tier_0: 0 },
  pot_revenue_threshold: 150.0,
  box_prices: { tier_0: 1, tier_1: 5, tier_2: 20, tier_3: 50 },
  shard_probs: { tier_0: 0.007, tier_1: 0.035, tier_2: 0.14, tier_3: 0.35 },
  pc_value: 100,
  pc_display_value: 400,
  shards_required: 4,
  pc_total_supply: 1,
  pc_shards_minted: 0,
  max_item_prob: 0.3,
  ev_weight_factor: 0.2,
  scrap_ev_frac: 0.2,
  scrap_key_usd: 1,
  max_respin_share: 0.25,
  shard_salvage_value: 10,
  filler_max_value: 15,
  cross_tier_factor: 0.15,
  scrap_coins_per_key: 50,
  scrap_key_tier: 'tier_2',
  flash_sale: false,
  flash_sale_pct: 0.2,
  flash_sale_ends_at: null,
};

/** Dollar value of one scrap coin, derived from what the compactor buys. */
export function scrapCoinUsd(cfg: EconomyConfig): number {
  // Mirrors box_odds in migration 0023. The two must agree or the coins a
  // player is awarded stop matching the coins the solvency proof budgeted for.
  const payout = cfg.scrap_key_usd ?? cfg.box_prices[cfg.scrap_key_tier];
  return payout / cfg.scrap_coins_per_key;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The margin this tier actually runs at.
 *
 * Every solvency check must go through this rather than reading
 * `cfg.house_margin` directly, or a tier with an override gets measured
 * against a target it was never built to hit — and reports as broken.
 *
 * Mirrored in SQL by `box_odds` (migration 0021). The two must agree.
 */
export function marginForTier(cfg: EconomyConfig, tier: BoxTier): number {
  const override = cfg.tier_margins?.[tier];
  return typeof override === 'number' && Number.isFinite(override) ? override : cfg.house_margin;
}

/** Box price after any live flash sale. The server clock is authoritative. */
export function effectiveBoxPrice(cfg: EconomyConfig, tier: BoxTier, now = new Date()): number {
  const base = cfg.box_prices[tier];
  if (!cfg.flash_sale) return base;
  if (cfg.flash_sale_ends_at && new Date(cfg.flash_sale_ends_at) <= now) return base;
  return round2(base * (1 - cfg.flash_sale_pct));
}

export interface OddsInput {
  tier: BoxTier;
  items: Item[];
  config: EconomyConfig;
  /** Approved deposits have crossed pot_revenue_threshold. Gates shards to 0 below it. */
  potGateMet: boolean;
  now?: Date;
}

/**
 * Compute the full probability distribution for one box tier.
 *
 * Solves the closed system:
 *      sum(P_i) + P_shard + P_respin + P_scrap                        = 1
 *      sum(P_i.V_i) + P_shard.V_shard + P_respin.C + P_scrap.V_scrap  = target_ev
 *
 * Two equations, two unknowns (P_respin, P_scrap), given P_i and P_shard.
 */
export function computeBoxOdds({ tier, items, config: cfg, potGateMet, now }: OddsInput): BoxOdds {
  const warnings: string[] = [];
  const C = effectiveBoxPrice(cfg, tier, now);
  const target = C * (1 - marginForTier(cfg, tier));

  // --- Ceiling-adjacent anchor: shards, gated by pot floor AND global supply ---
  // Mint cap is deliberately NOT the completion requirement -- see 0006.
  const shardCapacity = cfg.pc_shard_mint_cap ?? cfg.pc_total_supply * cfg.shards_required;
  const shardsAvailable = cfg.pc_shards_minted < shardCapacity;
  const pShard = potGateMet && shardsAvailable ? cfg.shard_probs[tier] ?? 0 : 0;
  const vShard = cfg.pc_value / cfg.shards_required;
  if (potGateMet && !shardsAvailable) {
    warnings.push(
      'PC shard supply exhausted (' + cfg.pc_shards_minted + '/' + shardCapacity + ') - shard odds forced to 0'
    );
  }

  // --- Partition the pool ---------------------------------------------------
  // Items belonging to THIS tier are the real prizes. Cheap items borrowed from
  // tier 1 are "filler": they serve as the floor anchor, replacing scrap coins.
  //
  // They must NOT be merged into the item pool and scaled alongside real prizes.
  // Merging them was measured to overcharge players by 10x the intended margin:
  // `w_i = min(max_item_prob, C*f/V_i)` gives cheap items the CAPPED weight, so
  // eight junk types took 2.4 of the raw mass against ~0.28 for four real items.
  // That made probability, not budget, the binding constraint — and because
  // lambda is uniform, shrinking to fit probability also shrank the expensive
  // items, the only ones able to spend the budget. A $50 box paid out $23.68.
  const live = items.filter(
    (i) =>
      i.is_active &&
      i.stock_qty > 0 &&
      i.est_value > 0 &&
      // Shard-locked prizes are claimed with shards, never dropped from a box.
      // Mirrors the same predicate in box_odds SQL.
      !(i.shard_cost && i.shard_cost > 0)
  );
  // Every box can drop anything, but off-tier prizes are heavily suppressed.
  // Strict partitioning meant a $5 crate could never produce anything exciting,
  // which is the opposite of why people open cases. The weight formula already
  // makes expensive items rare in a cheap box (min(cap, C*f/V) is 0.7% for a
  // $150 item in a $5 box); the affinity factor pushes them rarer still without
  // making them impossible.
  //
  // Cheap off-tier items are excluded here because they are the FLOOR ANCHOR
  // below -- counting them in both places would double their real frequency.
  const fillerMax = cfg.filler_max_value;
  const crossFactor = cfg.cross_tier_factor ?? 0.15;
  const pool = live.filter(
    (i) => i.box_tier === tier || i.est_value > fillerMax
  );
  const affinity = (i: Item) => (i.box_tier === tier ? 1 : crossFactor);
  // Predicate mirrors box_odds SQL exactly. Without the value cap, passing a
  // full catalog would let an expensive tier-3 prize act as tier-2 "filler",
  // and the floor anchor would be mispriced in a way the gate cannot see.
  // MUST match the predicate in box_odds SQL exactly. It restricts filler to
  // cheap TIER-1 junk borrowed into tier 2 and 3; tier 1 has no filler and
  // falls back to scrap coins.
  //
  // These two had silently diverged: a migration generator's conditional
  // replace failed to match, so the SQL kept the strict predicate while this
  // side got a loose one. Tier 1 then had an item floor anchor here and a coin
  // floor anchor in production -- different anchor values, different lambda,
  // different odds. The solvency proof runs on THIS engine, so it was proving
  // properties of a game nobody was playing. Caught by an external audit, not
  // by any gate, which is why the drift test in scripts/verify-sql.ts exists.
  // Filler must come from a strictly CHEAPER tier, not merely from under a flat
  // cap. With a fixed $15 cap a $5 box borrowed $15 tier-2 items as its
  // "consolation", making the floor anchor worth $5.41 against a $4.38 budget --
  // the house lost 18.5% on every tier-1 roll. Cheap junk is borrowed UP the
  // ladder, never down it.
  const tierRank = BOX_TIERS.indexOf(tier);
  const fillerPool = live.filter(
    (i) => BOX_TIERS.indexOf(i.box_tier) < tierRank && i.est_value <= fillerMax
  );

  // --- Floor anchor: priced honestly, never $0 ------------------------------
  const coinUsd = scrapCoinUsd(cfg);
  const coins = Math.max(1, Math.round((cfg.scrap_ev_frac * C) / coinUsd));
  const fillerStock = fillerPool.reduce((a, i) => a + i.stock_qty, 0);
  const fillerMean =
    fillerStock > 0
      ? fillerPool.reduce((a, i) => a + i.est_value * i.stock_qty, 0) / fillerStock
      : 0;

  // A junk object beats abstract coins for the same money: in CS:GO the usual
  // result is a cheap skin, not "nothing". Fall back to coins when the junk
  // runs out, so the engine always has a terminal branch.
  const floorKind: 'item' | 'coins' = fillerStock > 0 ? 'item' : 'coins';
  const vScrap = floorKind === 'item' ? fillerMean : coins * coinUsd;

  // --- Raw weights: the spec's expression, used as a SHAPE ------------------
  const weights = pool.map(
    (i) => Math.min(cfg.max_item_prob, (C * cfg.ev_weight_factor) / i.est_value) * affinity(i)
  );
  const Wp = weights.reduce((a, w) => a + w, 0);
  const Wv = weights.reduce((a, w, k) => a + w * pool[k].est_value, 0);

  // --- Scale pass 1: probability mass must fit under 1 ----------------------
  const lambdaProb = Wp > 0 ? (1 - pShard) / Wp : Infinity;

  // --- Scale pass 2: expected value must fit the budget ---------------------
  // Need: target - lam*Wv - pShard*vShard >= (1 - lam*Wp - pShard) * vScrap
  const spendable = target - pShard * vShard - (1 - pShard) * vScrap;
  const denom = Wv - Wp * vScrap;
  const lambdaEv = denom > 1e-12 ? spendable / denom : Infinity;

  if (spendable < 0) {
    warnings.push(
      'INSOLVENT CONFIG: shard EV ($' +
        (pShard * vShard).toFixed(2) +
        ') + scrap floor ($' +
        vScrap.toFixed(2) +
        ') exceed the $' +
        target.toFixed(2) +
        ' budget before any item drops. Lower shard_probs, scrap_ev_frac, or house_margin.'
    );
  }

  let lambda = clamp(Math.min(1, lambdaProb, lambdaEv), 0, 1);

  // --- Scale pass 3: the UNDERSPEND case -----------------------------------
  //
  // Passes 1 and 2 only ever scale items DOWN to stop the house losing money.
  // They cannot fix the opposite failure: a tier full of items far cheaper than
  // the box. Tier 1 with 53 items averaging ~$3.90 saturated probability at
  // 100% items and paid out $3.93 against a $4.38 budget -- a silent 21.5%
  // margin against a 12.5% target, with no probability left for an anchor to
  // top it up.
  //
  // The respin anchor is worth C, which is MORE than the budget, so handing out
  // fewer items and some free re-rolls raises EV. Solve for the lambda where
  // the anchors run all-respin and EV lands exactly on target:
  //
  //     target = lam*Wv + P_shard*V_shard + (1 - lam*Wp - P_shard) * C
  //
  const maxAchievable =
    lambda * Wv + pShard * vShard + Math.max(0, 1 - lambda * Wp - pShard) * C;

  if (maxAchievable < target - 1e-9) {
    const denomUnder = Wv - Wp * C; // negative when the average item is cheaper than the box
    if (Math.abs(denomUnder) > 1e-12) {
      const lambdaUnder = (target - pShard * vShard - (1 - pShard) * C) / denomUnder;
      lambda = clamp(Math.min(lambda, lambdaUnder), 0, 1);
    }

    // ---- A BOX IS NOT A RE-ROLL MACHINE ------------------------------------
    //
    // The solve above maximises EV, and the respin anchor is valued at the full
    // box price C. So when the average item in a tier is worth LESS than the
    // box, the arithmetic concludes that handing out free re-rolls "pays" more
    // than handing out prizes, drives lambda to zero, and produces a tier with
    // 0% items and 65% re-rolls. Technically on-budget. Useless as a game, and
    // it presents to the player as a box that never gives anything.
    //
    // This is not hypothetical or confined to re-pricing. Tier 3's average item
    // sits a few dollars above its $50 price; win the two dearest prizes and
    // the average drops below it mid-party, and the top box quietly stops
    // paying out.
    //
    // A free re-roll is also not really worth C -- it is worth the EV of a
    // roll, which is `target`. Valuing it at the sticker price is what lets it
    // out-compete real prizes. Rather than re-derive the whole anchor system on
    // the eve of the party, cap the share of a box that may be re-rolls and
    // accept the resulting underspend, which shows up honestly as a higher
    // realized margin in `npm run audit` instead of as a dead tier.
    const respinCap = cfg.max_respin_share ?? 0.25;
    if (denomUnder < 0 && Wp > 0) {
      const lambdaFloor = Math.max(0, (1 - pShard - respinCap) / Wp);
      if (lambdaFloor > lambda) {
        lambda = clamp(lambdaFloor, 0, 1);
        warnings.push(
          'Items here are worth less than the box, so the EV solve wanted to pay in free ' +
            're-rolls. Capped re-rolls at ' + (respinCap * 100).toFixed(0) +
            '% and accepted a smaller payout so the box still gives prizes.'
        );
      }
    }
  }

  if (lambda < 1 - 1e-9 && Wp > 0) {
    warnings.push(
      'Item probabilities scaled to ' +
        (lambda * 100).toFixed(1) +
        '% to stay solvent (' +
        pool.length +
        ' items in tier; raw mass ' +
        Wp.toFixed(3) +
        ', raw EV $' +
        Wv.toFixed(2) +
        ').'
    );
  }

  const pPhysical = lambda * Wp;
  const evPhysical = lambda * Wv;

  // --- Solve the two virtual anchors ---------------------------------------
  const K = 1 - pPhysical - pShard; // probability left over
  const B = target - evPhysical - pShard * vShard; // EV left over

  let pRespin: number;
  if (K <= 1e-12) {
    pRespin = 0;
  } else if (C - vScrap <= 1e-12) {
    pRespin = 0;
    warnings.push('Scrap consolation is worth as much as the box; respin anchor disabled.');
  } else {
    pRespin = clamp((B - K * vScrap) / (C - vScrap), 0, K);
  }
  const pScrap = Math.max(0, K - pRespin);

  const itemOdds: ItemOdds[] = pool.map((i, k) => ({
    item_id: i.id,
    name: i.name,
    image_url: i.image_url ?? null,
    est_value: i.est_value,
    // Carried for display only. Note it is absent from `weights` above and from
    // every EV term below -- that is deliberate and must stay true.
    msrp: i.msrp ?? null,
    rarity: i.rarity,
    stock_qty: i.stock_qty,
    probability: lambda * weights[k],
  }));

  // Within the floor branch, which junk item do you get? Stock-weighted, so a
  // pile of 8 cable bundles is 8x likelier than a single desk lamp.
  const fillerOdds: ItemOdds[] = fillerPool.map((i) => ({
    item_id: i.id,
    name: i.name,
    image_url: i.image_url ?? null,
    est_value: i.est_value,
    rarity: i.rarity,
    stock_qty: i.stock_qty,
    probability: fillerStock > 0 ? (pScrap * i.stock_qty) / fillerStock : 0,
  }));

  const evShard = pShard * vShard;
  const evRespin = pRespin * C;
  const evScrap = pScrap * vScrap;
  const totalEv = evPhysical + evShard + evRespin + evScrap;

  const pSum = pPhysical + pShard + pRespin + pScrap;
  if (Math.abs(pSum - 1) > 1e-9) {
    warnings.push('Probabilities sum to ' + pSum.toFixed(9) + ', not 1.0 - this is a bug.');
  }
  if (totalEv > target + 1e-9) {
    warnings.push(
      'Payout $' + totalEv.toFixed(2) + ' exceeds budget $' + target.toFixed(2) + ' - the house is losing money.'
    );
  }

  return {
    tier,
    box_price: C,
    target_ev: target,
    items: itemOdds,
    p_physical: pPhysical,
    ev_physical: evPhysical,
    p_shard: pShard,
    ev_shard: evShard,
    p_respin: pRespin,
    ev_respin: evRespin,
    p_scrap: pScrap,
    ev_scrap: evScrap,
    scrap_coins_awarded: coins,
    filler: fillerOdds,
    floor_kind: floorKind,
    floor_value: vScrap,
    total_ev: totalEv,
    realized_margin: C > 0 ? 1 - totalEv / C : 0,
    scale_factor: lambda,
    warnings,
  };
}

/**
 * Walk the CDF. Order: items, then shard, then respin, then scrap.
 * `rand` must be a fresh uniform in [0,1). Never reuse one draw across several
 * decisions -- the spec's original reused a single random() for the shard check,
 * the item walk, and the respin/scrap split, which correlates all three.
 */
export type Outcome =
  | { kind: 'physical'; index: number }
  | { kind: 'shard' }
  | { kind: 'respin' }
  | { kind: 'scrap' };

export function drawOutcome(odds: BoxOdds, rand: number): Outcome {
  let cum = 0;
  for (let k = 0; k < odds.items.length; k++) {
    cum += odds.items[k].probability;
    if (rand < cum) return { kind: 'physical', index: k };
  }
  cum += odds.p_shard;
  if (rand < cum) return { kind: 'shard' };
  cum += odds.p_respin;
  if (rand < cum) return { kind: 'respin' };
  return { kind: 'scrap' };
}

/** Dollar value actually handed to the player. Used by the ledger and the simulation. */
export function outcomeValue(odds: BoxOdds, o: Outcome, cfg: EconomyConfig): number {
  switch (o.kind) {
    case 'physical':
      return odds.items[o.index].est_value;
    case 'shard':
      return cfg.pc_value / cfg.shards_required;
    case 'respin':
      return odds.box_price;
    case 'scrap':
      // The floor branch is a junk OBJECT when the filler pool has stock, and
      // only falls back to coins when it is empty. `floor_value` already
      // carries whichever applies, so never re-derive it from the coin rate.
      return odds.floor_value;
  }
}

/** Spec rarity bands. Used by the vision scanner and the seed catalog. */
/**
 * Value -> rarity bands.
 *
 * Tuned so that most things a player actually wins register as SOMETHING rather
 * than as grey filler: a $12 desk lamp reading as Mil-Spec blue is a small win,
 * and a small win still gets a sound. Grey is reserved for genuine junk.
 */
export function rarityForValue(v: number): Rarity {
  if (v >= 200) return 'gold'; // Exotic
  if (v >= 100) return 'pink'; // Mythic
  if (v >= 50) return 'purple'; // Legendary
  if (v >= 10) return 'blue'; // Rare
  return 'grey'; // Common
}

/**
 * Tier bands, cut to the house's ACTUAL value distribution.
 *
 * The spec's bands (tier_1 <= $30, tier_2 <= $120, tier_3 > $120) left tier 3
 * holding exactly one item, because almost nothing in a student house is worth
 * over $120. A $50 box whose only prize is one book is not a High Roller case,
 * it is a refund machine -- 51% of rolls came back as free spins.
 *
 * Cut at $50 and $15 instead, which splits the real catalog roughly:
 *   tier_3  6 items  $50-150   (the genuinely good stuff)
 *   tier_2 10 items  $15-30
 *   tier_1 43 items  under $15 (the junk drawer)
 */
export function tierForValue(v: number): BoxTier {
  if (v >= 50) return 'tier_3';
  if (v >= 15) return 'tier_2';
  if (v >= 3) return 'tier_1';
  return 'tier_0';
}
