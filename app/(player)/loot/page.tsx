import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { fetchAllOdds, fetchGameConfig } from '../_lib/queries';
import { LootCatalog } from './loot-catalog';

export const dynamic = 'force-dynamic';

/**
 * THE FULL LOOT LIST.
 *
 * Every box publishes its own odds, but until now there was nowhere to answer
 * "what is actually in this house, and which box do I buy to get it?" without
 * opening four modals and holding the answer in your head. This is that page:
 * one row per item, its picture, what it is worth, and the chance of pulling
 * it from each tier side by side.
 *
 * It is built from `box_odds` rather than from the items table, deliberately.
 * The items table would say what exists; box_odds says what you can actually
 * win right now, at the probabilities the server will really use, with stock
 * and the pot gate already accounted for. Anything else would be a second
 * source of truth about the odds, and this project has been bitten by that.
 */
export default async function LootPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [oddsList, config] = await Promise.all([fetchAllOdds(), fetchGameConfig()]);

  return <LootCatalog oddsList={oddsList} config={config} />;
}
