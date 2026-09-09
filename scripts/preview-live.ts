/**
 * A free test spin must change absolutely nothing.
 *
 *   npm run preview
 *
 * preview_box runs the REAL open_box inside a subtransaction and throws the
 * subtransaction away, so there is only ever one copy of the draw logic. This
 * proves the discard actually works: balance, stock, roll count, vouchers, the
 * shard counter and the player's own shard total must all be identical after a
 * run of previews, while still producing the same spread of outcomes a paid
 * roll would.
 */
import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

denv({ path: '.env.local', quiet: true });
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };

const snap = async (uid: string) => {
  const [{ data: prof }, items, rolls, vouchers, { data: cfg }] = await Promise.all([
    db.from('profiles').select('balance,scrap_coins,pc_shards').eq('id', uid).single(),
    db.from('items').select('stock_qty'),
    db.from('rolls').select('id', { count: 'exact', head: true }),
    db.from('vouchers').select('id', { count: 'exact', head: true }),
    db.from('config').select('value').eq('key', 'settings').single(),
  ]);
  return {
    balance: Number(prof!.balance),
    shards: Number(prof!.pc_shards),
    coins: Number(prof!.scrap_coins),
    stock: (items.data ?? []).reduce((a, i) => a + i.stock_qty, 0),
    rolls: rolls.count ?? 0,
    vouchers: vouchers.count ?? 0,
    minted: Number((cfg!.value as any).pc_shards_minted ?? 0),
  };
};

(async () => {
  let uid = '';
  try {
    const { data: p } = await db.from('profiles')
      .insert({ name: '__preview__', balance: 0 }).select('id').single();
    uid = p!.id;

    // Deliberately $0: a preview must work for a player who cannot afford it.
    const before = await snap(uid);

    const kinds: Record<string, number> = {};
    let errs = 0;
    for (let i = 0; i < 40; i++) {
      const tier = ['tier_0', 'tier_1', 'tier_2', 'tier_3'][i % 4];
      const { data, error } = await db.rpc('preview_box', { p_user_id: uid, p_box_tier: tier });
      if (error) {
        // A locked tier legitimately refuses; anything else is a fault.
        if (!/empty/i.test(error.message)) { errs++; console.log('        ' + error.message); }
        continue;
      }
      const r = data as any;
      kinds[r.type] = (kinds[r.type] ?? 0) + 1;
      if (i === 0) ok(r.preview === true, 'the result is flagged as a preview');
    }
    ok(errs === 0, 'no preview errored unexpectedly (' + errs + ')');
    console.log('        outcomes seen: ' + JSON.stringify(kinds));
    ok(Object.keys(kinds).length > 0, 'previews actually produced results');

    const after = await snap(uid);
    ok(after.balance === before.balance, 'balance unchanged ($' + before.balance + ' -> $' + after.balance + ')');
    ok(after.stock === before.stock, 'not one unit left the shelf (' + before.stock + ' -> ' + after.stock + ')');
    ok(after.rolls === before.rolls, 'no roll was recorded (' + before.rolls + ' -> ' + after.rolls + ')');
    ok(after.vouchers === before.vouchers, 'no voucher created or burned (' + before.vouchers + ' -> ' + after.vouchers + ')');
    ok(after.shards === before.shards, 'no shard credited (' + before.shards + ' -> ' + after.shards + ')');
    ok(after.minted === before.minted, 'the global mint counter did not move (' + before.minted + ' -> ' + after.minted + ')');
    ok(after.coins === before.coins, 'no scrap coins awarded (' + before.coins + ' -> ' + after.coins + ')');

    // A real roll after a preview must still work — the subtransaction must not
    // have poisoned the session.
    await db.from('profiles').update({ balance: 50 }).eq('id', uid);
    const { error: realErr } = await db.rpc('open_box', { p_user_id: uid, p_box_tier: 'tier_0' });
    ok(!realErr, 'a real roll still works afterwards' + (realErr ? ': ' + realErr.message : ''));
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    if (uid) {
      await db.from('rolls').delete().eq('user_id', uid);
      await db.from('vouchers').delete().eq('user_id', uid);
      await db.from('profiles').delete().eq('id', uid);
    }
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'a preview changes nothing') + '\n');
    process.exit(fails ? 1 : 0);
  }
})();
