import 'server-only';
import { db } from '@/lib/supabase/server';
import { BOX_TIERS, type BoxTier, type Roll } from '@/lib/types';
import { callRpc } from './http';
import { DEFAULT_GAME_CONFIG, normalizeOdds, type GameConfig, type PlayerBoxOdds } from './shared';

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
    scrap_key_tier: (cfg.scrap_key_tier as BoxTier) ?? DEFAULT_GAME_CONFIG.scrap_key_tier,
    pc_value: num(cfg.pc_value, DEFAULT_GAME_CONFIG.pc_value),
    // The UI must show this one, never pc_value -- see GameConfig.
    pc_display_value: num(cfg.pc_display_value, DEFAULT_GAME_CONFIG.pc_display_value ?? 400),
    base_prices: Object.fromEntries(
      BOX_TIERS.map((t) => [t, num(prices[t], DEFAULT_GAME_CONFIG.base_prices[t])])
    ) as Record<BoxTier, number>,
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
