import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS entirely — this IS the security boundary.
 *
 * `import 'server-only'` makes the build fail loudly if this module is ever
 * pulled into a client component, rather than silently shipping the key to
 * every visitor's browser.
 *
 * Rule for every caller: the user id passed to an RPC comes from the session
 * cookie, NEVER from the request body. The whole auth model rests on that.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS LAZY
 * ---------------------------------------------------------------------------
 * This used to build the client at module scope and throw if the env vars were
 * missing. That broke `next build`: Next.js imports every route module during
 * "collecting page data", so a missing variable at BUILD time killed the whole
 * deploy — even though the app only needs the key at REQUEST time. On Vercel
 * that surfaced as a completely unrelated-looking failure in the first API
 * route that happened to be collected.
 *
 * Config problems should fail on the request that needs the config, with a
 * message naming what is missing, not during a build step that has no business
 * touching the database.
 */

let cached: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    const missing = [
      !url && 'NEXT_PUBLIC_SUPABASE_URL',
      !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ]
      .filter(Boolean)
      .join(' and ');
    throw new Error(
      'Supabase is not configured: missing ' + missing + '. ' +
        'Locally, set it in .env.local. On Vercel, add it under ' +
        'Settings -> Environment Variables (SUPABASE_SERVICE_ROLE_KEY must NOT ' +
        'have a NEXT_PUBLIC_ prefix).'
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * Behaves exactly like a SupabaseClient, but the real one is constructed on
 * first property access rather than at import. Call sites are unchanged.
 */
export const db: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(client() as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client()) : value;
  },
  has(_target, prop) {
    return Reflect.has(client() as object, prop);
  },
});

/** True when the server has everything it needs to reach Supabase. */
export function supabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Postgres SQLSTATEs the RPCs raise, mapped to HTTP status codes. */
export const PG_ERROR_STATUS: Record<string, number> = {
  PT400: 400,
  PT402: 402,
  PT403: 403,
  PT404: 404,
  PT409: 409,
  PT429: 429,
  PT500: 500,
};

export function rpcErrorStatus(err: { code?: string } | null): number {
  return (err?.code && PG_ERROR_STATUS[err.code]) || 500;
}
