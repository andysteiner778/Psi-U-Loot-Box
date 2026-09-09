import { requireUser } from '@/lib/session';
import { callRpc, fail, ok, readJson, toErrorResponse } from '@/app/(player)/_lib/http';
import { BOX_TIERS, type BoxTier, type OpenBoxResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/box/preview   { tier } -> { data: OpenBoxResult & { preview: true } }
 *
 * A free test spin: what you WOULD have won. `preview_box` runs the real
 * open_box inside a subtransaction and throws the subtransaction away, so there
 * is exactly one copy of the draw logic and nothing is charged, decremented or
 * recorded.
 *
 * No `stats` in the response, deliberately — nothing changed, and handing back
 * a stats object would invite the client to commit it.
 *
 * Not rate-limited: the real roll draws its own fresh random(), so previewing
 * repeatedly tells a player nothing about their next paid spin. It is a shop
 * window, not the answer sheet.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const tier = String(body.tier ?? '');
    if (!BOX_TIERS.includes(tier as BoxTier)) return fail('Unknown box', 400);

    const result = await callRpc<OpenBoxResult>('preview_box', {
      p_user_id: user.id,
      p_box_tier: tier,
    });
    return ok(result);
  } catch (err) {
    return toErrorResponse(err, {
      PT423: 'That box is empty — nothing to preview.',
    });
  }
}
