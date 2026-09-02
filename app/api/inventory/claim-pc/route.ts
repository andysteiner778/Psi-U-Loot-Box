import { requireUser } from '@/lib/session';
import { callRpc, ok, playerStats, toErrorResponse } from '@/app/(player)/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory/claim-pc -> { ok, item_name, value }
 *
 * `claim_pc` takes the profiles row lock, re-checks the shard count and burns
 * all five in one transaction, so two taps from two tabs cannot mint two PCs.
 * The count is never sent from the client.
 */
export async function POST() {
  try {
    const user = await requireUser();

    const result = await callRpc<{ ok: boolean; item_name: string; value: number }>('claim_pc', {
      p_user_id: user.id,
    });

    return ok(result, { stats: await playerStats(user.id) });
  } catch (err) {
    return toErrorResponse(err, {
      PT402: 'You need all 5 PC Core Shards first.',
    });
  }
}
