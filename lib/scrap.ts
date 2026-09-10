import { scrapCoinUsd, standingBoxPrice } from './economy';
import type { BoxTier, EconomyConfig, Rarity } from './types';

/**
 * WHAT AN ITEM SCRAPS FOR — the one definition.
 *
 * "What is a coin worth" previously existed in FOUR places and two of them were
 * ten times wrong, which is why scrapping felt worthless across a whole
 * catalogue. This is that lesson applied to the payout itself: the admin create
 * form, the admin edit form and the rebase script must all produce the same
 * number, or an item's scrap value depends on which screen last touched it.
 *
 * THE RULE
 *   payout = min(retail x 90%, HALF what the box it drops from COSTS right now)
 *   coins  = floor(payout / coin)
 *
 * Priced off RETAIL because the owner deliberately prices give-away junk at
 * $0.01 — a payout derived from that is worth a cent and scrapping is pointless.
 * Retail is what a player believes the thing is worth.
 *
 * CAPPED because retail and est_value are decoupled here on purpose: a $0.01
 * item can carry a $40 retail, and an uncapped retail rate hands back more than
 * the box that produced it cost. At 100% of the box price it is break-even and
 * a patient player farms it; at 50% it is a good deal on a lucky pull and never
 * free money.
 *
 * FLOOR, not round: a $0.25 cap against a $0.10 coin rounds 2.5 up to 3 coins =
 * $0.30, quietly breaking the very cap it is applying.
 */
export const RETAIL_RATE = 0.9;
export const CAP_OF_BOX = 0.5;

const HIGH_RARITIES: Rarity[] = ['purple', 'pink', 'gold'];

export interface ScrapInput {
  est_value: number;
  msrp?: number | null;
  rarity: Rarity;
  box_tier: BoxTier;
  /** Shard-locked prizes are claimed, never sold or scrapped. */
  shard_cost?: number | null;
  /** Reward rows pay as credit or a voucher; they never reach a shelf. */
  reward_credit?: number | null;
  reward_voucher_tier?: BoxTier | null;
}

/** Scrap payout in COINS, which is how items.scrap_value is stored. */
export function scrapValueCoins(item: ScrapInput, cfg: EconomyConfig): number {
  if (Number(item.shard_cost ?? 0) > 0) return 0;
  if (item.reward_credit != null || item.reward_voucher_tier != null) return 0;

  const highOk = cfg.allow_high_rarity_scrap === true;
  if (HIGH_RARITIES.includes(item.rarity) && !highOk) return 0;

  const coin = scrapCoinUsd(cfg);
  if (!(coin > 0)) return 0;

  const retail = Number(item.msrp ?? 0) || 0;
  /*
   * The price people actually PAY, after the standing discount -- not the list
   * price.
   *
   * This used the list price, on the reasoning that a sale should not rewrite
   * what an item is worth. At 60% off that made the cap 125% of the real box
   * price: the $4 Golden Chest paid $5 to scrap a Ti-83, and scrapping puts the
   * Ti-83 back in the box. Buy, scrap, repeat, $1 of credit each time. In a
   * simulated party that turned $150 of deposits into ~$780 of spins and lost
   * the house $138 on a bad night.
   *
   * Standing discount only, not the timed flash sale: the sale is 20% for 15
   * minutes, so a roll during it still costs 80% of the standing price, well
   * above this 50% cap. Values are recomputed whenever the discount is saved
   * (app/admin/_lib/scrap-rebase.ts), so turning the sale off raises them again.
   */
  const boxPrice = cfg.box_prices?.[item.box_tier] ? standingBoxPrice(cfg, item.box_tier) : 0;

  const payout = Math.min(retail * RETAIL_RATE, boxPrice * CAP_OF_BOX);
  if (!(payout > 0)) return 0;
  // The epsilon is for binary floating point, not generosity: 0.6 / 0.1 is
  // 5.999999999999999, which floors to 5 coins and short-pays a $0.60 cap as
  // $0.50. It is far too small to lift 2.5 coins to 3.
  return Math.floor(payout / coin + 1e-9);
}

/**
 * Which box an item belongs in, by RETAIL.
 *
 * `tierForValue` assigns from est_value, and almost everything here is $0.01 on
 * purpose — which put 61 of 67 objects in the cheapest box and left the $30 box
 * with nothing droppable. Retail is what a player perceives, and it is the
 * whole reason retail is recorded, so it is what decides the tier. Mirrors
 * scripts/retier-by-retail.ts.
 */
export function tierForRetail(msrp: number): BoxTier {
  if (msrp >= 30) return 'tier_3';
  if (msrp >= 10) return 'tier_2';
  if (msrp >= 4) return 'tier_1';
  return 'tier_0';
}
