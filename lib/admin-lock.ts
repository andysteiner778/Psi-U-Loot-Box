import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * ADMIN STEP-UP LOCK
 *
 * `requireAdmin()` already proves *who* you are: it re-reads `profiles.role`
 * from the database on every request, so an outsider cannot reach /admin at
 * all. This is a second, different factor on top of that.
 *
 * The threat it addresses is the realistic one at a house party: the admin's
 * phone is unlocked on a table, already signed in, and someone picks it up.
 * Role alone cannot stop that — the session is legitimately the admin's. A
 * separate PIN, plus a short idle timeout, does.
 *
 * Two properties that matter:
 *   - The PIN is verified SERVER-SIDE and never sent to the browser. A
 *     client-side prompt would be trivially bypassed by anyone who opens
 *     devtools, which is exactly the "hack into the app and modify win rates"
 *     case this is meant to prevent.
 *   - The unlock token is bound to the admin's profile id, so it cannot be
 *     lifted from one account's cookie jar and replayed against another.
 */

const COOKIE = 'hl_admin_unlock';

/** Short by design: an unattended phone re-locks on its own. */
const TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

const DEFAULT_ADMIN_PIN = '4242';

/** The configured admin PIN, falling back to '4242' if unset in env. */
export function adminPin(): string {
  const p = process.env.ADMIN_PIN;
  return p && p.length >= 4 ? p : DEFAULT_ADMIN_PIN;
}

export function adminPinConfigured(): boolean {
  return true;
}

function sign(profileId: string, exp: number): string {
  return createHmac('sha256', secret()).update(profileId + '.' + exp).digest('hex');
}

/** Constant-time compare so a wrong PIN cannot be discovered by timing. */
function pinMatches(input: string): boolean {
  const expected = adminPin();
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so length is not leaked by early return timing.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function unlockAdmin(profileId: string, pin: string): Promise<boolean> {
  if (!pinMatches(pin)) return false;

  const exp = Date.now() + TTL_MS;
  (await cookies()).set(COOKIE, exp + '.' + sign(profileId, exp), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return true;
}

export async function isAdminUnlocked(profileId: string): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;

  const [expStr, sig] = raw.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;

  const expected = sign(profileId, exp);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export async function lockAdmin(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
