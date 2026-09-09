/**
 * THE SHARD LADDER, AND THE PC STAYING BEHIND IT
 *
 *   npm run shards
 *
 * Four things this proves, all of which have broken at least once:
 *
 *   1. The published ladder is exactly what was configured, per tier, per
 *      shard held. It has silently disagreed with what open_box rolled before.
 *   2. A player holding a full set is shown 0%, because open_box refuses to
 *      mint past shards_required and would fall through to a refund.
 *   3. The Gaming PC is in NO drop pool. It was found live at 0.02% in the $10
 *      box after being re-added through the admin form, which does not set
 *      shard_cost.
 *   4. A tier picked clean does not become a shard lottery.
 */
import { Client } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };
const pctOf = (n: number) => (n * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%';
const TIERS = ['tier_0', 'tier_1', 'tier_2', 'tier_3'];

(async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL!, ssl: { rejectUnauthorized: false }, statement_timeout: 120_000 });
  await c.connect();
  await c.query("SET idle_in_transaction_session_timeout = '45s'");
  await c.query('BEGIN');
  try {
    const { rows: [cfgRow] } = await c.query("SELECT value FROM config WHERE key='settings'");
    const cfg = cfgRow.value as any;
    const ladder = cfg.shard_ladder ?? {};
    const required = Number(cfg.shards_required ?? 4);

    // Open the pot gate and give every tier plenty of stock, so the ladder is
    // measured on its own rather than through the endgame taper.
    await c.query(`INSERT INTO deposits (user_id, amount, status, venmo_note)
                   SELECT id, 100000, 'approved', 'shard-probe' FROM profiles LIMIT 1`);
    await c.query('UPDATE items SET stock_qty = GREATEST(stock_qty, 20) WHERE COALESCE(shard_cost,0) = 0');

    const { rows: [p] } = await c.query(
      "INSERT INTO profiles (name, balance) VALUES ('__shardprobe__', 0) RETURNING id");

    console.log('\n  PUBLISHED LADDER (stock topped up so the taper is not in play)\n');
    console.log('  held  ' + TIERS.map((t) => t.replace('tier_', 'T').padStart(10)).join(''));
    for (let held = 0; held <= required; held++) {
      await c.query('UPDATE profiles SET pc_shards=$2 WHERE id=$1', [p.id, held]);
      const row: string[] = [];
      for (const t of TIERS) {
        const { rows: [o] } = await c.query('SELECT box_odds($1,$2) AS o', [t, p.id]);
        row.push(pctOf(Number(o.o.p_shard)).padStart(10));
        if (held < required) {
          const want = Number((ladder[t] ?? [])[held] ?? -1);
          if (want >= 0 && Math.abs(Number(o.o.p_shard) - want) > 1e-9) {
            ok(false, t + ' shard ' + (held + 1) + ' should be ' + pctOf(want) + ', got ' + pctOf(Number(o.o.p_shard)));
          }
        }
      }
      console.log('  ' + String(held).padEnd(6) + row.join(''));
    }
    ok(fails === 0, 'every rung of the ladder matches the configured value');

    // 2. A complete set publishes nothing.
    await c.query('UPDATE profiles SET pc_shards=$2 WHERE id=$1', [p.id, required]);
    let allZero = true;
    for (const t of TIERS) {
      const { rows: [o] } = await c.query('SELECT box_odds($1,$2) AS o', [t, p.id]);
      if (Number(o.o.p_shard) !== 0) allZero = false;
    }
    ok(allZero, 'a player holding a full set is shown 0% in every box');

    // 3. The PC is in no pool, from any tier, at any shard count.
    const { rows: [pc] } = await c.query("SELECT id, name, shard_cost FROM items WHERE name ILIKE '%gaming pc%' LIMIT 1");
    ok(!!pc, 'the shard prize row exists');
    if (pc) {
      ok(Number(pc.shard_cost) > 0,
        'the PC has a shard_cost so it is excluded from every pool (' + pc.shard_cost + ')');
      let seen = false;
      for (const t of TIERS) {
        const { rows: [o] } = await c.query('SELECT box_odds($1,$2) AS o', [t, p.id]);
        const pool = [...(o.o.items ?? []), ...(o.o.filler ?? [])];
        if (pool.some((i: any) => i.item_id === pc.id)) seen = true;
      }
      ok(!seen, 'the PC appears in NO drop pool');
    }

    // Any other high-value row sitting loose in a pool is the same mistake.
    const { rows: [loose] } = await c.query(`
      SELECT count(*)::INT n FROM items
       WHERE is_active AND stock_qty > 0 AND est_value >= 100
         AND COALESCE(shard_cost, 0) = 0`);
    ok(loose.n === 0,
      'no item worth $100+ is droppable without a shard_cost (' + loose.n + ')');

    // 4. Endgame: strip a tier to nothing and shards must not take over.
    await c.query('UPDATE profiles SET pc_shards=0 WHERE id=$1', [p.id]);
    const { rows: [full] } = await c.query("SELECT box_odds('tier_3',$1) AS o", [p.id]);
    await c.query(`UPDATE items SET stock_qty = 0
                    WHERE box_tier='tier_3' AND COALESCE(shard_cost,0)=0
                      AND reward_credit IS NULL AND reward_voucher_tier IS NULL`);
    const { rows: [bare] } = await c.query("SELECT box_odds('tier_3',$1) AS o", [p.id]);
    ok(Number(bare.o.p_shard) < Number(full.o.p_shard),
      'stripping a tier LOWERS its shard chance (' + pctOf(Number(full.o.p_shard)) +
      ' -> ' + pctOf(Number(bare.o.p_shard)) + ')');

    /*
     * NOT "the tier locks". A tier keeps borrowing cheap filler from the tiers
     * below it, so tier_3 stripped of its OWN prizes can still hand over a real
     * object and correctly stays open. The invariant that matters is the one
     * above plus this: an emptied tier pays NO shards, so a cleaned-out box can
     * never quietly become the easiest route to the PC.
     */
    ok(Number(bare.o.p_shard) === 0,
      'an emptied tier pays no shards at all (' + pctOf(Number(bare.o.p_shard)) + ')');

    const { rows: [lock] } = await c.query("SELECT tier_lock_state('tier_3') AS l");
    console.log('        (tier_3 locked=' + lock.l.locked + ', ' + lock.l.real_items_left +
      ' real items still reachable via cross-tier filler)');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    await c.query('ROLLBACK');
    await c.end();
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'the ladder holds and the PC stays locked') + '\n');
    process.exit(fails ? 1 : 0);
  }
})();
