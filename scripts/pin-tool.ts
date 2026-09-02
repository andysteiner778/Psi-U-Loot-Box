/**
 * PIN / lockout tool.  npm run pin -- status | reset <Name> [pin]
 *
 * The party will need this: someone forgets a PIN, or triggers the 5-strike
 * 15-minute lockout, and you need it cleared from a laptop in ten seconds.
 */
import { config } from 'dotenv';
import { Client } from 'pg';
config({ path: '.env.local', quiet: true });

const [cmd, name, pin = '1234'] = process.argv.slice(2);

async function main() {
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

if (cmd === 'reset' && name) {
  const { rows } = await c.query('SELECT id FROM profiles WHERE name=$1', [name]);
  if (!rows.length) { console.error('No player named ' + name); process.exit(1); }
  await c.query('SELECT auth_set_pin($1,$2)', [rows[0].id, pin]);
  // set_pin clears must_change; put it back so they are forced to choose their own.
  await c.query(
    'UPDATE app_private.profile_secrets SET must_change=TRUE, failed_attempts=0, locked_until=NULL WHERE profile_id=$1',
    [rows[0].id]
  );
  console.log(name + ' reset to PIN ' + pin + ', lockout cleared, will be prompted to choose a new one.');
} else {
  const { rows } = await c.query(`
    SELECT p.name, p.role, s.must_change AS must_chg, s.failed_attempts AS fails,
           COALESCE(s.locked_until > NOW(), false) AS locked,
           (s.pin_hash = extensions.crypt('1234', s.pin_hash)) AS is_1234
      FROM profiles p JOIN app_private.profile_secrets s ON s.profile_id = p.id
     ORDER BY (s.locked_until > NOW()) DESC NULLS LAST, p.name`);
  console.table(rows);
  const locked = rows.filter((r) => r.locked);
  if (locked.length) console.log('\nLOCKED OUT: ' + locked.map((r) => r.name).join(', ') + '  ->  npm run pin -- reset <Name>');
}
await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
