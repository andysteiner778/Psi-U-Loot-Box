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
 * when one of thirty housemates loses a phone at 2am.
 *
 * Session and PIN data live in the `app_private` schema, which PostgREST does
 * not expose, so supabase-js cannot touch those tables directly. Everything
 * here goes through the SECURITY DEFINER wrappers in migration 0004 — each one
 * exposes a single verb rather than table access, so there is no code path that
 * can return a PIN hash at all.
 */

const COOKIE = 'hl_session';
const TTL_DAYS = 14;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface SessionUserFull extends SessionUser {
  /** True until the player replaces the seeded 1234. Force a change before play. */
  mustChangePin: boolean;
}

export async function createSession(profileId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TTL_DAYS * 86400_000);

  const { error } = await db.rpc('session_create', {
    p_profile_id: profileId,
    p_token_hash: hash(token),
    p_expires: expires.toISOString(),
  });
  if (error) throw new Error('Could not create session: ' + error.message);

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // blocks cross-site POSTs; with POST-only mutations this is our CSRF control
    path: '/',
    maxAge: TTL_DAYS * 86400,
  });
}

/** Resolve the current user, or null. The ONLY source of identity in the app. */
export async function getSession(): Promise<SessionUserFull | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const { data, error } = await db.rpc('session_lookup', { p_token_hash: hash(token) });
  if (error || !data || data.length === 0) return null;

  const row = data[0] as { id: string; name: string; role: 'player' | 'admin'; must_change: boolean };
  return { id: row.id, name: row.name, role: row.role, mustChangePin: !!row.must_change };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.rpc('session_destroy', { p_token_hash: hash(token) });
  jar.delete(COOKIE);
}

/**
 * Verify a name + PIN and open a session.
 * Returns null on bad credentials; throws with code 'PT429' when locked out
 * after five failed attempts (15 minutes).
 */
export interface LoginResult extends SessionUserFull {
  /** True when this call created the account rather than signing into one. */
  created: boolean;
}

/**
 * Sign in, or create the account if the name is new.
 *
 * There is no pre-seeded roster: people type their name, choose a PIN, and the
 * account exists. Login and registration are ONE database call on purpose --
 * checking "is this name free?" and then inserting is a race two people typing
 * the same name can lose.
 *
 * Returns null on a wrong PIN for an existing account; throws with code 'PT429'
 * when locked out, and 'PT400' for a malformed name or PIN.
 */
export async function login(name: string, pin: string): Promise<LoginResult | null> {
  const { data, error } = await db.rpc('auth_login_or_register', { p_name: name, p_pin: pin });
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const row = data[0] as {
    profile_id: string;
    name: string;
    role: 'player' | 'admin';
    must_change: boolean;
    created: boolean;
  };
  await createSession(row.profile_id);
  return {
    id: row.profile_id,
    name: row.name,
    role: row.role,
    mustChangePin: !!row.must_change,
    created: !!row.created,
  };
}

export async function setPin(profileId: string, pin: string): Promise<void> {
  const { error } = await db.rpc('auth_set_pin', { p_profile_id: profileId, p_pin: pin });
  if (error) throw error;
}

/** Names for the login dropdown. Server-side only — the browser never sees `profiles`. */
export async function playerRoster(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db.rpc('player_roster');
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}

/** Throws unless a player is signed in. Use at the top of every player route. */
export async function requireUser(): Promise<SessionUserFull> {
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
 * with the house's billing attached.
 */
export async function requireAdmin(): Promise<SessionUserFull> {
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
