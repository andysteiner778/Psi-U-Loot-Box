import { requireUser } from '@/lib/session';
import { BOX_TIERS, type BoxTier, type OpenBoxResult } from '@/lib/types';
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
 * POST /api/box/open   { tier, clientRollId } -> OpenBoxResult
 *
 * Three things make this safe, and all three are load-bearing:
 *
 *   1. `p_user_id` is `(await requireUser()).id`. Never the body. A route that
 *      trusts a client-supplied user id lets anyone spend anyone's balance.
 *   2. There is no price parameter. `open_box` derives the price from the tier
 *      server-side, so nobody rolls tier 3 for a penny.
 *   3. `clientRollId` is UNIQUE on `rolls`, so a double-tap on a phone or a
 *      fetch the browser silently retried returns the ORIGINAL result instead
 *      of charging twice. It is required, not optional — a missing one turns a
 *      flaky connection into a duplicate charge.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const tier = body.tier;
    const clientRollId = body.clientRollId;

    if (typeof tier !== 'string' || !BOX_TIERS.includes(tier as BoxTier)) {
      return fail('No such box.', 400);
    }
    if (!isUuid(clientRollId)) {
      return fail('Missing roll id — refresh and try again.', 400);
    }

    const result = await callRpc<OpenBoxResult>('open_box', {
      p_user_id: user.id,
      p_box_tier: tier as BoxTier,
      p_client_roll_id: clientRollId,
    });

    return ok(result, { stats: await playerStats(user.id) });
  } catch (err) {
    return toErrorResponse(err, {
      PT402: 'Not enough credits',
      PT404: 'We could not find your account. Sign in again.',
    });
  }
}
