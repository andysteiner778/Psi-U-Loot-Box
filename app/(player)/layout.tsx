import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { PlayerProvider, ToastStack } from './_lib/player-store';
import { fetchGameConfig } from './_lib/queries';
import { Ticker } from '@/components/Ticker';
import { Header } from '@/components/Header';
import type { PlayerStats } from './_lib/shared';

export const dynamic = 'force-dynamic';

export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  if (session.mustChangePin) {
    redirect('/login');
  }

  // Fetch live stats from database
  const { data: profile } = await db
    .from('profiles')
    .select('balance, scrap_coins, pc_shards')
    .eq('id', session.id)
    .single();

  const initialStats: PlayerStats = {
    balance: Number(profile?.balance ?? 0),
    scrap_coins: Number(profile?.scrap_coins ?? 0),
    pc_shards: Number(profile?.pc_shards ?? 0),
  };

  const config = await fetchGameConfig();

  return (
    <PlayerProvider user={session} config={config} initialStats={initialStats}>
      <div className="min-h-dvh flex flex-col bg-gun-950 text-white">
        {/* Persistent Live Ticker */}
        <Ticker />

        {/* Navigation Header */}
        <Header />

        {/* Main Content Area */}
        <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 mb-12">
          {children}
        </main>

        {/* Toast Notification Container */}
        <ToastStack />
      </div>
    </PlayerProvider>
  );
}
