import { Client } from 'pg';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };

(async () => {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL!,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  });
  await c.connect();
  await c.query("SET idle_in_transaction_session_timeout = '45s'");
  await c.query('BEGIN');
  try {
    const { rows: [pair] } = await c.query(`
      SELECT h.id host, h.name hname, h.stock_qty hstock, h.box_tier,
             b.id rider, b.name rname, b.est_value rval, b.stock_qty rstock
        FROM items h JOIN items b ON b.id = h.bonus_item_id
       WHERE h.is_active AND h.stock_qty > 0 LIMIT 1`);
    console.log('        ' + pair.hname + '  carries  ' + pair.rname + ' ($' + pair.rval + ')');

    const { rows: [p] } = await c.query(
      "INSERT INTO profiles (name, balance) VALUES ('__bundle__', 500) RETURNING id");
    await c.query('INSERT INTO drop_overrides (user_id, item_id) VALUES ($1,$2)', [p.id, pair.host]);

    const { rows: [r] } = await c.query('SELECT open_box($1,$2) AS r', [p.id, pair.box_tier]);
    const res = r.r;
    ok(res.type === 'physical' && res.item_id === pair.host, 'won the host object (' + res.item_name + ')');
    ok(!!res.bonus_item, 'payload carries the rider');
    ok(res.bonus_item?.item_id === pair.rider,
      'and it is the right one (' + res.bonus_item?.item_name + ')');

    const { rows: inv } = await c.query(
      "SELECT item_id, item_name FROM rolls WHERE user_id=$1 AND status='inventory' ORDER BY item_name", [p.id]);
    ok(inv.length === 2, 'BOTH objects landed in inventory (' + inv.map((x: any) => x.item_name).join(' + ') + ')');

    const { rows: [st] } = await c.query('SELECT stock_qty FROM items WHERE id=$1', [pair.rider]);
    ok(st.stock_qty === pair.rstock - 1, 'the rider came off the shelf (' + pair.rstock + ' -> ' + st.stock_qty + ')');

    // the rider must never be drawn on its own
    const { rows: [odds] } = await c.query('SELECT box_odds($1, NULL) AS o', [pair.box_tier]);
    const pool = [...(odds.o.items ?? []), ...(odds.o.filler ?? [])];
    ok(!pool.some((i: any) => i.item_id === pair.rider), 'the rider is not in the published pool');

    // out of riders: the host is still won, just without the extra
    await c.query('UPDATE items SET stock_qty = 0 WHERE id=$1', [pair.rider]);
    await c.query('INSERT INTO drop_overrides (user_id, item_id) VALUES ($1,$2)', [p.id, pair.host]);
    // the host's own stock was spent by the first roll; put one back so the
    // question under test is the RIDER's absence, not the host's
    await c.query('UPDATE items SET stock_qty = stock_qty + 1 WHERE id=$1', [pair.host]);
    const { rows: [r2] } = await c.query('SELECT open_box($1,$2) AS r', [p.id, pair.box_tier]);
    ok(r2.r.type === 'physical' && r2.r.item_id === pair.host,
      'with the rider gone the host is still won (' + r2.r.type + ')');
    ok(!r2.r.bonus_item, 'and no phantom rider is handed over');
    const { rows: [neg] } = await c.query('SELECT stock_qty FROM items WHERE id=$1', [pair.rider]);
    ok(neg.stock_qty === 0, 'rider stock never went negative (' + neg.stock_qty + ')');

    // reconcile's invariant must still hold for the rider
    const { rows: [held] } = await c.query(
      "SELECT count(*)::INT n FROM rolls WHERE item_id=$1 AND status='inventory'", [pair.rider]);
    ok(held.n === 1, 'exactly one rider unit is accounted for in inventory (' + held.n + ')');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    await c.query('ROLLBACK');
    await c.end();
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'all bundle checks pass'));
    process.exit(fails ? 1 : 0);
  }
})();
