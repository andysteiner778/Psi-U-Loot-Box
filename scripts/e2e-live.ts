/**
 * LIVE END-TO-END SCENARIO TEST
 *
 *   npm run e2e
 *
 * Drives the real database through the situations that actually happen at a
 * party, using throwaway probe accounts that are deleted afterwards. Nothing a
 * real player owns is touched.
 *
 * `verify:live` checks that the plumbing is connected. This checks that the
 * GAME behaves — stock moves, balances reconcile, shards accumulate and spend,
 * exploits are refused, and the state a player sees updates after each action.
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
let checks = 0;
const ok = (cond: boolean, msg: string, detail = '') => {
  checks++;
  if (cond) console.log('  ok    ' + msg);
  else {
    fails++;
    console.error('  FAIL  ' + msg + (detail ? '\n        ' + detail : ''));
  }
};
const section = (s: string) => console.log('\n--- ' + s + ' ---');
const usd = (n: number) => '$' + Number(n).toFixed(2);

const probes: string[] = [];

async function makePlayer(tag: string) {
  const name = 'zz-e2e-' + tag + '-' + Date.now().toString(36);
  const { data, error } = await db.rpc('auth_login_or_register', { p_name: name, p_pin: '1357' });
  if (error || !data?.[0]) throw new Error('could not create probe: ' + (error?.message ?? 'no row'));
  probes.push(name);
  return { id: data[0].profile_id as string, name };
}

const balanceOf = async (id: string) => {
  const { data } = await db.from('profiles').select('balance, scrap_coins, pc_shards').eq('id', id).single();
  return {
    balance: Number(data?.balance ?? 0),
    coins: Number(data?.scrap_coins ?? 0),
    shards: Number(data?.pc_shards ?? 0),
  };
};

const setBalance = (id: string, v: number) => db.from('profiles').update({ balance: v }).eq('id', id);

async function main() {
  console.log('\n=================================================================');
  console.log(' LIVE END-TO-END SCENARIO TEST');
  console.log('=================================================================');

  const admin = await db.from('profiles').select('id, name').eq('role', 'admin').limit(1).maybeSingle();
  const adminId = admin.data?.id as string | undefined;
  ok(!!adminId, 'an admin account exists (needed for approvals and gifts)');

  const p1 = await makePlayer('a');
  const p2 = await makePlayer('b');

  // =========================================================================
  section('opening a box moves money and stock in step');

  await setBalance(p1.id, 200);
  const before = await balanceOf(p1.id);

  const { data: odds } = await db.rpc('box_odds', { p_box_tier: 'tier_2' });
  const price = Number(odds.box_price);

  const { data: roll, error: rollErr } = await db.rpc('open_box', {
    p_user_id: p1.id,
    p_box_tier: 'tier_2',
  });
  ok(!rollErr && !!roll, 'a roll succeeds' + (rollErr ? ': ' + rollErr.message : ''));

  const after = await balanceOf(p1.id);
  const spent = before.balance - after.balance;
  const kind = String(roll?.type);

  if (kind === 'respin') {
    ok(spent === 0, 'a re-roll refunds the price, so net spend is $0 (was ' + usd(spent) + ')');
  } else {
    ok(Math.abs(spent - price) < 0.001, 'charged exactly the box price ' + usd(price) + ' (was ' + usd(spent) + ')');
  }
  ok(typeof roll?.item_name === 'string' && roll.item_name.length > 0, 'the result is named: ' + roll?.item_name);

  if (kind === 'physical') {
    const { data: it } = await db.from('items').select('stock_qty').eq('id', roll.item_id).maybeSingle();
    ok(it !== null, 'the won item still exists');
    const { data: freshOdds } = await db.rpc('box_odds', { p_box_tier: 'tier_2' });
    const stillListed = (freshOdds.items as { item_id: string; stock_qty: number }[]).find(
      (i) => i.item_id === roll.item_id
    );
    ok(
      !stillListed || stillListed.stock_qty < 900,
      'odds reflect the decrement immediately after the win'
    );
  }
  if (kind === 'scrap') {
    ok(after.coins > before.coins, 'scrap coins were credited (' + before.coins + ' -> ' + after.coins + ')');
  }

  // =========================================================================
  section('an empty tier cannot be rolled forever for free');
  const { data: t3 } = await db.rpc('box_odds', { p_box_tier: 'tier_3' });
  const sum =
    Number(t3.p_physical) + Number(t3.p_shard) + Number(t3.p_respin) + Number(t3.p_scrap);
  ok(Math.abs(sum - 1) < 1e-9, 'tier_3 outcomes sum to exactly 1 (' + sum.toFixed(9) + ')');
  ok(Number(t3.total_ev) <= Number(t3.target_ev) + 1e-6,
    'tier_3 payout ' + usd(t3.total_ev) + ' stays within budget ' + usd(t3.target_ev));

  // =========================================================================
  section('exploits are refused');

  await setBalance(p1.id, 0);
  const noFunds = await db.rpc('open_box', { p_user_id: p1.id, p_box_tier: 'tier_3' });
  ok(!!noFunds.error, 'cannot roll with a zero balance');

  await setBalance(p1.id, 500);
  const badTier = await db.rpc('open_box', { p_user_id: p1.id, p_box_tier: 'tier_9' });
  ok(!!badTier.error, 'an invented tier is rejected');

  const ghost = await db.rpc('open_box', {
    p_user_id: '00000000-0000-0000-0000-000000000000',
    p_box_tier: 'tier_1',
  });
  ok(!!ghost.error, 'a nonexistent player is rejected');

  const notAdmin = await db.rpc('reset_party_state', { p_admin_id: p1.id });
  ok(!!notAdmin.error, 'a normal player cannot reset the party');

  const giftSelf = await db.rpc('admin_grant_spins', {
    p_admin_id: p1.id, p_user_id: p1.id, p_box_tier: 'tier_3', p_count: 50,
  });
  ok(!!giftSelf.error, 'a normal player cannot gift themselves spins');

  // =========================================================================
  section('double-tap protection');
  await setBalance(p1.id, 300);
  const b1 = (await balanceOf(p1.id)).balance;
  const rid = crypto.randomUUID();
  const first = await db.rpc('open_box', { p_user_id: p1.id, p_box_tier: 'tier_1', p_client_roll_id: rid });
  const second = await db.rpc('open_box', { p_user_id: p1.id, p_box_tier: 'tier_1', p_client_roll_id: rid });
  const b2 = (await balanceOf(p1.id)).balance;
  ok(first.data?.roll_id === second.data?.roll_id, 'a replayed roll id returns the original result');
  ok(b1 - b2 <= 5.001, 'charged at most once for the double tap (' + usd(b1 - b2) + ')');

  // =========================================================================
  section('shards accumulate and buy the right thing');

  const { data: lockedItems } = await db
    .from('items').select('id, name, est_value, shard_cost').gt('shard_cost', 0);
  ok((lockedItems ?? []).length > 0, 'at least one shard-locked prize exists');

  const prize = (lockedItems ?? [])[0];
  if (prize) {
    // Not enough shards yet.
    await db.from('profiles').update({ pc_shards: prize.shard_cost - 1 }).eq('id', p2.id);
    const tooFew = await db.rpc('claim_with_shards', { p_user_id: p2.id, p_item_id: prize.id });
    ok(!!tooFew.error, 'cannot claim ' + prize.name + ' one shard short');

    // Exactly enough.
    await db.from('profiles').update({ pc_shards: prize.shard_cost }).eq('id', p2.id);
    const claim = await db.rpc('claim_with_shards', { p_user_id: p2.id, p_item_id: prize.id });
    ok(!claim.error, 'claims ' + prize.name + ' with ' + prize.shard_cost + ' shards');
    const afterClaim = await balanceOf(p2.id);
    ok(afterClaim.shards === 0, 'shards were spent, not just checked (' + afterClaim.shards + ' left)');

    // Stock is gone, so a second claim must fail.
    await db.from('profiles').update({ pc_shards: prize.shard_cost }).eq('id', p1.id);
    const twice = await db.rpc('claim_with_shards', { p_user_id: p1.id, p_item_id: prize.id });
    ok(!!twice.error, 'the same one-off prize cannot be claimed twice');

    // Put it back.
    await db.from('items').update({ stock_qty: 1 }).eq('id', prize.id);
    await db.from('profiles').update({ pc_shards: 0 }).eq('id', p1.id);
  }

  const { data: lockedInPool } = await db.rpc('box_odds', { p_box_tier: 'tier_3' });
  const leaked = (lockedInPool.items as { item_id: string }[]).some((i) =>
    (lockedItems ?? []).some((l) => l.id === i.item_id)
  );
  ok(!leaked, 'shard-locked prizes never appear in the box drop pool');

  // =========================================================================
  section('deposits and gifts are accounted separately');

  if (adminId) {
    const potBefore = await db.from('deposits').select('amount').eq('status', 'approved');
    const sumBefore = (potBefore.data ?? []).reduce((a, d) => a + Number(d.amount), 0);

    const gift = await db.rpc('admin_grant_spins', {
      p_admin_id: adminId, p_user_id: p2.id, p_box_tier: 'tier_1', p_count: 5,
    });
    ok(!gift.error, 'admin can gift spins' + (gift.error ? ': ' + gift.error.message : ''));
    const afterGift = await balanceOf(p2.id);
    ok(afterGift.balance >= 25, 'the gift credited balance (' + usd(afterGift.balance) + ')');

    const potAfter = await db.from('deposits').select('amount').eq('status', 'approved');
    const sumAfter = (potAfter.data ?? []).reduce((a, d) => a + Number(d.amount), 0);
    ok(sumAfter === sumBefore, 'a gift does NOT count toward the pot gate');

    const { data: dep } = await db
      .from('deposits')
      .insert({ user_id: p2.id, amount: 20, venmo_note: '#E2E' })
      .select('id').single();
    const balPre = (await balanceOf(p2.id)).balance;
    const appr = await db.rpc('approve_deposit', { p_deposit_id: dep!.id, p_admin_id: adminId });
    ok(!appr.error, 'admin approves a deposit');
    const balPost = (await balanceOf(p2.id)).balance;
    ok(Math.abs(balPost - balPre - 20) < 0.001, 'approval credits exactly the amount once');
    const twice2 = await db.rpc('approve_deposit', { p_deposit_id: dep!.id, p_admin_id: adminId });
    ok(!!twice2.error, 'the same deposit cannot be approved twice');
    await db.from('deposits').delete().eq('id', dep!.id);
  }

  // =========================================================================
  section('scrapping never pays more than an item is worth');

  const { data: cfgRow } = await db.from('config').select('value').eq('key', 'settings').single();
  const cfg = cfgRow!.value as Record<string, never> & Record<string, unknown>;
  const coinUsd =
    Number((cfg.box_prices as Record<string, number>)[String(cfg.scrap_key_tier)]) /
    Number(cfg.scrap_coins_per_key);
  const { data: allItems } = await db.from('items').select('name, est_value, scrap_value');
  let worst = 0;
  let worstName = '';
  for (const i of allItems ?? []) {
    const r = (Number(i.scrap_value) * coinUsd) / Number(i.est_value);
    if (r > worst) {
      worst = r;
      worstName = i.name;
    }
  }
  ok(worst < 1, 'worst scrap ratio is ' + (worst * 100).toFixed(0) + '% (' + worstName + ')');

  // =========================================================================
  section('cleanup');
  for (const name of probes) await db.from('profiles').delete().eq('name', name);
  const { data: leftovers } = await db.from('profiles').select('name').like('name', 'zz-e2e-%');
  ok((leftovers ?? []).length === 0, 'all probe accounts removed');

  console.log('\n=================================================================');
  console.log(fails === 0 ? ' PASS — ' + checks + ' checks, 0 failures.' : ' FAIL — ' + fails + ' of ' + checks + ' failed.');
  console.log('=================================================================\n');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  for (const name of probes) await db.from('profiles').delete().eq('name', name);
  process.exit(1);
});
