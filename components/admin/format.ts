/**
 * Pure formatters shared by admin server pages and admin client components.
 * No imports from `lib/supabase` or `lib/session` — this file crosses the
 * server/client boundary, so it must stay free of anything `server-only`.
 */

export function usd(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toFixed(dp);
}

export function pct(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '—';
  return (n * 100).toFixed(dp) + '%';
}

/** "1 in 67" reads better than "1.5%" when the admin is eyeballing drop rates. */
export function oneIn(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return 'never';
  if (p >= 1) return 'always';
  return '1 in ' + Math.round(1 / p).toLocaleString();
}

export function ago(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
  return Math.floor(h / 24) + 'd ago';
}

/** Countdown text for the flash-sale clock. Server supplies the deadline. */
export function countdown(msRemaining: number): string {
  const s = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export const TIER_LABEL: Record<string, string> = {
  tier_1: 'Tier 1 · Dorm Scraps',
  tier_2: 'Tier 2 · Living Room Gear',
  tier_3: 'Tier 3 · High Roller',
};

/** Coerce PostgREST numerics (which may arrive as strings) to a real number. */
export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
