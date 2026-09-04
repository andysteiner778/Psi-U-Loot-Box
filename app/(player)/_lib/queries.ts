import 'server-only';
import { db } from '@/lib/supabase/server';
import { BOX_TIERS, type BoxTier, type Rarity, type Roll } from '@/lib/types';
import { callRpc } from './http';
import { DEFAULT_GAME_CONFIG, normalizeOdds, type GameConfig, type PlayerBoxOdds, type ShardPrize } from './shared';

/**
 * Server-side reads for the player pages.
 *
 * Pages call these directly instead of fetching their own API routes: it saves
 * a round trip on a phone that is sharing one apartment's wifi with 29 others,
 * and it keeps the service-role client on the server where it belongs.
 */

/** Odds for one tier. The price inside is the authoritative, sale-aware one. */
export async function fetchOdds(tier: BoxTier): Promise<PlayerBoxOdds> {
  return normalizeOdds(await callRpc<unknown>('box_odds', { p_box_tier: tier }));
}

/** All three tiers in parallel — three cheap STABLE calls, one page render. */
export async function fetchAllOdds(): Promise<PlayerBoxOdds[]> {
  return Promise.all(BOX_TIERS.map(fetchOdds));
}

/**
 * How many guaranteed-prize spins this player still has.
 *
 * The welcome guarantee lives in `open_box` (migration 0025), which means a
 * beginner's real odds are BETTER than the ones the loot table publishes. That
 * is the right direction to be wrong in, but it is still a gap between what the
 * app says and what it does, so the box screen states it plainly.
 */
export async function fetchWelcomeSpinsLeft(userId: string): Promise<number> {
  const { data: cfgRow } = await db.from('config').select('value').eq('key', 'settings').maybeSingle();
  const total = Number((cfgRow?.value as Record<string, unknown> | undefined)?.welcome_spins ?? 0);
  if (!(total > 0)) return 0;
  const { count } = await db
    .from('rolls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return Math.max(0, total - (count ?? 0));
}

/**
 * Prizes claimed with shards rather than won from a box.
 *
 * These are excluded from `box_odds` on purpose -- they can never drop, so
 * publishing a probability for them would be a lie. But that also meant they
 * appeared NOWHERE in the app outside the shard HUD: the $600 machine the whole
 * shard track exists for was invisible on the loot list and the front page.
 */
export async function fetchShardPrizes(): Promise<ShardPrize[]> {
  const { data, error } = await db
    .from('items')
    .select('id,name,image_url,est_value,msrp,rarity,shard_cost,stock_qty')
    .gt('shard_cost', 0)
    .eq('is_active', true)
    .gt('stock_qty', 0)
    .order('est_value', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      item_id: String(row.id),
      name: String(row.name),
      image_url: (row.image_url as string | null) ?? null,
      // msrp is the display price; est_value drives the economy and is not
      // the number to advertise.
      value: Number(row.msrp ?? row.est_value ?? 0),
      rarity: row.rarity as Rarity,
      shard_cost: Number(row.shard_cost ?? 0),
      stock_qty: Number(row.stock_qty ?? 0),
    };
  });
}

/**
 * The economy knobs the UI quotes back to the player: shard count, coins per
 * key, and the undiscounted prices a flash sale is measured against.
 *
 * Falls back to the shipped defaults rather than throwing — a missing config
 * row should not blank the whole box screen.
 */
export async function fetchGameConfig(): Promise<GameConfig> {
  const { data, error } = await db
    .from('config')
    .select('value')
    .eq('key', 'settings')
    .maybeSingle();

  if (error || !data?.value) return DEFAULT_GAME_CONFIG;
  const cfg = data.value as Record<string, unknown>;
  const prices = (cfg.box_prices ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

  return {
    shards_required: num(cfg.shards_required, DEFAULT_GAME_CONFIG.shards_required),
    scrap_coins_per_key: num(cfg.scrap_coins_per_key, DEFAULT_GAME_CONFIG.scrap_coins_per_key),
    // Falls back to the old tier-derived value so an un-migrated config row
    // still quotes a real number rather than NaN.
    scrap_key_usd: num(
      cfg.scrap_key_usd,
      num((prices as Record<string, unknown>)[String(cfg.scrap_key_tier)], DEFAULT_GAME_CONFIG.scrap_key_usd)
    ),
    scrap_key_tier: (cfg.scrap_key_tier as BoxTier) ?? DEFAULT_GAME_CONFIG.scrap_key_tier,
    pc_value: num(cfg.pc_value, DEFAULT_GAME_CONFIG.pc_value),
    // The UI must show this one, never pc_value -- see GameConfig.
    pc_display_value: num(cfg.pc_display_value, DEFAULT_GAME_CONFIG.pc_display_value ?? 400),
    base_prices: Object.fromEntries(
      BOX_TIERS.map((t) => [t, num(prices[t], DEFAULT_GAME_CONFIG.base_prices[t])])
    ) as Record<BoxTier, number>,
    // Strict === true: a missing key, a string "false", or anything else the
    // admin form might have written means OFF. The server makes the real
    // decision in scrap_item; getting this wrong only offers a button that
    // then fails, which is worse than not offering it.
    allow_high_rarity_scrap: cfg.allow_high_rarity_scrap === true,
    shard_salvage_tier: (cfg.shard_salvage_tier as BoxTier) ?? DEFAULT_GAME_CONFIG.shard_salvage_tier,
    shard_salvage_value: num(
      prices[(cfg.shard_salvage_tier as BoxTier) ?? 'tier_1'],
      DEFAULT_GAME_CONFIG.shard_salvage_value ?? 5
    ),
  };
}

/**
 * Physical items still sitting in a player's inventory.
 *
 * `kind = 'physical'` matters: shard, respin and scrap rows are events, not
 * objects, and putting them on the shelf next to a real monitor is what made
 * the spec's single overloaded `status` column ambiguous in the first place.
 */
export async function fetchInventory(userId: string): Promise<Roll[]> {
  const { data, error } = await db
    .from('rolls')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'inventory')
    .eq('kind', 'physical')
    .order('rolled_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Roll[];
}

/** Everything that has happened to this player lately, inventory or not. */
export async function fetchRecentRolls(userId: string, limit = 25): Promise<Roll[]> {
  const { data, error } = await db
    .from('rolls')
    .select('*')
    .eq('user_id', userId)
    .order('rolled_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Roll[];
}
