import { NextResponse } from 'next/server';
import { requireAdmin, ForbiddenError, UnauthorizedError } from '@/lib/session';
import { unlockAdmin, lockAdmin, adminPinConfigured } from '@/lib/admin-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/unlock  { pin }   -> unlock for 30 minutes
 * DELETE /api/admin/unlock          -> lock immediately
 *
 * The PIN is compared server-side in constant time and never leaves the server.
 * A client-side prompt would be bypassed by anyone who opens devtools, which is
 * exactly the case this exists to prevent.
 */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    const status = e instanceof ForbiddenError ? 403 : e instanceof UnauthorizedError ? 401 : 503;
    return NextResponse.json({ ok: false, error: 'Not an admin' }, { status });
  }

  if (!adminPinConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'ADMIN_PIN is not configured on the server' },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => null)) as { pin?: string } | null;
  const pin = String(body?.pin ?? '');

  if (!(await unlockAdmin(admin.id, pin))) {
    // Deliberately vague and deliberately slow-ish: no hint about length or
    // how close the guess was.
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ ok: false, error: 'Incorrect PIN' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await lockAdmin();
  return NextResponse.json({ ok: true });
}
