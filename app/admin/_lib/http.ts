import 'server-only';

import type { ApiResult } from '@/lib/types';

/**
 * JSON helpers for the admin API surface. Every handler answers in the
 * project's `ApiResult<T>` shape so the admin client can branch on `ok`
 * without sniffing status codes.
 */

export function jsonOk<T>(data: T, status = 200): Response {
  const body: ApiResult<T> = { ok: true, data };
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export function jsonErr(status: number, error: string, code?: string): Response {
  const body: ApiResult<never> = { ok: false, error, code };
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
