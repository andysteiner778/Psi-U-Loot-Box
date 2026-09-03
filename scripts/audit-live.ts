/**
 * LIVE ECONOMY AUDIT
 *
 *   npm run audit
 *
 * `npm run simulate` proves the ENGINE is solvent against a fixture catalog.
 * This asks the different, and more important, question: is the economy sane
 * against the items that are actually in the database right now?
 *
 * Read-only. Touches nothing.
 */

import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { computeBoxOdds, marginForTier, DEFAULT_CONFIG, scrapCoinUsd } from '../lib/economy';
import { BOX_TIERS, RARITY_LABEL, type BoxTier, type EconomyConfig, type Item } from '../lib/types';

denv({ path: '.env.local', quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const usd = (n: number) => '$' + n.toFixed(2);
const pct = (n: number) => (n * 100).toFixed(1) + '%';
const pad = (s: string, n: number) => s.padEnd(n);

let warnings = 0;
const warn = (m: string) => {
  warnings++;
  console.log('  !!  ' + m);
};

async function main() {
  const { data: cfgRow } = await db.from('config').select('value').eq('key', 'settings').single();
  const cfg = { ...DEFAULT_CONFIG, ...(cfgRow?.value as Partial<EconomyConfig>) } as EconomyConfig;

  const { data: rawItems } = await db.from('items').select('*').order('est_value', { ascending: false });
  const items = (rawItems ?? []) as Item[];
  const locked = items.filter((i) => (i.shard_cost ?? 0) > 0);

  const { data: deps } = await db.from('deposits').select('amount').eq('status', 'approved');
  const pot = (deps ?? []).reduce((a, d) => a + Number(d.amount), 0);
  const gateMet = pot >= cfg.pot_revenue_threshold;

  console.log('\n================================================================');
  console.log(' LIVE ECONOMY AUDIT — the real catalog, right now');
  console.log('================================================================\n');

  const active = items.filter((i) => i.is_active && i.stock_qty > 0);
  const units = active.reduce((a, i) => a + i.stock_qty, 0);
  const value = active.reduce((a, i) => a + Number(i.est_value) * i.stock_qty, 0);

  console.log(' catalog        ' + items.length + ' items, ' + units + ' units in stock, ' + usd(value) + ' of goods');
  const overrides = BOX_TIERS.filter((t) => marginForTier(cfg, t) !== cfg.house_margin);
  console.log(' house margin   ' + pct(cfg.house_margin) +
    (overrides.length
      ? '   (' + overrides.map((t) => t + ' ' + pct(marginForTier(cfg, t))).join(', ') + ')'
      : ''));
  console.log(' pot            ' + usd(pot) + ' / ' + usd(cfg.pot_revenue_threshold) +
    '  -> shard gate ' + (gateMet ? 'OPEN' : 'shut'));
  console.log(' scrap coin     ' + usd(scrapCoinUsd(cfg)) + '   compactor: ' +
    cfg.scrap_coins_per_key + ' coins -> ' + usd(cfg.box_prices[cfg.scrap_key_tier]));

  if (locked.length) {
    // The number that matters is EXPECTED REAL SPEND to farm the shards, not
    // the EV the engine charges per shard. Those are different questions, and
    // measuring the wrong one made a perfectly healthy PC price look like a
    // $300 subsidy. Cost per shard = box_price / P(shard), taking whichever
    // tier is cheapest, because that is the route a determined player will use.
    let cheapest = Infinity;
    let cheapestTier = '';
    for (const t of BOX_TIERS) {
      const p = cfg.shard_probs[t];
      if (!p) continue;
      const per = cfg.box_prices[t] / p;
      if (per < cheapest) {
        cheapest = per;
        cheapestTier = t;
      }
    }

    console.log('\n shard-locked prizes (claimed with shards, never dropped):');
    console.log('   cheapest shard farming: ' + cheapestTier + ' at ' + usd(cheapest) + ' per shard');
    console.log('   ' + pad('prize', 30) + pad('value', 10) + pad('shards', 9) +
      pad('to farm', 11) + 'verdict');

    for (const l of locked) {
      const cost = (l.shard_cost ?? 1) * cheapest;
      const v = Number(l.est_value);
      const ahead = cost - v;
      console.log('   ' + pad(l.name.slice(0, 28), 30) + pad(usd(v), 10) +
        pad(String(l.shard_cost), 9) + pad(usd(cost), 11) +
        (ahead >= 0 ? 'house +' + usd(ahead) : 'PLAYER +' + usd(-ahead)));

      if (ahead < 0) {
        warn(l.name + ' is farmable for ' + usd(cost) + ' but worth ' + usd(v) +
          ' — players profit by grinding shards for it.');
      } else if (ahead > v * 1.5) {
        warn(l.name + ' costs ' + usd(cost) + ' to farm for a ' + usd(v) +
          ' item — nobody will bother. Lower its shard_cost.');
      }
    }
  }

  // ---- per tier -----------------------------------------------------------
  for (const tier of BOX_TIERS) {
    // Mirrors box_odds: this tier's own items, plus anything dear enough to
    // qualify as a cross-tier long shot, plus cheap items from other tiers that
    // serve as the floor anchor.
    const fillerMax = cfg.filler_max_value ?? 15;
    const pool = active.filter(
      (i) =>
        i.box_tier === tier ||
        Number(i.est_value) > fillerMax ||
        (tier !== 'tier_0' && Number(i.est_value) <= fillerMax)
    );
    const native = pool.filter((i) => i.box_tier === tier);
    const o = computeBoxOdds({ tier, items: pool, config: cfg, potGateMet: gateMet });

    console.log('\n----------------------------------------------------------------');
    console.log(' ' + tier.toUpperCase() + '   ' + usd(o.box_price) + ' box   ' +
      native.length + ' native items (' + native.reduce((a, i) => a + i.stock_qty, 0) + ' units)');
    console.log('----------------------------------------------------------------');
    console.log('   budget ' + usd(o.target_ev) + '   payout ' + usd(o.total_ev) +
      '   margin ' + pct(o.realized_margin));
    console.log('   P(real prize) ' + pct(o.p_physical) +
      '   P(shard) ' + pct(o.p_shard) +
      '   P(respin) ' + pct(o.p_respin) +
      '   P(junk/coins) ' + pct(o.p_scrap));

    if (native.length === 0) warn(tier + ' has NO items of its own — every win is borrowed junk.');
    const tierMargin = marginForTier(cfg, tier);
    if (o.realized_margin > tierMargin + 0.05) {
      warn(tier + ' is overcharging: keeping ' + pct(o.realized_margin) +
        ' against a target of ' + pct(tierMargin) + '.');
    }
    if (o.realized_margin < -0.001) warn(tier + ' LOSES money: ' + pct(-o.realized_margin) + ' per roll.');
    for (const w of o.warnings) warn(tier + ': ' + w);

    // The gate being shut makes every tier look thinner than it will be on the
    // night, because the whole shard slice shows as respin/junk. Project both.
    if (!gateMet) {
      const open = computeBoxOdds({ tier, items: pool, config: cfg, potGateMet: true });
      console.log('   once the pot passes ' + usd(cfg.pot_revenue_threshold) + ':  ' +
        'P(prize) ' + pct(open.p_physical) +
        '   P(shard) ' + pct(open.p_shard) +
        '   P(respin) ' + pct(open.p_respin) +
        '   P(junk) ' + pct(open.p_scrap));
    }

    const top = [...o.items].sort((a, b) => b.probability - a.probability).slice(0, 8);
    if (top.length) {
      console.log('\n   most likely items in this box:');
      console.log('     ' + pad('item', 30) + pad('value', 10) + pad('rarity', 12) + pad('stock', 7) + 'chance');
      for (const it of top) {
        console.log('     ' + pad(it.name.slice(0, 29), 30) + pad(usd(it.est_value), 10) +
          pad(RARITY_LABEL[it.rarity], 12) + pad(String(it.stock_qty), 7) + pct(it.probability));
      }
    }
  }

  // ---- whole-party view ---------------------------------------------------
  console.log('\n================================================================');
  console.log(' WHAT THIS MEANS FOR THE PARTY');
  console.log('================================================================');
  const needed = value / (1 - cfg.house_margin);
  console.log(' To clear ' + usd(value) + ' of goods, players must deposit about ' + usd(needed) + '.');
  console.log(' Across 12 buyers that is ' + usd(needed / 12) + ' each; across 20, ' + usd(needed / 20) + ' each.');

  // Built from BOX_TIERS so a new tier cannot be silently omitted from the
  // summary -- which is exactly what happened when tier_0 was added.
  const byTier = Object.fromEntries(
    BOX_TIERS.map((t) => [t, { n: 0, v: 0 }])
  ) as Record<BoxTier, { n: number; v: number }>;
  for (const i of active) {
    byTier[i.box_tier].n += i.stock_qty;
    byTier[i.box_tier].v += Number(i.est_value) * i.stock_qty;
  }
  console.log('');
  for (const t of BOX_TIERS) {
    console.log(' ' + pad(t, 9) + pad(byTier[t].n + ' units', 12) + usd(byTier[t].v));
  }

  console.log('\n----------------------------------------------------------------');
  if (warnings === 0) console.log(' No problems found. The economy is solvent against the real catalog.');
  else console.log(' ' + warnings + ' thing(s) worth looking at above (marked !!).');
  console.log('----------------------------------------------------------------\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
