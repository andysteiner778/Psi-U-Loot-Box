import { adminPageGate } from '../_lib/guard';
import { PlayerRoster } from '@/components/admin/PlayerRoster';
import Link from 'next/link';
import { ArrowLeft, Lock, LayoutDashboard } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminPlayersPage() {
  const gate = await adminPageGate();

  if (!gate.ok) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-4 bg-gun-950 text-white">
        <div className="w-full max-w-md rounded-3xl border border-red-500/40 bg-gun-900/90 p-8 shadow-2xl text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/20 border border-red-500/40 text-red-400">
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight">Access Restricted</h1>
          <p className="text-xs font-mono text-gun-300 leading-relaxed">
            {gate.detail || 'You must be signed in with an admin profile to view this portal.'}
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <Link
              href="/login"
              className="rounded-xl bg-purple-600 py-3 font-mono text-xs font-bold text-white hover:bg-purple-500 transition"
            >
              Sign In as Admin
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-gun-700 bg-gun-800 py-3 font-mono text-xs font-semibold text-gun-300 hover:text-white transition"
            >
              Back to Game
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gun-950 text-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gun-700 bg-gun-850 px-3 py-1.5 text-xs font-mono text-gun-300 hover:text-white transition"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span>Admin Dashboard</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gun-700 bg-gun-850 px-3 py-1.5 text-xs font-mono text-gun-300 hover:text-white transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Game</span>
          </Link>
        </div>

        <div className="rounded-3xl border border-gun-800 bg-gun-900/60 p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          <PlayerRoster />
        </div>
      </div>
    </main>
  );
}
