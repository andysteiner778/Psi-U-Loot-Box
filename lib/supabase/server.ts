import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS entirely — this IS the security boundary.
 *
 * `import 'server-only'` makes the build fail loudly if this module is ever
 * pulled into a client component, rather than silently shipping the key to
 * every visitor's browser.
 *
 * Rule for every caller: the user id passed to an RPC comes from the session
 * cookie, NEVER from the request body. The whole auth model rests on that.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Copy .env.local.example to .env.local and fill in your Supabase keys.'
  );
}

export const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
