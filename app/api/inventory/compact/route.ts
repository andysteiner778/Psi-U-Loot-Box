import { requireUser } from '@/lib/session';
import type { BoxTier } from '@/lib/types';
import { callRpc, ok, playerStats, toErrorResponse } from '@/app/(player)/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory/compact -> { ok, spent, credit, tier }
 *
 * The Scrap Compactor: 100 coins become one Tier-2 key's worth of credit. The
 * cost, the tier and the credit all come from the `config` row inside
 * `compact_scrap`, so an admin retuning the economy mid-party is picked up
 * without a deploy — and a client that thinks the price is 50 gets a PT402.
 */
export async function POST() {
  try {
    const user = await requireUser();

    const result = await callRpc<{ ok: boolean; spent: number; credit: number; tier: BoxTier }>(
      'compact_scrap',
      { p_user_id: user.id }
    );

    return ok(result, { stats: await playerStats(user.id) });
  } catch (err) {
    return toErrorResponse(err, {
      PT402: 'Not enough scrap coins yet.',
    });
  }
}
