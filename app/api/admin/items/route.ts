import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import { isScrappable, RARITIES, BOX_TIERS, type Rarity, type BoxTier } from '@/lib/types';
import { rarityForValue, tierForValue, scrapCoinUsd } from '@/lib/economy';
import { readConfig } from '@/app/admin/_lib/config';

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

  // Scrap recovery, in 10-cent coins (migration 0015).
  //
  //   grey / blue          60% of est_value, always
  //   purple / pink / gold 40% when `allow_high_rarity_scrap` is on, else 0
  //
  // The lower rate on the good stuff is deliberate: scrapping a $70 monitor
  // returns it to the pool, so the house should not be paying near its value
  // to get it back. `scrap_item` is the authority on whether the action is
  // permitted at all; this only decides what the item is WORTH if it is.
  //
  // The previous version forced 0 for high tiers unconditionally, which
  // silently disabled the feature for any item an admin edited -- and cited a
  // `high_tier_never_scrappable` CHECK constraint that does not exist.
  const cfg = await readConfig();
  /*
   * Was `cfg.box_prices[cfg.scrap_key_tier] / cfg.scrap_coins_per_key` -- the
   * KEY TIER'S BOX PRICE over coins-per-key, $10/50 = $0.20. The engine,
   * box_odds and the audit all use scrapCoinUsd: scrap_key_usd over
   * coins-per-key, $1/50 = $0.02. Ten times apart, so every item created or
   * edited through this route got a scrap_value a tenth of what it should be,
   * and the audit reported it as "scraps for 4%, config promises 40%".
   */
  const coin = scrapCoinUsd(cfg);
  const highTierScrappable = cfg.allow_high_rarity_scrap === true;

  /*
   * The Math.max(1, ...) floor guarantees a scrappable item is worth at least
   * one coin -- which quietly becomes a way to MINT money once items get cheap
   * enough. A coin is $0.02; a $0.01 item floored to one coin scraps for twice
   * what it is worth, so the compactor turns junk into profit.
   *
   * Cap the floor at what the item is actually worth: below one coin, the item
   * simply is not scrappable. The UI already handles that case ("not worth
   * enough to scrap -- take it home instead"), which is the right outcome for
   * a 1c item you would rather someone just took away.
   */
  const affordableCoins = Math.floor(est_value / coin);
  const withFloor = (raw: number) => Math.min(Math.max(1, raw), affordableCoins);

  let scrap_value: number;
  if (isScrappable(rarity)) {
    scrap_value = withFloor(parseInt(String(body.scrap_value ?? Math.round((est_value * 0.6) / coin)), 10));
  } else if (highTierScrappable) {
    scrap_value = withFloor(Math.round((est_value * 0.4) / coin));
  } else {
    scrap_value = 0;
  }

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
