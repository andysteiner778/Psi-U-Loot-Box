/**
 * LIVE SUPABASE VERIFICATION
 *
 *   npm run verify:live
 *
 * Everything else in this repo is proved offline. This is the only script that
 * touches the real hosted project, because four things simply cannot be known
 * without it:
 *
 *   1. Does the anon key actually get refused? (grants asserted, never watched)
 *   2. Does Realtime actually DELIVER? (the PGlite shim proves the trigger
 *      fires and composes the payload, not that a socket carries it)
 *   3. Did migration 0005 create the storage bucket? (it no-ops on PGlite, so
 *      it is the one migration that has never executed anywhere)
 *   4. Does the session pooler hold up under real latency?
 *
 * Read-mostly. It opens one real box and reverses the charge afterwards.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local', quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!URL || !ANON || !SERVICE) {
  console.error('Missing Supabase env vars in .env.local');
  process.exit(1);
}

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string, detail = '') {
  checks++;
  if (cond) console.log('  ok    ' + msg);
  else {
    failures++;
    console.error('  FAIL  ' + msg + (detail ? '\n        ' + detail : ''));
  }
}

async function main() {
  console.log('\n=================================================================');
  console.log(' LIVE SUPABASE VERIFICATION');
  console.log('=================================================================');
  console.log(' project: ' + URL + '\n');

  // -------------------------------------------------------------------------
  console.log('--- 1. anon key is powerless ---');

  for (const table of ['profiles', 'items', 'rolls', 'deposits', 'config']) {
    const { data, error } = await anon.from(table).select('*').limit(1);
    ok(
      !!error || !data || data.length === 0,
      'anon cannot read ' + table + (error ? ' (' + error.code + ')' : ' (0 rows)')
    );
  }

  {
    const { error } = await anon.rpc('open_box', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_box_tier: 'tier_3',
    });
    ok(!!error, 'anon cannot EXECUTE open_box', error ? '' : 'IT RAN. This is a total compromise.');
  }
  {
    const { error } = await anon.rpc('box_odds', { p_box_tier: 'tier_1' });
    ok(!!error, 'anon cannot EXECUTE box_odds');
  }
  {
    // The PIN table lives in app_private, which PostgREST should not expose at all.
    const { error } = await anon.schema('app_private').from('profile_secrets').select('*').limit(1);
    ok(!!error, 'app_private is not reachable over PostgREST');
  }

  // -------------------------------------------------------------------------
  console.log('\n--- 2. service role works ---');

  const { data: odds, error: oddsErr } = await svc.rpc('box_odds', { p_box_tier: 'tier_3' });
  ok(!oddsErr && !!odds, 'box_odds returns' + (oddsErr ? ': ' + oddsErr.message : ''));
  if (odds) {
    const o = odds as Record<string, number | boolean>;
    const sum = Number(o.p_physical) + Number(o.p_shard) + Number(o.p_respin) + Number(o.p_scrap);
    ok(Math.abs(sum - 1) < 1e-9, 'probabilities sum to 1 on the live database');
    ok(
      Number(o.total_ev) <= Number(o.target_ev) + 1e-6,
      'live payout $' + Number(o.total_ev).toFixed(2) + ' within budget $' + Number(o.target_ev).toFixed(2)
    );
    // Assert the RELATIONSHIP, not a fixed state: this runs against a live
    // database whose pot grows as real deposits are approved, so "no deposits
    // yet" stops being true the moment the party starts.
    const gateMet = o.pot_gate_met === true;
    ok(
      gateMet ? Number(o.p_shard) > 0 : Number(o.p_shard) === 0,
      'shard odds track the pot gate (pot $' + Number(o.pot_total).toFixed(2) +
        ', gate ' + (gateMet ? 'OPEN' : 'shut') + ', P(shard) ' +
        (Number(o.p_shard) * 100).toFixed(1) + '%)'
    );
    ok(
      Number(o.shards_minted) <= Number(o.shard_capacity),
      'shards minted ' + o.shards_minted + ' is within the mint cap ' + o.shard_capacity
    );
  }

  const { data: roster } = await svc.rpc('player_roster');
  // Not a fixed count: players self-register now and the seeded placeholders are
  // gone. What matters is that the call works.
  ok(
    Array.isArray(roster) && roster.length >= 1,
    'player_roster returns ' + (Array.isArray(roster) ? roster.length : 0) + ' name(s)'
  );

  // -------------------------------------------------------------------------
  console.log('\n--- 3. auth round trip ---');

  // Self-registration means there is no seeded account to test against, so make
  // one, exercise the whole path, then remove it. Using a real player would risk
  // locking them out via the deliberate wrong-PIN attempt below.
  const probeName = 'zz-verify-' + Date.now().toString(36);

  const { data: created, error: cErr } = await svc.rpc('auth_login_or_register', {
    p_name: probeName, p_pin: '4021',
  });
  ok(!cErr && Array.isArray(created) && created.length === 1, 'a new name self-registers');
  ok(Array.isArray(created) && created[0]?.created === true, 'it reports as newly created');

  const { data: again } = await svc.rpc('auth_login_or_register', {
    p_name: probeName, p_pin: '4021',
  });
  ok(Array.isArray(again) && again.length === 1 && again[0]?.created === false,
    'same name + PIN signs in rather than making a second account');

  const { data: wrong } = await svc.rpc('auth_login_or_register', {
    p_name: probeName, p_pin: '9999',
  });
  ok(Array.isArray(wrong) && wrong.length === 0, 'wrong PIN returns no rows');

  const { data: cased } = await svc.rpc('auth_login_or_register', {
    p_name: probeName.toUpperCase(), p_pin: '4021',
  });
  ok(Array.isArray(cased) && cased.length === 1 && cased[0]?.created === false,
    'names match case-insensitively, so no duplicate account');

  // -------------------------------------------------------------------------
  console.log('\n--- 4. storage bucket (migration 0005) ---');

  const { data: buckets, error: bErr } = await svc.storage.listBuckets();
  const bucket = buckets?.find((b) => b.name === 'item-images');
  ok(!bErr && !!bucket, 'the item-images bucket exists', bErr?.message);
  if (bucket) ok(bucket.public === true, 'bucket is public-read');

  // -------------------------------------------------------------------------
  console.log('\n--- 5. Realtime actually delivers ---');
  // The one thing PGlite could not prove. Subscribe as the browser would, fire
  // a real roll, and wait for the trigger's broadcast to come back over the wire.

  const received: Record<string, unknown>[] = [];
  const channel = anon.channel('house_ticker');

  const subscribed = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 15000);
    channel
      .on('broadcast', { event: 'roll' }, ({ payload }) => {
        received.push(payload as Record<string, unknown>);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve(true);
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          resolve(false);
        }
      });
  });
  ok(subscribed, 'anon can subscribe to the house_ticker broadcast topic');

  // -------------------------------------------------------------------------
  console.log('\n--- 6. one real box opening ---');

  // Roll as the probe account created above, so no real player's balance,
  // inventory or shard count is disturbed by the verification run.
  const { data: ben } = await svc
    .from('profiles').select('id,balance').eq('name', probeName).maybeSingle();
  ok(!!ben, 'probe account available for a live roll');

  if (ben && subscribed) {
    await svc.from('profiles').update({ balance: 50 }).eq('id', ben.id);

    const { data: result, error: rollErr } = await svc.rpc('open_box', {
      p_user_id: ben.id,
      p_box_tier: 'tier_1',
    });
    ok(!rollErr && !!result, 'open_box succeeded on the live database' + (rollErr ? ': ' + rollErr.message : ''));

    if (result) {
      const r = result as Record<string, unknown>;
      console.log('        won: ' + r.type + ' — ' + r.item_name);
      ok(typeof r.item_name === 'string' && r.item_name.length > 0, 'item_name is populated (the NULL bug is gone)');
      ok(typeof r.roll_id === 'string', 'roll_id returned');
    }

    // Give Realtime a moment to round-trip.
    await new Promise((r) => setTimeout(r, 4000));
    ok(received.length > 0, 'the ticker event arrived over Realtime (' + received.length + ' received)');
    if (received.length > 0) {
      const p = received[0];
      console.log('        ticker payload: ' + JSON.stringify(p));
      ok(typeof p.player === 'string', 'payload carries the player name');
      ok(!('user_id' in p) && !('balance' in p), 'payload leaks no user_id or balance');
    }

    // Reverse the test roll's side effects.
    //
    // Deleting the roll is not the whole reversal: a physical win also
    // decremented items.stock_qty, and with the roll gone there is no
    // inventory row to account for the missing unit. Left alone, every run of
    // this script permanently shrinks the real catalog by whatever it won.
    if (result) {
      const r = result as Record<string, unknown>;
      if (r.type === 'physical' && typeof r.item_id === 'string') {
        const { data: it } = await svc
          .from('items')
          .select('stock_qty')
          .eq('id', r.item_id)
          .maybeSingle();
        if (it) {
          await svc
            .from('items')
            .update({ stock_qty: (it as { stock_qty: number }).stock_qty + 1 })
            .eq('id', r.item_id);
          console.log('        (returned 1x ' + r.item_name + ' to stock)');
        }
      }
    }
    await svc.from('rolls').delete().eq('user_id', ben.id);
    console.log('        (test roll reversed)');
  }

  // Remove the probe account entirely; rolls cascade with it.
  await svc.from('profiles').delete().eq('name', probeName);

  await anon.removeChannel(channel);

  console.log('\n=================================================================');
  if (failures === 0) console.log(' PASS — ' + checks + ' live checks, 0 failures.');
  else console.log(' FAIL — ' + failures + ' of ' + checks + ' live checks failed.');
  console.log('=================================================================\n');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
