'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Hammer, Sparkles, Coins, Key, ArrowRight } from 'lucide-react';
import { usePlayer } from '@/app/(player)/_lib/player-store';
import { apiCompact } from '@/app/(player)/_lib/api';
import { sfx } from '@/lib/sound';

export function ScrapCompactor() {
  const { stats, config, commit, toast } = usePlayer();
  const [crunching, setCrunching] = useState(false);

  const coinsHeld = stats.scrap_coins;
  const cost = config.scrap_coins_per_key || 500;
  const keyTier = config.scrap_key_tier || 'tier_2';
  // What the compactor actually pays, not a box tier's price.
  const keyPrice = config.scrap_key_usd ?? config.base_prices?.[keyTier] ?? 10;
  const canCompact = coinsHeld >= cost;
  const progressPct = Math.min(100, (coinsHeld / cost) * 100);

  const handleCompact = async () => {
    if (!canCompact || crunching) return;
    setCrunching(true);
    sfx.playScrapCrunch();

    try {
      // Delay briefly to allow the hydraulic crunch animation to play
      await new Promise((resolve) => setTimeout(resolve, 800));

      const res = await apiCompact();
      if (res.ok) {
        commit(res.value.stats);
        sfx.playScrapCrunch();
        toast(`💥 CRUNCH! Converted ${cost} Scrap Coins into $${res.value.data.credit}.00 Account Credit!`, 'good');
      } else {
        toast(res.error, 'bad');
      }
    } catch {
      toast('Could not crush scrap right now.', 'bad');
    } finally {
      setCrunching(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gun-700 bg-gun-900/90 p-5 shadow-xl backdrop-blur-md">
      {/* Background radial glow */}
      <div className="pointer-events-none absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-cyan-500/10 blur-2xl" />

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Left Info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Hammer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                <span>The Scrap Compactor</span>
                <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                  Hydraulic Press
                </span>
              </h3>
              <p className="text-xs text-gun-400">
                Crush {cost} junk scrap coins into ${keyPrice} account credit (spendable on any tier).
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-3 w-full max-w-sm">
            <div className="flex justify-between text-xs font-mono mb-1">
              <span className="text-gun-400 flex items-center gap-1">
                <Coins className="h-3 w-3 text-cyan-400" />
                <span>{coinsHeld} / {cost} coins</span>
              </span>
              <span className="text-cyan-400 font-bold">{progressPct.toFixed(0)}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gun-950 border border-gun-800">
              <motion.div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full"
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        </div>

        {/* Right Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="rounded-xl bg-gun-950/80 border border-gun-800 px-3 py-2 text-center font-mono">
            <div className="text-[10px] uppercase text-gun-400 font-semibold">Reward</div>
            <div className="text-xs font-bold text-emerald-400 flex items-center justify-center gap-1">
              <Coins className="h-3.5 w-3.5 text-emerald-400" />
              <span>+${keyPrice}.00 Credit</span>
            </div>
          </div>

          <motion.button
            onClick={handleCompact}
            disabled={!canCompact || crunching}
            animate={crunching ? { scale: [1, 0.9, 1.05, 1], rotate: [0, -2, 2, 0] } : {}}
            transition={{ duration: 0.8 }}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-3 font-mono text-sm font-bold shadow-lg transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
              canCompact
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-cyan-500/25 hover:brightness-110 animate-pulse'
                : 'bg-gun-800 text-gun-400 border border-gun-700'
            }`}
          >
            <Hammer className={`h-4 w-4 ${crunching ? 'animate-spin' : ''}`} />
            <span>
              {crunching
                ? 'CRUSHING...'
                : canCompact
                  ? `Crush ${cost} Scrap → $${keyPrice} Credit`
                  : `Need ${Math.max(0, cost - coinsHeld)} More Coins`}
            </span>
          </motion.button>
        </div>
      </div>
    </div>
  );
}
