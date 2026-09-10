import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import { RARITIES, BOX_TIERS, type BoxTier, type Rarity } from '@/lib/types';
import { readConfig } from '@/app/admin/_lib/config';
import { scrapValueCoins, tierForRetail } from '@/lib/scrap';

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

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.description !== undefined) patch.description = String(body.description).trim();
  if (body.image_url !== undefined) patch.image_url = String(body.image_url).trim();
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
  // 0 is legal and means "not priced yet", exactly as on the create route --
  // this clamped it up to $0.01, which is a PRICE, and quietly put an unpriced
  // item into the draw pool.
  if (body.est_value !== undefined) patch.est_value = Math.max(0, Number(body.est_value) || 0);
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

  /*
   * Scrap value and box tier come from lib/scrap.ts, the same module the create
   * form and `npm run rebase-scrap` use. Editing an item used to derive scrap
   * from est_value here with a locally written formula, so the same item was
   * worth different amounts depending on which screen last touched it, and
   * every edit had to be undone by re-running the rebase script.
   *
   * Both are recomputed from the item AS IT WILL BE -- current row merged with
   * this patch -- because retail, rarity and tier all feed the answer, and the
   * old code only recomputed when est_value or rarity changed. Re-pricing the
   * retail of an item left it scrapping for its old value.
   */
  const { data: curRow } = await db
    .from('items')
    .select('rarity,est_value,msrp,box_tier,shard_cost,reward_credit,reward_voucher_tier')
    .eq('id', id)
    .maybeSingle();
  const cur = (curRow ?? {}) as Record<string, unknown>;

  const nextMsrp = (patch.msrp !== undefined ? patch.msrp : cur.msrp) as number | null;

  // Retail decides the box, but only when the admin has not chosen one by hand
  // in this same edit -- an explicit tier is a deliberate override.
  if (patch.box_tier === undefined && patch.msrp !== undefined && nextMsrp) {
    patch.box_tier = tierForRetail(Number(nextMsrp));
  }

  const merged = {
    est_value: Number(patch.est_value ?? cur.est_value ?? 0),
    msrp: nextMsrp,
    rarity: String(patch.rarity ?? cur.rarity ?? 'grey') as Rarity,
    box_tier: String(patch.box_tier ?? cur.box_tier ?? 'tier_0') as BoxTier,
    shard_cost: (cur.shard_cost ?? null) as number | null,
    reward_credit: (cur.reward_credit ?? null) as number | null,
    reward_voucher_tier: (cur.reward_voucher_tier ?? null) as BoxTier | null,
  };
  const autoScrap = scrapValueCoins(merged, cfg);

  if (body.scrap_value !== undefined) {
    // A hand-typed figure still wins, but never above what the rule allows --
    // the cap is what stops an item paying back more than its box costs.
    patch.scrap_value = Math.min(
      Math.max(0, parseInt(String(body.scrap_value), 10) || 0),
      Math.max(autoScrap, 0)
    );
  } else {
    patch.scrap_value = autoScrap;
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
