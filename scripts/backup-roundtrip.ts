/**
 * PROVE THE BACKUP CAN ACTUALLY BE RESTORED FROM.
 *
 *   npm run backup:verify
 *
 * A backup nobody has restored from is not a backup. This wipes the items
 * table and the PIN table on purpose — the two losses that actually happened —
 * restores, and checks that both came back AND that the restored PIN still
 * authenticates. The first version of this script checked row counts only, so
 * it passed while silently destroying every PIN in the house.
 *
 * Runs against the live database and puts everything back. It takes its own
 * snapshot first, so an abort mid-way is still recoverable.
 */
import { config as denv } from 'dotenv';
import { Client } from 'pg';
import { execSync } from 'child_process';

denv({ path: '.env.local', quiet: true });

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };

const conn = () =>
  new Client({ connectionString: process.env.SUPABASE_DB_URL!, ssl: { rejectUnauthorized: false } });

(async () => {
  const c = conn();
  await c.connect();
  const n = async (t: string) => Number((await c.query(`SELECT count(*)::INT c FROM ${t}`)).rows[0].c);

  const items0 = await n('public.items');
  const pins0 = await n('app_private.profile_secrets');
  console.log('\n  before: ' + items0 + ' items, ' + pins0 + ' pin(s)\n');
  ok(items0 > 0, 'there is a catalogue to lose');

  // A known-good credential to authenticate with after the restore.
  const { rows: [p] } = await c.query('SELECT id, name FROM public.profiles LIMIT 1');
  ok(!!p, 'there is a player to lose');
  await c.query('SELECT auth_set_pin($1,$2)', [p.id, '4321']);

  const out = execSync('npm run backup -- verify', { encoding: 'utf8' });
  const dir = (/Snapshot -> (\S+)/.exec(out) ?? [])[1];
  ok(!!dir, 'snapshot written (' + dir + ')');

  // Destroy exactly what was destroyed for real.
  await c.query('DELETE FROM public.items WHERE TRUE');
  await c.query('DELETE FROM app_private.profile_secrets WHERE TRUE');
  ok((await n('public.items')) === 0, 'catalogue deliberately wiped');
  ok((await n('app_private.profile_secrets')) === 0, 'pins deliberately wiped');

  execSync('npm run backup -- --restore ' + dir, { encoding: 'utf8' });

  ok((await n('public.items')) === items0, 'every item came back (' + (await n('public.items')) + '/' + items0 + ')');
  ok((await n('app_private.profile_secrets')) === pins0,
    'every pin came back (' + (await n('app_private.profile_secrets')) + '/' + pins0 + ')');

  // The one that matters: the restored hash must still authenticate.
  const { rows: [auth] } = await c.query('SELECT app_private.verify_pin($1,$2) AS id', [p.name, '4321']);
  ok(auth.id === p.id, 'and the restored PIN still logs that player in');

  const { rows: [bad] } = await c.query('SELECT app_private.verify_pin($1,$2) AS id', [p.name, '0000']);
  ok(bad.id === null, 'while a wrong PIN is still refused');

  await c.end();
  console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'backup and restore are trustworthy') + '\n');
  process.exit(fails ? 1 : 0);
})();
