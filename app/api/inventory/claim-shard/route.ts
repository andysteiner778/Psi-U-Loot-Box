import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/session';
import { db, rpcErrorStatus } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory/claim-shard  { itemId }
 *
 * Spend shards on a shard-locked prize. The user id comes from the session, so
 * a player cannot spend someone else's shards by editing the request.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { itemId?: string } | null;
  if (!body?.itemId) {
    return NextResponse.json({ ok: false, error: 'Missing itemId' }, { status: 400 });
  }

  const { data, error } = await db.rpc('claim_with_shards', {
    p_user_id: user.id,
    p_item_id: body.itemId,
  });
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: rpcErrorStatus(error) }
    );
  }
  return NextResponse.json({ ok: true, data });
}
