import { requireUser } from '@/lib/session';
import {
  callRpc,
  fail,
  isUuid,
  ok,
  playerStats,
  readJson,
  toErrorResponse,
} from '@/app/(player)/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory/scrap   { rollId } -> { ok, scrap_gained }
 *
 * Anti-exploit rule 2 lives in `scrap_item`, not here: purple/pink/gold raise
 * PT403 in SQL. The UI hides the button for those rarities as a courtesy, but
 * the courtesy is not the control — a PT403 reaching this handler means the UI
 * drifted, which is why it gets its own message rather than a generic 403.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const rollId = body.rollId;

    if (!isUuid(rollId)) return fail('Which item?', 400);

    const result = await callRpc<{ ok: boolean; scrap_gained: number }>('scrap_item', {
      p_user_id: user.id,
      p_roll_id: rollId,
    });

    return ok(result, { stats: await playerStats(user.id) });
  } catch (err) {
    return toErrorResponse(err, {
      PT403: 'Restricted, Covert and Special items are physical pickup only.',
      PT409: 'That one is already gone.',
    });
  }
}
