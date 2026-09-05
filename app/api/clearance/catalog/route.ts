import { NextResponse } from 'next/server';
import { readClearanceConfig } from '@/app/admin/_lib/clearance';
import { db } from '@/lib/supabase/server';
import type { Item, Rarity, BoxTier } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await readClearanceConfig();

    const { data, error } = await db
      .from('items')
      .select('id, name, description, image_url, est_value, msrp, rarity, stock_qty, box_tier, reward_credit, reward_voucher_tier, shard_cost')
      .gt('stock_qty', 0)
      .eq('is_active', true)
      .order('est_value', { ascending: false });

    if (error) throw error;

    // Filter out consumable vouchers/credits — clearance is for physical things
    const items = (data ?? [])
      .filter((i) => i.reward_credit === null && i.reward_voucher_tier === null)
      // The Gaming PC is an ordinary items row with shard_cost = 4. Without
      // this it was buyable outright and eligible for a 1-in-3 custom spin,
      // which makes every shard anyone collected worthless.
      .filter((i) => !i.shard_cost || Number(i.shard_cost) === 0)
      .map((i) => ({
        id: i.id as string,
        name: i.name as string,
        description: (i.description as string | null) ?? null,
        image_url: (i.image_url as string | null) ?? null,
        est_value: Number(i.est_value),
        msrp: i.msrp ? Number(i.msrp) : null,
        rarity: i.rarity as Rarity,
        stock_qty: Number(i.stock_qty),
        box_tier: i.box_tier as BoxTier,
      }));

    return NextResponse.json({
      ok: true,
      config,
      items,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to load clearance catalog' },
      { status: 500 }
    );
  }
}
