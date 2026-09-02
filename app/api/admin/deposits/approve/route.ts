import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/deposits/approve   { depositId } -> { ok, amount }
 */
export async function POST(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = await readJson<{ depositId?: string }>(req);
  const depositId = body?.depositId;

  if (!depositId || typeof depositId !== 'string') {
    return jsonErr(400, 'Missing depositId');
  }

  const { data, error } = await db.rpc('approve_deposit', {
    p_deposit_id: depositId,
    p_admin_id: gate.id,
  });

  if (error) {
    return jsonErr(400, error.message, error.code);
  }

  return jsonOk(data);
}
