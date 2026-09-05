import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/session';
import { readClearanceConfig } from '@/app/admin/_lib/clearance';
import { db } from '@/lib/supabase/server';
import type { BoxTier, Rarity } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isUuid(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  );
}

/**
 * POST /api/clearance/buy
 * Body: { itemId, paymentMethod, clientRollId }
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { itemId, paymentMethod, clientRollId } = body;

    if (!isUuid(itemId)) {
      return NextResponse.json({ ok: false, error: 'Invalid item ID' }, { status: 400 });
    }
    if (!isUuid(clientRollId)) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid client roll ID' }, { status: 400 });
    }
    if (paymentMethod !== 'balance' && paymentMethod !== 'venmo_reserve') {
      return NextResponse.json({ ok: false, error: 'Invalid payment method' }, { status: 400 });
    }

    // 1. Check idempotency: if this clientRollId already succeeded, replay original result
    const { data: existingRoll } = await db
      .from('rolls')
      .select('id, item_name, item_rarity, box_price, payload')
      .eq('client_roll_id', clientRollId)
      .maybeSingle();

    if (existingRoll) {
      const payload = existingRoll.payload as Record<string, unknown> | null;
      return NextResponse.json({
        ok: true,
        replayed: true,
        item: {
          id: itemId,
          name: existingRoll.item_name,
          rarity: existingRoll.item_rarity as Rarity,
          est_value: Number(existingRoll.box_price),
        },
        rollId: existingRoll.id,
        paymentMethod: payload?.payment_method ?? paymentMethod,
        price: Number(existingRoll.box_price),
      });
    }

    // 2. Clearance Mode enabled check
    const clearanceConfig = await readClearanceConfig();
    if (!clearanceConfig.enabled) {
      return NextResponse.json({ ok: false, error: 'Clearance Mode is not currently active' }, { status: 403 });
    }
    if (paymentMethod === 'venmo_reserve' && !clearanceConfig.allow_venmo_reserve) {
      return NextResponse.json({ ok: false, error: 'Venmo reservations are currently disabled' }, { status: 400 });
    }

    // 3. Inspect target item
    const { data: item, error: itemErr } = await db
      .from('items')
      .select('id, name, rarity, est_value, stock_qty, box_tier, image_url, is_active, reward_credit, reward_voucher_tier')
      .eq('id', itemId)
      .maybeSingle();

    if (itemErr || !item) {
      return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 });
    }
    if (!item.is_active || item.reward_credit !== null || item.reward_voucher_tier !== null) {
      return NextResponse.json({ ok: false, error: 'This item is not eligible for clearance buyout' }, { status: 400 });
    }
    if (Number(item.stock_qty) <= 0) {
      return NextResponse.json({ ok: false, error: 'Item is out of stock' }, { status: 409 });
    }

    const price = Number(item.est_value);

    // 4-6. Charge, decrement and record — in ONE database transaction.
    //
    // This used to be three PostgREST round trips: read the balance and write
    // balance-price, then read stock and write stock-1 guarded by stock_qty>0,
    // then insert the roll and hand-roll a compensating "revert" on failure.
    //
    // The stock step was a READ-MODIFY-WRITE, not an atomic decrement. The >0
    // guard only covers the case where stock is exactly 1. With stock >= 2 both
    // racers read 2, both write 1, both pass the guard, and two units go out
    // against one decrement. Measured live: 2 concurrent claims on 2 units left
    // stock at 1, so 3 units were accounted for out of 2. That is the same
    // invariant break that duplicated five prizes earlier in this project.
    //
    // The compensating revert was worse: it wrote back the STALE stock value,
    // un-selling whatever another buyer took in between.
    //
    // clearance_claim (migration 0034) does the whole thing in one transaction
    // with `stock_qty = stock_qty - 1` evaluated by Postgres, so racers
    // serialise and the loser simply loses. Nothing to compensate.
    const claim = await db.rpc('clearance_claim', {
      p_user_id: user.id,
      p_item_id: itemId,
      p_price: price,
      p_charge_balance: paymentMethod === 'balance',
      p_mode: 'direct_buyout',
      p_payment_method: paymentMethod,
      p_client_roll_id: clientRollId ?? null,
    });

    if (claim.error) {
      const code = claim.error.code;
      const status = code === 'PT402' ? 402 : code === 'PT409' ? 409 : code === 'PT404' ? 404 : 500;
      return NextResponse.json({ ok: false, error: claim.error.message }, { status });
    }

    const result = claim.data as {
      roll_id: string; balance: number; item_name: string; replayed?: boolean;
    };
    const rollData = { id: result.roll_id };
    const balanceCharged = paymentMethod === 'balance';
    const newBalance = Number(result.balance);

    // 7. Broadcast to realtime ticker
    try {
      const { data: prof } = await db.from('profiles').select('name').eq('id', user.id).single();
      await db.channel('house_ticker').send({
        type: 'broadcast',
        event: 'roll',
        payload: {
          id: rollData.id,
          player: prof?.name || user.name,
          item: item.name,
          kind: 'physical',
          tier: item.box_tier,
          rarity: item.rarity,
          shards: null,
          at: new Date().toISOString(),
        },
      });
    } catch {
      // Non-fatal if ticker fails
    }

    return NextResponse.json({
      ok: true,
      item: {
        id: item.id,
        name: item.name,
        rarity: item.rarity as Rarity,
        est_value: price,
        image_url: item.image_url,
      },
      rollId: rollData.id,
      paymentMethod,
      price,
      balance: balanceCharged ? newBalance : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Buyout request failed' }, { status: 500 });
  }
}
