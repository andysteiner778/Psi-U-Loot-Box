import { adminOrError } from '@/app/admin/_lib/guard';
import { jsonErr, jsonOk } from '@/app/admin/_lib/http';
import { db, rpcErrorStatus } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/reset   { confirm: "RESET" }  -> { ok, rolls_cleared, ... }
 *
 * Clears the test run: rolls, deposits, balances, coins, shards, the global
 * shard mint counter, and restores every item to its opening stock. Keeps
 * names, roles and PINs, so a roster already renamed to real housemates
 * survives.
 *
 * Requires an explicit confirmation string in the body. This is destructive and
 * one stray tap on a phone should not be able to wipe a live party.
 */
export async function POST(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== 'RESET') {
    return jsonErr(400, 'Confirmation required', 'CONFIRM_REQUIRED');
  }

  const { data, error } = await db.rpc('reset_party_state', { p_admin_id: gate.id });
  if (error) return jsonErr(rpcErrorStatus(error), error.message);
  return jsonOk(data);
}
