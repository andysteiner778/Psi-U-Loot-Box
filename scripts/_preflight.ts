/**
 * Shared preflight for the gates that roll real boxes.
 *
 * During setup the catalogue is legitimately empty of priced objects — items
 * are uploaded first and valued later — and every tier is locked, so open_box
 * refuses. The live gates then failed with a dozen confusing assertions about
 * charges and payloads when the real answer was "there is nothing to win yet".
 *
 * A skip is not a pass, and this says so loudly rather than quietly returning
 * green.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export async function catalogueIsPlayable(db: SupabaseClient): Promise<{
  playable: boolean;
  detail: string;
}> {
  const tiers = ['tier_0', 'tier_1', 'tier_2', 'tier_3'];
  const state: string[] = [];
  let anyOpen = false;

  for (const t of tiers) {
    const { data } = await db.rpc('tier_lock_state', { p_box_tier: t });
    const s = data as { locked: boolean; real_items_left: number; unpriced_items: number } | null;
    if (!s) continue;
    if (!s.locked) anyOpen = true;
    state.push(
      '    ' + t.padEnd(8) + (s.locked ? 'LOCKED' : 'open  ') +
      '  priced items: ' + s.real_items_left +
      (s.unpriced_items ? '   waiting to be priced: ' + s.unpriced_items : '')
    );
  }
  return { playable: anyOpen, detail: state.join('\n') };
}

/** Print the skip banner. Returns true if the caller should stop. */
export async function skipIfUnplayable(db: SupabaseClient, gate: string): Promise<boolean> {
  const { playable, detail } = await catalogueIsPlayable(db);
  if (playable) return false;
  console.log('\n=================================================================');
  console.log(' SKIPPED — ' + gate + ' needs a box that can actually be opened');
  console.log('=================================================================\n');
  console.log(detail);
  console.log('\n  Every tier is locked because no item has a price above $0 yet.');
  console.log('  That is the correct behaviour mid-setup, not a fault — but it');
  console.log('  means these checks proved nothing. Add and price items, then');
  console.log('  re-run. THIS IS NOT A PASS.\n');
  return true;
}
