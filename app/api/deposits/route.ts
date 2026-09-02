import { requireUser } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { fail, ok, readJson, toErrorResponse } from '@/app/(player)/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/deposits   { amount, venmoNote } -> Deposit
 *
 * User creates a pending deposit record for admin approval.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
      return fail('Please enter a valid deposit amount between $1 and $10,000.', 400);
    }

    const venmoNote = typeof body.venmoNote === 'string' && body.venmoNote.trim()
      ? body.venmoNote.trim().slice(0, 100)
      : `#BOX-${user.name}`;

    const { data, error } = await db
      .from('deposits')
      .insert({
        user_id: user.id,
        amount: Math.round(amount * 100) / 100,
        venmo_note: venmoNote,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) {
      console.error('[deposits] insert failed', error);
      return fail('Could not submit deposit request.', 500);
    }

    return ok(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}
