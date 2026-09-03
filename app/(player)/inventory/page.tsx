import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { fetchGameConfig, fetchInventory, fetchRecentRolls } from '../_lib/queries';
import { InventoryView } from './inventory-view';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [items, recent, config] = await Promise.all([
    fetchInventory(session.id),
    fetchRecentRolls(session.id, 20),
    fetchGameConfig(),
  ]);

  return (
    <InventoryView
      initialItems={items}
      recentRolls={recent}
      allowHighRarityScrap={config.allow_high_rarity_scrap}
    />
  );
}
