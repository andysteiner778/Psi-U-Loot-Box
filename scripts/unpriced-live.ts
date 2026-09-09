/**
 * An item may be worth $0, and a $0 item must never reach a box.
 *
 *   npm run unpriced
 *
 * $0 means "uploaded, not yet priced". The engine, box_odds and
 * tier_lock_state all filter `est_value > 0` — this proves all three agree,
 * because the weight formula divides by value and a $0 item that slipped
 * through would take the capped weight and crowd out every real prize.
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
const TIERS = ['tier_0', 'tier_1', 'tier_2', 'tier_3'];

const inAnyPool = async (id: string) => {
  for (const t of TIERS) {
    const { data } = await db.rpc('box_odds', { p_box_tier: t, p_user_id: null });
    const o = data as any;
    if ([...(o.items ?? []), ...(o.filler ?? [])].some((i: any) => i.item_id === id)) return t;
  }
  return null;
};

(async () => {
  let id = '';
  try {
    const { data, error } = await db.from('items').insert({
      name: '__unpriced_probe__', box_tier: 'tier_1', rarity: 'grey',
      est_value: 0, stock_qty: 5, initial_stock_qty: 5, scrap_value: 0, is_active: true,
    }).select('id').single();
    ok(!error, 'an item can be saved with est_value 0' + (error ? ': ' + error.message : ''));
    if (error) throw error;
    id = data!.id;

    ok((await inAnyPool(id)) === null, 'a $0 item appears in no box');

    const { data: lock } = await db.rpc('tier_lock_state', { p_box_tier: 'tier_1' });
    ok(Number((lock as any).unpriced_items) > 0,
      'tier_lock_state counts it as unpriced (' + (lock as any).unpriced_items + ')');

    // Price it, and it should join the draw.
    await db.from('items').update({ est_value: 4 }).eq('id', id);
    const where = await inAnyPool(id);
    ok(where !== null, 'once priced it joins the draw (' + where + ')');

    // Negative is still refused: it inverts the weight formula.
    const { error: neg } = await db.from('items').update({ est_value: -1 }).eq('id', id);
    ok(!!neg, 'a negative value is still refused');

    // And a $0 item is not scrappable — a coin is worth more than it is.
    await db.from('items').update({ est_value: 0, scrap_value: 0 }).eq('id', id);
    const { data: chk } = await db.from('items').select('scrap_value').eq('id', id).single();
    ok(chk!.scrap_value === 0, 'a $0 item has no scrap value');
  } catch (e) {
    console.error('  THREW: ' + (e as Error).message);
    fails++;
  } finally {
    if (id) {
      await db.from('rolls').delete().eq('item_id', id);
      await db.from('items').delete().eq('id', id);
    }
    console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'unpriced items behave') + '\n');
    process.exit(fails ? 1 : 0);
  }
})();
