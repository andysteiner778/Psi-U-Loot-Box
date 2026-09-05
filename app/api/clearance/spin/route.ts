import { NextResponse } from 'next/server';
import crypto from 'crypto';
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
 * POST /api/clearance/spin
 * Body: { itemIds: [string, string, string], paymentMethod: 'balance' | 'venmo_reserve', clientRollId: string }
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const { itemIds, paymentMethod, clientRollId } = body;

    if (!Array.isArray(itemIds) || itemIds.length !== 3 || !itemIds.every(isUuid)) {
      return NextResponse.json({ ok: false, error: 'Must select exactly 3 valid items for a custom box' }, { status: 400 });
    }

    if (new Set(itemIds).size !== 3) {
      return NextResponse.json({ ok: false, error: 'All 3 chosen items must be distinct' }, { status: 400 });
    }

    if (!isUuid(clientRollId)) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid client roll ID' }, { status: 400 });
    }

    if (paymentMethod !== 'balance' && paymentMethod !== 'venmo_reserve') {
      return NextResponse.json({ ok: false, error: 'Invalid payment method' }, { status: 400 });
    }

    // 1. Idempotency: replay if already processed
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
        winner: {
          name: existingRoll.item_name,
          rarity: existingRoll.item_rarity as Rarity,
          est_value: Number(existingRoll.box_price),
        },
        rollId: existingRoll.id,
        price: Number(existingRoll.box_price),
        paymentMethod: payload?.payment_method ?? paymentMethod,
        winningIndex: payload?.winning_index ?? 0,
        bundleItems: payload?.bundle_items ?? [],
      });
    }

    // 2. Clearance config check
    const clearanceConfig = await readClearanceConfig();
    if (!clearanceConfig.enabled) {
      return NextResponse.json({ ok: false, error: 'Clearance Mode is not currently active' }, { status: 403 });
    }
    if (paymentMethod === 'venmo_reserve' && !clearanceConfig.allow_venmo_reserve) {
      return NextResponse.json({ ok: false, error: 'Venmo reservations are currently disabled' }, { status: 400 });
    }

    // 3. Inspect all 3 items
    const { data: items, error: itemsErr } = await db
      .from('items')
      .select('id, name, rarity, est_value, stock_qty, box_tier, image_url, is_active, reward_credit, reward_voucher_tier')
      .in('id', itemIds);

    if (itemsErr || !items || items.length !== 3) {
      return NextResponse.json({ ok: false, error: 'One or more selected items were not found' }, { status: 404 });
    }

    for (const item of items) {
      if (!item.is_active || item.reward_credit !== null || item.reward_voucher_tier !== null) {
        return NextResponse.json(
          { ok: false, error: `Item "${item.name}" is not eligible for clearance spins` },
          { status: 400 }
        );
      }
      if (Number(item.stock_qty) <= 0) {
        return NextResponse.json(
          { ok: false, error: `Item "${item.name}" is currently out of stock` },
          { status: 409 }
        );
      }
    }

    // Preserve order as sent by caller
    const orderedItems = itemIds.map((id) => items.find((i) => i.id === id)!);

    // 4. Calculate spin price
    // Average of 3 items * clearance discount rate (e.g. 75%)
    const sumEst = orderedItems.reduce((acc, item) => acc + Number(item.est_value), 0);
    const avgEst = sumEst / 3;
    const spinPrice = Math.max(0.5, Math.round(avgEst * clearanceConfig.spin_discount_rate * 100) / 100);

    // 6. Draw the winner first — the RNG must not depend on who paid.
    const randomBuffer = crypto.randomBytes(4);
    const randomInt = randomBuffer.readUInt32BE(0);
    const winningIndex = randomInt % 3;
    const winner = orderedItems[winningIndex];

    // 7. Charge, decrement and record — in ONE database transaction.
    //
    // Was: read balance / write balance-price, then read stock / write stock-1
    // guarded by stock_qty>0, then insert the roll, with a hand-rolled revert
    // on failure that wrote back the STALE stock value.
    //
    // The stock step was a READ-MODIFY-WRITE. The >0 guard only covers stock
    // exactly 1 -- the only case that got tested. At stock >= 2 both racers
    // read 2, both write 1, both pass, and two units leave against one
    // decrement. Proven live before this change: 2 claims on 2 units left stock
    // at 1, accounting for 3 units out of 2.
    //
    // clearance_claim (migration 0034) is one transaction and lets Postgres
    // evaluate `stock_qty = stock_qty - 1`, so racers serialise.
    const claim = await db.rpc('clearance_claim', {
      p_user_id: user.id,
      p_item_id: winner.id,
      p_price: spinPrice,
      p_charge_balance: paymentMethod === 'balance',
      p_mode: 'custom_spin',
      p_payment_method: paymentMethod,
      p_client_roll_id: clientRollId ?? null,
    });

    if (claim.error) {
      const code = claim.error.code;
      const status = code === 'PT402' ? 402 : code === 'PT409' ? 409 : code === 'PT404' ? 404 : 500;
      const msg = code === 'PT409'
        ? `"${winner.name}" just went out of stock during the spin. Nothing was charged.`
        : claim.error.message;
      return NextResponse.json({ ok: false, error: msg }, { status });
    }

    const claimed = claim.data as { roll_id: string; balance: number };
    // clearance_claim writes a generic clearance payload; the spin-specific
    // detail (which three items were offered, which slot won) is merged in
    // here. Losing it would make a disputed spin impossible to audit.
    await db.from('rolls').update({
      payload: {
        clearance: true,
        mode: 'custom_spin',
        payment_method: paymentMethod,
        price: spinPrice,
        bundle_items: orderedItems.map((i) => ({
          id: i.id, name: i.name, est_value: Number(i.est_value), rarity: i.rarity,
        })),
        winning_index: winningIndex,
        discount_rate: clearanceConfig.spin_discount_rate,
        reserved: paymentMethod === 'venmo_reserve',
      },
    }).eq('id', claimed.roll_id);

    const rollData = { id: claimed.roll_id };
    const balanceCharged = paymentMethod === 'balance';
    const newBalance = Number(claimed.balance);

    // 9. Realtime broadcast
    try {
      const { data: prof } = await db.from('profiles').select('name').eq('id', user.id).single();
      await db.channel('house_ticker').send({
        type: 'broadcast',
        event: 'roll',
        payload: {
          id: rollData.id,
          player: prof?.name || user.name,
          item: winner.name,
          kind: 'physical',
          tier: winner.box_tier,
          rarity: winner.rarity,
          shards: null,
          at: new Date().toISOString(),
        },
      });
    } catch {
      // Non-fatal if ticker broadcast fails
    }

    return NextResponse.json({
      ok: true,
      winner: {
        id: winner.id,
        name: winner.name,
        rarity: winner.rarity as Rarity,
        est_value: Number(winner.est_value),
        image_url: winner.image_url,
      },
      winningIndex,
      bundleItems: orderedItems.map((i) => ({
        id: i.id,
        name: i.name,
        est_value: Number(i.est_value),
        rarity: i.rarity as Rarity,
        image_url: i.image_url,
      })),
      rollId: rollData.id,
      price: spinPrice,
      paymentMethod,
      balance: balanceCharged ? newBalance : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Spin request failed' }, { status: 500 });
  }
}
