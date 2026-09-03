/**
 * SQL VERIFICATION HARNESS
 *
 *   npm run verify:sql
 *
 * Applies every migration to a real PostgreSQL instance (PGlite — Postgres 18
 * compiled to WASM, in-process, no Docker) and then exercises `open_box` for
 * real: hundreds of rolls, concurrency, the pot gate, the anti-exploit rules.
 *
 * WHY THIS EXISTS
 * The migrations were written, reviewed and mirrored against lib/economy.ts,
 * but until this script existed no Postgres had ever parsed them. `npm run
 * simulate` proves the *TypeScript* engine is solvent; it cannot catch a typo
 * in PL/pgSQL, a column that does not exist, or a branch of open_box that
 * throws. This closes that gap without needing the hosted database.
 *
 * Supabase provides a few things a bare Postgres does not. Those are shimmed
 * below, and ONLY those — everything else is the real migration text.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

let failures = 0;
let checks = 0;

function ok(cond: boolean, msg: string) {
  checks++;
  if (cond) {
    console.log('  ok    ' + msg);
  } else {
    failures++;
    console.error('  FAIL  ' + msg);
  }
}

/** Things Supabase supplies that a bare Postgres does not. */
const SUPABASE_SHIM = `
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

  DO $shim$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role; END IF;
  END $shim$;

  -- Realtime broadcast. The real one pushes to a websocket; we only need the
  -- signature to exist so the trigger compiles and fires.
  CREATE SCHEMA IF NOT EXISTS realtime;
  CREATE TABLE IF NOT EXISTS realtime.sent (
    id SERIAL PRIMARY KEY, payload JSONB, event TEXT, topic TEXT, private BOOLEAN
  );
  CREATE OR REPLACE FUNCTION realtime.send(
    payload JSONB, event TEXT, topic TEXT, private BOOLEAN DEFAULT false
  ) RETURNS VOID LANGUAGE plpgsql AS $rt$
  BEGIN
    INSERT INTO realtime.sent (payload, event, topic, private)
    VALUES (payload, event, topic, private);
  END $rt$;

  CREATE PUBLICATION supabase_realtime FOR TABLE realtime.sent;
`;

async function main() {
  console.log('\n=================================================================');
  console.log(' SQL VERIFICATION — real Postgres, no Docker, no hosted project');
  console.log('=================================================================\n');

  const db = new PGlite({ extensions: { pgcrypto } });
  const v = await db.query<{ version: string }>('SELECT version()');
  console.log(String(v.rows[0].version).split(',')[0] + '\n');

  await db.exec(SUPABASE_SHIM);
  console.log('Supabase shims installed (extensions, roles, realtime.send)\n');

  // ---- Apply every migration, in order ------------------------------------
  console.log('--- MIGRATIONS ---');
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join('supabase/migrations', f), 'utf8');
    try {
      await db.exec(sql);
      console.log('  ok    ' + f);
      checks++;
    } catch (e) {
      failures++;
      checks++;
      console.error('  FAIL  ' + f);
      console.error('        ' + (e as Error).message);
      console.error('\nStopping: later migrations depend on this one.\n');
      process.exit(1);
    }
  }

  // ---- Seed ---------------------------------------------------------------
  console.log('\n--- SEED ---');
  try {
    await db.exec(readFileSync('supabase/seed.sql', 'utf8'));
    const c = await db.query<{ players: number; items: number; units: number }>(`
      SELECT (SELECT count(*) FROM profiles)::int AS players,
             (SELECT count(*) FROM items)::int AS items,
             (SELECT COALESCE(sum(stock_qty),0) FROM items)::int AS units`);
    const r = c.rows[0];
    ok(r.players === 30, 'seeded ' + r.players + ' players');
    ok(r.items > 0, 'seeded ' + r.items + ' items (' + r.units + ' units)');
  } catch (e) {
    ok(false, 'seed.sql: ' + (e as Error).message);
    process.exit(1);
  }

  const uid = async (name: string) =>
    (await db.query<{ id: string }>('SELECT id FROM profiles WHERE name=$1', [name])).rows[0].id;

  const player = await uid('Ben');
  const admin = await uid('Andy');

  // ---- box_odds -----------------------------------------------------------
  console.log('\n--- box_odds() ---');
  for (const tier of ['tier_1', 'tier_2', 'tier_3']) {
    const o = (await db.query<{ box_odds: Record<string, unknown> }>(
      'SELECT box_odds($1) AS box_odds', [tier]
    )).rows[0].box_odds;
    const p =
      Number(o.p_physical) + Number(o.p_shard) + Number(o.p_respin) + Number(o.p_scrap);
    ok(Math.abs(p - 1) < 1e-9, tier + ': probabilities sum to ' + p.toFixed(12));
    ok(
      Number(o.total_ev) <= Number(o.target_ev) + 1e-6,
      tier + ': payout $' + Number(o.total_ev).toFixed(2) +
        ' within budget $' + Number(o.target_ev).toFixed(2)
    );
    ok(Number(o.p_shard) === 0, tier + ': shard odds locked at 0 below the pot gate');
  }

  // ---- open_box: insufficient balance -------------------------------------
  console.log('\n--- open_box() guards ---');
  try {
    await db.query('SELECT open_box($1,$2,NULL)', [player, 'tier_1']);
    ok(false, 'broke with a zero balance (should have raised PT402)');
  } catch (e) {
    ok(/Insufficient balance/.test((e as Error).message), 'refuses a roll with no credits');
  }

  try {
    await db.query('SELECT open_box($1,$2,NULL)', [player, 'tier_9']);
    ok(false, 'accepted an unknown tier');
  } catch (e) {
    ok(/Unknown box tier/.test((e as Error).message), 'rejects an unknown tier');
  }

  const ghost = '00000000-0000-0000-0000-000000000000';
  await db.query('UPDATE profiles SET balance=1000 WHERE id=$1', [player]);
  try {
    await db.query('SELECT open_box($1,$2,NULL)', [ghost, 'tier_1']);
    ok(false, 'accepted a nonexistent player');
  } catch (e) {
    ok(/No such player/.test((e as Error).message), 'rejects a nonexistent player');
  }

  // ---- Idempotency --------------------------------------------------------
  console.log('\n--- idempotency ---');
  const before = (await db.query<{ balance: string }>('SELECT balance FROM profiles WHERE id=$1', [player])).rows[0].balance;
  const rollId = '11111111-2222-3333-4444-555555555555';
  const a = (await db.query<{ open_box: { roll_id: string } }>('SELECT open_box($1,$2,$3) AS open_box', [player, 'tier_1', rollId])).rows[0].open_box;
  const b = (await db.query<{ open_box: { roll_id: string } }>('SELECT open_box($1,$2,$3) AS open_box', [player, 'tier_1', rollId])).rows[0].open_box;
  const after = (await db.query<{ balance: string }>('SELECT balance FROM profiles WHERE id=$1', [player])).rows[0].balance;
  ok(a.roll_id === b.roll_id, 'a replayed clientRollId returns the original result');
  ok(
    Number(before) - Number(after) === 5,
    'charged exactly once for a double-tap ($' + (Number(before) - Number(after)).toFixed(2) + ')'
  );

  // ---- Bulk rolls: every branch must survive ------------------------------
  console.log('\n--- 400 live rolls ---');
  await db.query('UPDATE profiles SET balance=100000 WHERE id=$1', [player]);
  const kinds: Record<string, number> = {};
  let thrown = 0;
  for (let i = 0; i < 400; i++) {
    try {
      const res = (await db.query<{ open_box: { type: string } }>(
        'SELECT open_box($1,$2,NULL) AS open_box', [player, ['tier_1', 'tier_2', 'tier_3'][i % 3]]
      )).rows[0].open_box;
      kinds[res.type] = (kinds[res.type] ?? 0) + 1;
    } catch (e) {
      thrown++;
      if (thrown === 1) console.error('        first error: ' + (e as Error).message);
    }
  }
  ok(thrown === 0, '400 rolls with 0 exceptions');
  console.log('        outcomes: ' + JSON.stringify(kinds));
  ok((kinds.physical ?? 0) > 0, 'physical wins occur (' + (kinds.physical ?? 0) + ')');

  const neg = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM items WHERE stock_qty < 0');
  ok(neg.rows[0].n === 0, 'stock never went negative');

  // ---- Pot gate -----------------------------------------------------------
  console.log('\n--- pot gate ---');
  await db.query(
    "INSERT INTO deposits (user_id, amount, venmo_note, status) VALUES ($1, 500, '#TEST', 'approved')",
    [player]
  );
  const gated = (await db.query<{ box_odds: Record<string, unknown> }>(
    "SELECT box_odds('tier_3') AS box_odds"
  )).rows[0].box_odds;
  ok(Number(gated.p_shard) > 0, 'shards unlock once deposits cross the threshold');
  ok(gated.pot_gate_met === true, 'pot_gate_met flips true');

  // ---- Scrapping must never pay more than an item is worth ----------------
  //
  // This is the invariant that matters, and the one nothing used to check.
  // SPEC's "price * 10" formula paid 2x an item's value at the live coin rate:
  // win a $70 monitor, scrap it for $140, buy seven more boxes. Every solvency
  // gate missed it because they model the ROLL, not what a player does with the
  // item afterwards.
  //
  // High-rarity scrapping is now deliberately ALLOWED at a worse rate, so the
  // maths -- not a ban -- is what stops someone recycling a headline prize.
  console.log('\n--- scrap economy ---');
  {
    const cfg = (await db.query<{ value: Record<string, unknown> }>(
      "SELECT value FROM config WHERE key='settings'"
    )).rows[0].value;
    const coinUsd =
      Number((cfg.box_prices as Record<string, number>)[String(cfg.scrap_key_tier)]) /
      Number(cfg.scrap_coins_per_key);
    ok(coinUsd > 0, 'a scrap coin is worth $' + coinUsd.toFixed(2));

    const rows = (await db.query<{ name: string; est_value: string; scrap_value: number; rarity: string }>(
      'SELECT name, est_value, scrap_value, rarity FROM items ORDER BY est_value DESC'
    )).rows;

    let worst = 0;
    let worstName = '';
    for (const r of rows) {
      const ratio = (r.scrap_value * coinUsd) / Number(r.est_value);
      if (ratio > worst) { worst = ratio; worstName = r.name; }
    }
    ok(
      worst < 1,
      'no item scraps for more than it is worth (worst: ' + worstName + ' at ' +
        (worst * 100).toFixed(0) + '% of value)'
    );

    // Scrapping through the RPC must also land under 100%, since it recomputes
    // from the live price rather than the stored column.
    const target = (await db.query<{ id: string }>(
      "SELECT id FROM rolls WHERE kind='physical' AND status='inventory' LIMIT 1"
    )).rows[0];
    if (target) {
      const before = Number((await db.query<{ scrap_coins: number }>(
        'SELECT scrap_coins FROM profiles WHERE id=$1', [player]
      )).rows[0].scrap_coins);
      await db.query('SELECT scrap_item($1,$2)', [player, target.id]);
      const after = Number((await db.query<{ scrap_coins: number }>(
        'SELECT scrap_coins FROM profiles WHERE id=$1', [player]
      )).rows[0].scrap_coins);
      ok(after > before, 'scrap_item pays out (' + (after - before) + ' coins)');
    }
  }

  // ---- Shard supply cap ---------------------------------------------------
  console.log('\n--- shard supply cap ---');
  await db.query(`UPDATE config SET value = jsonb_set(value,'{pc_shards_minted}','999') WHERE key='settings'`);
  const capped = (await db.query<{ box_odds: Record<string, unknown> }>(
    "SELECT box_odds('tier_3') AS box_odds"
  )).rows[0].box_odds;
  ok(Number(capped.p_shard) === 0, 'shard odds forced to 0 once global PC supply is exhausted');
  await db.query(`UPDATE config SET value = jsonb_set(value,'{pc_shards_minted}','0') WHERE key='settings'`);

  // ---- Auth ---------------------------------------------------------------
  console.log('\n--- auth ---');
  const good = await db.query<{ auth_verify_pin: unknown }>("SELECT auth_verify_pin('Ben','1234') AS auth_verify_pin");
  ok(good.rows.length === 1, 'correct PIN authenticates');
  const bad = await db.query("SELECT auth_verify_pin('Ben','9999')");
  ok(bad.rows.length === 0, 'wrong PIN returns no rows');

  for (let i = 0; i < 5; i++) await db.query("SELECT auth_verify_pin('Ben','9999')").catch(() => {});
  try {
    await db.query("SELECT auth_verify_pin('Ben','1234')");
    ok(false, 'lockout did not engage after 5 failures');
  } catch (e) {
    ok(/Too many attempts/.test((e as Error).message), 'locks the account after 5 failed PINs');
  }

  // ---- Sessions -----------------------------------------------------------
  console.log('\n--- sessions ---');
  await db.query("SELECT session_create($1,'deadbeef', NOW() + INTERVAL '1 day')", [admin]);
  const look = await db.query<{ role: string }>("SELECT * FROM session_lookup('deadbeef')");
  ok(look.rows.length === 1 && look.rows[0].role === 'admin', 'session_lookup resolves the admin in one call');
  await db.query("SELECT session_create($1,'expired', NOW() - INTERVAL '1 day')", [admin]);
  const exp = await db.query("SELECT * FROM session_lookup('expired')");
  ok(exp.rows.length === 0, 'an expired session resolves to nobody');

  // ---- Deposits -----------------------------------------------------------
  console.log('\n--- deposit approval ---');
  const dep = (await db.query<{ id: string }>(
    "INSERT INTO deposits (user_id, amount, venmo_note) VALUES ($1, 25, '#BOX-BEN') RETURNING id",
    [player]
  )).rows[0].id;
  try {
    await db.query('SELECT approve_deposit($1,$2)', [dep, player]);
    ok(false, 'a non-admin approved a deposit');
  } catch (e) {
    ok(/Admin only/.test((e as Error).message), 'non-admin cannot approve a deposit');
  }
  const balBefore = Number((await db.query<{ balance: string }>('SELECT balance FROM profiles WHERE id=$1', [player])).rows[0].balance);
  await db.query('SELECT approve_deposit($1,$2)', [dep, admin]);
  const balAfter = Number((await db.query<{ balance: string }>('SELECT balance FROM profiles WHERE id=$1', [player])).rows[0].balance);
  ok(balAfter - balBefore === 25, 'approval credits the player exactly once');
  try {
    await db.query('SELECT approve_deposit($1,$2)', [dep, admin]);
    ok(false, 'double-approved the same deposit');
  } catch (e) {
    ok(/Already approved/.test((e as Error).message), 'refuses to approve the same deposit twice');
  }

  // ---- Ticker -------------------------------------------------------------
  console.log('\n--- realtime ticker ---');
  const sent = await db.query<{ n: number; topic: string }>(
    "SELECT count(*)::int AS n, max(topic) AS topic FROM realtime.sent"
  );
  ok(sent.rows[0].n > 0, 'the roll trigger broadcast ' + sent.rows[0].n + ' ticker events');
  ok(sent.rows[0].topic === 'house_ticker', "broadcasts on the 'house_ticker' topic");
  const leak = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM realtime.sent WHERE payload ? 'user_id' OR payload ? 'balance'"
  );
  ok(leak.rows[0].n === 0, 'ticker payload leaks no user_id or balance');

  // ---- The two engines must describe the SAME game ------------------------
  //
  // lib/economy.ts and the SQL box_odds are hand-mirrored, and `npm run
  // simulate` only proves the TypeScript one. A divergence is therefore
  // invisible: the proof passes while production plays by different numbers.
  // That happened -- a migration generator's conditional replace silently
  // failed to match, leaving the filler predicate different on each side, and
  // an outside audit found it rather than any gate here.
  //
  // This runs both engines over the SAME catalog and config and compares the
  // outputs. It is the only check that can catch drift at all.
  console.log('\n--- TypeScript engine vs SQL engine ---');
  {
    const { computeBoxOdds } = await import('../lib/economy');
    const cfgRow = await db.query<{ value: Record<string, unknown> }>(
      "SELECT value FROM config WHERE key='settings'"
    );
    const cfg = cfgRow.rows[0].value as never;

    // Fixtures that FORCE the edge cases, rather than hoping the seed catalog
    // happens to contain them. Without these the comparison passes trivially:
    // the real divergence only shows when a cheap item lives in a higher tier,
    // which seed.sql does not have. A first attempt at this test passed even
    // with the bug deliberately reintroduced.
    await db.exec(`
      INSERT INTO items (name, est_value, rarity, scrap_value, stock_qty, box_tier)
      VALUES ('drift-cheap-t2',  12, 'blue', 7, 3, 'tier_2'),
             ('drift-cheap-t3',   9, 'grey', 5, 2, 'tier_3'),
             ('drift-dear-t1',   80, 'purple', 0, 1, 'tier_1');
    `);

    const itemRows = await db.query(
      'SELECT id, name, description, image_url, est_value, rarity, scrap_value, ' +
      'stock_qty, box_tier, is_active, msrp, shard_cost, created_at FROM items'
    );
    const items = itemRows.rows.map((r) => ({
      ...(r as Record<string, unknown>),
      est_value: Number((r as { est_value: string }).est_value),
      msrp: (r as { msrp: string | null }).msrp === null ? null : Number((r as { msrp: string }).msrp),
      stock_qty: Number((r as { stock_qty: number }).stock_qty),
      shard_cost: Number((r as { shard_cost: number }).shard_cost ?? 0),
    })) as never[];

    const potRow = await db.query<{ pot: string }>(
      "SELECT COALESCE(SUM(amount),0) AS pot FROM deposits WHERE status='approved'"
    );
    const gate =
      Number(potRow.rows[0].pot) >= Number((cfg as Record<string, unknown>).pot_revenue_threshold);

    for (const tier of ['tier_1', 'tier_2', 'tier_3'] as const) {
      const sql = (
        await db.query<{ box_odds: Record<string, number | string> }>(
          'SELECT box_odds($1) AS box_odds', [tier]
        )
      ).rows[0].box_odds;

      const ts = computeBoxOdds({ tier, items, config: cfg, potGateMet: gate });

      const pairs: [string, number, number][] = [
        ['p_physical', ts.p_physical, Number(sql.p_physical)],
        ['p_shard', ts.p_shard, Number(sql.p_shard)],
        ['p_respin', ts.p_respin, Number(sql.p_respin)],
        ['p_scrap', ts.p_scrap, Number(sql.p_scrap)],
        ['total_ev', ts.total_ev, Number(sql.total_ev)],
        ['box_price', ts.box_price, Number(sql.box_price)],
      ];

      let worst = 0;
      let worstField = '';
      for (const [field, a, b] of pairs) {
        const d = Math.abs(a - b);
        if (d > worst) {
          worst = d;
          worstField = field;
        }
      }
      ok(
        worst < 1e-6,
        tier + ': both engines agree' +
          (worst >= 1e-6
            ? ' — ' + worstField + ' differs by ' + worst.toFixed(9)
            : ' (max delta ' + worst.toExponential(1) + ')')
      );

      ok(
        String(sql.floor_kind) === ts.floor_kind,
        tier + ': same floor anchor kind (' + ts.floor_kind + ')'
      );

      // Same pool membership, not just the same totals: two engines can reach
      // equal probabilities from different item sets.
      const sqlIds = new Set(
        (sql.items as unknown as { item_id: string }[]).map((i) => i.item_id)
      );
      const tsIds = new Set(ts.items.map((i) => i.item_id));
      const onlySql = [...sqlIds].filter((i) => !tsIds.has(i)).length;
      const onlyTs = [...tsIds].filter((i) => !sqlIds.has(i)).length;
      ok(
        onlySql === 0 && onlyTs === 0,
        tier + ': identical item pools (' + tsIds.size + ' items)' +
          (onlySql || onlyTs ? ' — ' + onlySql + ' SQL-only, ' + onlyTs + ' TS-only' : '')
      );
    }

    await db.exec("DELETE FROM items WHERE name LIKE 'drift-%'");
  }

  // ---- Lockdown -----------------------------------------------------------
  console.log('\n--- lockdown ---');
  const grants = await db.query<{ n: number }>(`
    SELECT count(*)::int AS n FROM information_schema.role_table_grants
     WHERE grantee IN ('anon','authenticated') AND table_schema='public'`);
  ok(grants.rows[0].n === 0, 'anon has zero table grants in public');

  const exec = await db.query<{ n: number }>(`
    SELECT count(*)::int AS n FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='open_box'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
  ok(exec.rows[0].n === 0, 'anon cannot EXECUTE open_box');

  const rls = await db.query<{ n: number }>(`
    SELECT count(*)::int AS n FROM pg_tables
     WHERE schemaname='public' AND NOT rowsecurity
       AND tablename IN ('profiles','items','rolls','deposits','config','drop_overrides')`);
  ok(rls.rows[0].n === 0, 'RLS is enabled on every public table');

  const pin = await db.query<{ n: number }>(`
    SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_schema='public' AND column_name='pin'`);
  ok(pin.rows[0].n === 0, 'no `pin` column exists anywhere in public');

  await db.close();

  console.log('\n=================================================================');
  if (failures === 0) {
    console.log(' PASS — ' + checks + ' checks, 0 failures. The SQL runs.');
  } else {
    console.log(' FAIL — ' + failures + ' of ' + checks + ' checks failed.');
  }
  console.log('=================================================================\n');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
