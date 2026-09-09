import { Client } from 'pg';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };

(async () => {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL!,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60_000,
  });
  await c.connect();
  await c.query("SET idle_in_transaction_session_timeout = '30s'");
  await c.query('BEGIN');
  try {
    const { rows: [cfg] } = await c.query("SELECT value FROM config WHERE key='settings'");
    const rate = Number(cfg.value.scrap_coins_per_key);
    const per = Number(cfg.value.scrap_key_usd);
    console.log('        ' + rate + ' coins = $' + per.toFixed(2) + '  (a coin is $' + (per / rate).toFixed(4) + ')');

    const { rows: [p] } = await c.query(
      'INSERT INTO profiles (name, balance, scrap_coins) VALUES ($1,0,$2) RETURNING id',
      ['__compact__', rate * 3 + 17]);

    // single crush takes exactly one key
    const { rows: [r1] } = await c.query('SELECT compact_scrap($1) AS r', [p.id]);
    ok(r1.r.spent === rate && Number(r1.r.credit) === per,
      'one crush takes ' + rate + ' coins for $' + per + ' (' + r1.r.spent + '/' + r1.r.credit + ')');

    // crush all takes every WHOLE key and leaves the remainder
    const { rows: [r2] } = await c.query('SELECT compact_scrap($1, TRUE) AS r', [p.id]);
    const { rows: [prof]} = await c.query('SELECT balance, scrap_coins FROM profiles WHERE id=$1', [p.id]);
    ok(r2.r.keys === 2, 'crush-all converted both remaining keys (' + r2.r.keys + ')');
    ok(prof.scrap_coins === 17, 'the 17-coin remainder stayed as coins (' + prof.scrap_coins + ')');
    ok(Math.abs(Number(prof.balance) - per * 3) < 1e-9,
      'balance is exactly 3 keys of credit ($' + prof.balance + ')');

    // below one key it refuses rather than paying for a partial
    const { rows: [q] } = await c.query(
      'INSERT INTO profiles (name, balance, scrap_coins) VALUES ($1,0,$2) RETURNING id',
      ['__compact2__', rate - 1]);
    // SAVEPOINT: an expected RAISE aborts the enclosing transaction, and every
    // assertion after it would fail with "current transaction is aborted".
    let refused = false;
    await c.query('SAVEPOINT s1');
    try { await c.query('SELECT compact_scrap($1, TRUE) AS r', [q.id]); }
    catch { refused = true; await c.query('ROLLBACK TO SAVEPOINT s1'); }
    ok(refused, 'crush-all refuses when there is not even one whole key');

    // scrap_all must be gone
    const { rows: [fn] } = await c.query(
      "SELECT count(*)::INT n FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace WHERE n2.nspname='public' AND p.proname='scrap_all'");
    ok(fn.n === 0, 'scrap_all() no longer exists (' + fn.n + ')');

    // Scrap is priced off RETAIL now, capped at half the box price, so the old
    // "never more than est_value" rule no longer describes it: a $0.01 giveaway
    // with a $40 retail is meant to scrap for real money. The two invariants
    // that still matter are that nothing can be farmed for more than the box
    // that produced it, and that nothing exceeds its own retail.
    const { rows: [bad] } = await c.query(`
      SELECT
        count(*) FILTER (WHERE COALESCE(i.scrap_value,0) < 1)::INT AS unscrappable,
        count(*) FILTER (
          WHERE i.scrap_value * $1::NUMERIC
                > (c.value->'box_prices'->>i.box_tier)::NUMERIC * 0.5 + 1e-9
        )::INT AS beats_its_box,
        count(*) FILTER (
          WHERE i.scrap_value * $1::NUMERIC > COALESCE(i.msrp, i.est_value) + 1e-9
        )::INT AS beats_retail
      FROM items i CROSS JOIN config c
      WHERE c.key = 'settings'
        AND i.is_active AND COALESCE(i.shard_cost,0)=0
        AND i.reward_credit IS NULL AND i.reward_voucher_tier IS NULL
        AND COALESCE(i.msrp, 0) * 0.9 >= $1::NUMERIC`, [per / rate]);
    ok(bad.unscrappable === 0,
      'every object worth at least one coin of retail can be scrapped (' + bad.unscrappable + ' cannot)');
    ok(bad.beats_its_box === 0,
      'nothing scraps for more than half the box that drops it (' + bad.beats_its_box + ' do)');
    ok(bad.beats_retail === 0,
      'nothing scraps for more than its own retail (' + bad.beats_retail + ' do)');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    await c.query('ROLLBACK');
    await c.end();
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'all compactor checks pass'));
    process.exit(fails ? 1 : 0);
  }
})();
