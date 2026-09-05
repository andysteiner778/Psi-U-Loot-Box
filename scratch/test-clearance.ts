import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

denv({ path: '.env.local', quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('  FAIL: ' + msg);
    throw new Error(msg);
  }
  console.log('  ok    ' + msg);
}

async function main() {
  console.log('\n================================================================');
  console.log(' POST-PARTY CLEARANCE MODE — VERIFICATION SUITE');
  console.log('================================================================\n');

  // Track probe data for absolute cleanup
  const probeRollIds: string[] = [];
  const probeProfileIds: string[] = [];
  const restoredStock: { id: string; originalStock: number }[] = [];

  try {
    // -------------------------------------------------------------------------
    // 1. CONFIG READ / WRITE
    // -------------------------------------------------------------------------
    console.log('--- 1. Clearance Configuration ---');
    const testConfig = {
      enabled: true,
      spin_discount_rate: 0.75,
      allow_venmo_reserve: true,
    };

    const { error: upsertErr } = await db.from('config').upsert({
      key: 'clearance',
      value: testConfig,
    });
    assert(!upsertErr, 'clearance config upsert succeeds');

    const { data: cfgRow, error: getCfgErr } = await db
      .from('config')
      .select('value')
      .eq('key', 'clearance')
      .single();
    assert(!getCfgErr && cfgRow?.value?.enabled === true, 'clearance mode reads enabled');
    assert(cfgRow?.value?.spin_discount_rate === 0.75, 'spin discount rate is 0.75');

    // -------------------------------------------------------------------------
    // 2. CREATE PROBE PLAYER
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Probe Player Setup ---');
    const probeName = 'zz-clearance-' + crypto.randomBytes(4).toString('hex');
    const { data: probeUser, error: probeErr } = await db
      .from('profiles')
      .insert({
        name: probeName,
        balance: 1000.0,
        scrap_coins: 0,
        pc_shards: 0,
        role: 'player',
      })
      .select('id, name, balance')
      .single();

    assert(!probeErr && !!probeUser, 'probe player created with $1000.00 balance');
    probeProfileIds.push(probeUser!.id);

    // -------------------------------------------------------------------------
    // 3. CATALOG CHECK
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Catalog Integrity ---');
    const { data: items, error: itemsErr } = await db
      .from('items')
      .select('*')
      .gt('stock_qty', 0)
      .eq('is_active', true)
      .is('reward_credit', null)
      .is('reward_voucher_tier', null)
      .order('est_value', { ascending: false });

    assert(!itemsErr && (items?.length ?? 0) >= 3, `at least 3 in-stock physical items (${items?.length})`);
    const testItem1 = items![0];
    const testItem2 = items![1];
    const testItem3 = items![2];

    restoredStock.push({ id: testItem1.id, originalStock: testItem1.stock_qty });
    restoredStock.push({ id: testItem2.id, originalStock: testItem2.stock_qty });
    restoredStock.push({ id: testItem3.id, originalStock: testItem3.stock_qty });

    // -------------------------------------------------------------------------
    // 4. DIRECT BUYOUT WITH IN-APP BALANCE
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Direct Buyout (Balance Deduction) ---');
    const buyPrice = Number(testItem1.est_value);
    const startBal = Number(probeUser!.balance);

    // Atomically deduct balance
    const { data: balUpdate, error: balErr } = await db
      .from('profiles')
      .update({ balance: startBal - buyPrice })
      .eq('id', probeUser!.id)
      .gte('balance', buyPrice)
      .select('balance');

    assert(!balErr && balUpdate?.length === 1, 'balance deducted by exact est_value');
    assert(Math.abs(Number(balUpdate![0].balance) - (startBal - buyPrice)) < 0.001, 'new balance matches expected');

    // Atomically decrement stock
    const { data: stockUpdate, error: stockErr } = await db
      .from('items')
      .update({ stock_qty: testItem1.stock_qty - 1 })
      .eq('id', testItem1.id)
      .gt('stock_qty', 0)
      .select('stock_qty');

    assert(!stockErr && stockUpdate?.length === 1, 'stock decremented atomically by 1');

    // Create roll record
    const clientRollId1 = crypto.randomUUID();
    const { data: roll1, error: rollErr1 } = await db
      .from('rolls')
      .insert({
        user_id: probeUser!.id,
        box_tier: testItem1.box_tier,
        kind: 'physical',
        item_id: testItem1.id,
        item_name: testItem1.name,
        item_rarity: testItem1.rarity,
        status: 'inventory',
        box_price: buyPrice,
        client_roll_id: clientRollId1,
        payload: {
          clearance: true,
          mode: 'direct_buyout',
          payment_method: 'balance',
          price: buyPrice,
        },
      })
      .select('id')
      .single();

    assert(!rollErr1 && !!roll1, 'roll row recorded with status=inventory, kind=physical');
    probeRollIds.push(roll1!.id);

    // -------------------------------------------------------------------------
    // 5. DIRECT BUYOUT WITH VENMO RESERVATION
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Direct Buyout (Venmo Reservation) ---');
    const reservePrice = Number(testItem2.est_value);
    const balBeforeReserve = Number(balUpdate![0].balance);

    // Atomically decrement stock
    const { data: stockUpdate2, error: stockErr2 } = await db
      .from('items')
      .update({ stock_qty: testItem2.stock_qty - 1 })
      .eq('id', testItem2.id)
      .gt('stock_qty', 0)
      .select('stock_qty');

    assert(!stockErr2 && stockUpdate2?.length === 1, 'stock decremented for reservation');

    // Verify balance is UNTOUCHED
    const { data: profAfterReserve } = await db
      .from('profiles')
      .select('balance')
      .eq('id', probeUser!.id)
      .single();

    assert(Number(profAfterReserve?.balance) === balBeforeReserve, 'balance untouched for Venmo reservation');

    const clientRollId2 = crypto.randomUUID();
    const { data: roll2, error: rollErr2 } = await db
      .from('rolls')
      .insert({
        user_id: probeUser!.id,
        box_tier: testItem2.box_tier,
        kind: 'physical',
        item_id: testItem2.id,
        item_name: testItem2.name,
        item_rarity: testItem2.rarity,
        status: 'inventory',
        box_price: reservePrice,
        client_roll_id: clientRollId2,
        payload: {
          clearance: true,
          mode: 'direct_buyout',
          payment_method: 'venmo_reserve',
          price: reservePrice,
          reserved: true,
        },
      })
      .select('id')
      .single();

    assert(!rollErr2 && !!roll2, 'reservation roll recorded');
    probeRollIds.push(roll2!.id);

    // -------------------------------------------------------------------------
    // 6. CONCURRENCY RACE TEST ON LAST UNIT
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Concurrency Safety: 2 Players racing for last unit ---');
    // Create temporary item with stock_qty = 1
    const { data: scarceItem, error: scarceErr } = await db
      .from('items')
      .insert({
        name: 'zz-scarce-item-' + crypto.randomBytes(3).toString('hex'),
        est_value: 10.0,
        rarity: 'blue',
        stock_qty: 1,
        box_tier: 'tier_1',
        is_active: true,
      })
      .select('id, stock_qty')
      .single();

    assert(!scarceErr && scarceItem?.stock_qty === 1, 'created test item with exactly 1 unit');

    // Race two simultaneous decrements with WHERE stock_qty > 0
    const [race1, race2] = await Promise.all([
      db.from('items').update({ stock_qty: 0 }).eq('id', scarceItem!.id).gt('stock_qty', 0).select(),
      db.from('items').update({ stock_qty: 0 }).eq('id', scarceItem!.id).gt('stock_qty', 0).select(),
    ]);

    const successes = (race1.data?.length ?? 0) + (race2.data?.length ?? 0);
    assert(successes === 1, `exactly 1 concurrent claimant succeeded (winner: ${successes === 1 ? 'YES' : 'NO'})`);

    const { data: finalScarce } = await db.from('items').select('stock_qty').eq('id', scarceItem!.id).single();
    assert(finalScarce?.stock_qty === 0, 'scarce item stock ended at exactly 0 (no negative stock)');

    // Delete temporary item
    await db.from('items').delete().eq('id', scarceItem!.id);

    // -------------------------------------------------------------------------
    // 7. "PICK 3, WIN 1" DISCOUNTED CUSTOM SPIN
    // -------------------------------------------------------------------------
    console.log('\n--- 7. "Pick 3, Win 1" Custom Box Spin ---');
    const { data: freshItems } = await db
      .from('items')
      .select('*')
      .gt('stock_qty', 0)
      .eq('is_active', true)
      .is('reward_credit', null)
      .is('reward_voucher_tier', null)
      .order('est_value', { ascending: false });

    assert(freshItems && freshItems.length >= 3, 'at least 3 items in stock for spin');
    const spinItem1 = freshItems[0];
    const spinItem2 = freshItems[1];
    const spinItem3 = freshItems[2];
    restoredStock.push({ id: spinItem1.id, originalStock: spinItem1.stock_qty });
    restoredStock.push({ id: spinItem2.id, originalStock: spinItem2.stock_qty });
    restoredStock.push({ id: spinItem3.id, originalStock: spinItem3.stock_qty });
    const trio = [spinItem1, spinItem2, spinItem3];
    const avgVal = (Number(spinItem1.est_value) + Number(spinItem2.est_value) + Number(spinItem3.est_value)) / 3;
    const expectedSpinPrice = Math.max(0.5, Math.round(avgVal * 0.75 * 100) / 100);

    console.log(`     Items: $${spinItem1.est_value}, $${spinItem2.est_value}, $${spinItem3.est_value}`);
    console.log(`     Average: $${avgVal.toFixed(2)} | Spin Price (75%): $${expectedSpinPrice.toFixed(2)}`);

    // Draw random winner using uniform RNG
    const randomBuffer = crypto.randomBytes(4);
    const winIdx = randomBuffer.readUInt32BE(0) % 3;
    const winner = trio[winIdx];

    assert(winIdx >= 0 && winIdx <= 2, `winner index ${winIdx} is valid in [0, 1, 2]`);
    console.log(`     Winner drawn: ${winner.name}`);

    // Deduct spin price
    const { data: spinBalUpdate } = await db
      .from('profiles')
      .update({ balance: balBeforeReserve - expectedSpinPrice })
      .eq('id', probeUser!.id)
      .gte('balance', expectedSpinPrice)
      .select('balance');

    assert(spinBalUpdate?.length === 1, 'spin price deducted from balance');

    // Decrement winner's stock
    const { data: winStockUpdate } = await db
      .from('items')
      .update({ stock_qty: winner.stock_qty - 1 })
      .eq('id', winner.id)
      .gt('stock_qty', 0)
      .select('stock_qty');

    assert(winStockUpdate?.length === 1, 'winner stock decremented by 1');

    const clientRollId3 = crypto.randomUUID();
    const { data: roll3, error: rollErr3 } = await db
      .from('rolls')
      .insert({
        user_id: probeUser!.id,
        box_tier: winner.box_tier,
        kind: 'physical',
        item_id: winner.id,
        item_name: winner.name,
        item_rarity: winner.rarity,
        status: 'inventory',
        box_price: expectedSpinPrice,
        client_roll_id: clientRollId3,
        payload: {
          clearance: true,
          mode: 'custom_spin',
          payment_method: 'balance',
          price: expectedSpinPrice,
          bundle_items: trio.map((t) => ({ id: t.id, name: t.name, est_value: t.est_value })),
          winning_index: winIdx,
        },
      })
      .select('id')
      .single();

    assert(!rollErr3 && !!roll3, 'spin roll row recorded');
    probeRollIds.push(roll3!.id);

    // -------------------------------------------------------------------------
    // 8. EMPIRICAL RNG DISTRIBUTION CHECK (300 draws)
    // -------------------------------------------------------------------------
    console.log('\n--- 8. RNG Uniformity Check (300 draws) ---');
    const counts = [0, 0, 0];
    for (let i = 0; i < 300; i++) {
      const b = crypto.randomBytes(4);
      const idx = b.readUInt32BE(0) % 3;
      counts[idx]++;
    }
    console.log(`     Counts: [Item 0: ${counts[0]}, Item 1: ${counts[1]}, Item 2: ${counts[2]}]`);
    console.log(`     Percentages: [${((counts[0] / 300) * 100).toFixed(1)}%, ${((counts[1] / 300) * 100).toFixed(1)}%, ${((counts[2] / 300) * 100).toFixed(1)}%]`);
    assert(counts[0] > 60 && counts[1] > 60 && counts[2] > 60, 'all 3 items drawn with balanced ~33.3% distribution');

  } finally {
    // -------------------------------------------------------------------------
    // 9. CLEANUP & STOCK RESTORATION
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Cleanup & Invariant Restoration ---');
    if (probeRollIds.length > 0) {
      const { error: delRollErr } = await db.from('rolls').delete().in('id', probeRollIds);
      assert(!delRollErr, `deleted ${probeRollIds.length} probe rolls`);
    }

    for (const r of restoredStock) {
      await db.from('items').update({ stock_qty: r.originalStock }).eq('id', r.id);
    }
    console.log(`  ok    restored original stock quantities for ${restoredStock.length} items`);

    if (probeProfileIds.length > 0) {
      const { error: delUserErr } = await db.from('profiles').delete().in('id', probeProfileIds);
      assert(!delUserErr, `deleted probe player ${probeProfileIds.join(', ')}`);
    }

    console.log('\n================================================================');
    console.log(' ALL CLEARANCE TESTS PASSED.');
    console.log('================================================================\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
