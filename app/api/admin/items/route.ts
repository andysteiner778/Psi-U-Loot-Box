import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import { isScrappable, RARITIES, BOX_TIERS, type Rarity, type BoxTier } from '@/lib/types';
import { rarityForValue, tierForValue } from '@/lib/economy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/items -> Item[]
 * POST /api/admin/items -> Item
 */
export async function GET() {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const { data, error } = await db
    .from('items')
    .select('*')
    .order('box_tier', { ascending: true })
    .order('est_value', { ascending: false });

  if (error) return jsonErr(500, error.message);
  return jsonOk(data);
}

export async function POST(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = await readJson<any>(req);
  if (!body || !body.name || !body.est_value) {
    return jsonErr(400, 'Missing name or est_value');
  }

  const name = String(body.name).trim();
  const description = body.description ? String(body.description).trim() : null;
  const image_url = body.image_url ? String(body.image_url).trim() : null;
  const est_value = Math.max(0.01, Number(body.est_value));
  // Display only. Never feeds the odds -- see items.msrp in migration 0008.
  const msrpRaw = Number(body.msrp);
  const msrp = Number.isFinite(msrpRaw) && msrpRaw > 0 ? msrpRaw : null;
  const stock_qty = Math.max(0, parseInt(body.stock_qty ?? 1, 10));

  const rarity: Rarity = RARITIES.includes(body.rarity)
    ? body.rarity
    : rarityForValue(est_value);

  const box_tier: BoxTier = BOX_TIERS.includes(body.box_tier)
    ? body.box_tier
    : tierForValue(est_value);

  // Enforce Anti-Exploit Rule 2
  // High tier items (purple, pink, gold) cannot be scrapped and must have scrap_value = 0
  // to satisfy the high_tier_never_scrappable CHECK constraint.
  // For scrappable items (grey, blue), recovery is 60% of est_value in 10-cent coins (migration 0015).
  const scrap_value = isScrappable(rarity)
    ? Math.max(1, parseInt(String(body.scrap_value ?? Math.round((est_value * 0.60) / 0.10)), 10))
    : 0;

  // Adding the same name twice splits one pile into two entries with separate
  // stock, which then compete for probability as if they were different items.
  // Bulk intake makes this easy to do by accident -- two photos of the same
  // drawer -- so fold the quantity into the existing row instead.
  const { data: existing } = await db
    .from('items')
    .select('id, stock_qty')
    .ilike('name', name)
    .maybeSingle();

  if (existing) {
    const { data: merged, error: mErr } = await db
      .from('items')
      .update({ stock_qty: existing.stock_qty + stock_qty })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (mErr) return jsonErr(400, mErr.message);
    return jsonOk(merged);
  }

  const { data, error } = await db
    .from('items')
    .insert({
      name,
      description,
      image_url,
      est_value,
      rarity,
      scrap_value,
      msrp,
      stock_qty,
      box_tier,
      is_active: body.is_active !== false,
    })
    .select('*')
    .single();

  if (error) {
    return jsonErr(400, error.message);
  }

  return jsonOk(data, 201);
}
