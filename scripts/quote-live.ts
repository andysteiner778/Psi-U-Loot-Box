import { Client } from 'pg';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

/**
 * The bug the user hit: the card said the High Roller spin was free, and the
 * roll charged $30. Reproduce the sequence and assert the SERVER's quote
 * tracks reality on every step -- that quote is what the card now renders.
 */
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

  // Mirrors app/(player)/_lib/queries.ts exactly.
  const quote = async (uid: string, tier: string) => {
    const { rows: [o] } = await c.query('SELECT box_odds($1,$2) AS o', [tier, uid]);
    const { rows: v } = await c.query(
      `SELECT discount_pct FROM vouchers
        WHERE user_id=$1 AND box_tier=$2 AND redeemed_at IS NULL
        ORDER BY discount_pct DESC, created_at ASC LIMIT 1`, [uid, tier]);
    const pct = v.length ? Math.min(1, Math.max(0, Number(v[0].discount_pct))) : 0;
    return Math.round(Number(o.o.box_price) * (1 - pct) * 100) / 100;
  };

  try {
    const { rows: [reg] } = await c.query(
      'SELECT * FROM auth_login_or_register($1,$2)', ['__quote_probe__', '1234']);
    const uid = reg.profile_id;

    const { rows: pkg } = await c.query(
      `SELECT box_tier, count(*)::INT n FROM vouchers WHERE user_id=$1 GROUP BY box_tier ORDER BY box_tier`, [uid]);
    console.log('        signup package: ' + JSON.stringify(pkg));
    ok(pkg.length === 3 &&
       pkg.every((r: any) => r.n === 1) &&
       pkg.map((r: any) => r.box_tier).join(',') === 'tier_0,tier_1,tier_2',
      'one free spin each on OG Junk Box, Good Stuff and Golden Chest');
    const { rows: [t3] } = await c.query(
      "SELECT count(*)::INT n FROM vouchers WHERE user_id=$1 AND box_tier='tier_3'", [uid]);
    ok(t3.n === 0, 'no free High Roller spin in the package (' + t3.n + ')');

    await c.query('UPDATE profiles SET balance = 500 WHERE id=$1', [uid]);

    // Golden Chest: quoted free, must charge nothing; then quoted full.
    const q1 = await quote(uid, 'tier_2');
    ok(q1 === 0, 'Golden Chest quoted FREE while the voucher is held ($' + q1 + ')');

    const { rows: [b0] } = await c.query('SELECT balance FROM profiles WHERE id=$1', [uid]);
    const { rows: [r1] } = await c.query("SELECT open_box($1,'tier_2') AS r", [uid]);
    const { rows: [ch1] } = await c.query(
      'SELECT box_price FROM rolls WHERE id=$1', [(r1.r as any).roll_id]);
    ok(Number(ch1.box_price) === q1,
      'and it charged exactly what was quoted ($' + ch1.box_price + ')');

    /*
     * THE REPORTED BUG, stated as the invariant that actually matters: the
     * quote must equal the charge, roll after roll. A won item can BUNDLE
     * another free spin for the same tier, so "the second roll costs full
     * price" is not true in general -- asserting it would be testing the
     * catalogue, not the pricing.
     */
    for (let i = 0; i < 6; i++) {
      const q = await quote(uid, 'tier_2');
      const { rows: [r] } = await c.query("SELECT open_box($1,'tier_2') AS r", [uid]);
      const { rows: [ch] } = await c.query(
        'SELECT box_price FROM rolls WHERE id=$1', [(r.r as any).roll_id]);
      ok(Number(ch.box_price) === q,
        'roll ' + (i + 2) + ': quoted $' + q + ', charged $' + ch.box_price);
    }

    // And with every voucher gone it must quote full price, never a stale free.
    await c.query('DELETE FROM vouchers WHERE user_id=$1', [uid]);
    const q2 = await quote(uid, 'tier_2');
    ok(q2 === 10, 'with no voucher held, Golden Chest quotes full price ($' + q2 + ')');
    const { rows: [r2] } = await c.query("SELECT open_box($1,'tier_2') AS r", [uid]);
    const { rows: [ch2] } = await c.query(
      'SELECT box_price FROM rolls WHERE id=$1', [(r2.r as any).roll_id]);
    ok(Number(ch2.box_price) === q2,
      'and charged that, not a stale free price ($' + ch2.box_price + ')');

    const { rows: [b2] } = await c.query('SELECT balance FROM profiles WHERE id=$1', [uid]);
    console.log('        balance ' + b0.balance + ' -> ' + b2.balance + ' over the two rolls');

    // High Roller was never free for this player, and must never quote free.
    const q3 = await quote(uid, 'tier_3');
    ok(q3 === 30, 'High Roller quoted at full price throughout ($' + q3 + ')');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    await c.query('ROLLBACK');
    await c.end();
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'quote matches charge on every step'));
    process.exit(fails ? 1 : 0);
  }
})();
