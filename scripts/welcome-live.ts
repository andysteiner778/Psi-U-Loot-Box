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
    const vouchers = async (uid: string) => (await c.query(
      `SELECT box_tier, count(*)::INT n FROM vouchers
        WHERE user_id=$1 AND redeemed_at IS NULL AND discount_pct = 1
        GROUP BY box_tier ORDER BY box_tier`, [uid])).rows;

    // ---- signup grants exactly the package ------------------------------
    const { rows: [reg] } = await c.query(
      'SELECT * FROM auth_login_or_register($1,$2)', ['__welcome_probe__', '1234']);
    ok(reg.created === true, 'new account created');
    const v1 = await vouchers(reg.profile_id);
    console.log('        signup vouchers: ' + JSON.stringify(v1));
    ok(v1.length === 3, 'three tiers granted');
    ok(v1.find((r: any) => r.box_tier === 'tier_0')?.n === 1, '1 free spin on tier_0 (OG Junk Box)');
    ok(v1.find((r: any) => r.box_tier === 'tier_1')?.n === 1, '1 free spin on tier_1 (Good Stuff)');
    ok(v1.find((r: any) => r.box_tier === 'tier_2')?.n === 1, '1 free spin on tier_2 (Golden Chest)');
    ok(!v1.find((r: any) => r.box_tier === 'tier_3'), 'and NO free High Roller spin');

    // ---- logging back in must NOT mint more -----------------------------
    await c.query('SELECT * FROM auth_login_or_register($1,$2)', ['__welcome_probe__', '1234']);
    await c.query('SELECT * FROM auth_login_or_register($1,$2)', ['__welcome_probe__', '1234']);
    const v2 = await vouchers(reg.profile_id);
    const total = v2.reduce((s: number, r: any) => s + r.n, 0);
    ok(total === 3, 'signing in twice more grants nothing extra (' + total + ' held)');

    // ---- they are real: a free spin costs nothing and refunds nothing ----
    await c.query('UPDATE profiles SET balance = 100 WHERE id=$1', [reg.profile_id]);
    const { rows: [r1] } = await c.query("SELECT open_box($1,'tier_0') AS r", [reg.profile_id]);
    const { rows: [b1] } = await c.query('SELECT balance FROM profiles WHERE id=$1', [reg.profile_id]);
    ok(Number(b1.balance) >= 100,
      'a free tier_0 spin charged nothing (balance $' + b1.balance + ', got ' + r1.r.type + ')');

    // ---- reset clears the pile and re-issues the package -----------------
    const { rows: [adm] } = await c.query("SELECT id FROM profiles WHERE role='admin' LIMIT 1");
    // junk vouchers that must NOT survive a reset
    for (let i = 0; i < 6; i++) {
      await c.query(
        "INSERT INTO vouchers (user_id, box_tier, discount_pct) VALUES ($1,'tier_2',0.5)",
        [reg.profile_id]);
    }
    const { rows: [pre] } = await c.query('SELECT count(*)::INT n FROM vouchers');
    const { rows: [res] } = await c.query('SELECT reset_party_state($1) AS r', [adm.id]);
    console.log('        reset -> ' + JSON.stringify(res.r));

    const { rows: [half] } = await c.query(
      'SELECT count(*)::INT n FROM vouchers WHERE discount_pct <> 1');
    ok(half.n === 0, 'every non-welcome voucher was cleared (' + half.n + ' left of ' + pre.n + ')');

    const { rows: [profCount] } = await c.query('SELECT count(*)::INT n FROM profiles');
    const { rows: [after] } = await c.query('SELECT count(*)::INT n FROM vouchers');
    ok(after.n === profCount.n * 3,
      'exactly 3 welcome spins per account afterwards (' + after.n + ' for ' + profCount.n + ' players)');

    const v3 = await vouchers(reg.profile_id);
    ok(v3.length === 3 && v3.every((r: any) => r.n === 1) &&
       v3.map((r: any) => r.box_tier).join(',') === 'tier_0,tier_1,tier_2',
      'and the mix is right after a reset: ' + JSON.stringify(v3));

    // ---- redeemed vouchers do not survive either -------------------------
    const { rows: [red] } = await c.query(
      'SELECT count(*)::INT n FROM vouchers WHERE redeemed_at IS NOT NULL');
    ok(red.n === 0, 'spent vouchers are gone too, not left as history (' + red.n + ')');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    await c.query('ROLLBACK');
    await c.end();
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'all welcome-voucher checks pass'));
    process.exit(fails ? 1 : 0);
  }
})();
