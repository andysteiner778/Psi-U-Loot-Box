'use client';

import React, { useState } from 'react';
import confetti from 'canvas-confetti';
import { Cpu, Zap, Trophy, AlertTriangle, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react';
import { usePlayer } from '@/app/(player)/_lib/player-store';
import { apiClaimPc, apiSalvage } from '@/app/(player)/_lib/api';
import { sfx } from '@/lib/sound';

export interface ShardHudProps {
  potTotal?: number;
  potThreshold?: number;
  potGateMet?: boolean;
}

export function ShardHud({
  potTotal = 0,
  potThreshold = 400,
  potGateMet = false,
}: ShardHudProps) {
  const { stats, config, commit, toast } = usePlayer();
  const [claiming, setClaiming] = useState(false);
  const [salvaging, setSalvaging] = useState(false);
  const [showSalvageModal, setShowSalvageModal] = useState(false);
  const [showWinModal, setShowWinModal] = useState(false);

  const shardsHeld = stats.pc_shards;
  const shardsReq = config.shards_required || 5;
  const pcValue = config.pc_value || 400;
  const hasCompletedPc = shardsHeld >= shardsReq;

  const handleClaimPc = async () => {
    setClaiming(true);
    try {
      const res = await apiClaimPc();
      if (res.ok) {
        commit(res.value.stats);
        sfx.playGoldFanfare();
        try {
          confetti({
            particleCount: 150,
            spread: 90,
            origin: { y: 0.5 },
            colors: ['#eab308', '#f59e0b', '#ec4899', '#3b82f6'],
          });
        } catch {}
        setShowWinModal(true);
        toast('🎉 Gaming PC Claimed! Head to Room 4 for pickup.', 'good');
      } else {
        toast(res.error, 'bad');
      }
    } catch {
      toast('Could not claim PC right now.', 'bad');
    } finally {
      setClaiming(false);
    }
  };

  const handleSalvage = async (count: number) => {
    setSalvaging(true);
    try {
      const res = await apiSalvage(count);
      if (res.ok) {
        commit(res.value.stats);
        sfx.playScrapCrunch();
        toast(`Salvaged ${count} shard(s) for +$${res.value.data.credit} credit!`, 'good');
        setShowSalvageModal(false);
      } else {
        toast(res.error, 'bad');
      }
    } catch {
      toast('Failed to salvage shards.', 'bad');
    } finally {
      setSalvaging(false);
    }
  };

  return (
    <>
      <div className="relative w-full overflow-hidden rounded-2xl border border-yellow-500/30 bg-gradient-to-r from-gun-950 via-gun-900 to-gun-950 p-4 shadow-xl backdrop-blur-md">
        {/* Glow effect */}
        <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-yellow-500/10 blur-2xl" />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Title & Shard Progress */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.2)]">
              <Cpu className="h-6 w-6" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                  PC Core Forge
                </h3>
                <span className="rounded bg-yellow-400/20 px-2 py-0.5 text-xs font-mono font-bold text-yellow-300">
                  ${pcValue} Rig
                </span>
              </div>

              {/* Shard Slots */}
              <div className="mt-1.5 flex items-center gap-1.5">
                {Array.from({ length: shardsReq }).map((_, i) => {
                  const filled = i < shardsHeld;
                  return (
                    <div
                      key={i}
                      className={`h-5 w-7 rounded-md border transition-all ${
                        filled
                          ? 'border-yellow-300 bg-gradient-to-t from-yellow-500 to-yellow-300 shadow-[0_0_10px_#eab308]'
                          : 'border-gun-700 bg-gun-900/80'
                      }`}
                      title={filled ? `Shard ${i + 1} slotted` : `Slot ${i + 1} empty`}
                    />
                  );
                })}
                <span className="ml-2 font-mono text-xs font-bold text-yellow-400">
                  {shardsHeld}/{shardsReq} Shards
                </span>
              </div>
            </div>
          </div>

          {/* Pot Gate Status or Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {!potGateMet ? (
              <div className="flex items-center gap-2 rounded-xl bg-gun-950/80 border border-gun-800 px-3 py-2 text-xs font-mono text-gun-400">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <div>
                  <div className="font-semibold text-gun-300">Pot Gate: Locked at 0%</div>
                  <div className="text-[10px]">
                    Opens at ${potThreshold} pot (${potTotal.toFixed(0)} deposited)
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-xl bg-emerald-950/50 border border-emerald-500/30 px-3 py-1.5 text-xs font-mono text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
                <span>Drops Unlocked</span>
              </div>
            )}

            {/* Claim PC Button */}
            {hasCompletedPc && (
              <button
                onClick={handleClaimPc}
                disabled={claiming}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-yellow-500/30 transition hover:brightness-110 active:scale-95 disabled:opacity-50 animate-pulse"
              >
                <Trophy className="h-4 w-4" />
                <span>{claiming ? 'Claiming...' : `Claim $${pcValue} Gaming PC`}</span>
              </button>
            )}

            {/* Salvage Option (if holding 1-4 shards) */}
            {shardsHeld > 0 && !hasCompletedPc && (
              <button
                onClick={() => setShowSalvageModal(true)}
                className="flex min-h-[44px] items-center rounded-xl border border-gun-700 bg-gun-850 px-3.5 py-2 text-xs font-mono text-gun-300 transition hover:border-gun-600 hover:text-white"
              >
                Salvage Shards ($20 ea)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Salvage Modal Dialog */}
      {showSalvageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gun-700 bg-gun-900 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-yellow-400" />
              <span>Salvage Soulbound Shards</span>
            </h3>
            <p className="mt-2 text-xs text-gun-300 leading-relaxed">
              According to Anti-Exploit Rule 3, PC Shards cannot be traded to other players. You can
              salvage them back to the house for <strong className="text-white">$20.00 Account Credit</strong> per shard.
            </p>

            <div className="my-4 rounded-xl bg-gun-950 p-4 border border-gun-800 font-mono text-sm space-y-1">
              <div className="flex justify-between text-gun-400">
                <span>Shards currently held:</span>
                <span className="text-yellow-400 font-bold">{shardsHeld}</span>
              </div>
              <div className="flex justify-between text-gun-400">
                <span>Salvage Payout:</span>
                <span className="text-emerald-400 font-bold">+${(shardsHeld * 20).toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleSalvage(shardsHeld)}
                disabled={salvaging}
                className="flex-1 rounded-xl bg-yellow-500 py-2.5 text-sm font-bold text-black transition hover:bg-yellow-400 active:scale-95 disabled:opacity-50"
              >
                {salvaging ? 'Salvaging...' : `Salvage All ${shardsHeld} Shard(s)`}
              </button>
              <button
                onClick={() => setShowSalvageModal(false)}
                className="rounded-xl border border-gun-700 bg-gun-800 px-4 py-2.5 text-sm font-semibold text-gun-300 hover:text-white"
              >
                Keep Shards
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PC Claimed Victory Modal */}
      {showWinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-3xl border-2 border-yellow-400 bg-gun-900 p-8 shadow-2xl text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-yellow-500/20 border-2 border-yellow-400 text-yellow-400 animate-bounce">
              <Trophy className="h-10 w-10" />
            </div>
            <h2 className="text-3xl font-black text-white">GAMING PC CLAIMED!</h2>
            <p className="mt-3 text-sm text-gun-300 leading-relaxed">
              You successfully forged all 5 PC Core Shards! The house ${pcValue} custom gaming rig is
              yours.
            </p>
            <div className="my-6 rounded-2xl bg-gun-950 p-4 border border-yellow-500/30">
              <p className="text-xs font-mono uppercase text-yellow-400 font-bold">
                Pickup Instructions
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                Find Tyler in Room 4 with your phone to claim your rig.
              </p>
            </div>
            <button
              onClick={() => setShowWinModal(false)}
              className="w-full min-h-[44px] rounded-xl bg-yellow-500 py-3 font-bold text-black transition hover:bg-yellow-400 active:scale-95 shadow-lg shadow-yellow-500/30"
            >
              Close & Celebrate
            </button>
          </div>
        </div>
      )}
    </>
  );
}
