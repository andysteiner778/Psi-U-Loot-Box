/**
 * FROZEN CONTRACT — House Loot
 *
 * Every workstream imports from here. Nothing else is shared.
 * If you need a change to this file, propose it; do not edit it directly.
 */

export const RARITIES = ['grey', 'blue', 'purple', 'pink', 'gold'] as const;
export type Rarity = (typeof RARITIES)[number];

export const BOX_TIERS = ['tier_1', 'tier_2', 'tier_3'] as const;
export type BoxTier = (typeof BOX_TIERS)[number];

/** Anti-exploit rule 2: these can never be scrapped, only physically claimed. */
export const UNSCRAPPABLE: readonly Rarity[] = ['purple', 'pink', 'gold'];
export const isScrappable = (r: Rarity): boolean => !UNSCRAPPABLE.includes(r);

/** Neon border colors, spec section 4B. */
export const RARITY_COLOR: Record<Rarity, string> = {
  grey: '#4b5563',
  blue: '#2563eb',
  purple: '#9333ea',
  pink: '#ec4899',
  gold: '#eab308',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  grey: 'Consumer',
  blue: 'Mil-Spec',
  purple: 'Restricted',
  pink: 'Covert',
  gold: 'Special',
};

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
  est_value: number;
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
      rarity: 'blue';
      refund_amount: number;
      roll_id: string;
    }
  | {
      type: 'scrap';
      item_name: string;
      rarity: 'grey';
      scrap_gained: number;
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
  pot_revenue_threshold: number;
  box_prices: Record<BoxTier, number>;
  shard_probs: Record<BoxTier, number>;
  pc_value: number;
  shards_required: number;
  pc_total_supply: number;
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
  scrap_coins_per_key: number;
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
  est_value: number;
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
