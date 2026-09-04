'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Eye, Zap, Flame, Lock, PackageOpen, Ticket } from 'lucide-react';
import { CaseArt } from './CaseArt';
import type { BoxTier, OpenBoxResult } from '@/lib/types';
import { RARITY_COLOR } from '@/lib/types';
import { BOX_META, money, type PlayerBoxOdds } from '@/app/(player)/_lib/shared';
import { usePlayer } from '@/app/(player)/_lib/player-store';
import { apiOdds, apiOpenBox, newRollId } from '@/app/(player)/_lib/api';
import { sfx } from '@/lib/sound';
import { supabase, TICKER_TOPIC } from '@/lib/supabase/browser';
import { CaseReel } from '@/components/CaseReel';
import { BoxOddsModal } from '@/components/BoxOddsModal';
import { DepositModal } from '@/components/DepositModal';

export interface BoxCardProps {
  odds: PlayerBoxOdds;
  isFlashSale?: boolean;
  /** The "was" price for this tier, struck through on the card. */
  listPrice?: number;
  /** Live config: may purple/pink/gold be turned into coins? */
  allowHighRarityScrap?: boolean;
  compactCoins?: number;
  compactUsd?: number;
  /** Best unredeemed voucher this player holds for THIS tier, 0.5 = half off. */
  voucherPct?: number;
}

export function BoxCard({ odds: initialOdds, isFlashSale = false, allowHighRarityScrap = false, compactCoins, compactUsd, listPrice, voucherPct }: BoxCardProps) {
  /**
   * Odds are server-rendered once at page load. Stock changes on every roll --
   * yours and everyone else's -- so without refreshing them the card kept
   * offering an item that had already been won, and the reel kept scrolling it
   * past. Refetch after each spin, and poll while the tab is visible so another
   * player's win shows up here too.
   */
  const [odds, setOdds] = useState<PlayerBoxOdds>(initialOdds);

  /**
   * Refreshing odds mid-spin re-renders this card, and a re-render of the card
   * is a re-render of the open <CaseReel>. That used to abort the spin outright
   * (see the comment on the spin effect in CaseReel). CaseReel is now immune to
   * it, but there is still no reason to swap the reel's decoy strip out from
   * under a spin that is already running, so hold refreshes until it closes and
   * take one on the way out.
   */
  const spinningRef = useRef(false);
  const refreshPendingRef = useRef(false);

  const refreshOdds = useCallback(async () => {
    if (spinningRef.current) {
      refreshPendingRef.current = true;
      return;
    }
    const res = await apiOdds(initialOdds.tier);
    if (res.ok) setOdds(res.value.data);
  }, [initialOdds.tier]);

  const handleOpenRef = useRef<(() => Promise<void>) | null>(null);

  const endSpin = useCallback(() => {
    spinningRef.current = false;
    setActiveWinner(null);
    setSpinning(false);
    refreshPendingRef.current = false;
    void refreshOdds();
  }, [refreshOdds]);

  useEffect(() => {
    setOdds(initialOdds);
  }, [initialOdds]);

  useEffect(() => {
    // Only while the tab is actually on screen: thirty phones polling a
    // backgrounded page is wasted bandwidth on one wifi connection.
    const tick = () => {
      if (document.visibilityState === 'visible') void refreshOdds();
    };
    const id = setInterval(tick, 20000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refreshOdds]);

  // Realtime odds sync: whenever any player wins an item (broadcast on house_ticker),
  // immediately refresh this card's odds so stock decrements and probabilities
  // rebalance without waiting for the 20s polling loop.
  useEffect(() => {
    try {
      const channel = supabase
        .channel(`box_card_sync_${initialOdds.tier}`)
        .on('broadcast', { event: 'roll' }, () => {
          if (document.visibilityState === 'visible') {
            void refreshOdds();
          }
        })
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    } catch {
      /* fallback to interval polling */
    }
  }, [refreshOdds, initialOdds.tier]);

  const { stats, commit, adjust, toast } = usePlayer();
  const [inspectOpen, setInspectOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [opening, setOpening] = useState(false);
  const [activeWinner, setActiveWinner] = useState<OpenBoxResult | null>(null);

  const tier = odds.tier;
  const meta = BOX_META[tier] || { name: 'Mystery Box', blurb: '', accent: 'grey' };
  const accentColor = RARITY_COLOR[meta.accent] || '#3b82f6';
  /*
   * A held voucher is applied by open_box, from its own row. Mirrored here ONLY
   * so the card shows what the tap will actually cost -- and rounded the same
   * way the SQL rounds it, or the card would quote a price the server does not
   * charge.
   */
  const rawPrice = odds.box_price;
  const effectivePrice =
    voucherPct && voucherPct > 0
      ? Math.round(rawPrice * (1 - Math.min(1, voucherPct)) * 100) / 100
      : rawPrice;
  const basePrice = isFlashSale ? effectivePrice / 0.8 : effectivePrice;
  /*
   * The struck-through price. A flash sale is measured against the standing
   * price, so during a sale the "was" is the list price and the saving shown
   * is the two stacked together rather than just the sale.
   */
  const wasPrice = voucherPct
    ? rawPrice
    : listPrice && listPrice > effectivePrice
      ? listPrice
      : isFlashSale
        ? basePrice
        : null;
  const percentOff = wasPrice ? Math.round((1 - effectivePrice / wasPrice) * 100) : 0;
  const hasFunds = stats.balance >= effectivePrice;

  /**
   * The cards that scroll past on the reel.
   *
   * BoxCard never passed these, so CaseReel fell back to FALLBACK_DECOYS --
   * hardcoded placeholders. The wheel was showing invented items the house does
   * not own, next to a winner that was real. Built here from this tier's actual
   * pool (prizes plus the borrowed junk filler) so what scrolls past is what
   * you could genuinely have won.
   */
  const decoys = useMemo(
    () =>
      [...odds.items, ...odds.filler].map((i) => ({
        id: i.item_id,
        name: i.name,
        rarity: i.rarity,
        image_url: i.image_url ?? null,
      })),
    [odds.items, odds.filler]
  );

  // Once a tier's physical stock is gone the engine has nothing left to hand
  // over, so the whole payout budget flows to the ceiling anchor and the player
  // just gets refunded. That is a sane failure mode -- the house stops taking
  // money when it has nothing to sell -- but without saying so, a player sees
  // "Free Re-Roll" a dozen times in a row and concludes the app is broken.
  const unitsLeft = odds.items.reduce((a, i) => a + i.stock_qty, 0);
  const isCleanedOut = unitsLeft === 0 && odds.filler.length === 0;

  const handleSpinAgain = useCallback(() => {
    endSpin();
    setTimeout(() => void handleOpenRef.current?.(), 100);
  }, [endSpin]);

  const handleReelFinished = useCallback(() => {
    // The item that just landed has had its stock decremented server side.
    // Queue a refresh; it lands the moment the reel closes.
    refreshPendingRef.current = true;
  }, []);

  const handleOpen = async () => {
    if (opening || spinning) return;
    // Unlock iOS WebAudio synchronously during user gesture before async fetch
    void sfx.unlock();
    if (!hasFunds) {
      setDepositOpen(true);
      return;
    }

    setOpening(true);
    // Optimistic balance adjustment for instant UI tap feedback
    adjust({ balance: -effectivePrice });

    const clientRollId = newRollId();
    try {
      const res = await apiOpenBox(tier, clientRollId);
      if (res.ok) {
        commit(res.value.stats);
        spinningRef.current = true;
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
    } finally {
      setOpening(false);
    }
  };

  handleOpenRef.current = handleOpen;

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
        {voucherPct ? (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 py-2">
            <Ticket className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="font-mono text-[11px] font-bold text-emerald-300">
              Your {Math.round(voucherPct * 100)}% off voucher is on this box
            </span>
          </div>
        ) : null}

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

            <div
              title={odds.pot_gate_met ? 'Current shard drop probability' : 'Shard drops locked until house deposit pot threshold is met'}
              className={`flex items-center gap-1.5 font-mono text-xs font-bold px-2.5 py-1 rounded-xl border ${
                odds.pot_gate_met
                  ? 'text-yellow-400 bg-yellow-950/40 border-yellow-500/30'
                  : 'text-gun-400 bg-gun-950/60 border-gun-800'
              }`}
            >
              {odds.pot_gate_met ? (
                <>
                  <Zap className="h-3.5 w-3.5 fill-yellow-400" />
                  <span>{(odds.p_shard * 100).toFixed(1)}% Shard</span>
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5 text-gun-400" />
                  <span>Shard Locked</span>
                </>
              )}
            </div>
          </div>

          {/* Crate Visual Artwork */}
          <div className="relative my-6 flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl bg-gun-950/80 border border-gun-800 group-hover:border-gun-700 transition">
            <div
              className="absolute inset-0 bg-radial-gradient opacity-30"
              style={{ background: `radial-gradient(circle at center, ${accentColor}30, transparent 70%)` }}
            />
            <div className="transition-transform duration-500 group-hover:scale-110">
              <CaseArt tier={tier} color={accentColor} />
            </div>
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
              {wasPrice && (
                <>
                  <span className="text-xs text-gun-500 line-through">
                    ${wasPrice.toFixed(2)}
                  </span>
                  {percentOff > 0 && (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      -{percentOff}%
                    </span>
                  )}
                </>
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
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gun-700 bg-gun-800/80 py-3 text-xs font-semibold text-gun-300 hover:border-gun-600 hover:text-white transition"
              title="View Loot Table & Realtime Odds"
            >
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Odds</span>
            </button>

            {/* Open Button */}
            <button
              onClick={handleOpen}
              disabled={isCleanedOut || opening || spinning}
              title={isCleanedOut ? 'Every item in this tier has been won' : undefined}
              className={`col-span-2 flex min-h-[44px] items-center justify-center gap-2 rounded-xl py-3 font-mono font-bold text-sm shadow-xl transition active:scale-95 ${
                isCleanedOut
                  ? 'cursor-not-allowed border border-gun-700 bg-gun-850 text-gun-400 shadow-none active:scale-100'
                  : opening || spinning
                    ? 'cursor-wait border border-indigo-500/50 bg-indigo-950/60 text-indigo-300 shadow-none active:scale-100'
                    : hasFunds
                      ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-indigo-600/30 hover:brightness-110'
                      : 'bg-gun-800 text-gun-400 border border-gun-700 cursor-pointer hover:border-gun-600'
              }`}
            >
              {isCleanedOut ? (
                <>
                  <PackageOpen className="h-4 w-4" />
                  <span>Cleaned Out</span>
                </>
              ) : opening ? (
                <>
                  <Sparkles className="h-4 w-4 animate-spin" />
                  <span>Rolling…</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>{hasFunds ? `Open Box ($${effectivePrice})` : `Add $${effectivePrice}`}</span>
                </>
              )}
            </button>

            {isCleanedOut && (
              <p className="col-span-3 -mt-1 text-center text-[11px] leading-snug text-gun-400">
                Every item in this tier has been won. Spinning now would only
                refund you — try another tier.
              </p>
            )}
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

      {/* Deposit Modal on Insufficient Funds */}
      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
      />

      {/* Reel Spinner Modal */}
      {spinning && activeWinner && (
        <CaseReel
          allowHighRarityScrap={allowHighRarityScrap}
          compactCoins={compactCoins}
          compactUsd={compactUsd}
          decoys={decoys}
          winner={activeWinner}
          tierName={meta.name}
          // The item that just landed has had its stock decremented server
          // side. Pull fresh odds now so it stops appearing in this card and on
          // the next spin's reel.
          onFinished={handleReelFinished}
          onSpinAgain={handleSpinAgain}
          onClose={endSpin}
        />
      )}
    </>
  );
}
