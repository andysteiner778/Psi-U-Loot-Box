import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import type { TickerEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ticker -> TickerEvent[]  (most recent first)
 *
 * The ticker is fed by Realtime broadcast, which only carries events that
 * happen while you are watching. Navigating to /inventory and back remounted
 * the component with an empty list, so the banner went blank and looked broken
 * — on a busy night it would refill, but on a quiet one it just sat empty.
 *
 * This seeds it with recent history so it always has something to cycle.
 * Deliberately narrow: names and items only, never user ids or balances, so it
 * discloses exactly what the live broadcast already does.
 */
export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }

  const { data, error } = await db
    .from('rolls')
    .select('item_name, item_rarity, kind, box_tier, rolled_at, profiles(name)')
    .order('rolled_at', { ascending: false })
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const events: TickerEvent[] = (data ?? []).map((r) => {
    const prof = r.profiles as unknown as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(prof) ? prof[0]?.name : prof?.name;
    return {
      player: name ?? 'Someone',
      item: r.item_name,
      rarity: r.item_rarity,
      kind: r.kind,
      tier: r.box_tier,
      at: r.rolled_at,
    } as TickerEvent;
  });

  return NextResponse.json({ ok: true, data: events });
}
