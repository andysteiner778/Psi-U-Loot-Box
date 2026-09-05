import type { BoxOdds, BoxTier, Rarity, Roll } from '@/lib/types';

/**
 * Types and pure helpers shared by the player server components, the route
 * handlers and the client components.
 *
 * Deliberately free of any `server-only` import so a client component can pull
 * a type out of here without dragging the service-role client into the bundle.
 */

/** Live voucher summary per tier: count held and best discount rate (e.g. 1.0 or 0.5). */
export interface VoucherSummary {
  count: number;
  bestPct: number;
}

/** Ladder destination metadata to showcase target box and top prize upon voucher win. */
export interface DestinationTarget {
  tier: BoxTier;
  boxName: string;
  boxPrice: number;
  topItem?: {
    name: string;
    value: number;
    rarity: Rarity;
    image_url: string | null;
  };
}

/** Live counters echoed back after every mutation so the HUD can reconcile. */
export interface PlayerStats {
  balance: number;
  scrap_coins: number;
  pc_shards: number;
  vouchers?: Partial<Record<BoxTier, VoucherSummary>>;
}

/**
 * `box_odds` returns a few fields beyond the frozen `BoxOdds` contract that are
 * genuinely useful to a player: whether the shard gate has opened, and how much
 * of the PC has been minted. Additive only — `BoxOdds` itself is untouched.
 */
export interface PlayerBoxOdds extends BoxOdds {
  shard_value: number;
  pot_total: number;
  pot_gate_met: boolean;
  shards_minted: number;
  shard_capacity: number;
}

/** Economy knobs the UI needs to render honestly, read from the `config` row. */
/**
 * A prize that is never dropped by a box -- you assemble shards and claim it.
 * The PC is the only one today. Deliberately display-only: `value` is the msrp
 * the room is shown, never est_value, which is what the ODDS are derived from.
 */
export interface ShardPrize {
  item_id: string;
  name: string;
  image_url: string | null;
  value: number;
  rarity: Rarity;
  shard_cost: number;
  stock_qty: number;
}

/**
 * One row of the full house catalogue, INCLUDING things already claimed.
 *
 * The loot page cannot be built from box_odds alone: box_odds only publishes
 * what is currently winnable, so a monitor somebody took home vanishes from it
 * entirely -- which made the "show claimed too" toggle structurally incapable
 * of showing anything. Rows come from here; the CHANCES still come from
 * box_odds, which stays the single source of truth about odds.
 */
export interface CatalogueItem {
  item_id: string;
  name: string;
  image_url: string | null;
  value: number;
  rarity: Rarity;
  stock_qty: number;
  shard_cost: number;
}

export interface GameConfig {
  shards_required: number;
  scrap_coins_per_key: number;
  /** Dollars the compactor pays for scrap_coins_per_key coins. */
  scrap_key_usd: number;
  scrap_key_tier: BoxTier;
  /** What the ECONOMY charges for the shard track. Never show this to players. */
  pc_value: number;
  /** What the machine is actually worth. This is the number the UI displays. */
  pc_display_value?: number;
  /**
   * Approved deposits the pot must reach before a completed PC can be CLAIMED.
   * Distinct from the pot gate, which controls whether shards drop at all:
   * shards accumulate freely, the finished machine waits for the pot.
   *
   * The UI must SHOW this condition whenever a player is holding a full set.
   * The alternative -- quietly making the last shard undroppable -- would be a
   * rigged jackpot, since about 21% of every spin's value is charged to the
   * shard track and the HUD renders a progress bar toward it.
   */
  pc_claim_threshold?: number;
  /** Undiscounted prices, so a flash sale can be shown as a strike-through. */
  base_prices: Record<BoxTier, number>;
  /**
   * The "was" price shown struck through on every card, always. Distinct from
   * base_prices, which is what a FLASH SALE is measured against: this is a
   * standing markdown, and a sale stacks on top of it.
   */
  box_list_prices?: Record<BoxTier, number>;
  /** Box tier / value awarded when salvaging a soulbound shard */
  shard_salvage_tier?: BoxTier;
  shard_salvage_value?: number;
  /**
   * Whether purple/pink/gold may be turned into coins. The server decides;
   * the UI only uses this to know whether to offer the button.
   */
  allow_high_rarity_scrap: boolean;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  shards_required: 4,
  scrap_coins_per_key: 50,
  scrap_key_usd: 1,
  scrap_key_tier: 'tier_2',
  pc_value: 50,
  pc_display_value: 400,
  base_prices: { tier_0: 1, tier_1: 5, tier_2: 20, tier_3: 50 },
  shard_salvage_tier: 'tier_1',
  shard_salvage_value: 5,
  allow_high_rarity_scrap: false,
};

export const BOX_META: Record<BoxTier, { name: string; blurb: string; accent: Rarity }> = {
  tier_0: {
    name: 'Mostly Junk, Some Goodies',
    blurb: 'Cheap as it gets. Mostly oddments — but anything can show up.',
    accent: 'grey',
  },
  tier_1: {
    name: 'Good Stuff',
    blurb: 'Real things worth keeping. Cheap enough to keep spinning.',
    accent: 'blue',
  },
  tier_2: {
    name: 'Golden Chest',
    blurb: 'Things worth carrying home. Best odds of a real win.',
    accent: 'purple',
  },
  tier_3: {
    name: 'High Roller',
    blurb: 'The big pulls, and the best shot at PC shards.',
    accent: 'gold',
  },
};

export const money = (n: number): string =>
  `$${(Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, '')}`;

export const pct = (p: number): string => {
  const v = (Number.isFinite(p) ? p : 0) * 100;
  if (v === 0) return '0%';
  if (v < 0.1) return '<0.1%';
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
};

/**
 * Coerce the raw JSONB from `box_odds` into the frozen shape.
 *
 * The SQL does not emit `warnings`, and PostgREST can hand numerics back as
 * strings, so a bare `as BoxOdds` would be a lie that shows up later as
 * `undefined.length` or `"5" - 1`. Normalise once, here.
 */
export function normalizeOdds(raw: unknown): PlayerBoxOdds {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const boxPrice = num(o.box_price);
  const totalEv = num(o.total_ev);

  const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
  const filler = Array.isArray(o.filler) ? (o.filler as Record<string, unknown>[]) : [];

  const mapOdds = (i: Record<string, unknown>) => ({
    item_id: String(i.item_id ?? ''),
    name: String(i.name ?? 'Unknown'),
    // Display price. box_odds publishes it; this mapper used to drop it, so the
    // loot table quoted est_value -- the economy's cost basis -- as if it were
    // the price on the tin.
    msrp: i.msrp === null || i.msrp === undefined ? null : num(i.msrp),
    image_url: typeof i.image_url === 'string' && i.image_url ? i.image_url : null,
    est_value: num(i.est_value),
    rarity: (i.rarity as Rarity) ?? 'grey',
    stock_qty: num(i.stock_qty),
    probability: num(i.probability),
  });

  return {
    // The consolation is a real cheap object drawn from `filler`, not coins,
    // whenever the junk pool has stock. See BoxOdds in lib/types.ts.
    filler: filler.map(mapOdds),
    floor_kind: o.floor_kind === 'coins' ? ('coins' as const) : ('item' as const),
    floor_value: num(o.floor_value),
    tier: (o.tier as BoxTier) ?? 'tier_1',
    box_price: boxPrice,
    target_ev: num(o.target_ev),
    items: items.map(mapOdds).sort((a, b) => b.est_value - a.est_value),
    p_physical: num(o.p_physical),
    ev_physical: num(o.ev_physical),
    p_shard: num(o.p_shard),
    ev_shard: num(o.ev_shard),
    p_respin: num(o.p_respin),
    ev_respin: num(o.ev_respin),
    p_scrap: num(o.p_scrap),
    ev_scrap: num(o.ev_scrap),
    scrap_coins_awarded: num(o.scrap_coins_awarded),
    total_ev: totalEv,
    /*
     * DERIVED, not read. `box_odds` computes a realized margin internally but
     * never puts it in the JSONB it returns, so reading the key gave 0 on every
     * tier -- and the odds modal turned that into "Expected Payout $43.75
     * (100%)" on a $50 box. Deriving it from two numbers the payload does
     * publish cannot drift from a key that is not there.
     */
    realized_margin: boxPrice > 0 ? 1 - totalEv / boxPrice : 0,
    scale_factor: num(o.scale_factor),
    warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [],
    shard_value: num(o.shard_value),
    pot_total: num(o.pot_total),
    pot_gate_met: Boolean(o.pot_gate_met),
    shards_minted: num(o.shards_minted),
    shard_capacity: num(o.shard_capacity),
  };
}

/**
 * The scrap payout for an inventory row.
 *
 * `rolls` has no scrap_value column; the value is captured in the `payload`
 * snapshot written by `open_box`. Purple/pink/gold are always 0 there — the
 * database CHECK guarantees it — so this can only ever under-promise.
 */
export function rollScrapValue(roll: Roll): number {
  const p = roll.payload;
  if (p && p.type === 'physical') return Number(p.scrap_value ?? 0);
  return 0;
}

export function rollImage(roll: Roll): string | null {
  const p = roll.payload;
  if (p && p.type === 'physical') return p.image_url ?? null;
  return null;
}

export function rollValue(roll: Roll): number {
  const p = roll.payload;
  if (p && p.type === 'physical') return Number(p.est_value ?? 0);
  return 0;
}
