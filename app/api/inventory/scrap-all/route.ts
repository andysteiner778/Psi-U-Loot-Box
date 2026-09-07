import { requireUser } from '@/lib/session';
import { callRpc, ok, playerStats, toErrorResponse } from '@/app/(player)/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ScrapAllResult {
  ok: boolean;
  scrapped: number;
  scrap_gained: number;
  items: { name: string; coins: number }[];
}

/**
 * POST /api/inventory/scrap-all  -> { ok, scrapped, scrap_gained, items }
 *
 * Takes no body on purpose. "Everything of mine that is eligible" is a fact
 * the server can work out from the session; accepting a list of roll ids would
 * let the client nominate rows, which is the same shape of hole as accepting a
 * box price. The user id comes from the cookie and nowhere else.
 *
 * `scrap_all` calls `scrap_item` per row inside one transaction, so the rarity
 * and minimum-value rules cannot drift from the single-item path, and a
 * refusal rolls the whole batch back rather than half-emptying the shelf.
 */
export async function POST() {
  try {
    const user = await requireUser();
    const result = await callRpc<ScrapAllResult>('scrap_all', { p_user_id: user.id });
    return ok(result, { stats: await playerStats(user.id) });
  } catch (err) {
    return toErrorResponse(err, {
      PT403: 'Restricted, Covert and Special items are physical pickup only.',
      PT409: 'Your shelf changed while that was running — reopen and try again.',
    });
  }
}
