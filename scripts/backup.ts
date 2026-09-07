/**
 * SNAPSHOT THE WHOLE DATABASE TO DISK
 *
 *   npm run backup                 # write backups/<timestamp>/
 *   npm run backup -- --restore <dir>   # put a snapshot back
 *
 * This project is on Supabase's free tier: there is no point-in-time recovery
 * and no scheduled backups. On 2026-09-07 a bad DELETE destroyed the entire
 * items table and there was nothing to restore from. This is the thing that
 * should have existed already.
 *
 * Every table is written as plain JSON — readable, diffable, committable, and
 * restorable without any Supabase plan. Snapshots are keyed by timestamp so
 * they never overwrite each other.
 *
 * RUN THIS BEFORE ANY DESTRUCTIVE OPERATION. `reset-party` and anything that
 * deletes rows call it automatically; a human running SQL by hand should too.
 */
import { config as denv } from 'dotenv';
import { Client } from 'pg';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

denv({ path: '.env.local', quiet: true });

/**
 * Everything the game owns. Deliberately explicit rather than "all tables in
 * public": a new table should be a conscious decision to back up, not a silent
 * omission discovered during a restore.
 */
const TABLES = [
  'config',
  'profiles',
  'items',
  'rolls',
  'vouchers',
  'deposits',
  'drop_overrides',
  'schema_migrations',
];

const ROOT = 'backups';

function connect() {
  return new Client({
    connectionString: process.env.SUPABASE_DB_URL!,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  });
}

export async function snapshot(label = ''): Promise<string> {
  const c = connect();
  await c.connect();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(ROOT, stamp + (label ? '_' + label : ''));
  mkdirSync(dir, { recursive: true });

  const summary: Record<string, number> = {};
  try {
    for (const t of TABLES) {
      try {
        const { rows } = await c.query(`SELECT * FROM public.${t}`);
        writeFileSync(join(dir, t + '.json'), JSON.stringify(rows, null, 1));
        summary[t] = rows.length;
      } catch (e) {
        summary[t] = -1;
        writeFileSync(join(dir, t + '.ERROR.txt'), (e as Error).message);
      }
    }
    writeFileSync(join(dir, '_manifest.json'), JSON.stringify({
      taken_at: new Date().toISOString(),
      label,
      rows: summary,
    }, null, 2));
  } finally {
    await c.end();
  }
  return dir;
}

async function restore(dir: string) {
  if (!existsSync(dir)) throw new Error('no such snapshot: ' + dir);
  const c = connect();
  await c.connect();
  try {
    await c.query('BEGIN');
    /*
     * Children first on the way out, parents first on the way in, so foreign
     * keys never block the load. config and schema_migrations are left alone --
     * restoring a migration ledger over a newer schema would make the database
     * lie about what has been applied.
     */
    const order = ['drop_overrides', 'vouchers', 'rolls', 'deposits', 'items', 'profiles'];
    for (const t of order) await c.query(`DELETE FROM public.${t} WHERE TRUE`);

    for (const t of [...order].reverse()) {
      const file = join(dir, t + '.json');
      if (!existsSync(file)) continue;
      const rows = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
      for (const r of rows) {
        const cols = Object.keys(r);
        const vals = cols.map((k) => r[k]);
        const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
        await c.query(
          `INSERT INTO public.${t} (${cols.map((k) => '"' + k + '"').join(',')}) VALUES (${ph})`,
          vals
        );
      }
      console.log('  restored ' + rows.length + ' row(s) into ' + t);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--restore');

  if (ri >= 0) {
    const dir = args[ri + 1];
    if (!dir) {
      console.log('\n  Usage: npm run backup -- --restore backups/<snapshot>\n');
      console.log('  Available:');
      for (const d of (existsSync(ROOT) ? readdirSync(ROOT) : []).sort().reverse().slice(0, 20)) {
        const m = join(ROOT, d, '_manifest.json');
        const rows = existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')).rows : {};
        console.log('    ' + d + '   items=' + (rows.items ?? '?') + ' rolls=' + (rows.rolls ?? '?'));
      }
      console.log('');
      return;
    }
    // Never restore over live data without a snapshot of that data first.
    const safety = await snapshot('pre-restore');
    console.log('\n  current state saved to ' + safety);
    console.log('  restoring ' + dir + '\n');
    await restore(dir);
    console.log('\n  Done.\n');
    return;
  }

  const label = args.find((a) => !a.startsWith('-')) ?? '';
  const dir = await snapshot(label);
  const m = JSON.parse(readFileSync(join(dir, '_manifest.json'), 'utf8'));
  console.log('\n  Snapshot -> ' + dir);
  for (const [t, n] of Object.entries(m.rows as Record<string, number>)) {
    console.log('    ' + t.padEnd(20) + (n < 0 ? 'FAILED' : n + ' row(s)'));
  }
  console.log('');
}

if (process.argv[1] && process.argv[1].includes('backup')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
