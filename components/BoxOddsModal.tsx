'use client';

import React from 'react';
import { X, ShieldAlert, Zap, RefreshCw, Skull, Sparkles, Package } from 'lucide-react';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/types';
import type { PlayerBoxOdds } from '@/app/(player)/_lib/shared';

export interface BoxOddsModalProps {
  isOpen: boolean;
  onClose: () => void;
  odds: PlayerBoxOdds;
  meta: { name: string; blurb: string; accent: string };
}

export function BoxOddsModal({ isOpen, onClose, odds, meta }: BoxOddsModalProps) {
  if (!isOpen) return null;

  const pct = (p: number) => {
    const v = (Number.isFinite(p) ? p : 0) * 100;
    if (v === 0) return '0%';
    if (v < 0.1) return '<0.1%';
    return `${v < 10 ? v.toFixed(2) : v.toFixed(1)}%`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-in fade-in">
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
            <div className="rounded-xl bg-yellow-950/30 p-3 border border-yellow-500/20">
              <span className="text-yellow-400 block text-[10px]">PC Shard Drop</span>
              <span className="text-yellow-300 font-bold text-sm">{pct(odds.p_shard)}</span>
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
              <div className="flex items-center justify-between rounded-xl bg-yellow-950/20 border border-yellow-500/30 p-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-400" />
                  <span className="text-yellow-200">PC Core Shard</span>
                </div>
                <span className="font-bold text-yellow-400">{pct(odds.p_shard)}</span>
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
          </div>

          {/* Physical Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-gun-300">
                Physical Loot Pool ({odds.items.length} native prizes)
              </h3>
              <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                Total Physical Chance: {pct(odds.p_physical + (odds.floor_kind === 'item' ? odds.p_scrap : 0))}
              </span>
            </div>

            <div className="rounded-2xl border border-gun-800 overflow-hidden bg-gun-950/50">
              <table className="w-full text-left text-xs font-mono">
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
                  {odds.items.map((item) => {
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
                          ${item.est_value.toFixed(2)}
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
