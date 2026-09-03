'use client';

import React, { useState } from 'react';
import { Package, Trash2, MapPin, Sparkles, History, Check, ShieldAlert } from 'lucide-react';
import type { Roll, Rarity } from '@/lib/types';
import { RARITY_COLOR, RARITY_LABEL, canScrap, isScrappable } from '@/lib/types';
import { usePlayer } from '@/app/(player)/_lib/player-store';
import { apiScrap } from '@/app/(player)/_lib/api';
import { sfx } from '@/lib/sound';
import { ScrapCompactor } from '@/components/ScrapCompactor';

import Link from 'next/link';
import { DepositModal } from '@/components/DepositModal';

export interface InventoryViewProps {
  initialItems: Roll[];
  recentRolls: Roll[];
}

export function InventoryView({ initialItems, recentRolls }: InventoryViewProps) {
  const { stats, commit, adjust, toast } = usePlayer();
  const [items, setItems] = useState<Roll[]>(initialItems);
  const [scrappingId, setScrappingId] = useState<string | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  const handleScrap = async (roll: Roll) => {
    if (scrappingId) return;
    const coins =
      roll.payload && roll.payload.type === 'physical' ? roll.payload.scrap_value : 0;
    if (!canScrap(roll.item_rarity, coins)) {
      toast('Purple, Pink, and Gold items cannot be scrapped! Physical pickup in Room 4 only.', 'bad');
      return;
    }

    const scrapVal = roll.payload && roll.payload.type === 'physical' ? roll.payload.scrap_value : 0;
    setScrappingId(roll.id);

    // Optimistic scrap
    adjust({ scrap_coins: scrapVal });

    try {
      const res = await apiScrap(roll.id);
      if (res.ok) {
        commit(res.value.stats);
        sfx.playScrapCrunch();
        setItems((prev) => prev.filter((i) => i.id !== roll.id));
        toast(`Recycled ${roll.item_name} for +${res.value.data.scrap_gained} Scrap Coins!`, 'good');
      } else {
        adjust({ scrap_coins: -scrapVal });
        sfx.playError();
        toast(res.error, 'bad');
      }
    } catch {
      adjust({ scrap_coins: -scrapVal });
      sfx.playError();
      toast('Failed to scrap item. Please retry.', 'bad');
    } finally {
      setScrappingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Scrap Compactor */}
      <ScrapCompactor />

      {/* Unboxed Physical Inventory */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
              <Package className="h-5 w-5 text-purple-400" />
              <span>Unboxed Physical Loot ({items.length})</span>
            </h2>
            <p className="text-xs font-mono text-gun-400">
              Grey & Blue items can be recycled for Scrap Coins. High-tier items are pickup only.
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-gun-800 bg-gun-900/60 p-10 text-center space-y-4">
            <Package className="mx-auto h-12 w-12 text-gun-600" />
            <div>
              <h3 className="text-base font-bold text-white">Your shelf is currently empty</h3>
              <p className="text-xs text-gun-400 mt-1 max-w-sm mx-auto">
                Open some mystery boxes to win physical goods, scrap coins, and PC shards.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Link
                href="/"
                className="flex min-h-[44px] items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg hover:brightness-110 transition"
              >
                Open Boxes ↗
              </Link>
              <button
                onClick={() => setDepositOpen(true)}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-gun-700 bg-gun-800 px-4 py-2.5 text-xs font-semibold text-gun-200 hover:border-emerald-500/50 hover:text-emerald-300 transition"
              >
                + Deposit via Venmo
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {items.map((roll) => {
              const rarity = roll.item_rarity;
              const color = RARITY_COLOR[rarity] || '#4b5563';
              const label = RARITY_LABEL[rarity] || 'Item';
              const payload = roll.payload && roll.payload.type === 'physical' ? roll.payload : null;
              const scrapCoins = payload?.scrap_value ?? 0;
              // Rarity alone is not enough: something cheap enough that 60% of
              // its value floors to zero coins has nothing to give, and a
              // "Scrap for +0" button is worse than no button.
              const scrappable = canScrap(rarity, scrapCoins);
              // Show retail when the admin set one; it is display-only and does
              // not affect what this item cost the pool or scraps for.
              const estVal = (payload?.msrp && payload.msrp > 0 ? payload.msrp : payload?.est_value) ?? 0;
              const isScrapping = scrappingId === roll.id;

              return (
                <div
                  key={roll.id}
                  data-rarity={rarity}
                  className="relative flex flex-col justify-between rounded-2xl border border-gun-750 bg-gun-900/90 p-4 shadow-xl backdrop-blur-md"
                  style={{
                    boxShadow: `0 0 20px -8px ${color}40`,
                  }}
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <span
                        className="rounded-md px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-white"
                        style={{ backgroundColor: color }}
                      >
                        {label}
                      </span>
                      {estVal > 0 && (
                        <span className="font-mono text-xs font-bold text-emerald-400">
                          ${estVal.toFixed(2)}
                        </span>
                      )}
                    </div>

                    {/* Image / Graphic */}
                    <div className="my-3 flex h-32 w-full items-center justify-center overflow-hidden rounded-xl bg-gun-950/80 border border-gun-800">
                      {payload?.image_url ? (
                        <img
                          src={payload.image_url}
                          alt={roll.item_name}
                          className="h-full w-full object-contain p-2"
                        />
                      ) : (
                        <Package className="h-12 w-12" style={{ color }} />
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="text-sm font-bold text-white line-clamp-1" title={roll.item_name}>
                      {roll.item_name}
                    </h3>
                  </div>

                  {/* Actions / Anti-exploit notice */}
                  <div className="mt-4 pt-3 border-t border-gun-800">
                    {scrappable ? (
                      <button
                        onClick={() => handleScrap(roll)}
                        disabled={isScrapping}
                        className="w-full flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 py-2.5 font-mono text-xs font-bold text-cyan-300 shadow-sm transition hover:bg-cyan-900/60 active:scale-95 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-cyan-400" />
                        <span>{isScrapping ? 'Recycling...' : `Scrap for +${scrapCoins} Coins`}</span>
                      </button>
                    ) : (
                      <div className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-amber-950/40 border border-amber-500/40 py-2 px-2 text-center text-[11px] font-mono font-semibold text-amber-300">
                        <MapPin className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span>Physical Pickup (Room 4)</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History Log Table */}
      <div>
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-gun-400" />
          <span>Recent Unboxing Activity</span>
        </h2>

        <div className="rounded-2xl border border-gun-800 bg-gun-900/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-gun-950 text-gun-400 border-b border-gun-800">
                <tr>
                  <th className="py-2.5 px-4">Item</th>
                  <th className="py-2.5 px-3">Outcome</th>
                  <th className="py-2.5 px-3">Tier</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-4 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gun-850">
                {recentRolls.map((roll) => {
                  const rColor = RARITY_COLOR[roll.item_rarity] || '#fff';
                  return (
                    <tr key={roll.id} className="hover:bg-gun-850/40 transition">
                      <td className="py-2.5 px-4 font-sans font-semibold text-white">
                        <span style={{ color: rColor }}>{roll.item_name}</span>
                      </td>
                      <td className="py-2.5 px-3 uppercase text-[10px] text-gun-300">
                        {roll.kind}
                      </td>
                      <td className="py-2.5 px-3 text-gun-400">
                        {roll.box_tier.replace('_', ' ')}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] uppercase font-bold ${
                            roll.status === 'inventory'
                              ? 'bg-emerald-950 text-emerald-400'
                              : roll.status === 'scrapped'
                                ? 'bg-cyan-950 text-cyan-400'
                                : 'bg-gun-800 text-gun-400'
                          }`}
                        >
                          {roll.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-gun-500">
                        {new Date(roll.rolled_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  );
                })}
                {recentRolls.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gun-500">
                      No activity yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
      />
    </div>
  );
}
