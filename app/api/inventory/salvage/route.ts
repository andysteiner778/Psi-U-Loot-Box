import { requireUser } from '@/lib/session';
import { callRpc, fail, ok, playerStats, readJson, toErrorResponse } from '@/app/(player)/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory/salvage   { count } -> { ok, salvaged, credit }
 *
 * Anti-exploit rule 3's escape hatch. Shards are soulbound, so a player who
 * gives up on the PC cannot sell or gift them — they can only hand them back
 * for one free Tier-2 roll each. `salvage_shards` also returns the shards to
 * global supply, which is what keeps the PC winnable by somebody else.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const count = Number(body.count);

    if (!Number.isInteger(count) || count < 1 || count > 100) {
      return fail('How many shards?', 400);
    }

    const result = await callRpc<{ ok: boolean; salvaged: number; credit: number }>(
      'salvage_shards',
      { p_user_id: user.id, p_count: count }
    );

    return ok(result, { stats: await playerStats(user.id) });
  } catch (err) {
    return toErrorResponse(err, {
      PT402: "You don't have that many shards.",
    });
  }
}
