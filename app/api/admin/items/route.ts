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
  const stock_qty = Math.max(0, parseInt(body.stock_qty ?? 1, 10));

  const rarity: Rarity = RARITIES.includes(body.rarity)
    ? body.rarity
    : rarityForValue(est_value);

  const box_tier: BoxTier = BOX_TIERS.includes(body.box_tier)
    ? body.box_tier
    : tierForValue(est_value);

  // Enforce Anti-Exploit Rule 2
  // Coins are $1 each, so scrap_value is a dollar figure and MUST be a fraction
  // of est_value. The old `est_value * 10` paid 2x the item's worth at the old
  // coin rate, which let a player scrap a $70 monitor for $140 of credit.
  const recovery = isScrappable(rarity) ? 0.6 : 0.4;
  const scrap_value = Math.max(
    1,
    parseInt(String(body.scrap_value ?? Math.round(est_value * recovery)), 10)
  );

  const { data, error } = await db
    .from('items')
    .insert({
      name,
      description,
      image_url,
      est_value,
      rarity,
      scrap_value,
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
