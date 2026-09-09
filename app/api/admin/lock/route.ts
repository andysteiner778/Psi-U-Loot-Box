import { NextResponse } from 'next/server';
import { lockAdmin } from '@/lib/admin-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/lock -> locks admin panel and redirects to main menu /
 * POST /api/admin/lock -> locks admin panel and returns { ok: true }
 */
export async function GET(req: Request) {
  await lockAdmin();
  const url = new URL(req.url);
  const target = url.searchParams.get('redirect') || '/';
  return NextResponse.redirect(new URL(target, req.url));
}

export async function POST() {
  await lockAdmin();
  return NextResponse.json({ ok: true });
}
