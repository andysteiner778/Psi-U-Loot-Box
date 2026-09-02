import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import { isScrappable, RARITIES, type Rarity } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/items/[id]   { stock_qty, is_active, est_value, name, ... }
 * DELETE /api/admin/items/[id]
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const body = await readJson<any>(req);
  if (!body) return jsonErr(400, 'Missing body');

  const patch: Record<string, any> = {};
  if (body.stock_qty !== undefined) patch.stock_qty = Math.max(0, parseInt(body.stock_qty, 10));
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.description !== undefined) patch.description = String(body.description).trim();
  if (body.image_url !== undefined) patch.image_url = String(body.image_url).trim();
  if (body.est_value !== undefined) patch.est_value = Math.max(0.01, Number(body.est_value));
  if (body.rarity !== undefined && RARITIES.includes(body.rarity)) {
    patch.rarity = body.rarity;
    if (!isScrappable(body.rarity)) patch.scrap_value = 0;
  }
  if (body.scrap_value !== undefined && patch.rarity && isScrappable(patch.rarity)) {
    patch.scrap_value = Math.max(0, parseInt(body.scrap_value, 10));
  }

  const { data, error } = await db
    .from('items')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return jsonErr(400, error.message);
  return jsonOk(data);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const { error } = await db.from('items').delete().eq('id', id);
  if (error) return jsonErr(400, error.message);
  return jsonOk({ ok: true });
}
