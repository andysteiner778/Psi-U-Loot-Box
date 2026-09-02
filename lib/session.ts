import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import { db } from './supabase/server';
import type { SessionUser } from './types';

/**
 * Server-side sessions.
 *
 * The cookie holds 32 random bytes; the database stores only its SHA-256. A
 * database read therefore cannot be replayed as a login, and a session can be
 * revoked — which a stateless signed JWT cannot, and which is a realistic need
 * when one of thirty housemates starts being a problem at 2am.
 */

const COOKIE = 'hl_session';
const TTL_DAYS = 14;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(profileId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TTL_DAYS * 86400_000);

  const { error } = await db.schema('app_private').from('sessions').insert({
    token_hash: hash(token),
    profile_id: profileId,
    expires_at: expires.toISOString(),
  });
  if (error) throw new Error('Could not create session: ' + error.message);

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // blocks cross-site POSTs; with POST-only mutations this is our CSRF control
    path: '/',
    maxAge: TTL_DAYS * 86400,
  });
  return token;
}

/** Resolve the current user, or null. The ONLY source of identity in the app. */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const { data, error } = await db
    .schema('app_private')
    .from('sessions')
    .select('profile_id, expires_at')
    .eq('token_hash', hash(token))
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at) <= new Date()) {
    await destroySession();
    return null;
  }

  const { data: profile } = await db
    .from('profiles')
    .select('id, name, role')
    .eq('id', data.profile_id)
    .maybeSingle();

  return profile ? { id: profile.id, name: profile.name, role: profile.role } : null;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await db.schema('app_private').from('sessions').delete().eq('token_hash', hash(token));
  }
  jar.delete(COOKIE);
}

/** Throws unless a player is signed in. Use at the top of every player route. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new UnauthorizedError('Not signed in');
  return user;
}

/**
 * Throws unless the signed-in user is an admin.
 *
 * Role is read from the database on every call, never from the cookie. The
 * spec's "protect /admin with a simple PIN prompt" is a client-side gate and
 * protects nothing — this must guard every /admin page AND every admin API
 * route, including /api/vision/scan-item, which is otherwise a free AI proxy
 * with your billing attached.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') throw new ForbiddenError('Admin only');
  return user;
}

export class UnauthorizedError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}
