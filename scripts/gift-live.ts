/**
 * EVERY BOX MUST BE GIFTABLE.
 *
 *   npm run gift
 *
 * admin_grant_spins validated against a hand-written list of three tiers that
 * predated the $0.50 box existing, so the cheapest box — the one you would most
 * want to hand a few free spins on — was the one tier you could not gift, and
 * the admin dropdown only ever offered three options.
 *
 * Runs inside a rolled-back transaction against throwaway accounts: proving a
 * gift works must not put credit into a real player's balance.
 */
import { Client } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };
const TIERS = ['tier_0', 'tier_1', 'tier_2', 'tier_3'];

(async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL!, ssl: { rejectUnauthorized: false }, statement_timeout: 60_000 });
  await c.connect();
  await c.query("SET idle_in_transaction_session_timeout = '30s'");
  await c.query('BEGIN');
  try {
    const { rows: [cfg] } = await c.query("SELECT value FROM config WHERE key='settings'");
    const prices = (cfg.value as any).box_prices as Record<string, number>;

    const { rows: [admin] } = await c.query(
      "INSERT INTO profiles (name, balance, role) VALUES ('__giftadmin__', 0, 'admin') RETURNING id");
    const { rows: [player] } = await c.query(
      "INSERT INTO profiles (name, balance) VALUES ('__giftee__', 0) RETURNING id");

    for (const t of TIERS) {
      const spins = 3;
      const before = Number((await c.query('SELECT balance FROM profiles WHERE id=$1', [player.id])).rows[0].balance);
      await c.query('SAVEPOINT g');
      try {
        const { rows: [r] } = await c.query(
          'SELECT admin_grant_spins($1,$2,$3,$4) AS r', [admin.id, player.id, t, spins]);
        await c.query('RELEASE SAVEPOINT g');
        const after = Number((await c.query('SELECT balance FROM profiles WHERE id=$1', [player.id])).rows[0].balance);
        const expected = Math.round(Number(prices[t]) * spins * 100) / 100;
        ok(Math.abs(after - before - expected) < 1e-9,
          t + ': ' + spins + ' spins credits $' + expected.toFixed(2) +
          ' (balance ' + before.toFixed(2) + ' -> ' + after.toFixed(2) + ')');
        ok(Number(r.r.credited) === expected, t + ': the RPC reports the same figure it credited');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT g');
        ok(false, t + ' was REFUSED: ' + (e as Error).message);
      }
    }

    // A tier that does not exist must still be refused.
    await c.query('SAVEPOINT bad');
    let refused = false;
    try { await c.query('SELECT admin_grant_spins($1,$2,$3,$4)', [admin.id, player.id, 'tier_9', 1]); }
    catch { refused = true; await c.query('ROLLBACK TO SAVEPOINT bad'); }
    ok(refused, 'an invented tier is still refused');

    // And a non-admin still cannot gift.
    await c.query('SAVEPOINT nonadmin');
    let blocked = false;
    try { await c.query('SELECT admin_grant_spins($1,$2,$3,$4)', [player.id, player.id, 'tier_0', 1]); }
    catch { blocked = true; await c.query('ROLLBACK TO SAVEPOINT nonadmin'); }
    ok(blocked, 'a normal player still cannot gift themselves spins');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    await c.query('ROLLBACK');
    await c.end();
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'every box tier can be gifted') + '\n');
    process.exit(fails ? 1 : 0);
  }
})();
