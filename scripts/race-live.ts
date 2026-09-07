import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
denv({ path: '.env.local', quiet: true });

/**
 * The real thing: 15 phones tapping SPIN at the same instant, through
 * PostgREST, which is the path the app actually uses. (A direct-connection
 * version of this hits the session pooler's 15-client ceiling; PostgREST
 * multiplexes, so it does not.)
 */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const PLAYERS = 15;
/*
 * Fixed probe names collide with leftovers if a previous run died before its
 * cleanup, and the insert then fails on the unique index -- a gate that fails
 * because of its own debris teaches nothing. Same reason e2e's makePlayer
 * salts its names.
 */
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };

(async () => {
  const ids: string[] = [];
  let itemId = '';
  /*
   * These rolls hit the REAL catalogue and there is no transaction to roll
   * back -- PostgREST is one statement per request. Deleting the roll rows
   * afterwards is not enough: every physical win already decremented
   * items.stock_qty, and with the roll gone nothing accounts for the missing
   * unit. Left alone, each run of this gate permanently shrinks the shelf.
   * Snapshot stock up front and put it back in the finally block.
   */
  const stockBefore = new Map<string, number>();
  try {
    const { data: snap } = await db.from('items').select('id,stock_qty');
    for (const i of snap ?? []) stockBefore.set(i.id, i.stock_qty);
    const { data: it } = await db.from('items').insert({
      name: '__race_prize_' + RUN + '__', box_tier: 'tier_3', rarity: 'blue', est_value: 25, msrp: 25,
      stock_qty: 1, initial_stock_qty: 1, scrap_value: 10, is_active: true,
    }).select('id').single();
    itemId = it!.id;

    for (let i = 0; i < PLAYERS; i++) {
      const { data: p } = await db.from('profiles')
        .insert({ name: '__race_' + RUN + '_' + i + '__', balance: 500 }).select('id').single();
      ids.push(p!.id);
      await db.from('drop_overrides').insert({ user_id: p!.id, item_id: itemId });
    }

    console.log('\nTEST 1 — 15 players, ONE unit, all forced onto it, fired together');
    const res = await Promise.all(
      ids.map((id) => db.rpc('open_box', { p_user_id: id, p_box_tier: 'tier_3' }))
    );
    let won = 0, errs = 0;
    for (const r of res) {
      if (r.error) { errs++; continue; }
      if ((r.data as any)?.type === 'physical' && (r.data as any)?.item_id === itemId) won++;
    }
    ok(won === 1, 'exactly ONE player won the single unit (' + won + ')');
    ok(errs === 0, 'no roll errored under 15-way contention (' + errs + ')');

    const { data: st } = await db.from('items').select('stock_qty').eq('id', itemId).single();
    ok(st!.stock_qty === 0, 'stock is exactly 0, never negative (' + st!.stock_qty + ')');
    const { count } = await db.from('rolls').select('id', { count: 'exact', head: true })
      .eq('item_id', itemId).eq('kind', 'physical');
    ok(count === 1, 'exactly one inventory row for it (' + count + ')');

    // ---- TEST 2: one voucher, two devices ---------------------------------
    console.log('\nTEST 2 — same player, one 100%-off voucher, two devices at once');
    const u = ids[0];
    await db.from('vouchers').delete().eq('user_id', u);
    await db.from('profiles').update({ balance: 500 }).eq('id', u);
    await db.from('vouchers').insert({ user_id: u, box_tier: 'tier_2', discount_pct: 1 });
    await Promise.all([
      db.rpc('open_box', { p_user_id: u, p_box_tier: 'tier_2' }),
      db.rpc('open_box', { p_user_id: u, p_box_tier: 'tier_2' }),
    ]);
    const { count: used } = await db.from('vouchers').select('id', { count: 'exact', head: true })
      .eq('user_id', u).not('redeemed_at', 'is', null);
    ok(used === 1, 'the voucher was redeemed exactly ONCE, not twice (' + used + ')');

    // ---- TEST 3: overspend race -------------------------------------------
    console.log('\nTEST 3 — player with $30, ten simultaneous $10 rolls');
    const v = ids[1];
    await db.from('vouchers').delete().eq('user_id', v);
    await db.from('profiles').update({ balance: 30 }).eq('id', v);
    const spins = await Promise.all(
      Array.from({ length: 10 }, () => db.rpc('open_box', { p_user_id: v, p_box_tier: 'tier_2' }))
    );
    const okSpins = spins.filter((s) => !s.error).length;
    const refused = spins.filter((s) => s.error).length;
    const { data: bal } = await db.from('profiles').select('balance').eq('id', v).single();
    ok(Number(bal!.balance) >= 0, 'balance never went negative (ended $' + bal!.balance + ')');
    console.log('        ' + okSpins + ' rolls went through, ' + refused + ' refused for funds');

    // ---- TEST 4: voucher stacking ------------------------------------------
    console.log('\nTEST 4 — can vouchers pile up without bound?');
    const w = ids[2];
    await db.from('vouchers').delete().eq('user_id', w);
    const mine: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { data: vv } = await db.from('vouchers')
        .insert({ user_id: w, box_tier: 'tier_2', discount_pct: 0.5 }).select('id').single();
      mine.push(vv!.id);
    }
    await db.from('profiles').update({ balance: 500 }).eq('id', w);
    const { data: o } = await db.rpc('box_odds', { p_box_tier: 'tier_2', p_user_id: w });
    const listed = Number((o as any).box_price);
    const before = 500;
    await db.rpc('open_box', { p_user_id: w, p_box_tier: 'tier_2' });
    const { data: b2 } = await db.from('profiles').select('balance').eq('id', w).single();
    // count only the five WE created -- the roll may also award a new voucher,
    // which would otherwise look like one of ours failing to burn
    const { count: burned } = await db.from('vouchers').select('id', { count: 'exact', head: true })
      .in('id', mine).not('redeemed_at', 'is', null);
    ok(burned === 1, 'five 50%-off vouchers burn exactly ONE per roll (' + burned + ' burned)');
    const { count: total } = await db.from('vouchers').select('id', { count: 'exact', head: true })
      .eq('user_id', w).is('redeemed_at', null);
    console.log('        unredeemed vouchers now held: ' + total + ' (4 of ours + any the roll awarded)');
    console.log('        listed price $' + listed + ', balance ' + before + ' -> ' + b2!.balance +
                ' (charged/refunded in one roll)');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    for (const id of ids) {
      await db.from('rolls').delete().eq('user_id', id);
      await db.from('vouchers').delete().eq('user_id', id);
      await db.from('drop_overrides').delete().eq('user_id', id);
      await db.from('profiles').delete().eq('id', id);
    }
    if (itemId) {
      await db.from('rolls').delete().eq('item_id', itemId);
      await db.from('items').delete().eq('id', itemId);
    }
    // Put every unit this gate consumed back on the shelf.
    let restored = 0;
    const { data: now } = await db.from('items').select('id,stock_qty');
    for (const i of now ?? []) {
      const was = stockBefore.get(i.id);
      if (was !== undefined && was !== i.stock_qty) {
        await db.from('items').update({ stock_qty: was }).eq('id', i.id);
        restored += was - i.stock_qty;
      }
    }
    if (restored) console.log('  (returned ' + restored + ' unit(s) to stock)');
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'all concurrency checks pass'));
    process.exit(fails ? 1 : 0);
  }
})();
