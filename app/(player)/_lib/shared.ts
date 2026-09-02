import type { BoxOdds, BoxTier, Rarity, Roll } from '@/lib/types';

/**
 * Types and pure helpers shared by the player server components, the route
 * handlers and the client components.
 *
 * Deliberately free of any `server-only` import so a client component can pull
 * a type out of here without dragging the service-role client into the bundle.
 */

/** Live counters echoed back after every mutation so the HUD can reconcile. */
export interface PlayerStats {
  balance: number;
  scrap_coins: number;
  pc_shards: number;
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
export interface GameConfig {
  shards_required: number;
  scrap_coins_per_key: number;
  scrap_key_tier: BoxTier;
  pc_value: number;
  /** Undiscounted prices, so a flash sale can be shown as a strike-through. */
  base_prices: Record<BoxTier, number>;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  shards_required: 5,
  scrap_coins_per_key: 100,
  scrap_key_tier: 'tier_2',
  pc_value: 600,
  base_prices: { tier_1: 5, tier_2: 20, tier_3: 50 },
};

export const BOX_META: Record<BoxTier, { name: string; blurb: string; accent: Rarity }> = {
  tier_1: {
    name: 'Dorm Scraps',
    blurb: 'Cables, Steam keys, drone parts, MTG bulk.',
    accent: 'grey',
  },
  tier_2: {
    name: 'Living Room Gear',
    blurb: '144Hz monitors, audio peripherals, the MCAT books.',
    accent: 'blue',
  },
  tier_3: {
    name: 'High Roller',
    blurb: 'The speakers. The good monitor. Best shard odds.',
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

  const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];

  return {
    tier: (o.tier as BoxTier) ?? 'tier_1',
    box_price: num(o.box_price),
    target_ev: num(o.target_ev),
    items: items
      .map((i) => ({
        item_id: String(i.item_id ?? ''),
        name: String(i.name ?? 'Unknown'),
        est_value: num(i.est_value),
        rarity: (i.rarity as Rarity) ?? 'grey',
        stock_qty: num(i.stock_qty),
        probability: num(i.probability),
      }))
      .sort((a, b) => b.est_value - a.est_value),
    p_physical: num(o.p_physical),
    ev_physical: num(o.ev_physical),
    p_shard: num(o.p_shard),
    ev_shard: num(o.ev_shard),
    p_respin: num(o.p_respin),
    ev_respin: num(o.ev_respin),
    p_scrap: num(o.p_scrap),
    ev_scrap: num(o.ev_scrap),
    scrap_coins_awarded: num(o.scrap_coins_awarded),
    total_ev: num(o.total_ev),
    realized_margin: num(o.realized_margin),
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
