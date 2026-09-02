/**
 * Find (and optionally delete) photos in storage that no item references.
 *
 *   npm run storage:orphans
 *   npm run storage:orphans -- --delete
 *
 * These accumulate from any upload that succeeded but whose URL never made it
 * onto an item: a failed scan, a cancelled form, a browser closed mid-flow, or
 * a client-side bug reading the wrong response field. Harmless but untidy, and
 * they quietly eat the project's storage quota.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local', quiet: true });

const BUCKET = 'item-images';
const DELETE = process.argv.includes('--delete');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  const { data: files, error: lErr } = await db.storage.from(BUCKET).list('', { limit: 1000 });
  if (lErr) {
    console.error('Could not list ' + BUCKET + ': ' + lErr.message);
    process.exit(1);
  }

  const { data: items, error: iErr } = await db.from('items').select('image_url');
  if (iErr) {
    console.error('Could not read items: ' + iErr.message);
    process.exit(1);
  }

  // Compare by filename rather than full URL: the public URL carries a project
  // host and query string that can differ between environments.
  const referenced = new Set(
    (items ?? [])
      .map((i) => (i.image_url ? String(i.image_url).split('/').pop()?.split('?')[0] : null))
      .filter(Boolean) as string[]
  );

  const orphans = (files ?? []).filter((f) => !referenced.has(f.name));
  const bytes = orphans.reduce((a, f) => a + Number(f.metadata?.size ?? 0), 0);

  console.log('\n' + (files?.length ?? 0) + ' files in storage, ' + referenced.size + ' referenced by items.');
  console.log(orphans.length + ' orphaned (' + (bytes / 1048576).toFixed(1) + ' MB)\n');

  if (orphans.length === 0) return;

  for (const o of orphans.slice(0, 15)) {
    console.log('  ' + o.name + '  ' + Math.round(Number(o.metadata?.size ?? 0) / 1024) + 'KB');
  }
  if (orphans.length > 15) console.log('  ... and ' + (orphans.length - 15) + ' more');

  if (!DELETE) {
    console.log('\nRe-run with --delete to remove them.\n');
    return;
  }

  const { error } = await db.storage.from(BUCKET).remove(orphans.map((o) => o.name));
  if (error) {
    console.error('\nDelete failed: ' + error.message);
    process.exit(1);
  }
  console.log('\nDeleted ' + orphans.length + ' orphaned files.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
