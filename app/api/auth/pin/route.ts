import { requireUser, setPin } from '@/lib/session';
import { fail, isPin, ok, readJson, toErrorResponse } from '@/app/(player)/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The seeded PIN. Changing 1234 to 1234 is not changing it. */
const SEEDED_PIN = '1234';

/**
 * POST /api/auth/pin   { pin } -> { ok }
 *
 * First-login PIN change. The profile id comes from the session cookie via
 * `requireUser()`; there is no path here that accepts one from the body, so a
 * player cannot reset anybody else's PIN.
 *
 * `auth_set_pin` also clears failed_attempts and the lockout, which is the
 * intended behaviour: you just proved you know the current PIN to get here.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const pin = body.pin;

    if (!isPin(pin)) return fail('Your PIN must be exactly 4 digits.', 400);
    if (pin === SEEDED_PIN) {
      return fail('Pick something other than the default 1234.', 400);
    }

    await setPin(user.id, pin);
    return ok({ id: user.id, name: user.name, role: user.role, mustChangePin: false });
  } catch (err) {
    return toErrorResponse(err, { PT400: 'Your PIN must be exactly 4 digits.' });
  }
}
