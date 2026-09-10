import io
p='app/api/admin/items/[id]/route.ts'
s=io.open(p,encoding='utf-8').read()

# --- imports -------------------------------------------------------------
s = s.replace(
  "import { isScrappable, RARITIES, BOX_TIERS, type BoxTier } from '@/lib/types';",
  "import { RARITIES, BOX_TIERS, type BoxTier, type Rarity } from '@/lib/types';", 1)
s = s.replace(
  "import { scrapCoinUsd } from '@/lib/economy';",
  "import { scrapValueCoins, tierForRetail } from '@/lib/scrap';", 1)

# --- drop the old coin preamble -----------------------------------------
start = s.index('  const cfg = await readConfig();')
end   = s.index('  const patch: Record<string, unknown> = {};')
s = s[:start] + '  const cfg = await readConfig();\n\n' + s[end:]

# --- est_value may be 0 --------------------------------------------------
s = s.replace(
  "  if (body.est_value !== undefined) patch.est_value = Math.max(0.01, Number(body.est_value));",
  "  // 0 is legal and means \"not priced yet\", exactly as on the create route --\n"
  "  // this clamped it up to $0.01, which is a PRICE, and quietly put an unpriced\n"
  "  // item into the draw pool.\n"
  "  if (body.est_value !== undefined) patch.est_value = Math.max(0, Number(body.est_value) || 0);", 1)

# --- replace the whole scrap block --------------------------------------
start = s.index('  // Scrap value follows rarity and value unless explicitly given.')
end   = s.index("  if (Object.keys(patch).length === 0) return jsonErr(400, 'Nothing to change');")

NEW = """  /*
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

"""
s = s[:start] + NEW + s[end:]
io.open(p,'w',encoding='utf-8').write(s)
