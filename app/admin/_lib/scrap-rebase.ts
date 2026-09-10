import 'server-only';

import { db } from '@/lib/supabase/server';
import { scrapValueCoins } from '@/lib/scrap';
import type { BoxTier, EconomyConfig, Rarity } from '@/lib/types';

/**
 * Settings that change what an item scraps for. Saving any of them re-prices
 * every item's scrap value, because the cap is half of what the box costs --
 * and the discount slider changes what the box costs.
 */
export const SCRAP_AFFECTING_KEYS = [
  'box_prices', 'extra_discount_pct', 'scrap_key_usd', 'scrap_coins_per_key', 'allow_high_rarity_scrap',
] as const;

export function touchesScrap(patch: Record<string, unknown>): boolean {
  return SCRAP_AFFECTING_KEYS.some((k) => k in patch);
}

/**
 * Bring every item's stored scrap_value in line with lib/scrap.ts. Writes only
 * the rows that differ, one id at a time -- never a pattern.
 *
 * scrap_item pays the STORED value, and the inventory shows the stored value,
 * so updating it here keeps "what it says" and "what it pays" the same number.
 */
export async function rebaseScrapValues(cfg: EconomyConfig): Promise<{ changed: number; failed: number }> {
  const { data, error } = await db
    .from('items')
    .select('id,est_value,msrp,rarity,box_tier,scrap_value,shard_cost,reward_credit,reward_voucher_tier');
  if (error) throw new Error('Could not read items for scrap rebase: ' + error.message);

  let changed = 0, failed = 0;
  for (const i of data ?? []) {
    const want = scrapValueCoins(
      {
        est_value: Number(i.est_value),
        msrp: i.msrp as number | null,
        rarity: i.rarity as Rarity,
        box_tier: i.box_tier as BoxTier,
        shard_cost: i.shard_cost as number | null,
        reward_credit: i.reward_credit as number | null,
        reward_voucher_tier: i.reward_voucher_tier as BoxTier | null,
      },
      cfg
    );
    if (want === i.scrap_value) continue;
    const { error: e } = await db.from('items').update({ scrap_value: want }).eq('id', i.id);
    if (e) failed++; else changed++;
  }
  return { changed, failed };
}
