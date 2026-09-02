import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/override -> DropOverride[]
 * POST /api/admin/override   { userId, itemId } -> DropOverride
 * DELETE /api/admin/override?userId=... -> { ok }
 */
export async function GET() {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const { data, error } = await db
    .from('drop_overrides')
    .select(`
      user_id,
      item_id,
      created_at,
      profiles:user_id ( name ),
      items:item_id ( name, rarity, est_value, box_tier )
    `);

  if (error) return jsonErr(500, error.message);
  return jsonOk(data);
}

export async function POST(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = await readJson<{ userId?: string; itemId?: string }>(req);
  if (!body?.userId || !body?.itemId) {
    return jsonErr(400, 'Missing userId or itemId');
  }

  const { data, error } = await db
    .from('drop_overrides')
    .upsert({
      user_id: body.userId,
      item_id: body.itemId,
      created_by: gate.id,
    })
    .select('*')
    .single();

  if (error) return jsonErr(400, error.message);
  return jsonOk(data);
}

export async function DELETE(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return jsonErr(400, 'Missing userId');

  const { error } = await db
    .from('drop_overrides')
    .delete()
    .eq('user_id', userId);

  if (error) return jsonErr(400, error.message);
  return jsonOk({ ok: true });
}
