/**
 * SEED CATALOG — the real contents of the house.
 *
 * Single source of truth for both `supabase/seed.sql` (generated from this file)
 * and `scripts/simulate.ts`, so the economy is validated against exactly what
 * ships. Add real items here or through the admin scanner; do not hand-edit the
 * generated SQL.
 *
 * Rarity and tier are DERIVED from value via the spec's own bands, so an item
 * can never be mispriced into the wrong scrap rules by accident.
 */

import { rarityForValue, tierForValue } from './economy';
import type { BoxTier, Item, Rarity } from './types';

export interface SeedItem {
  name: string;
  description: string;
  est_value: number;
  stock_qty: number;
  /** Override the derived tier when the item belongs somewhere else. */
  tier?: BoxTier;
}

export const SEED_ITEMS: SeedItem[] = [
  // --- The headline stuff --------------------------------------------------
  { name: 'Graphics Card', description: 'Pulled from the house PC — the other half of the build', est_value: 200, stock_qty: 1 },
  { name: 'Audioengine A5+ Speakers', description: 'Powered bookshelf speakers, excellent condition', est_value: 200, stock_qty: 1 },
  { name: 'MCAT Prep Book Set', description: 'Full Kaplan set, lightly annotated', est_value: 120, stock_qty: 1, tier: 'tier_3' },
  { name: '144Hz Gaming Monitor', description: '27" 1080p 144Hz, no dead pixels', est_value: 100, stock_qty: 1 },
  { name: '1080p Monitor', description: '24" 60Hz secondary display', est_value: 70, stock_qty: 1 },
  { name: 'Standing Desk', description: 'Adjustable, minor scuffs on the legs', est_value: 50, stock_qty: 1 },
  { name: 'MTG Bulk Collection', description: 'Several thousand commons plus a few rares', est_value: 40, stock_qty: 1 },
  { name: 'Hardshell Suitcase', description: 'Carry-on size, wheels intact', est_value: 30, stock_qty: 1 },

  // --- Tier 1 filler: the actual junk drawer -------------------------------
  { name: 'Drone Parts Lot', description: 'Props, spare motors, one intact frame', est_value: 8, stock_qty: 4 },
  { name: 'Desk Lamp', description: 'LED, adjustable arm', est_value: 8, stock_qty: 2 },
  { name: 'Mechanical Keyboard', description: 'Membrane switches, works fine', est_value: 12, stock_qty: 1 },
  { name: 'Cable Bundle', description: 'HDMI, USB-C, DisplayPort, assorted', est_value: 4, stock_qty: 8 },
  { name: 'Steam Game Key', description: 'Random unredeemed key from a bundle', est_value: 3, stock_qty: 10 },
  { name: 'MTG Commons Box', description: 'Draft chaff by the pound', est_value: 4, stock_qty: 5 },
  { name: 'Kitchen Miscellany', description: 'Mugs, utensils, a decent pan', est_value: 6, stock_qty: 6 },
  { name: 'Phone Charger', description: 'Assorted bricks and cables', est_value: 5, stock_qty: 6 },
];

export interface ResolvedSeedItem extends SeedItem {
  rarity: Rarity;
  box_tier: BoxTier;
  scrap_value: number;
}

/**
 * Scrapping must recover a FRACTION of an item's value, never a multiple.
 *
 * SPEC.md says "price * 10" scrap coins, which only works if a coin is worth
 * $0.05. A coin is worth $1.00 here, so that formula paid 10x value -- and even
 * at the old $0.20 coin it paid 2x, which is a money printer: win a $70
 * monitor, scrap for $140, buy seven more boxes.
 *
 * 60% for ordinary items, 40% for Restricted/Covert/Special so recycling a
 * headline prize is a deliberately bad trade rather than a banned one.
 */
const SCRAP_RECOVERY = 0.6;
const SCRAP_RECOVERY_HIGH = 0.4;
export function resolveSeedItem(s: SeedItem): ResolvedSeedItem {
  const rarity = rarityForValue(s.est_value);
  const high = rarity === 'purple' || rarity === 'pink' || rarity === 'gold';
  return {
    ...s,
    rarity,
    box_tier: s.tier ?? tierForValue(s.est_value),
    // Coins are $1 each, so this is a straight dollar recovery figure.
    scrap_value: Math.max(1, Math.round(s.est_value * (high ? SCRAP_RECOVERY_HIGH : SCRAP_RECOVERY))),
  };
}

export const RESOLVED_CATALOG: ResolvedSeedItem[] = SEED_ITEMS.map(resolveSeedItem);

/** Shape the catalog into `Item` rows for the offline economy simulation. */
export function catalogAsItems(): Item[] {
  return RESOLVED_CATALOG.map((r, i) => ({
    id: 'seed-' + String(i).padStart(3, '0'),
    name: r.name,
    description: r.description,
    image_url: null,
    est_value: r.est_value,
    rarity: r.rarity,
    scrap_value: r.scrap_value,
    stock_qty: r.stock_qty,
    box_tier: r.box_tier,
    is_active: true,
    created_at: new Date(0).toISOString(),
  }));
}

/** The 30 housemates. Replace with real names before the party. */
export const SEED_PLAYERS: string[] = [
  'Andy', 'Ben', 'Caleb', 'Dev', 'Eli', 'Finn', 'Gabe', 'Hank', 'Ian', 'Jack',
  'Kai', 'Liam', 'Mason', 'Nate', 'Owen', 'Pat', 'Quinn', 'Reed', 'Sam', 'Theo',
  'Uri', 'Vince', 'Will', 'Xavier', 'Yusuf', 'Zach', 'Alex', 'Blake', 'Chris', 'Drew',
];
