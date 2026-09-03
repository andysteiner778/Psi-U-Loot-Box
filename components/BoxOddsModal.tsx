'use client';

import React from 'react';
import { X, ShieldAlert, Zap, RefreshCw, Skull, Sparkles, Package, Lock } from 'lucide-react';
import { RARITY_COLOR, RARITY_LABEL, type Rarity } from '@/lib/types';
import type { PlayerBoxOdds } from '@/app/(player)/_lib/shared';

export interface BoxOddsModalProps {
  isOpen: boolean;
  onClose: () => void;
  odds: PlayerBoxOdds;
  meta: { name: string; blurb: string; accent: string };
}

export function BoxOddsModal({ isOpen, onClose, odds, meta }: BoxOddsModalProps) {
  /*
   * ABOVE the early return, and it must stay there. A hook placed after
   * `if (!isOpen) return null` runs on some renders and not others, so React
   * sees the hook count change the moment the modal opens and throws
   * "change in the order of Hooks". Guard the BODY on isOpen, never the hook.
   */
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const pct = (p: number) => {
    const v = (Number.isFinite(p) ? p : 0) * 100;
    if (!(v > 0)) return '0%';
    if (v < 0.1) return '<0.1%';
    return `${v < 10 ? v.toFixed(2) : v.toFixed(1)}%`;
  };

  /**
   * Chance of each rarity BAND, which is the question people actually ask.
   *
   * The junk was never missing from the table -- it is filler, and in the $50
   * box that is 32 grey rows at ~0.6% each, sorted below ten headline prizes.
   * Reading "how often do I get junk here?" off that meant scrolling a
   * 59-row table and adding up by eye, so it looked like the greys were simply
   * not listed. One line at the top answers it instead.
   */
  const RARITY_ORDER: Rarity[] = ['grey', 'blue', 'purple', 'pink', 'gold'];
  const allDrops = [...odds.items, ...odds.filler];
  const rarityTotals = RARITY_ORDER.map((rarity) => ({
    rarity,
    p: allDrops.filter((i) => i.rarity === rarity).reduce((a, i) => a + i.probability, 0),
    n: allDrops.filter((i) => i.rarity === rarity && i.probability > 0).length,
  })).filter((x) => x.p > 0);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-in fade-in"
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-3xl border border-gun-700 bg-gun-900 shadow-2xl flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gun-800 p-5 bg-gun-950/60">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-gun-400">
              Live Odds & Loot Table
            </span>
            <h2 className="text-xl font-bold text-white">{meta.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-gun-800 p-2 text-gun-400 hover:bg-gun-700 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="overflow-y-auto p-5 space-y-5">
          {/* Summary Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
            <div className="rounded-xl bg-gun-950 p-3 border border-gun-800">
              <span className="text-gun-400 block text-[10px]">Box Cost</span>
              <span className="text-white font-bold text-sm">${odds.box_price.toFixed(2)}</span>
            </div>
            <div className="rounded-xl bg-gun-950 p-3 border border-gun-800">
              <span className="text-gun-400 block text-[10px]">Expected Payout</span>
              <span className="text-emerald-400 font-bold text-sm">
                ${odds.total_ev.toFixed(2)} ({(100 - odds.realized_margin * 100).toFixed(0)}%)
              </span>
            </div>
            <div className={`rounded-xl p-3 border ${odds.pot_gate_met ? 'bg-yellow-950/30 border-yellow-500/20' : 'bg-gun-950 border-gun-800'}`}>
              <span className={`block text-[10px] ${odds.pot_gate_met ? 'text-yellow-400' : 'text-gun-400'}`}>PC Shard Drop</span>
              <span className={`font-bold text-sm ${odds.pot_gate_met ? 'text-yellow-300' : 'text-gun-400'}`}>
                {odds.pot_gate_met ? pct(odds.p_shard) : 'Locked (Gate)'}
              </span>
            </div>
            <div className="rounded-xl bg-cyan-950/30 p-3 border border-cyan-500/20">
              <span className="text-cyan-400 block text-[10px]">
                {odds.floor_kind === 'item' ? 'Floor Prize' : 'Scrap Consolation'}
              </span>
              <span className="text-cyan-300 font-bold text-sm">
                {odds.floor_kind === 'item'
                  ? `House Item (~$${odds.floor_value.toFixed(2)})`
                  : `+${odds.scrap_coins_awarded} coins`}
              </span>
            </div>
          </div>

          {/* Dynamic Anchors Section */}
          <div className="space-y-2">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-gun-300">
              Virtual Dynamic Anchors
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
              {/* Shard Anchor */}
              <div className={`flex items-center justify-between rounded-xl border p-3 ${
                odds.pot_gate_met
                  ? 'bg-yellow-950/20 border-yellow-500/30'
                  : 'bg-gun-950/40 border-gun-800'
              }`}>
                <div className="flex items-center gap-2">
                  {odds.pot_gate_met ? (
                    <Zap className="h-4 w-4 text-yellow-400" />
                  ) : (
                    <Lock className="h-4 w-4 text-gun-400" />
                  )}
                  <span className={odds.pot_gate_met ? 'text-yellow-200' : 'text-gun-400'}>
                    PC Core Shard
                  </span>
                </div>
                <span className={`font-bold ${odds.pot_gate_met ? 'text-yellow-400' : 'text-gun-400'}`}>
                  {odds.pot_gate_met ? pct(odds.p_shard) : '0% (Gate Shut)'}
                </span>
              </div>

              {/* Free Respin Anchor */}
              <div className="flex items-center justify-between rounded-xl bg-blue-950/20 border border-blue-500/30 p-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-blue-400" />
                  <span className="text-blue-200">Free Re-Roll</span>
                </div>
                <span className="font-bold text-blue-400">{pct(odds.p_respin)}</span>
              </div>

              {/* Floor Anchor */}
              <div className="flex items-center justify-between rounded-xl bg-gun-950 border border-gun-800 p-3">
                <div className="flex items-center gap-2">
                  {odds.floor_kind === 'item' ? (
                    <>
                      <Package className="h-4 w-4 text-cyan-400" />
                      <span className="text-gun-200">Floor Junk Item</span>
                    </>
                  ) : (
                    <>
                      <Skull className="h-4 w-4 text-gun-400" />
                      <span className="text-gun-300">Scrap Coins</span>
                    </>
                  )}
                </div>
                <span className="font-bold text-gun-400">{pct(odds.p_scrap)}</span>
              </div>
            </div>
            {!odds.pot_gate_met && (
              <div className="flex items-center gap-2 rounded-xl bg-gun-950/70 border border-amber-500/20 p-2.5 text-[11px] font-mono text-gun-400">
                <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span>PC Shard drops are locked at 0% across all boxes until approved house deposits cross the pot threshold (${odds.pot_total.toFixed(0)} deposited so far).</span>
              </div>
            )}
          </div>

          {/* Physical Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-gun-300">
                Physical Loot Pool ({allDrops.filter((i) => i.probability > 0).length} prizes)
              </h3>
              <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                Total Physical Chance: {pct(odds.p_physical + (odds.floor_kind === 'item' ? odds.p_scrap : 0))}
              </span>
            </div>

            {/* Chance by rarity band -- the headline the table cannot give. */}
            {rarityTotals.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rarityTotals.map(({ rarity, p, n }) => (
                  <div
                    key={rarity}
                    title={n + (n === 1 ? ' item' : ' items') + ' at this rarity'}
                    className="flex items-center gap-1.5 rounded-lg border bg-gun-950 px-2 py-1"
                    style={{ borderColor: (RARITY_COLOR[rarity] || '#4b5563') + '66' }}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: RARITY_COLOR[rarity] }}
                    />
                    <span className="font-mono text-[10px] uppercase tracking-wide text-gun-300">
                      {RARITY_LABEL[rarity]}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-white">{pct(p)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-gun-800 overflow-x-auto bg-gun-950/50">
              {/* Five columns do not fit a phone. overflow-hidden CLIPPED the
                  Chance column -- the single number this table exists for. */}
              <table className="w-full min-w-[440px] text-left text-xs font-mono">
                <thead className="bg-gun-950 text-gun-400 border-b border-gun-800">
                  <tr>
                    <th className="py-2.5 px-3">Item Name</th>
                    <th className="py-2.5 px-3">Rarity</th>
                    <th className="py-2.5 px-3 text-right">Est. Value</th>
                    <th className="py-2.5 px-3 text-right">Stock</th>
                    <th className="py-2.5 px-3 text-right">Chance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gun-850">
                  {/*
                    Every outcome, not just the tier's own prizes.
                    The junk items that back the consolation slot were invisible
                    here, so the published odds did not add up to 100% and a
                    player could not see what the common result actually was.
                    Filler probabilities are already conditional on the floor
                    branch being drawn, so they are directly comparable.
                  */}
                  {[...odds.items, ...odds.filler]
                    .filter((i) => i.probability > 0)
                    .sort((a, b) => b.probability - a.probability)
                    .map((item) => {
                    const rColor = RARITY_COLOR[item.rarity] || '#fff';
                    const rLabel = RARITY_LABEL[item.rarity] || item.rarity;

                    return (
                      <tr key={item.item_id} className="hover:bg-gun-900/50 transition">
                        <td className="py-2.5 px-3 font-sans font-semibold text-white truncate max-w-[180px]">
                          {item.name}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] uppercase font-bold text-white shadow-sm"
                            style={{ backgroundColor: rColor }}
                          >
                            {rLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                          {item.msrp && item.msrp > 0
                            ? `$${Number(item.msrp).toFixed(2)}`
                            : `$${item.est_value.toFixed(2)}`}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gun-300">
                          {item.stock_qty > 0 ? (
                            <span>{item.stock_qty}</span>
                          ) : (
                            <span className="text-red-400">0</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-white">
                          {pct(item.probability)}
                        </td>
                      </tr>
                    );
                  })}

                  {/* The non-item outcomes, so the column genuinely sums to 100%. */}
                  {odds.p_shard > 0 ? (
                    <tr className="bg-yellow-950/20">
                      <td className="py-2.5 px-3 font-sans font-semibold text-yellow-200">
                        PC Core Shard
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white shadow-sm"
                          style={{ backgroundColor: RARITY_COLOR.gold }}
                        >
                          Exotic
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-yellow-300">toward the PC</td>
                      <td className="py-2.5 px-3 text-right text-gun-300">&mdash;</td>
                      <td className="py-2.5 px-3 text-right font-bold text-yellow-300">
                        {pct(odds.p_shard)}
                      </td>
                    </tr>
                  ) : !odds.pot_gate_met ? (
                    <tr className="bg-gun-950/40 text-gun-400">
                      <td className="py-2.5 px-3 font-sans font-medium text-gun-300 flex items-center gap-1.5">
                        <Lock className="h-3 w-3 text-amber-500/80 shrink-0" />
                        <span>PC Core Shard</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-gun-300 bg-gun-800">
                          Exotic
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-gun-400">toward the PC</td>
                      <td className="py-2.5 px-3 text-right text-gun-500">&mdash;</td>
                      <td className="py-2.5 px-3 text-right font-mono text-[11px] font-semibold text-amber-400/90">
                        0% (Pot Gate Locked)
                      </td>
                    </tr>
                  ) : null}
                  {odds.p_respin > 0 && (
                    <tr className="bg-blue-950/20">
                      <td className="py-2.5 px-3 font-sans font-semibold text-blue-200">
                        Free Re-Roll
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white shadow-sm"
                          style={{ backgroundColor: RARITY_COLOR.blue }}
                        >
                          Rare
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-blue-300">
                        ${odds.box_price.toFixed(2)} back
                      </td>
                      <td className="py-2.5 px-3 text-right text-gun-300">&mdash;</td>
                      <td className="py-2.5 px-3 text-right font-bold text-blue-300">
                        {pct(odds.p_respin)}
                      </td>
                    </tr>
                  )}
                  {odds.floor_kind === 'coins' && odds.p_scrap > 0 && (
                    <tr>
                      <td className="py-2.5 px-3 font-sans font-semibold text-gun-300">
                        {odds.scrap_coins_awarded} Scrap Coins
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white shadow-sm"
                          style={{ backgroundColor: RARITY_COLOR.grey }}
                        >
                          Common
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-gun-400">
                        ${odds.scrap_coins_awarded.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gun-300">&mdash;</td>
                      <td className="py-2.5 px-3 text-right font-bold text-gun-300">
                        {pct(odds.p_scrap)}
                      </td>
                    </tr>
                  )}
                  {odds.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-gun-500">
                        No physical items remaining in this tier.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="border-t border-gun-800 p-4 bg-gun-950/60 flex justify-end">
          <button
            onClick={onClose}
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-gun-800 px-6 py-2.5 text-xs font-semibold text-white hover:bg-gun-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
