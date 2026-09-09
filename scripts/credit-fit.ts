import { config as denv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
denv({ path: '.env.local', quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--fix');
(async () => {
  const { data: c } = await db.from('config').select('value').eq('key','settings').single();
  const prices:any = (c!.value as any).box_prices;
  const { data } = await db.from('items').select('id,name,box_tier,reward_credit,stock_qty,is_active').not('reward_credit','is',null);
  console.log('CREDIT ROWS — a credit worth less than the box it drops in feels like a loss\n');
  const moves:any[]=[];
  for (const i of (data??[]) as any[]) {
    const face=Number(i.reward_credit); const box=Number(prices[i.box_tier]);
    // Highest tier whose price the credit still covers.
    const fits=(['tier_3','tier_2','tier_1','tier_0'] as const).find(t=>face>=Number(prices[t])) ?? 'tier_0';
    const bad = face < box;
    console.log('  '+String(i.name).padEnd(22)+'$'+String(face).padEnd(6)+'in '+i.box_tier+' ($'+box+')'+
      (bad? '   <<< pays less than the box  -> move to '+fits : '   ok'));
    if (bad && fits!==i.box_tier) moves.push({id:i.id,name:i.name,to:fits});
  }
  if (!moves.length) { console.log('\n  nothing to move'); return; }
  if (!APPLY) { console.log('\n  '+moves.length+' would move. Re-run with --fix.'); return; }
  for (const m of moves) await db.from('items').update({ box_tier: m.to }).eq('id', m.id);
  console.log('\n  moved '+moves.length+' credit row(s) into a box they actually cover.');
})();
