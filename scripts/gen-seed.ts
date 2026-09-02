/**
 * Generates supabase/seed.sql from lib/catalog.ts.
 *
 *   npm run seed:gen
 *
 * Do not hand-edit the generated SQL — edit the catalog and re-run this, so the
 * economy simulation and the database always describe the same house.
 */

import { writeFileSync } from 'fs';
import { RESOLVED_CATALOG, SEED_PLAYERS } from '../lib/catalog';

const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";

const lines: string[] = [
  '-- ============================================================================',
  '--  HOUSE LOOT — SEED DATA',
  '--  GENERATED FILE. Edit lib/catalog.ts and run `npm run seed:gen` instead.',
  '-- ============================================================================',
  '',
  '-- Idempotent: safe to re-run.',
  'TRUNCATE public.drop_overrides, public.rolls, public.deposits CASCADE;',
  'DELETE FROM public.items;',
  '',
  '-- ---------------------------------------------------------------------------',
  '--  Players. Everyone starts on PIN 1234 with must_change = TRUE, so the app',
  '--  forces a change on first login. The first player is the admin.',
  '-- ---------------------------------------------------------------------------',
];

SEED_PLAYERS.forEach((name, i) => {
  lines.push(
    `INSERT INTO public.profiles (name, role) VALUES (${q(name)}, ${q(i === 0 ? 'admin' : 'player')})`,
    `  ON CONFLICT (name) DO NOTHING;`
  );
});

lines.push(
  '',
  '-- Hash the default PIN for anyone who has no secret row yet.',
  'INSERT INTO app_private.profile_secrets (profile_id, pin_hash, must_change)',
  "SELECT p.id, extensions.crypt('1234', extensions.gen_salt('bf', 10)), TRUE",
  '  FROM public.profiles p',
  ' WHERE NOT EXISTS (SELECT 1 FROM app_private.profile_secrets s WHERE s.profile_id = p.id);',
  '',
  '-- ---------------------------------------------------------------------------',
  '--  The house. Rarity and tier are derived from value by lib/catalog.ts using',
  "--  the spec's own bands, and purple/pink/gold carry scrap_value = 0 so the",
  '--  database itself refuses to let them be recycled (anti-exploit rule 2).',
  '-- ---------------------------------------------------------------------------'
);

let totalValue = 0;
for (const it of RESOLVED_CATALOG) {
  totalValue += it.est_value * it.stock_qty;
  lines.push(
    `INSERT INTO public.items (name, description, est_value, rarity, scrap_value, stock_qty, box_tier) VALUES`,
    `  (${q(it.name)}, ${q(it.description)}, ${it.est_value}, ${q(it.rarity)}, ${it.scrap_value}, ${it.stock_qty}, ${q(it.box_tier)});`
  );
}

const byTier: Record<string, { n: number; v: number }> = {};
for (const it of RESOLVED_CATALOG) {
  byTier[it.box_tier] ??= { n: 0, v: 0 };
  byTier[it.box_tier].n += it.stock_qty;
  byTier[it.box_tier].v += it.est_value * it.stock_qty;
}

lines.push(
  '',
  '-- ---------------------------------------------------------------------------',
  `--  Catalog totals: ${RESOLVED_CATALOG.length} distinct items, ` +
    `${RESOLVED_CATALOG.reduce((a, i) => a + i.stock_qty, 0)} units, $${totalValue.toFixed(2)} of goods.`,
  ...Object.entries(byTier).map(
    ([t, s]) => `--    ${t}: ${s.n} units worth $${s.v.toFixed(2)}`
  ),
  '--',
  '--  At a 20% house margin the pot needs roughly $' +
    (totalValue / 0.8).toFixed(0) +
    ' in deposits to clear all of it.',
  '-- ---------------------------------------------------------------------------',
  ''
);

writeFileSync('supabase/seed.sql', lines.join('\n'));
console.log(
  'wrote supabase/seed.sql — ' +
    SEED_PLAYERS.length +
    ' players, ' +
    RESOLVED_CATALOG.length +
    ' items, $' +
    totalValue.toFixed(2) +
    ' of goods'
);
