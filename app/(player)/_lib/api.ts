'use client';

import type { BoxTier, OpenBoxResult, Roll, SessionUser } from '@/lib/types';
import type { PlayerBoxOdds, PlayerStats } from './shared';

/**
 * Client-side calls into the player API.
 *
 * Every route answers with the same envelope — `{ ok: true, data, ...extra }`
 * or `{ ok: false, error, code }` — so there is exactly one shape to parse and
 * one place that decides what a failure says to the player.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };

const OFFLINE = 'No connection. Check the wifi and try again.';

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store' });
  } catch {
    return { ok: false, error: OFFLINE, code: 'NETWORK' };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* an HTML error page, a proxy timeout — handled below */
  }

  const parsed = (body ?? {}) as { ok?: boolean; error?: string; code?: string };
  if (!res.ok || parsed.ok !== true) {
    return {
      ok: false,
      error: parsed.error ?? `Something went wrong (${res.status}).`,
      code: parsed.code,
    };
  }
  return { ok: true, value: body as T };
}

function post<T>(url: string, body?: unknown): Promise<Result<T>> {
  return call<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Roll ids
// ---------------------------------------------------------------------------

/**
 * A UUID per spin, generated client-side so a retry can reuse it.
 *
 * `crypto.randomUUID` only exists in a secure context. Half the point of this
 * app is thirty phones on one apartment's wifi hitting `http://192.168.x.x`,
 * which is NOT secure — so there is a real fallback rather than a crash. It
 * only has to be unique, not unguessable: the id is scoped to the caller's own
 * session and a collision is rejected by a UNIQUE constraint.
 */
export function newRollId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type LoginOk = { data: SessionUser & { mustChangePin: boolean }; mustChangePin: boolean };

export const apiLogin = (name: string, pin: string) =>
  post<LoginOk>('/api/auth/login', { name, pin });

export const apiLogout = () => post<{ data: null }>('/api/auth/logout');

export const apiSetPin = (pin: string) => post<{ data: SessionUser }>('/api/auth/pin', { pin });

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

export const apiOddsAll = () =>
  call<{ data: PlayerBoxOdds[]; stats: PlayerStats }>('/api/box/odds');

export const apiOdds = (tier: BoxTier) =>
  call<{ data: PlayerBoxOdds; stats: PlayerStats }>(`/api/box/odds?tier=${tier}`);

/**
 * Open a box.
 *
 * `clientRollId` is passed in by the caller and reused verbatim on retry: the
 * server treats a repeat as the same spin and returns the original result
 * rather than charging again. That is the entire reason a lost response on a
 * bad connection is survivable, so never mint a fresh id for a retry.
 */
export async function apiOpenBox(
  tier: BoxTier,
  clientRollId: string
): Promise<Result<{ data: OpenBoxResult; stats: PlayerStats }>> {
  const first = await post<{ data: OpenBoxResult; stats: PlayerStats }>('/api/box/open', {
    tier,
    clientRollId,
  });
  if (first.ok || first.code !== 'NETWORK') return first;

  // Safe precisely because the id is unchanged.
  return post<{ data: OpenBoxResult; stats: PlayerStats }>('/api/box/open', {
    tier,
    clientRollId,
  });
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const apiInventory = () =>
  call<{ data: Roll[]; recent: Roll[]; stats: PlayerStats }>('/api/inventory');

export const apiScrap = (rollId: string) =>
  post<{ data: { ok: boolean; scrap_gained: number }; stats: PlayerStats }>(
    '/api/inventory/scrap',
    { rollId }
  );

export const apiCompact = () =>
  post<{ data: { ok: boolean; spent: number; credit: number; tier: BoxTier }; stats: PlayerStats }>(
    '/api/inventory/compact'
  );

export const apiClaimPc = () =>
  post<{ data: { ok: boolean; item_name: string; value: number }; stats: PlayerStats }>(
    '/api/inventory/claim-pc'
  );

export const apiSalvage = (count: number) =>
  post<{ data: { ok: boolean; salvaged: number; credit: number }; stats: PlayerStats }>(
    '/api/inventory/salvage',
    { count }
  );
