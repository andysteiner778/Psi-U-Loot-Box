/**
 * Applies supabase/migrations/*.sql in order, then optionally supabase/seed.sql.
 *
 *   npm run db:migrate          # migrations only
 *   npm run db:migrate -- --seed
 *
 * Each file runs inside its own transaction, so a failure rolls that file back
 * cleanly and leaves the database in a known state rather than half-applied.
 * Applied files are recorded in public.schema_migrations and skipped on re-run.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const DB_URL = process.env.SUPABASE_DB_URL;
const SEED = process.argv.includes('--seed');
const DIR = 'supabase/migrations';

if (!DB_URL) {
  console.error('SUPABASE_DB_URL is not set in .env.local.');
  console.error('Supabase dashboard -> Settings -> Database -> Connection string -> URI');
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    // A cold Supabase project can take a moment to accept the first connection.
    connectionTimeoutMillis: 30_000,
    statement_timeout: 120_000,
  });

  try {
    await client.connect();
  } catch (e) {
    const msg = (e as Error).message;
    console.error('\nCould not connect: ' + msg + '\n');
    if (/ENOTFOUND|EHOSTUNREACH|ENETUNREACH/.test(msg)) {
      console.error('The direct connection (db.<ref>.supabase.co:5432) is IPv6-only on newer');
      console.error('projects. Use the Session Pooler URI instead — same dashboard page,');
      console.error('under "Connection pooling". It is IPv4 and works from anywhere.');
    } else if (/password authentication failed/i.test(msg)) {
      console.error('Check that you replaced [YOUR-PASSWORD] in the URI with the real password.');
    }
    process.exit(1);
  }

  const { rows: who } = await client.query(
    'SELECT current_database() AS db, current_user AS usr, version() AS v'
  );
  console.log('connected: ' + who[0].db + ' as ' + who[0].usr);
  console.log(String(who[0].v).split(',')[0]);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const { rows: done } = await client.query('SELECT filename FROM public.schema_migrations');
  const applied = new Set(done.map((r) => r.filename));

  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const f of files) {
    if (applied.has(f)) {
      console.log('  skip  ' + f + '  (already applied)');
      continue;
    }
    const sql = readFileSync(join(DIR, f), 'utf8');
    process.stdout.write('  apply ' + f + ' ... ');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log('ok');
      ran++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      const err = e as Error & { position?: string; detail?: string; hint?: string };
      console.error('\n  ' + err.message);
      if (err.detail) console.error('  detail: ' + err.detail);
      if (err.hint) console.error('  hint:   ' + err.hint);
      if (err.position) {
        const p = parseInt(err.position, 10);
        const upto = sql.slice(0, p);
        const line = upto.split('\n').length;
        console.error('  at ' + f + ':' + line);
        console.error('  > ' + sql.split('\n')[line - 1]?.trim());
      }
      await client.end();
      process.exit(1);
    }
  }

  if (SEED) {
    process.stdout.write('  seed  supabase/seed.sql ... ');
    try {
      await client.query('BEGIN');
      await client.query(readFileSync('supabase/seed.sql', 'utf8'));
      await client.query('COMMIT');
      console.log('ok');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      console.error('  ' + (e as Error).message);
      await client.end();
      process.exit(1);
    }
  }

  // Report what actually landed.
  const { rows: counts } = await client.query(`
    SELECT
      (SELECT count(*) FROM public.profiles)                                    AS players,
      (SELECT count(*) FROM public.items)                                       AS items,
      (SELECT COALESCE(sum(stock_qty), 0) FROM public.items)                    AS units,
      (SELECT COALESCE(sum(est_value * stock_qty), 0) FROM public.items)         AS value,
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN
          ('open_box','box_odds','scrap_item','compact_scrap','salvage_shards',
           'claim_pc','approve_deposit','session_lookup','auth_verify_pin'))     AS fns
  `);
  const c = counts[0];
  console.log(
    '\n' + ran + ' migration(s) applied. ' +
    c.players + ' players, ' + c.items + ' items (' + c.units + ' units, $' +
    Number(c.value).toFixed(2) + '), ' + c.fns + '/9 core functions present.'
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
