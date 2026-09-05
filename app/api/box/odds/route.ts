import { requireUser } from '@/lib/session';
import { BOX_TIERS, type BoxTier } from '@/lib/types';
import { fail, playerStats, toErrorResponse, ok } from '@/app/(player)/_lib/http';
import { fetchAllOdds, fetchOdds } from '@/app/(player)/_lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/box/odds?tier=tier_2 -> BoxOdds
 * GET /api/box/odds             -> BoxOdds[]  (all three, for the price strip)
 *
 * Players get to see the real drop table. It costs nothing — the numbers are
 * already computed for the engine — and a visible, dynamically rebalancing odds
 * sheet is the whole reason anyone trusts a case-opening app.
 *
 * Read-only and signed-in-only. `box_odds` is STABLE, so the repeated polling
 * the price strip does is cheap.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();

    // Balances ride along so the box screen can poll one endpoint and pick up
    // both a flash sale and an admin-approved Venmo deposit.
    const tier = new URL(req.url).searchParams.get('tier');
    if (tier === null) {
      const [odds, stats] = await Promise.all([fetchAllOdds(user.id), playerStats(user.id)]);
      return ok(odds, { stats });
    }

    if (!BOX_TIERS.includes(tier as BoxTier)) {
      return fail('No such box.', 400);
    }
    const [odds, stats] = await Promise.all([fetchOdds(tier as BoxTier, user.id), playerStats(user.id)]);
    return ok(odds, { stats });
  } catch (err) {
    return toErrorResponse(err);
  }
}
