import { login } from '@/lib/session';
import { fail, isPin, ok, readJson, toErrorResponse } from '@/app/(player)/_lib/http';

/** Service-role client and node crypto — this cannot run on the edge. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login   { name, pin } -> SessionUserFull
 *
 * `login()` verifies the PIN and opens the session in one step. It returns null
 * for a wrong name AND a wrong PIN — `auth_verify_pin` equalises the timing on
 * purpose — so the response here must stay equally vague. Telling an attacker
 * which of thirty names is real halves the search space for free.
 *
 * Lockout (5 strikes, 15 minutes) is enforced in the database and arrives as
 * SQLSTATE PT429.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const pin = body.pin;

    if (!name || name.length > 64) return fail('Pick your name from the list.', 400);
    if (!isPin(pin)) return fail('Your PIN is 4 digits.', 400);

    const user = await login(name, pin);
    if (!user) {
      // Only reachable when the name EXISTS and the PIN was wrong -- a new name
      // would have been created instead. So we can say so plainly.
      return fail('Wrong PIN for that name. If this is your first time, pick a name nobody has used yet.', 401);
    }

    return ok(user, { mustChangePin: user.mustChangePin });
  } catch (err) {
    return toErrorResponse(err, {
      PT429: 'too many attempts, locked 15 minutes',
    });
  }
}
