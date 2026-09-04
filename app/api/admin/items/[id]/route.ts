import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import { isScrappable, RARITIES, BOX_TIERS, type BoxTier } from '@/lib/types';
import { readConfig } from '@/app/admin/_lib/config';

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

  const cfg = await readConfig();
  const coin = cfg.box_prices[cfg.scrap_key_tier] / cfg.scrap_coins_per_key;
  const highTierScrappable = cfg.allow_high_rarity_scrap === true;

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.description !== undefined) patch.description = String(body.description).trim();
  if (body.image_url !== undefined) patch.image_url = String(body.image_url).trim();
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
  if (body.est_value !== undefined) patch.est_value = Math.max(0.01, Number(body.est_value));
  // msrp is the DISPLAY price -- the number the room is shown. It was not
  // patchable at all, so the only way to correct a sticker price was to delete
  // the item and re-create it, which loses its stock history.
  if (body.msrp !== undefined) {
    const m = Number(body.msrp);
    patch.msrp = Number.isFinite(m) && m > 0 ? m : null;
  }
  if (body.rarity !== undefined && RARITIES.includes(body.rarity)) patch.rarity = body.rarity;
  if (body.box_tier !== undefined && BOX_TIERS.includes(body.box_tier as BoxTier)) {
    patch.box_tier = body.box_tier;
  }

  // Stock: keep initial_stock_qty consistent or `npm run reconcile` will report
  // this item as duplicated/lost forever. initial = what is on the shelf plus
  // what players already hold.
  if (body.stock_qty !== undefined) {
    const stock = Math.max(0, parseInt(String(body.stock_qty), 10) || 0);
    patch.stock_qty = stock;
    const { data: current } = await db.from('items').select('name').eq('id', id).maybeSingle();
    const heldName = (current as { name?: string } | null)?.name ?? String(patch.name ?? '');
    const { data: heldRows } = await db
      .from('rolls')
      .select('id')
      .eq('status', 'inventory')
      .eq('kind', 'physical')
      .eq('item_name', heldName);
    patch.initial_stock_qty = stock + (heldRows?.length ?? 0);
  }

  // Scrap value follows rarity and value unless explicitly given. Previously it
  // was only written when rarity ALSO changed, so re-pricing an item left it
  // scrapping for its old value -- a $50 item marked down to $10 still paid out
  // as if it were $50.
  const effectiveRarity = (patch.rarity ?? body._current_rarity) as string | undefined;
  if (body.scrap_value !== undefined) {
    patch.scrap_value = Math.max(0, parseInt(String(body.scrap_value), 10) || 0);
  } else if (patch.est_value !== undefined || patch.rarity !== undefined) {
    const { data: cur } = await db.from('items').select('rarity,est_value').eq('id', id).maybeSingle();
    const r = String(patch.rarity ?? (cur as { rarity?: string } | null)?.rarity ?? 'grey');
    const v = Number(patch.est_value ?? (cur as { est_value?: number } | null)?.est_value ?? 0);
    patch.scrap_value = isScrappable(r as never)
      ? Math.max(1, Math.round((v * 0.6) / coin))
      : highTierScrappable
        ? Math.max(1, Math.round((v * 0.4) / coin))
        : 0;
  }
  if (effectiveRarity && !isScrappable(effectiveRarity as never) && !highTierScrappable) {
    patch.scrap_value = 0;
  }

  if (Object.keys(patch).length === 0) return jsonErr(400, 'Nothing to change');

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
