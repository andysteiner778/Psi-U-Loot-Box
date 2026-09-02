'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useAnimation } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Sparkles, ArrowDown, ArrowUp, RefreshCw, X, Gift, ShieldAlert } from 'lucide-react';
import type { OpenBoxResult, Rarity } from '@/lib/types';
import { RARITY_COLOR, isJackpot, isScrappable } from '@/lib/types';
import {
  buildReel,
  cardFromResult,
  nearMissCueMs,
  offsetForIndex,
  tickFractions,
  tickTimes,
  travelDistance,
  REEL_DURATION_MS,
  REEL_EASE,
  WINNER_INDEX,
  type ReelCard,
  type ReelGeometry,
} from '@/lib/reel';
import { sfx } from '@/lib/sound';

export interface CaseReelProps {
  winner: OpenBoxResult;
  decoys?: ReelCard[];
  tierName?: string;
  onFinished?: (result: OpenBoxResult) => void;
  onSpinAgain?: () => void;
  onClose?: () => void;
}

const CARD_WIDTH = 180; // px
const CARD_GAP = 12; // px
const PITCH = CARD_WIDTH + CARD_GAP; // 192px

export function CaseReel({
  winner,
  decoys = [],
  tierName = 'Mystery Box',
  onFinished,
  onSpinAgain,
  onClose,
}: CaseReelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controls = useAnimation();
  const [spinning, setSpinning] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [geometry, setGeometry] = useState<ReelGeometry>({
    pitch: PITCH,
    cardWidth: CARD_WIDTH,
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 800,
  });

  // Build the 60-card strip with card 49 bait and card 50 winner
  const cards = useMemo(() => buildReel(winner, decoys), [winner, decoys]);

  // Measure container viewport width
  useLayoutEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setGeometry({
        pitch: PITCH,
        cardWidth: CARD_WIDTH,
        viewportWidth: rect.width || window.innerWidth,
      });
    }
  }, []);

  // Run the deceleration animation & audio
  useEffect(() => {
    let cancelTicks: (() => void) | null = null;
    let nearMissTimer: NodeJS.Timeout | null = null;
    let finishTimer: NodeJS.Timeout | null = null;

    const startSpin = async () => {
      // Auto-unlock WebAudio on spin start
      await sfx.unlock();
      sfx.playReelStart();

      // Compute geometry & travel target
      const g = geometry;
      const targetOffset = offsetForIndex(WINNER_INDEX, g);

      // Schedule tick train based on distance fractions inverted through bezier
      const fractions = tickFractions(g, WINNER_INDEX);
      const times = tickTimes(REEL_DURATION_MS, fractions, REEL_EASE);
      cancelTicks = sfx.scheduleTicks(times);

      // Cue near miss sound
      const cueTime = nearMissCueMs(REEL_DURATION_MS, g, REEL_EASE);
      nearMissTimer = setTimeout(() => {
        sfx.playNearMissWhoosh();
      }, Math.max(0, cueTime));

      // Animate track translation using Framer Motion
      controls.start({
        x: targetOffset,
        transition: {
          duration: REEL_DURATION_MS / 1000,
          ease: REEL_EASE,
        },
      });

      // Handle finish
      finishTimer = setTimeout(() => {
        setSpinning(false);
        setRevealed(true);

        // Sound effect based on result
        if (isJackpot(winner)) {
          sfx.playGoldFanfare();
          try {
            confetti({
              particleCount: 80,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#eab308', '#ec4899', '#3b82f6', '#10b981'],
            });
          } catch {
            /* ignore canvas-confetti issues */
          }
        } else if (winner.type === 'scrap') {
          sfx.playScrapCrunch();
        }

        if (onFinished) {
          onFinished(winner);
        }
      }, REEL_DURATION_MS + 200);
    };

    startSpin();

    return () => {
      if (cancelTicks) cancelTicks();
      if (nearMissTimer) clearTimeout(nearMissTimer);
      if (finishTimer) clearTimeout(finishTimer);
    };
  }, [winner, geometry, controls, onFinished]);

  const winnerCard = cardFromResult(winner);
  const winColor = RARITY_COLOR[winner.rarity] || '#3b82f6';

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
      {/* Background radial glow */}
      <div
        className="pointer-events-none absolute h-[500px] w-[500px] rounded-full opacity-20 blur-3xl transition-colors duration-1000"
        style={{ backgroundColor: winColor }}
      />

      {/* Header bar */}
      <div className="relative z-10 mb-6 flex w-full max-w-4xl items-center justify-between px-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-gun-400">Opening</span>
          <h2 className="text-xl font-bold text-white tracking-wide">{tierName}</h2>
        </div>

        {onClose && !spinning && (
          <button
            onClick={onClose}
            className="rounded-full bg-gun-800 p-2 text-gun-300 transition hover:bg-gun-700 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Reel Viewport Window */}
      <div
        ref={containerRef}
        className="relative w-full max-w-5xl overflow-hidden rounded-2xl border-2 border-gun-700 bg-gun-950/90 shadow-2xl py-8 my-2"
        style={{
          boxShadow: `0 0 35px -5px ${spinning ? 'rgba(59, 130, 246, 0.3)' : `${winColor}50`}`,
        }}
      >
        {/* Center Target Indicators (Top & Bottom Pointers) */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-30 -translate-x-1/2 flex flex-col justify-between items-center w-8">
          <div className="flex flex-col items-center">
            <ArrowDown className="h-6 w-6 text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.8)] fill-yellow-400 animate-bounce" />
            <div className="h-4 w-0.5 bg-yellow-400 shadow-[0_0_8px_#eab308]" />
          </div>
          <div className="h-full w-0.5 bg-yellow-400/40 shadow-[0_0_12px_#eab308]" />
          <div className="flex flex-col items-center">
            <div className="h-4 w-0.5 bg-yellow-400 shadow-[0_0_8px_#eab308]" />
            <ArrowUp className="h-6 w-6 text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.8)] fill-yellow-400 animate-bounce" />
          </div>
        </div>

        {/* Edge Vignettes */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-32 bg-gradient-to-r from-gun-950 via-gun-950/80 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-32 bg-gradient-to-l from-gun-950 via-gun-950/80 to-transparent" />

        {/* Moving Track */}
        <motion.div
          animate={controls}
          initial={{ x: 0 }}
          className="flex items-center gap-3 pl-0 select-none will-change-transform"
          style={{ width: 'max-content' }}
        >
          {cards.map((card, idx) => {
            const cardColor = RARITY_COLOR[card.rarity] || '#4b5563';
            const isTarget = idx === WINNER_INDEX;

            return (
              <div
                key={card.id}
                data-rarity={card.rarity}
                className={`relative flex flex-col justify-between rounded-xl border bg-gun-900/95 p-3 transition-transform ${
                  isTarget && revealed ? 'scale-105 rarity-border' : 'border-gun-800'
                }`}
                style={{
                  width: `${CARD_WIDTH}px`,
                  height: '220px',
                  boxShadow:
                    isTarget && revealed
                      ? `0 0 25px ${cardColor}`
                      : card.isNearMiss
                        ? '0 0 15px rgba(236, 72, 153, 0.4)'
                        : undefined,
                }}
              >
                {/* Rarity Tag */}
                <div className="flex items-center justify-between text-[10px] font-mono font-bold">
                  <span
                    className="rounded px-1.5 py-0.5 text-white uppercase tracking-wider"
                    style={{ backgroundColor: cardColor }}
                  >
                    {card.rarity}
                  </span>
                  {card.isNearMiss && (
                    <span className="text-[10px] text-pink-400 animate-pulse font-bold">BAIT</span>
                  )}
                </div>

                {/* Card Graphic */}
                <div className="my-auto flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-gun-950/80 p-2">
                  {card.image_url ? (
                    <img
                      src={card.image_url}
                      alt={card.name}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Gift className="h-10 w-10 text-gun-500" style={{ color: cardColor }} />
                  )}
                </div>

                {/* Card Title */}
                <div className="text-center">
                  <p className="truncate text-xs font-bold text-white">{card.name}</p>
                </div>

                {/* Bottom colored bar */}
                <div
                  className="mt-2 h-1 w-full rounded-full"
                  style={{ backgroundColor: cardColor }}
                />
              </div>
            );
          })}
        </motion.div>
      </div>

      {/* Result Card Modal Dialog on Finish */}
      {revealed && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="relative z-40 mt-6 flex flex-col items-center w-full max-w-md rounded-2xl border-2 bg-gun-900 p-6 shadow-2xl text-center"
          style={{ borderColor: winColor, boxShadow: `0 0 40px -5px ${winColor}80` }}
        >
          <div
            className="mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider text-white"
            style={{ backgroundColor: winColor }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {winner.type === 'shard'
                ? 'PC Core Shard'
                : winner.type === 'respin'
                  ? 'Free Re-Roll'
                  : winner.type === 'scrap'
                    ? 'Consolation Scrap'
                    : `${winner.rarity} Item Unlocked`}
            </span>
          </div>

          <h3 className="text-2xl font-black text-white mt-1">{winner.item_name}</h3>

          {/* Outcome specific details */}
          {winner.type === 'physical' && (
            <div className="my-4 flex flex-col items-center gap-1 text-sm font-mono">
              <span className="text-emerald-400 font-bold text-lg">
                Est. Value: ${winner.est_value.toFixed(2)}
              </span>
              {isScrappable(winner.rarity) ? (
                <span className="text-cyan-400">Can be scrapped for +{winner.scrap_value} coins</span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1 font-semibold">
                  <ShieldAlert className="h-4 w-4" /> Physical Pickup Only (Room 4)
                </span>
              )}
            </div>
          )}

          {winner.type === 'shard' && (
            <div className="my-4 flex flex-col items-center gap-2">
              <span className="text-sm font-mono text-yellow-300">
                Progress: {winner.current_shards} / {winner.shards_required} shards collected!
              </span>
              <div className="flex gap-1.5">
                {Array.from({ length: winner.shards_required }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-4 w-6 rounded border ${
                      i < winner.current_shards
                        ? 'bg-yellow-400 border-yellow-300 shadow-[0_0_8px_#eab308]'
                        : 'bg-gun-800 border-gun-700'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {winner.type === 'respin' && (
            <p className="my-4 text-sm font-mono text-blue-300">
              ${winner.refund_amount.toFixed(2)} refunded to your balance. Roll again!
            </p>
          )}

          {winner.type === 'scrap' && (
            <p className="my-4 text-sm font-mono text-gun-300">
              +{winner.scrap_gained} scrap coins added to your bag. Compact 100 into a Tier 2 key!
            </p>
          )}

          {/* Action buttons */}
          <div className="mt-4 flex w-full gap-3">
            {onSpinAgain && (
              <button
                onClick={onSpinAgain}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 font-bold text-white shadow-lg transition hover:brightness-110 active:scale-95"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Spin Again</span>
              </button>
            )}

            {onClose && (
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-gun-600 bg-gun-800 px-4 py-3 font-semibold text-gun-200 transition hover:bg-gun-700 hover:text-white"
              >
                Done
              </button>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
