import { adminPageGate } from './_lib/guard';
import { readConfig } from './_lib/config';
import { db } from '@/lib/supabase/server';
import { playerRoster } from '@/lib/session';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import Link from 'next/link';
import { ShieldAlert, ArrowLeft, Lock } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
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

  // Load initial dataset
  const [config, roster] = await Promise.all([
    readConfig(),
    playerRoster(),
  ]);

  const { data: depositsData } = await db
    .from('deposits')
    .select(`
      id,
      user_id,
      amount,
      venmo_note,
      status,
      created_at,
      profiles:user_id ( name )
    `)
    .order('created_at', { ascending: false });

  const deposits = (depositsData ?? []).map((d: any) => ({
    id: d.id,
    user_id: d.user_id,
    player_name: d.profiles?.name || 'Unknown',
    amount: Number(d.amount),
    venmo_note: d.venmo_note,
    status: d.status,
    created_at: d.created_at,
  }));

  const { data: itemsData } = await db
    .from('items')
    .select('*')
    .order('box_tier', { ascending: true })
    .order('est_value', { ascending: false });

  const items = itemsData ?? [];

  const { data: overridesData } = await db
    .from('drop_overrides')
    .select(`
      user_id,
      item_id,
      created_at,
      profiles:user_id ( name ),
      items:item_id ( name, rarity, est_value, box_tier )
    `);

  const overrides = overridesData ?? [];

  return (
    <main className="min-h-dvh bg-gun-950 text-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-xl border border-gun-700 bg-gun-850 px-3 py-1.5 text-xs font-mono text-gun-300 hover:text-white transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Player Game</span>
        </Link>

        <AdminDashboard
          admin={gate.admin}
          initialConfig={config}
          initialDeposits={deposits}
          initialItems={items as any}
          initialOverrides={overrides}
          roster={roster}
        />
      </div>
    </main>
  );
}
