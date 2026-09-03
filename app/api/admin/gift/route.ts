import { adminOrError } from '@/app/admin/_lib/guard';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import { db, rpcErrorStatus } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/gift  { userId, tier, count, note? }
 *
 * Credits the player with `count` boxes' worth of balance and records it in the
 * gifts ledger -- deliberately NOT in `deposits`, so a gift never counts as
 * revenue toward the pot gate or the house's books.
 */
export async function POST(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = await readJson<{ userId?: string; tier?: string; count?: number; note?: string }>(req);
  if (!body?.userId || !body?.tier) return jsonErr(400, 'Missing userId or tier');

  const count = Math.trunc(Number(body.count ?? 1));
  if (!Number.isFinite(count) || count < 1 || count > 50) {
    return jsonErr(400, 'Gift between 1 and 50 spins');
  }

  const { data, error } = await db.rpc('admin_grant_spins', {
    p_admin_id: gate.id,
    p_user_id: body.userId,
    p_box_tier: body.tier,
    p_count: count,
    p_note: body.note ?? null,
  });
  if (error) return jsonErr(rpcErrorStatus(error), error.message);
  return jsonOk(data);
}
