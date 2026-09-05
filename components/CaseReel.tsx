'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useAnimation, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Sparkles, ArrowDown, ArrowUp, RefreshCw, X, Gift, ShieldAlert, Ticket, Package } from 'lucide-react';
import type { BoxTier, OpenBoxResult, Rarity } from '@/lib/types';
import type { DestinationTarget } from '@/app/(player)/_lib/shared';
import { RARITY_COLOR, RARITY_LABEL, canScrap, isJackpot } from '@/lib/types';
import {
  buildReel,
  cardFromResult,
  nearMissCueMs,
  offsetForIndex,
  randomLandingFraction,
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
  tier?: BoxTier;
  destinations?: Partial<Record<BoxTier, DestinationTarget>>;
  onFinished?: (result: OpenBoxResult) => void;
  onSpinAgain?: () => void;
  onClose?: () => void;
  /**
   * Live config: may purple/pink/gold be turned into coins? Defaults to false
   * so a caller that has not plumbed it through promises pickup rather than a
   * scrap the server would refuse.
   */
  allowHighRarityScrap?: boolean;
  /** Coins the compactor needs, and what it pays. Quoted on a scrap result. */
  compactCoins?: number;
  compactUsd?: number;
}

/** Player-facing names for the tiers a voucher can be locked to. */
const TIER_LABEL: Record<BoxTier, string> = {
  tier_0: 'Mostly Junk box',
  tier_1: 'Good Stuff box',
  tier_2: 'Golden Chest box',
  tier_3: 'High Roller box',
};

const CARD_WIDTH = 180; // px
const CARD_GAP = 12; // px
const PITCH = CARD_WIDTH + CARD_GAP; // 192px

/**
 * How big a celebration does this result deserve?
 *
 * Returns null for anything that should pass without ceremony. Kept beside the
 * sound ladder in lib/sound.ts deliberately: the two must escalate together, or
 * a tier ends up with a fanfare and no confetti (or the reverse), which reads
 * as a bug rather than as restraint.
 */
function celebrationFor(
  winner: OpenBoxResult
): { particleCount: number; spread: number; origin: { y: number }; colors: string[]; scalar?: number } | null {
  if (winner.type === 'shard') {
    return { particleCount: 150, spread: 100, origin: { y: 0.6 }, colors: ['#eab308', '#fde047', '#ffffff'] };
  }
  // A respin is a full refund plus another roll -- strictly better than most
  // Rare items. It carries rarity 'blue', so falling through to the switch gave
  // it the smallest burst in the game for one of the best outcomes in it.
  if (winner.type === 'respin') {
    return { particleCount: 90, spread: 85, origin: { y: 0.62 }, colors: ['#22d3ee', '#3b82f6', '#a5f3fc'] };
  }
  switch (winner.rarity) {
    case 'gold':
      return { particleCount: 230, spread: 125, origin: { y: 0.6 }, colors: ['#eab308', '#fde047', '#ffffff', '#f59e0b'], scalar: 1.2 };
    case 'pink':
      return { particleCount: 160, spread: 108, origin: { y: 0.6 }, colors: ['#ec4899', '#f9a8d4', '#eab308'] };
    case 'purple':
      return { particleCount: 110, spread: 90, origin: { y: 0.62 }, colors: ['#a855f7', '#c084fc', '#ffffff'] };
    case 'blue':
      return { particleCount: 60, spread: 70, origin: { y: 0.65 }, colors: ['#3b82f6', '#60a5fa', '#93c5fd'] };
    default:
      return null;
  }
}

export function CaseReel({
  winner,
  decoys = [],
  tierName = 'Mystery Box',
  tier,
  destinations,
  onFinished,
  onSpinAgain,
  onClose,
  allowHighRarityScrap = false,
  compactCoins = 500,
  compactUsd = 10,
}: CaseReelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controls = useAnimation();
  // A 5.5-second spinning carousel is exactly the kind of motion that triggers
  // vestibular symptoms. The rule in globals.css only kills CSS animation
  // durations -- this reel animates via framer-motion transforms in JS, so it
  // was unaffected. Skip to the result with a short fade instead.
  //
  // Sound is kept: it is motion-independent, and losing the fanfare on a gold
  // pull would take away the payoff rather than the discomfort. Only the tick
  // train goes, since it exists to narrate movement that no longer happens.
  const prefersReducedMotion = useReducedMotion();
  const [spinning, setSpinning] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [geometry, setGeometry] = useState<ReelGeometry>({
    pitch: PITCH,
    cardWidth: CARD_WIDTH,
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 800,
  });

  // Build the 60-card strip. The near-miss in slot 49 is probabilistic, so
  // some spins have no bait at all -- see NEAR_MISS_CHANCE in lib/reel.ts.
  const cards = useMemo(() => buildReel(winner, decoys), [winner, decoys]);
  const hasNearMiss = useMemo(() => cards.some((c) => c.isNearMiss), [cards]);

  // Measure container viewport width.
  // The spin waits on this: starting against the initial window-width guess
  // would land the strip at the wrong offset, so the winner would not stop
  // under the marker.
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setGeometry({
        pitch: PITCH,
        cardWidth: CARD_WIDTH,
        viewportWidth: rect.width || window.innerWidth,
      });
    }
    setMeasured(true);
  }, []);

  /**
   * One spin per result, ever -- and once started, IT MUST FINISH.
   *
   * The reveal used to be scheduled by an effect that listed `onFinished`,
   * `geometry`, `hasNearMiss` and `prefersReducedMotion` as dependencies, with
   * a cleanup that cancelled the tick train and the finish timer. `onFinished`
   * was an inline arrow in BoxCard, so ANY parent re-render re-ran this effect:
   * cleanup killed the audio and the pending reveal, then the `spunFor` latch
   * made the new run return early without rescheduling. The spin coasted to a
   * halt in silence, nothing was ever revealed, and `onFinished` never fired --
   * so the card never refreshed and the item still looked available.
   *
   * BoxCard re-renders constantly: a 20s poll, a visibilitychange, and a
   * Realtime subscription that fires on every roll by ANY player in the house.
   * On a busy night that is several re-renders per spin, which is why this kept
   * coming back and why it got worse as the app got more live.
   *
   * Two rules now keep it fixed:
   *
   *   1. The effect depends ONLY on what identifies the spin (`spinKey`,
   *      `measured`). Everything else is read through refs, so a parent
   *      re-render cannot re-run it.
   *   2. The timers live in refs and are cancelled ONLY on unmount. Even if
   *      something does re-run the effect, the pending reveal survives.
   *
   * If you add a dependency to this effect, you are re-introducing the bug.
   */
  const spunFor = useRef<string | null>(null);
  const finishedFor = useRef<string | null>(null);
  const cancelTicksRef = useRef<(() => void) | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const deadlineRef = useRef<number>(0);
  const nearMissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live values the spin reads without depending on them.
  const winnerRef = useRef(winner);
  const geometryRef = useRef(geometry);
  const onFinishedRef = useRef(onFinished);
  const hasNearMissRef = useRef(hasNearMiss);
  const reducedMotionRef = useRef(prefersReducedMotion);
  useEffect(() => {
    winnerRef.current = winner;
    geometryRef.current = geometry;
    onFinishedRef.current = onFinished;
    hasNearMissRef.current = hasNearMiss;
    reducedMotionRef.current = prefersReducedMotion;
  });

  // Cancel outstanding audio and timers on UNMOUNT ONLY. Never on a re-run:
  // that is what silently ate the reveal.
  useEffect(
    () => () => {
      cancelTicksRef.current?.();
      if (nearMissTimerRef.current) clearTimeout(nearMissTimerRef.current);
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    },
    []
  );

  const spinKey = winner?.roll_id ?? null;

  /**
   * Watchdog: if the deadline has passed and nothing has been revealed, reveal.
   *
   * This is the belt to the timer's braces. Every previous version of this bug
   * had a different proximate cause -- an effect re-run cancelling the timer, a
   * throttled background tab, a suspended AudioContext -- but all of them
   * present identically to the player: the reel stops, the sound dies, and the
   * item never opens. Rather than chase causes one at a time, guarantee the
   * outcome: poll cheaply while a spin is pending, and check on every return to
   * the foreground, which is exactly when a throttled timer is most overdue.
   */
  useEffect(() => {
    if (!spinKey) return;
    const tick = () => {
      if (!deadlineRef.current || finishedFor.current === spinKey) return;
      if (Date.now() >= deadlineRef.current) finishRef.current?.();
    };
    const id = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [spinKey]);

  // Run the deceleration animation & audio
  useEffect(() => {
    if (!measured || !spinKey || spunFor.current === spinKey) return;
    spunFor.current = spinKey;

    const startSpin = async () => {
      // Auto-unlock WebAudio on spin start
      await sfx.unlock();
      sfx.playReelStart();

      // Read through refs: these must not be effect dependencies.
      const g = geometryRef.current;
      const reduced = reducedMotionRef.current;

      // Where in the winning card the marker will come to rest. Drawn ONCE per
      // spin and reused by the travel target, the tick train and the near-miss
      // cue, so the sound stays glued to what the eye sees. See the comment on
      // randomLandingFraction: a near-miss lands just over the boundary, so the
      // strip looks like it stopped on the bait and then thought better of it.
      const landing = randomLandingFraction(hasNearMissRef.current);
      const targetOffset = offsetForIndex(WINNER_INDEX, g, landing);

      const durationMs = reduced ? 300 : REEL_DURATION_MS;

      if (!reduced) {
        // Schedule tick train based on distance fractions inverted through bezier
        const fractions = tickFractions(g, WINNER_INDEX, landing);
        const times = tickTimes(REEL_DURATION_MS, fractions, REEL_EASE);
        cancelTicksRef.current = sfx.scheduleTicks(times);

        // Only cue the whoosh when there is actually a near-miss card to
        // narrate. Playing it on a spin with no bait is a false tell: the
        // player hears the tension sting, sees an ordinary card, and learns
        // the sound means nothing.
        if (hasNearMissRef.current) {
          const cueTime = nearMissCueMs(REEL_DURATION_MS, g, REEL_EASE, landing);
          nearMissTimerRef.current = setTimeout(() => {
            sfx.playNearMissWhoosh();
          }, Math.max(0, cueTime));
        }
      }

      // Animate track translation using Framer Motion
      controls.start({
        x: targetOffset,
        transition: reduced
          ? { duration: durationMs / 1000, ease: 'easeOut' }
          : { duration: durationMs / 1000, ease: REEL_EASE },
      });

      // Handle finish.
      //
      // The reveal is deliberately NOT tied to this timer alone. setTimeout is
      // throttled to >=1s in a backgrounded tab and suspended outright on a
      // locked phone, so a player who glances at a notification mid-spin can
      // come back to a reel that stopped in silence and never opened. The same
      // function is therefore also reachable from a watchdog below, and is
      // idempotent so whichever gets there first wins.
      const finishNow = () => {
        // Idempotent: a duplicate schedule must never double-fire onFinished,
        // which would double-refresh and could double-toast.
        if (finishedFor.current === spinKey) return;
        finishedFor.current = spinKey;

        const won = winnerRef.current;
        setSpinning(false);
        setRevealed(true);

        // Sound effect based on result
        // Every result at Rare or above gets an escalating payoff sound, so the
        // large majority of rolls now land with SOMETHING. Common stays silent
        // on purpose: if everything chimes, nothing feels rare.
        sfx.playWinFor(won.rarity);

        // Celebration scales with rarity, matching the sound ladder.
        //
        // This used to fire only for isJackpot() -- shard, gold and pink -- so
        // Legendary purple items landed in total silence visually, despite
        // being the second-best thing in the game and worth $50-100. A tier that
        // gets its own sound but no confetti reads as broken, not as restrained.
        const burst = celebrationFor(won);
        if (burst) {
          try {
            confetti(burst);
            // The top tiers get a second volley from the sides a beat later, so
            // the moment lasts as long as the fanfare does.
            if (isJackpot(won)) {
              setTimeout(() => {
                try {
                  confetti({ ...burst, particleCount: Math.round(burst.particleCount * 0.6), angle: 60, origin: { x: 0, y: 0.7 } });
                  confetti({ ...burst, particleCount: Math.round(burst.particleCount * 0.6), angle: 120, origin: { x: 1, y: 0.7 } });
                } catch {
                  /* ignore */
                }
              }, 320);
            }
          } catch {
            /* ignore canvas-confetti issues */
          }
        }

        if (won.type === 'scrap') {
          sfx.playScrapCrunch();
        }

        onFinishedRef.current?.(won);
      };

      finishRef.current = finishNow;
      deadlineRef.current = Date.now() + durationMs + 200;
      finishTimerRef.current = setTimeout(finishNow, durationMs + 200);
    };

    startSpin();

    // NO cleanup here on purpose. Cancelling the tick train and the finish
    // timer on every re-run is exactly the bug this rewrite removes; unmount
    // cleanup is handled by the mount-only effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey, measured, controls]);

  const winnerCard = cardFromResult(winner);
  const winColor = RARITY_COLOR[winner.rarity] || '#3b82f6';

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
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
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-gun-800 p-2 text-gun-300 transition hover:bg-gun-700 hover:text-white"
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
                  // No special glow for the near-miss card. Giving it a shadow
                  // nothing else had marked it out visually, which told the
                  // player which card was the fake before it even arrived. Its
                  // rarity colour is the only signal it should carry.
                  boxShadow: isTarget && revealed ? `0 0 25px ${cardColor}` : undefined,
                }}
              >
                {/* Rarity Tag */}
                <div className="flex items-center justify-between text-[10px] font-mono font-bold">
                  <span
                    className="rounded px-1.5 py-0.5 text-white uppercase tracking-wider"
                    style={{ backgroundColor: cardColor }}
                  >
                    {RARITY_LABEL[card.rarity]}
                  </span>
                  {/* The near-miss card is deliberately NOT labelled. Marking it
                      announced the trick and killed the tension it exists to
                      create -- the whole effect depends on the player believing
                      that card might land. It still reads as a big pull because
                      of its rarity colour, which is the honest tell. */}
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
                  ? // Reward items ride on the respin payload (migration 0028),
                    // so a "50% OFF a $40 box" would otherwise be badged as a
                    // free re-roll. The token has a fixed name; anything else
                    // is a bonus.
                    winner.item_name === 'Free Re-Roll Token'
                    ? 'Free Re-Roll'
                    : winner.voucher_pct
                      ? 'Voucher Won'
                      : 'Bonus Reward'
                  : winner.type === 'scrap'
                    ? 'Consolation Scrap'
                    : `${RARITY_LABEL[winner.rarity]} Item Unlocked`}
            </span>
          </div>

          {/* The prize itself, large. The reveal previously showed only a name
              and a price -- the photo the admin took never appeared at the
              moment it mattered most. */}
          <div
            className="relative mt-3 flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl border-2 bg-gun-950/80 sm:h-48 sm:w-48"
            style={{ borderColor: winColor, boxShadow: `inset 0 0 40px -10px ${winColor}` }}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{ background: `radial-gradient(circle at center, ${winColor}55, transparent 70%)` }}
            />
            {winner.type === 'physical' && winner.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={winner.image_url}
                alt={winner.item_name}
                className="relative h-full w-full object-contain p-2"
              />
            ) : winner.type === 'shard' ? (
              <Sparkles className="relative h-20 w-20" style={{ color: winColor }} />
            ) : winner.type === 'respin' ? (
              <RefreshCw className="relative h-20 w-20" style={{ color: winColor }} />
            ) : (
              <Gift className="relative h-20 w-20" style={{ color: winColor }} />
            )}
          </div>

          <h3 className="mt-3 text-2xl font-black text-white sm:text-3xl">{winner.item_name}</h3>

          {/* Outcome specific details */}
          {winner.type === 'physical' && (
            <div className="my-4 flex flex-col items-center gap-1 text-sm font-mono">
              <span className="text-emerald-400 font-bold text-lg">
                {winner.msrp && winner.msrp > 0
                  ? `Retail: $${Number(winner.msrp).toFixed(2)}`
                  : `Est. Value: $${winner.est_value.toFixed(2)}`}
              </span>
              {canScrap(winner.rarity, winner.scrap_value, allowHighRarityScrap) ? (
                <span className="text-cyan-400">Can be scrapped for +{winner.scrap_value} coins</span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1 font-semibold">
                  <ShieldAlert className="h-4 w-4" /> Pickup from Andy in Japan
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
            <div className="my-4 w-full text-center">
              {winner.voucher_pct ? (
                (() => {
                  const targetTier = winner.voucher_tier ?? 'tier_3';
                  const target = destinations?.[targetTier];
                  const targetName = target?.boxName ?? TIER_LABEL[targetTier];
                  const targetPrice = target?.boxPrice ?? 10;
                  const discountedPrice = Math.max(
                    0,
                    Math.round(targetPrice * (1 - Math.min(1, winner.voucher_pct)) * 100) / 100
                  );
                  const topPrize = target?.topItem;

                  return (
                    <div className="rounded-2xl border-2 border-cyan-500/50 bg-gradient-to-b from-cyan-950/70 to-gun-950 p-4 text-left shadow-xl shadow-cyan-950/40 space-y-3 animate-in fade-in">
                      <div className="flex items-center justify-between gap-2 border-b border-cyan-800/40 pb-2.5">
                        <div className="flex items-center gap-2">
                          <Ticket className="h-5 w-5 text-cyan-400 shrink-0" />
                          <div>
                            <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 block font-bold">
                              Ladder Tier Unlocked
                            </span>
                            <h4 className="text-base font-black text-white">{targetName}</h4>
                          </div>
                        </div>
                        <span className="rounded-lg bg-cyan-400 px-2.5 py-1 font-mono text-xs font-black text-black uppercase shrink-0">
                          {winner.voucher_pct >= 1 ? 'FREE SPIN' : `${Math.round(winner.voucher_pct * 100)}% OFF`}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between text-xs font-mono">
                        <span className="text-gun-400">Target Box Price:</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-gun-500 line-through">${targetPrice.toFixed(2)}</span>
                          <span className="text-sm font-bold text-emerald-400">
                            {discountedPrice === 0 ? 'FREE' : `$${discountedPrice.toFixed(2)}`}
                          </span>
                        </div>
                      </div>

                      {topPrize && (
                        <div className="flex items-center gap-3 rounded-xl bg-gun-900/80 p-2.5 border border-gun-750">
                          <div className="h-12 w-12 shrink-0 rounded-lg bg-gun-950 border border-gun-800 flex items-center justify-center overflow-hidden">
                            {topPrize.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={topPrize.image_url} alt={topPrize.name} className="h-full w-full object-contain p-1" />
                            ) : (
                              <Package className="h-6 w-6 text-gun-400" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-[9px] font-mono text-gun-400 uppercase tracking-wide block">
                              Best Prize In Target Box:
                            </span>
                            <span className="font-bold text-xs text-white truncate block">{topPrize.name}</span>
                            <span className="font-mono text-[11px] font-semibold text-emerald-400">
                              Est. Value ${topPrize.value.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          onClose?.();
                          const el = document.getElementById(`box-${targetTier}`);
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 py-3 font-mono text-xs font-bold text-white shadow-lg hover:brightness-110 active:scale-95 transition"
                      >
                        <Ticket className="h-4 w-4" />
                        <span>Go to {targetName} ({winner.voucher_pct >= 1 ? 'Free' : `${Math.round(winner.voucher_pct * 100)}% Off`}) ↗</span>
                      </button>
                    </div>
                  );
                })()
              ) : (
                <p className="text-sm font-mono text-blue-300">
                  {winner.item_name === 'Free Re-Roll Token'
                    ? `$${winner.refund_amount.toFixed(2)} refunded to your balance. Roll again!`
                    : `$${winner.refund_amount.toFixed(2)} added to your balance — spend it on anything.`}
                </p>
              )}
            </div>
          )}

          {/* A BUNDLED VOUCHER rides along with a physical win. It has already
              been issued server-side by the time this renders, so this is a
              receipt rather than an offer -- and without it the player would
              never learn they had it until the discount silently appeared on
              their next box. */}
          {winner.type === 'physical' && winner.bonus_pct ? (
            (() => {
              const bonusTier = winner.bonus_tier ?? 'tier_0';
              const target = destinations?.[bonusTier];
              const targetName = target?.boxName ?? TIER_LABEL[bonusTier];
              return (
                <div className="my-3 rounded-2xl border border-cyan-500/50 bg-cyan-950/40 p-3.5 text-left space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gift className="h-4 w-4 text-cyan-300 shrink-0" />
                      <span className="font-bold text-xs font-mono text-cyan-200 uppercase">
                        Bundled Bonus Spin!
                      </span>
                    </div>
                    <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 uppercase">
                      {winner.bonus_pct >= 1 ? 'Free Spin' : `${Math.round(winner.bonus_pct * 100)}% Off`}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-cyan-100/90">
                    You also won a {winner.bonus_pct >= 1 ? 'Free Spin' : `${Math.round(winner.bonus_pct * 100)}% off`} for the <span className="font-bold text-white">{targetName}</span> — loaded into your account right now.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      const el = document.getElementById(`box-${bonusTier}`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-900/60 py-2 font-mono text-xs font-bold text-cyan-200 hover:bg-cyan-800 transition"
                  >
                    <span>Jump to {targetName} ↗</span>
                  </button>
                </div>
              );
            })()
          ) : null}

          {winner.type === 'scrap' && (
            <div className="my-4 w-full space-y-2">
              {winner.credit_gained && winner.credit_gained > 0 ? (
                <div className="rounded-2xl border border-emerald-500/50 bg-gradient-to-b from-emerald-950/60 to-gun-950 p-4 text-center space-y-1">
                  <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 block font-bold">
                    Consolation Cash Back
                  </span>
                  <span className="text-2xl font-black text-white font-mono block">
                    +${winner.credit_gained.toFixed(2)} Instant Credit
                  </span>
                  <span className="text-xs font-mono text-emerald-200/90 block leading-relaxed max-w-sm mx-auto">
                    {tier === 'tier_0' || winner.credit_gained >= 0.10
                      ? 'That’s 20% of your roll straight back in your balance — bank it or take another spin!'
                      : 'Credited directly to your wallet — spend it on any box!'}
                  </span>
                </div>
              ) : (
                <p className="text-sm font-mono text-gun-300">
                  +{winner.scrap_gained} scrap coins added to your bag. Compact {compactCoins} into ${compactUsd} credit!
                </p>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-4 flex w-full gap-3">
            {onSpinAgain && (
              <button
                onClick={onSpinAgain}
                className="flex-1 flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 font-bold text-white shadow-lg transition hover:brightness-110 active:scale-95"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Spin Again</span>
              </button>
            )}

            {onClose && (
              <button
                onClick={onClose}
                className="flex-1 flex min-h-[44px] items-center justify-center rounded-xl border border-gun-600 bg-gun-800 px-4 py-3 font-semibold text-gun-200 transition hover:bg-gun-700 hover:text-white"
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
