'use client';

import React, { useState } from 'react';
import { Package, Sparkles, Eye, Zap, Flame, Lock } from 'lucide-react';
import type { BoxTier, OpenBoxResult } from '@/lib/types';
import { RARITY_COLOR } from '@/lib/types';
import { BOX_META, money, type PlayerBoxOdds } from '@/app/(player)/_lib/shared';
import { usePlayer } from '@/app/(player)/_lib/player-store';
import { apiOpenBox, newRollId } from '@/app/(player)/_lib/api';
import { sfx } from '@/lib/sound';
import { CaseReel } from '@/components/CaseReel';
import { BoxOddsModal } from '@/components/BoxOddsModal';

export interface BoxCardProps {
  odds: PlayerBoxOdds;
  isFlashSale?: boolean;
}

export function BoxCard({ odds, isFlashSale = false }: BoxCardProps) {
  const { stats, commit, adjust, toast } = usePlayer();
  const [inspectOpen, setInspectOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [activeWinner, setActiveWinner] = useState<OpenBoxResult | null>(null);

  const tier = odds.tier;
  const meta = BOX_META[tier] || { name: 'Mystery Box', blurb: '', accent: 'grey' };
  const accentColor = RARITY_COLOR[meta.accent] || '#3b82f6';
  const effectivePrice = odds.box_price;
  const basePrice = isFlashSale ? effectivePrice / 0.8 : effectivePrice;
  const hasFunds = stats.balance >= effectivePrice;

  const handleOpen = async () => {
    if (!hasFunds) {
      sfx.playError();
      toast(`Not enough balance ($${stats.balance.toFixed(2)} available, need $${effectivePrice.toFixed(2)}). Deposit funds via Venmo!`, 'bad');
      return;
    }

    // Optimistic balance adjustment for instant UI tap feedback
    adjust({ balance: -effectivePrice });

    const clientRollId = newRollId();
    try {
      const res = await apiOpenBox(tier, clientRollId);
      if (res.ok) {
        commit(res.value.stats);
        setActiveWinner(res.value.data);
        setSpinning(true);
      } else {
        // Rollback optimistic adjustment
        adjust({ balance: effectivePrice });
        sfx.playError();
        toast(res.error, 'bad');
      }
    } catch {
      adjust({ balance: effectivePrice });
      sfx.playError();
      toast('Network error rolling box. Please retry.', 'bad');
    }
  };

  return (
    <>
      <div
        data-rarity={meta.accent}
        className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-gun-700/80 bg-gun-900/90 p-6 shadow-2xl backdrop-blur-md transition-all hover:border-gun-600 hover:shadow-cyan-500/10"
        style={{
          boxShadow: `0 10px 30px -10px rgba(0,0,0,0.7), 0 0 25px -10px ${accentColor}40`,
        }}
      >
        {/* Flash Sale Ribbon */}
        {isFlashSale && (
          <div className="absolute -right-12 top-6 rotate-45 bg-gradient-to-r from-red-600 to-amber-500 py-1 px-12 text-center text-[10px] font-mono font-black uppercase tracking-wider text-white shadow-lg">
            <span className="flex items-center justify-center gap-1">
              <Flame className="h-3 w-3" /> 20% OFF
            </span>
          </div>
        )}

        {/* Top Glow */}
        <div
          className="pointer-events-none absolute -left-12 -top-12 h-36 w-36 rounded-full blur-3xl opacity-30 group-hover:opacity-60 transition"
          style={{ backgroundColor: accentColor }}
        />

        <div>
          {/* Header & Badges */}
          <div className="flex items-center justify-between">
            <span
              className="rounded-lg px-2.5 py-1 text-[11px] font-mono font-bold uppercase tracking-wider text-white shadow-sm"
              style={{ backgroundColor: accentColor }}
            >
              {tier.replace('_', ' ')}
            </span>

            <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-yellow-400 bg-yellow-950/40 border border-yellow-500/30 px-2.5 py-1 rounded-xl">
              <Zap className="h-3.5 w-3.5 fill-yellow-400" />
              <span>{(odds.p_shard * 100).toFixed(1)}% Shard</span>
            </div>
          </div>

          {/* Crate Visual Artwork */}
          <div className="relative my-6 flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl bg-gun-950/80 border border-gun-800 group-hover:border-gun-700 transition">
            <div
              className="absolute inset-0 bg-radial-gradient opacity-30"
              style={{ background: `radial-gradient(circle at center, ${accentColor}30, transparent 70%)` }}
            />
            <Package
              className="h-20 w-20 transition-transform duration-500 group-hover:scale-110"
              style={{ color: accentColor, filter: `drop-shadow(0 0 15px ${accentColor}80)` }}
            />
          </div>

          {/* Title & Blurb */}
          <div className="space-y-1">
            <h3 className="text-xl font-black text-white tracking-tight">{meta.name}</h3>
            <p className="text-xs text-gun-300 leading-relaxed min-h-[32px]">{meta.blurb}</p>
          </div>
        </div>

        {/* Pricing & Actions */}
        <div className="mt-6 pt-4 border-t border-gun-800 flex flex-col gap-3">
          <div className="flex items-baseline justify-between font-mono">
            <span className="text-xs text-gun-400">Price per roll:</span>
            <div className="flex items-baseline gap-2">
              {isFlashSale && (
                <span className="text-xs text-gun-500 line-through">
                  ${basePrice.toFixed(2)}
                </span>
              )}
              <span className="text-2xl font-black text-white">
                ${effectivePrice.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Inspect Button */}
            <button
              onClick={() => setInspectOpen(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-gun-700 bg-gun-800/80 py-3 text-xs font-semibold text-gun-300 hover:border-gun-600 hover:text-white transition"
              title="View Loot Table & Realtime Odds"
            >
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Odds</span>
            </button>

            {/* Open Button */}
            <button
              onClick={handleOpen}
              className={`col-span-2 flex items-center justify-center gap-2 rounded-xl py-3 font-mono font-bold text-sm shadow-xl transition active:scale-95 ${
                hasFunds
                  ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-indigo-600/30 hover:brightness-110'
                  : 'bg-gun-800 text-gun-400 border border-gun-700 cursor-pointer hover:border-gun-600'
              }`}
            >
              <Sparkles className="h-4 w-4" />
              <span>{hasFunds ? `Open Box ($${effectivePrice})` : `Add $${effectivePrice}`}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Box Odds Inspection Modal */}
      <BoxOddsModal
        isOpen={inspectOpen}
        onClose={() => setInspectOpen(false)}
        odds={odds}
        meta={meta}
      />

      {/* Reel Spinner Modal */}
      {spinning && activeWinner && (
        <CaseReel
          winner={activeWinner}
          tierName={meta.name}
          onFinished={() => {}}
          onSpinAgain={() => {
            setActiveWinner(null);
            setSpinning(false);
            setTimeout(() => handleOpen(), 100);
          }}
          onClose={() => {
            setActiveWinner(null);
            setSpinning(false);
          }}
        />
      )}
    </>
  );
}
