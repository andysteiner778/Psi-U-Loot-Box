import 'server-only';

import { ForbiddenError, UnauthorizedError, requireAdmin, type SessionUserFull } from '@/lib/session';
import { adminPinConfigured, isAdminUnlocked } from '@/lib/admin-lock';
import { jsonErr } from './http';

/**
 * THE admin boundary.
 *
 * SPEC.md section 6 says "protect /admin with a simple PIN prompt". A prompt in
 * the browser protects nothing: the pages are server-rendered and the API
 * routes hold the service-role key, so anyone who knows the URL would own the
 * economy. Both helpers below go to `requireAdmin()`, which re-reads the role
 * from the database on every single request.
 *
 * They differ only in how they FAIL: an API route returns 401/403 JSON, a page
 * renders a locked screen. Neither ever trusts a client-supplied identity.
 */

/**
 * For route handlers. Usage:
 *
 *   const gate = await adminOrError();
 *   if (gate instanceof Response) return gate;
 *   // `gate` is now the admin's SessionUser — take ids from HERE, never the body.
 */
export async function adminOrError(): Promise<SessionUserFull | Response> {
  try {
    const admin = await requireAdmin();
    // Second factor. Role proves WHO you are; this proves the person holding
    // the phone right now is actually the operator. See lib/admin-lock.ts.
    if (!(await isAdminUnlocked(admin.id))) {
      return jsonErr(403, 'Admin panel is locked. Enter the admin PIN.', 'ADMIN_LOCKED');
    }
    return admin;
  } catch (err) {
    if (err instanceof ForbiddenError) return jsonErr(403, 'Admin only', 'FORBIDDEN');
    if (err instanceof UnauthorizedError) return jsonErr(401, 'Not signed in', 'UNAUTHORIZED');
    // A database outage must fail closed, not open.
    return jsonErr(503, 'Cannot verify admin session right now', 'AUTH_UNAVAILABLE');
  }
}

export type PageGate =
  | { ok: true; admin: SessionUserFull }
  | { ok: false; reason: 'unauthorized' | 'forbidden' | 'unavailable' | 'locked'; detail: string };

/** For server pages. Returns a gate rather than throwing, so we can render a real screen. */
export async function adminPageGate(): Promise<PageGate> {
  try {
    const admin = await requireAdmin();
    if (!(await isAdminUnlocked(admin.id))) {
      return {
        ok: false,
        reason: 'locked',
        detail: adminPinConfigured()
          ? 'Enter the admin PIN to unlock house controls.'
          : 'ADMIN_PIN is not set.',
      };
    }
    return { ok: true, admin };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, reason: 'forbidden', detail: 'This account is not an admin.' };
    }
    if (err instanceof UnauthorizedError) {
      return { ok: false, reason: 'unauthorized', detail: 'Sign in first.' };
    }
    return {
      ok: false,
      reason: 'unavailable',
      detail: err instanceof Error ? err.message : 'Session backend unreachable.',
    };
  }
}
