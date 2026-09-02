import { destroySession } from '@/lib/session';
import { ok, toErrorResponse } from '@/app/(player)/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout -> { ok }
 *
 * Deliberately not guarded by `requireUser()`: signing out an already-dead
 * session must succeed, or a player with a stale cookie can never get back to
 * the login screen. POST-only, so a stray <img> tag cannot log anyone out.
 */
export async function POST() {
  try {
    await destroySession();
    return ok(null);
  } catch (err) {
    return toErrorResponse(err);
  }
}
