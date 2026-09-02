import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk } from '@/app/admin/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/deposits -> Deposit[] with player names
 */
export async function GET() {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const { data, error } = await db
    .from('deposits')
    .select(`
      id,
      user_id,
      amount,
      venmo_note,
      status,
      created_at,
      profiles:user_id ( name )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    return jsonErr(500, 'Could not load deposits: ' + error.message);
  }

  const formatted = (data ?? []).map((d: any) => ({
    id: d.id,
    user_id: d.user_id,
    player_name: d.profiles?.name || 'Unknown',
    amount: Number(d.amount),
    venmo_note: d.venmo_note,
    status: d.status,
    created_at: d.created_at,
  }));

  return jsonOk(formatted);
}
