/**
 * FROZEN CONTRACT — House Loot
 *
 * Every workstream imports from here. Nothing else is shared.
 * If you need a change to this file, propose it; do not edit it directly.
 */

export const RARITIES = ['grey', 'blue', 'purple', 'pink', 'gold'] as const;
export type Rarity = (typeof RARITIES)[number];

export const BOX_TIERS = ['tier_0', 'tier_1', 'tier_2', 'tier_3'] as const;
export type BoxTier = (typeof BOX_TIERS)[number];

/** Anti-exploit rule 2: these can never be scrapped, only physically claimed. */
export const UNSCRAPPABLE: readonly Rarity[] = ['purple', 'pink', 'gold'];
export const isScrappable = (r: Rarity): boolean => !UNSCRAPPABLE.includes(r);

/**
 * Can this specific win actually be recycled?
 *
 * Rarity alone is not enough: an item cheap enough that 60% of its value floors
 * to zero coins has nothing to give, and offering a "Scrap for +0" button is
 * worse than offering none.
 */
/**
 * Can the player turn this into coins?
 *
 * Rarity alone is not enough twice over. Something cheap enough that its
 * recovery floors to zero coins has nothing to give, and a "Scrap for +0"
 * button is worse than no button. And high-rarity items are scrappable or not
 * depending on `allow_high_rarity_scrap` in the live config, which the SERVER
 * is the authority on -- `scrap_item` refuses with PT403 when it is off. This
 * only decides whether to offer the button; it never decides the outcome.
 *
 * Defaults to false so a caller that has not plumbed the flag through shows
 * the conservative thing rather than a button the server will reject.
 */
export const canScrap = (
  rarity: Rarity,
  scrapValue: number | null | undefined,
  allowHighRarity = false
): boolean =>
  (isScrappable(rarity) || allowHighRarity) && (scrapValue ?? 0) > 0;

/** Neon border colors, spec section 4B. */
export const RARITY_COLOR: Record<Rarity, string> = {
  grey: '#4b5563',
  blue: '#2563eb',
  purple: '#9333ea',
  pink: '#ec4899',
  gold: '#eab308',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  grey: 'Common',
  blue: 'Rare',
  purple: 'Legendary',
  pink: 'Mythic',
  gold: 'Exotic',
};

/** Ascending rank, for "is this better than that" comparisons and sound tiers. */
export const RARITY_RANK: Record<Rarity, number> = {
  grey: 0,
  blue: 1,
  purple: 2,
  pink: 3,
  gold: 4,
};

/** Anything at or above this gets a win sound. Grey stays silent. */
export const SOUND_FLOOR: Rarity = 'blue';

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  name: string;
  balance: number;
  scrap_coins: number;
  pc_shards: number;
  role: 'player' | 'admin';
  created_at: string;
}

export interface Item {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  /** Realistic used value. Drives every probability and EV calculation. */
  est_value: number;
  /**
   * Display-only retail price, shown on the card as "$X retail".
   *
   * MUST NOT appear in any odds or EV computation. Inflating `est_value` to
   * make an item look better makes it drop LESS often, because drop chance is
   * `C * ev_weight_factor / est_value`. This column exists so perceived value
   * can rise without the game quietly getting stingier.
   */
  msrp?: number | null;
  /**
   * Shards needed to claim this. 0 (or absent) means an ordinary box drop.
   *
   * Anything above 0 is EXCLUDED from the drop pool: it is assembled toward,
   * not lucked into. Both the SQL `box_odds` and `computeBoxOdds` must apply
   * this filter or the two engines describe different games -- and only the
   * TypeScript one is covered by the solvency proof.
   */
  shard_cost?: number | null;
  rarity: Rarity;
  scrap_value: number;
  stock_qty: number;
  box_tier: BoxTier;
  is_active: boolean;
  created_at: string;
}

/** Disambiguates *why* a roll row exists. `status` tracks what happened to it after. */
export type RollKind = 'physical' | 'shard' | 'respin' | 'scrap';
export type RollStatus = 'inventory' | 'scrapped' | 'claimed' | 'consumed';

export interface Roll {
  id: string;
  user_id: string;
  box_tier: BoxTier;
  kind: RollKind;
  item_id: string | null;
  item_name: string;
  item_rarity: Rarity;
  status: RollStatus;
  box_price: number;
  payload: OpenBoxResult | null;
  rolled_at: string;
}

export interface Deposit {
  id: string;
  user_id: string;
  amount: number;
  venmo_note: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

// ---------------------------------------------------------------------------
// open_box RPC result — the discriminated union the reel animates
// ---------------------------------------------------------------------------

export type OpenBoxResult =
  | {
      type: 'physical';
      item_id: string;
      item_name: string;
      image_url: string | null;
      rarity: Rarity;
      est_value: number;
      /** Display only — see Item.msrp. */
      msrp?: number | null;
      /** Always 0 for purple/pink/gold — enforced server-side, not in the client. */
      scrap_value: number;
      roll_id: string;
    }
  | {
      type: 'shard';
      item_name: string;
      rarity: 'gold';
      current_shards: number;
      shards_required: number;
      roll_id: string;
    }
  | {
      type: 'respin';
      item_name: string;
      rarity: Rarity;
      refund_amount: number;
      roll_id: string;
      image_url?: string | null;
      /**
       * Set when the reward was a DISCOUNT VOUCHER rather than credit. The
       * voucher is stored server-side and applied automatically on the next
       * roll of that tier; refund_amount is 0 in this case, so a UI that only
       * reads refund_amount would announce "$0.00 added to your balance".
       */
      voucher_tier?: BoxTier;
      voucher_pct?: number;
    }
  | {
      type: 'scrap';
      item_name: string;
      rarity: 'grey';
      scrap_gained: number;
      /**
       * Dollars credited by a losing roll. Migration 0030 pays the consolation
       * straight into the balance instead of as coins, so this is the number to
       * show; scrap_gained stays at 0 and is kept only so a reader of the old
       * field does not get undefined.
       */
      credit_gained?: number;
      roll_id: string;
    };

/** Every result carries a rarity; the reel and sound engine key off this. */
export function resultRarity(r: OpenBoxResult): Rarity {
  return r.rarity;
}

/** Gold fanfare + confetti fire on these. */
export function isJackpot(r: OpenBoxResult): boolean {
  return r.type === 'shard' || r.rarity === 'gold' || r.rarity === 'pink';
}

// ---------------------------------------------------------------------------
// Economy configuration (the `config` table's `settings` row)
// ---------------------------------------------------------------------------

export interface EconomyConfig {
  house_margin: number;
  /**
   * May purple/pink/gold be turned into coins? Read by `scrap_item`, which is
   * the authority; the UI mirrors it only to decide whether to offer a button.
   * Absent means off.
   */
  allow_high_rarity_scrap?: boolean;
  /**
   * Per-tier margin overrides. A tier listed here uses its own margin instead
   * of `house_margin`; anything absent falls back to the global number.
   *
   * This exists because the $1 box runs at 1:1 — it is a loss-leader whose job
   * is to clear junk and get people rolling, not to earn. Keep it a PARTIAL
   * map: writing every tier in here means a change to `house_margin` silently
   * stops doing anything.
   */
  tier_margins?: Partial<Record<BoxTier, number>>;
  pot_revenue_threshold: number;
  box_prices: Record<BoxTier, number>;
  shard_probs: Record<BoxTier, number>;
  /** What the ECONOMY charges for the shard track. Not the machine's worth. */
  pc_value: number;
  /** What the machine is actually worth. Shown to players; never priced against. */
  pc_display_value?: number;
  shards_required: number;
  pc_total_supply: number;
  /**
   * How many shards may EXIST. Deliberately larger than `shards_required`:
   * tying the two together meant only 5 shards ever existed, so across a room
   * of players nobody could assemble a set and the PC was unwinnable.
   */
  pc_shard_mint_cap?: number;
  pc_shards_minted: number;
  max_item_prob: number;
  ev_weight_factor: number;
  /** Consolation payout as a fraction of box price. The floor anchor is NOT free. */
  scrap_ev_frac: number;
  /**
   * Max est_value of an item that may serve as filler (the floor-anchor junk
   * borrowed into a higher tier). MUST match the predicate in box_odds SQL --
   * the solvency proof runs on the TS engine, so a divergence would mean the
   * proof describes a different game than the one players actually play.
   */
  filler_max_value: number;
  /**
   * Weight multiplier for items that belong to a DIFFERENT tier than the box
   * being opened. 1.0 would make tiers meaningless; 0 restores strict
   * partitioning. Around 0.15 means a $5 crate can still cough up the good
   * monitor, just rarely.
   */
  cross_tier_factor?: number;
  scrap_coins_per_key: number;
  /**
   * Dollars the compactor pays for `scrap_coins_per_key` coins, and the
   * numerator of a coin's value. Previously derived from a box tier's price,
   * which limited the cash-out to $1/$5/$20/$50 -- there is no $10 box.
   * Absent falls back to that old derivation.
   */
  scrap_key_usd?: number;
  /**
   * Hard ceiling on how much of a box may be free re-rolls. See the respin
   * clamp in computeBoxOdds: without it a tier whose items are cheaper than
   * the box turns into a re-roll machine with no prizes at all.
   */
  max_respin_share?: number;
  /** Dollars credited per shard salvaged. Absent falls back to a tier price. */
  shard_salvage_value?: number;
  scrap_key_tier: BoxTier;
  flash_sale: boolean;
  flash_sale_pct: number;
  flash_sale_ends_at: string | null;
}

// ---------------------------------------------------------------------------
// Odds table — what the engine computes and the admin dashboard renders
// ---------------------------------------------------------------------------

export interface ItemOdds {
  item_id: string;
  name: string;
  /** Needed by the reel: without it the strip falls back to placeholder cards. */
  image_url?: string | null;
  est_value: number;
  /** Display only — see Item.msrp. */
  msrp?: number | null;
  rarity: Rarity;
  stock_qty: number;
  probability: number;
}

export interface BoxOdds {
  tier: BoxTier;
  box_price: number;
  /** C x (1 - house_margin) — what we intend to pay out per roll. */
  target_ev: number;
  items: ItemOdds[];
  p_physical: number;
  ev_physical: number;
  p_shard: number;
  ev_shard: number;
  p_respin: number;
  ev_respin: number;
  p_scrap: number;
  ev_scrap: number;
  scrap_coins_awarded: number;
  /**
   * The floor anchor. When `floor_kind` is 'item' the consolation is a real
   * cheap object drawn from `filler` (stock-weighted) rather than scrap coins —
   * winning a $4 cable bundle reads as a win; "+5 coins" reads as a loss.
   * Falls back to coins when the junk pool is empty.
   */
  filler: ItemOdds[];
  floor_kind: 'item' | 'coins';
  floor_value: number;
  /** Sum of all four EV components. MUST be <= target_ev or the house loses money. */
  total_ev: number;
  /** 1 - total_ev / box_price. Negative means insolvent. */
  realized_margin: number;
  /** Probabilities scaled down to fit the budget? By how much? */
  scale_factor: number;
  /** Populated when the configuration cannot be satisfied. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  name: string;
  role: 'player' | 'admin';
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export interface TickerEvent {
  player: string;
  item: string;
  rarity: Rarity;
  kind: RollKind;
  tier: BoxTier;
  at: string;
  shards?: number;
}
