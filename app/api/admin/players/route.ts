import 'server-only';

import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk } from '@/app/admin/_lib/http';
import type { Profile } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/players -> Profile[]
 *
 * Gated by adminOrError(). Returns all 30 profiles ordered alphabetically.
 */
export async function GET() {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const { data, error } = await db
    .from('profiles')
    .select('id, name, balance, scrap_coins, pc_shards, role, created_at')
    .order('name', { ascending: true });

  if (error) {
    return jsonErr(500, error.message);
  }

  return jsonOk(data as Profile[]);
}
