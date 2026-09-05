import 'server-only';
import { NextResponse } from 'next/server';
import { db, rpcErrorStatus } from '@/lib/supabase/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/session';
import type { BoxTier } from '@/lib/types';
import type { PlayerStats, VoucherSummary } from './shared';

/**
 * Shared plumbing for the player route handlers (auth / box / inventory).
 *
 * It lives under `app/(player)/_lib` rather than `lib/` because `lib/` is
 * centrally owned and frozen; `_lib` is a private folder, so Next.js does not
 * route it. It is server-only — never import it from a client component.
 *
 * Two jobs:
 *   1. One response envelope, so the client has exactly one shape to parse.
 *   2. One place that turns a Postgres SQLSTATE into a sentence a drunk
 *      housemate can act on. "Not enough credits" must never surface as a
 *      stack trace, and an unrecognised failure must never leak SQL text.
 */

export type { PlayerStats };

export function ok<T>(data: T, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: true, data, ...extra });
}

export function fail(error: string, status: number, code?: string): NextResponse {
  return NextResponse.json({ ok: false, error, code }, { status });
}

/** A Postgres error surfaced through PostgREST. `code` is the SQLSTATE. */
export class RpcError extends Error {
  code?: string;
  status: number;
  constructor(err: { code?: string; message?: string }) {
    super(err.message ?? 'RPC failed');
    this.name = 'RpcError';
    this.code = err.code;
    this.status = rpcErrorStatus(err);
  }
}

/**
 * Call an RPC and throw on failure, so every route can use one try/catch
 * instead of hand-rolling error plumbing five times.
 *
 * The caller ALWAYS supplies identity from `(await requireUser()).id`. There is
 * deliberately no helper here that reads a user id out of a request body.
 */
export async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new RpcError(error);
  return data as T;
}

/** Default copy per SQLSTATE. Routes override the ones that need context. */
const DEFAULT_MESSAGES: Record<string, string> = {
  PT400: "That didn't look right — try again.",
  PT402: 'Not enough credits',
  PT403: "That isn't yours to do.",
  PT404: "We couldn't find that.",
  PT409: 'That has already been handled.',
  PT429: 'Too many attempts, locked 15 minutes',
  PT500: 'The house is having a moment. Try again.',
};

function codeOf(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

/**
 * Convert anything thrown inside a route handler into a safe JSON response.
 *
 * Unrecognised errors are logged server-side and reported generically: the
 * message on a Postgres error can contain query text, and this app is served
 * to thirty people on a shared network.
 */
export function toErrorResponse(err: unknown, messages?: Record<string, string>): NextResponse {
  if (err instanceof UnauthorizedError) return fail('Sign in first.', 401);
  if (err instanceof ForbiddenError) return fail('Admins only.', 403);

  const code = codeOf(err);
  if (code && (messages?.[code] || DEFAULT_MESSAGES[code])) {
    return fail(messages?.[code] ?? DEFAULT_MESSAGES[code], rpcErrorStatus({ code }), code);
  }

  console.error('[house-loot] unhandled route error', err);
  return fail('Something broke on our end. Try that again.', 500);
}

/** Current balances and active unredeemed vouchers, for the optimistic HUD and box cards to reconcile against. */
export async function playerStats(userId: string): Promise<PlayerStats> {
  const [profRes, vchRes] = await Promise.all([
    db.from('profiles').select('balance, scrap_coins, pc_shards').eq('id', userId).maybeSingle(),
    db.from('vouchers').select('box_tier, discount_pct').eq('user_id', userId).is('redeemed_at', null),
  ]);

  const vouchers: Partial<Record<BoxTier, VoucherSummary>> = {};
  for (const r of vchRes.data ?? []) {
    const tier = r.box_tier as BoxTier;
    const pct = Number(r.discount_pct);
    if (!vouchers[tier]) {
      vouchers[tier] = { count: 1, bestPct: pct };
    } else {
      vouchers[tier]!.count += 1;
      if (pct > vouchers[tier]!.bestPct) {
        vouchers[tier]!.bestPct = pct;
      }
    }
  }

  const data = profRes.data;
  return {
    balance: Number(data?.balance ?? 0),
    scrap_coins: Number(data?.scrap_coins ?? 0),
    pc_shards: Number(data?.pc_shards ?? 0),
    vouchers,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export const isPin = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{4}$/.test(v);

/** Body parsing that cannot throw. A truncated POST from a flaky phone is a 400, not a 500. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
