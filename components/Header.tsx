'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Coins,
  DollarSign,
  Volume2,
  VolumeX,
  LogOut,
  Shield,
  Plus,
  Box,
  Layers,
  User,
  Ticket,
} from 'lucide-react';
import { usePlayer } from '@/app/(player)/_lib/player-store';
import { apiLogout } from '@/app/(player)/_lib/api';
import { sfx } from '@/lib/sound';
import { DepositModal } from '@/components/DepositModal';

export function Header() {
  const { user, stats, toast } = usePlayer();
  const router = useRouter();
  const [isMuted, setIsMuted] = useState(sfx.muted);
  const [depositOpen, setDepositOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const totalVouchers = Object.values(stats.vouchers ?? {}).reduce(
    (acc, v) => acc + (v?.count ?? 0),
    0
  );

  const handleToggleSound = () => {
    const next = sfx.toggleMuted();
    setIsMuted(next);
    toast(next ? 'Sound Muted' : 'Sound Enabled', 'info');
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await apiLogout();
      router.push('/login');
      router.refresh();
    } catch {
      router.push('/login');
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-gun-800 bg-gun-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 overflow-hidden px-3 py-3 sm:px-4">
          {/* Logo & Navigation */}
          <div className="flex items-center gap-6">
            <Link href="/" className="group flex min-w-0 shrink items-center gap-2">
              <div className="flex flex-col items-center transition group-hover:scale-105">
                <div className="h-1.5 w-8 rounded-t-sm bg-gradient-to-r from-yellow-600 via-yellow-300 to-yellow-600" />
                <div className="flex h-8 w-9 items-center justify-center rounded-b-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-black tracking-tighter text-white shadow-lg shadow-purple-500/20">
                  ΨΥ
                </div>
              </div>
              <div>
                <span className="hidden truncate text-sm font-black tracking-tight text-white transition group-hover:text-purple-300 min-[400px]:block sm:text-base">
                  PSI U LOOT BOX
                </span>
                {/* Hidden with the wordmark below 400px -- a lone subtitle next
                    to the crest reads as a layout mistake. */}
                <span className="hidden text-[9px] font-mono uppercase tracking-widest text-gun-400 min-[400px]:block">
                  Moving Out
                </span>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-2">
              <Link
                href="/"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gun-200 hover:bg-gun-800 hover:text-white transition"
              >
                <Box className="h-4 w-4 text-blue-400" />
                <span>Boxes</span>
              </Link>
              <Link
                href="/inventory"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gun-200 hover:bg-gun-800 hover:text-white transition"
              >
                <Layers className="h-4 w-4 text-purple-400" />
                <span>Inventory</span>
              </Link>
            </nav>
          </div>

          {/* Player Balance HUD & Controls */}
          <div className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2.5">
            {/* Balance Pill */}
            <div className="flex shrink-0 items-center rounded-xl border border-emerald-500/30 bg-gun-950/80 px-2 py-1.5 shadow-inner sm:px-3">
              {/* "Bal:" is the first thing to go on a narrow screen -- the $ sign
                  already says what the number is, and the label was the
                  difference between the controls fitting and being clipped. */}
              <span className="mr-1.5 hidden font-mono text-[10px] uppercase text-gun-400 sm:inline">
                Bal:
              </span>
              <span className="font-mono text-sm font-bold text-emerald-400">
                ${stats.balance.toFixed(2)}
              </span>
              <button
                onClick={() => setDepositOpen(true)}
                title="Deposit Funds via Venmo"
                aria-label="Add funds"
                className="ml-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-400 transition hover:bg-emerald-500 hover:text-black sm:ml-2"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Scrap Coins Pill */}
            <Link
              href="/inventory"
              title="View Scrap & Compactor"
              className="hidden sm:flex min-h-[44px] items-center rounded-xl border border-cyan-500/30 bg-gun-950/80 px-3 py-1.5 shadow-inner hover:border-cyan-400 transition"
            >
              <Coins className="h-3.5 w-3.5 text-cyan-400 mr-1.5" />
              <span className="font-mono text-sm font-bold text-cyan-300">
                {stats.scrap_coins}
              </span>
            </Link>

            {/* Active Discount Vouchers Pill */}
            {totalVouchers > 0 && (
              <div
                title={`${totalVouchers} active discount voucher${totalVouchers > 1 ? 's' : ''} available`}
                className="flex min-h-[44px] items-center rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1.5 shadow-inner"
              >
                <Ticket className="h-3.5 w-3.5 text-emerald-400 mr-1.5 shrink-0" />
                <span className="font-mono text-xs font-bold text-emerald-300 whitespace-nowrap">
                  {totalVouchers} {totalVouchers === 1 ? 'Voucher' : 'Vouchers'}
                </span>
              </div>
            )}

            {/* Mobile Inventory Link (visible when < md) */}
            <Link
              href="/inventory"
              title="Inventory & Scrap Compactor"
              className="flex md:hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gun-750 bg-gun-850 text-gun-300 hover:border-purple-500/40 hover:text-white transition"
            >
              <Layers className="h-4 w-4 text-purple-400" />
            </Link>

            {/* Mute Button */}
            <button
              onClick={handleToggleSound}
              title={isMuted ? 'Unmute' : 'Mute'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gun-750 bg-gun-850 text-gun-300 hover:border-gun-600 hover:text-white transition"
            >
              {isMuted ? <VolumeX className="h-4 w-4 text-red-400" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
            </button>

            {/* Admin Link if admin role */}
            {user.role === 'admin' && (
              <Link
                href="/admin"
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-950/50 px-3 py-2 text-xs font-mono font-bold text-purple-300 hover:bg-purple-900/60 transition shadow-sm"
              >
                <Shield className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            )}

            {/* User Pill & Signout */}
            <div className="flex items-center gap-1.5 pl-1 border-l border-gun-800">
              <span className="hidden lg:inline text-xs font-medium text-gun-300 px-1">
                {user.name}
              </span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                title="Sign Out"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gun-750 bg-gun-850 text-gun-400 hover:border-red-500/40 hover:bg-red-950/40 hover:text-red-300 transition"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <DepositModal isOpen={depositOpen} onClose={() => setDepositOpen(false)} />
    </>
  );
}
