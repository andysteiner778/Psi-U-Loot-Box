import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { PlayerProvider, ToastStack } from './_lib/player-store';
import { fetchGameConfig } from './_lib/queries';
import { playerStats } from './_lib/http';
import { Ticker } from '@/components/Ticker';
import { Header } from '@/components/Header';

export const dynamic = 'force-dynamic';

export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  if (session.mustChangePin) {
    redirect('/login');
  }

  // Fetch live stats (balances and active vouchers) from database
  const [initialStats, config] = await Promise.all([
    playerStats(session.id),
    fetchGameConfig(),
  ]);

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
