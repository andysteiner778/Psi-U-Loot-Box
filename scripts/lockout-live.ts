/**
 * The PIN lockout must be survivable.
 *
 *   npm run lockout
 *
 * Five wrong tries used to buy a fifteen-minute lockout, and the owner hit it
 * on his own admin account mid-setup with no way back in except a script. This
 * proves the new limits: the right PIN always works, wrong ones count, the lock
 * only bites at the configured attempt, and it clears in seconds not quarters
 * of an hour.
 *
 * Runs in a rolled-back transaction against a throwaway account, so no real
 * player's credential is touched — an earlier version of the backup gate did
 * exactly that and changed a real PIN.
 */
import { Client } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };

(async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL!, ssl: { rejectUnauthorized: false }, statement_timeout: 60_000 });
  await c.connect();
  await c.query("SET idle_in_transaction_session_timeout = '30s'");
  await c.query('BEGIN');
  try {
    const { rows: [cfg] } = await c.query("SELECT value FROM config WHERE key='settings'");
    const max = Number((cfg.value as any).pin_max_attempts ?? 10);
    const secs = Number((cfg.value as any).pin_lockout_seconds ?? 60);
    console.log('\n  configured: ' + max + ' attempts, then ' + secs + ' seconds\n');

    const name = '__lockprobe_' + Date.now().toString(36) + '__';
    const { rows: [p] } = await c.query(
      'INSERT INTO profiles (name, balance) VALUES ($1, 0) RETURNING id', [name]);
    await c.query('SELECT auth_set_pin($1,$2)', [p.id, '1357']);

    const tryPin = async (pin: string): Promise<'ok' | 'wrong' | 'locked'> => {
      await c.query('SAVEPOINT s');
      try {
        const { rows: [r] } = await c.query('SELECT app_private.verify_pin($1,$2) AS id', [name, pin]);
        await c.query('RELEASE SAVEPOINT s');
        return r.id ? 'ok' : 'wrong';
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT s');
        return 'locked';
      }
    };

    ok((await tryPin('1357')) === 'ok', 'the right PIN works');

    // One short of the limit must still let the right PIN through.
    for (let i = 0; i < max - 1; i++) await tryPin('0000');
    ok((await tryPin('1357')) === 'ok',
      (max - 1) + ' wrong tries do not lock the account, and a success clears the count');

    // Now go all the way.
    let lockedAt = 0;
    for (let i = 1; i <= max + 1; i++) {
      const res = await tryPin('0000');
      if (res === 'locked') { lockedAt = i; break; }
    }
    ok(lockedAt === max + 1 || lockedAt === 0,
      'the lock does not bite before attempt ' + max + ' (first refusal at ' + (lockedAt || 'none') + ')');

    const { rows: [s] } = await c.query(
      'SELECT failed_attempts, locked_until FROM app_private.profile_secrets WHERE profile_id=$1', [p.id]);
    ok(Number(s.failed_attempts) >= max, 'the failures were counted (' + s.failed_attempts + ')');
    ok(!!s.locked_until, 'and a lock was set');

    if (s.locked_until) {
      const heldFor = (new Date(s.locked_until).getTime() - Date.now()) / 1000;
      ok(heldFor <= secs + 5,
        'the lock lasts about ' + secs + 's, not a quarter of an hour (' + heldFor.toFixed(0) + 's)');
    }

    // And it must actually refuse while held.
    ok((await tryPin('1357')) === 'locked', 'even the correct PIN is refused while locked');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    await c.query('ROLLBACK');
    await c.end();
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'the lockout is strict enough and survivable') + '\n');
    process.exit(fails ? 1 : 0);
  }
})();
