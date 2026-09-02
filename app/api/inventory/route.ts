import { requireUser } from '@/lib/session';
import { ok, playerStats, toErrorResponse } from '@/app/(player)/_lib/http';
import { fetchInventory, fetchRecentRolls } from '@/app/(player)/_lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/inventory -> Roll[]  (physical items still on the shelf)
 *
 * Scoped to `(await requireUser()).id`, so there is no way to read another
 * player's shelf even by guessing ids. `recent` and `stats` ride along so the
 * page can refresh everything after a scrap without three round trips.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const [items, recent, stats] = await Promise.all([
      fetchInventory(user.id),
      fetchRecentRolls(user.id),
      playerStats(user.id),
    ]);
    return ok(items, { recent, stats });
  } catch (err) {
    return toErrorResponse(err);
  }
}
