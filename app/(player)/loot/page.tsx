import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { fetchAllOdds, fetchCatalogue, fetchGameConfig } from '../_lib/queries';
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
 * ROWS come from the items table; CHANCES come from box_odds.
 *
 * It used to build the rows from box_odds too, which seemed tidy -- one source
 * of truth -- but box_odds only publishes what is currently WINNABLE. The
 * moment somebody took a monitor home it vanished from this page, and the
 * "show claimed too" toggle had nothing left to reveal: it was structurally
 * incapable of working. The odds are still box_odds and only box_odds; the
 * catalogue is just where the list of things comes from.
 */
export default async function LootPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [oddsList, config, catalogue] = await Promise.all([
    fetchAllOdds(session.id),
    fetchGameConfig(),
    fetchCatalogue(),
  ]);

  return <LootCatalog oddsList={oddsList} config={config} catalogue={catalogue} />;
}
