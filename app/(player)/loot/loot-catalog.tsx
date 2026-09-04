'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Package, Sparkles } from 'lucide-react';
import { BOX_TIERS, RARITY_COLOR, RARITY_LABEL, type BoxTier, type Rarity } from '@/lib/types';
import type { GameConfig, PlayerBoxOdds, ShardPrize } from '../_lib/shared';

const TIER_NAME: Record<BoxTier, string> = {
  tier_0: 'Pocket Lint',
  tier_1: 'Loose Change',
  tier_2: 'The Good Stuff',
  tier_3: 'High Roller',
};

/** Best first: the things people came for, then everything else by value. */
const RARITY_RANK: Record<Rarity, number> = { gold: 0, pink: 1, purple: 2, blue: 3, grey: 4 };

interface Row {
  id: string;
  name: string;
  image: string | null;
  value: number;
  rarity: Rarity;
  stock: number;
  /** Chance of pulling this item, per tier. Zero means it cannot drop there. */
  chance: Record<BoxTier, number>;
  /** Set instead of chances for prizes claimed with shards rather than won. */
  shardCost?: number;
}

export function LootCatalog({
  oddsList,
  config,
  shardPrizes = [],
}: {
  oddsList: PlayerBoxOdds[];
  config: GameConfig;
  shardPrizes?: ShardPrize[];
}) {
  const [query, setQuery] = useState('');
  const [onlyWinnable, setOnlyWinnable] = useState(true);

  const rows = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const odds of oddsList) {
      // items + filler: filler is the cheap junk that backs the consolation
      // slot, and it is genuinely winnable, so leaving it out would understate
      // what is in the house.
      for (const it of [...odds.items, ...odds.filler]) {
        let row: Row | undefined = byId.get(it.item_id);
        if (!row) {
          row = {
            id: it.item_id,
            name: it.name,
            image: it.image_url ?? null,
            value: it.est_value,
            rarity: it.rarity,
            stock: it.stock_qty,
            chance: { tier_0: 0, tier_1: 0, tier_2: 0, tier_3: 0 },
          };
          byId.set(it.item_id, row);
        }
        // Same item can appear in several tiers; keep the best chance per tier.
        row.chance[odds.tier] = Math.max(row.chance[odds.tier], it.probability);
        row.stock = Math.max(row.stock, it.stock_qty);
      }
    }
    const dropped = [...byId.values()].sort(
      (a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || b.value - a.value
    );
    // Claimed with shards, never dropped -- so absent from box_odds, and until
    // now absent from this list too. It is the most valuable thing in the house.
    const claimed: Row[] = shardPrizes.map((p) => ({
      id: p.item_id,
      name: p.name,
      image: p.image_url,
      value: p.value,
      rarity: p.rarity,
      stock: p.stock_qty,
      chance: { tier_0: 0, tier_1: 0, tier_2: 0, tier_3: 0 },
      shardCost: p.shard_cost,
    }));
    return [...claimed, ...dropped];
  }, [oddsList, shardPrizes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyWinnable && r.stock <= 0) return false;
      return !q || r.name.toLowerCase().includes(q);
    });
  }, [rows, query, onlyWinnable]);

  const pct = (p: number) => {
    const v = p * 100;
    if (!(v > 0)) return null;
    if (v < 0.1) return '<0.1%';
    return `${v < 10 ? v.toFixed(2) : v.toFixed(1)}%`;
  };

  const totalValue = filtered.reduce((a, r) => a + r.value * Math.max(0, r.stock), 0);
  const totalUnits = filtered.reduce((a, r) => a + Math.max(0, r.stock), 0);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-3 py-6 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-gun-700 bg-gun-900 px-3 font-mono text-xs text-gun-300 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Boxes
        </Link>
        <div className="text-right">
          <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            Everything in the House
          </h1>
          <p className="font-mono text-[11px] text-gun-400">
            {totalUnits} items still unclaimed &middot; ${totalValue.toFixed(2)} of goods
          </p>
        </div>
      </div>

      {/* The headline prizes, scrolled horizontally. */}
      <div>
        <h2 className="mb-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-gun-300">
          <Sparkles className="h-3.5 w-3.5 text-yellow-400" />
          The big ones
        </h2>
        <div className="flex snap-x gap-3 overflow-x-auto pb-2">
          {filtered
            .filter((r) => r.rarity === 'gold' || r.rarity === 'pink' || r.rarity === 'purple')
            .map((r) => (
              <a
                key={r.id}
                href={`#item-${r.id}`}
                data-rarity={r.rarity}
                className="rarity-border flex w-36 shrink-0 snap-start flex-col rounded-2xl border bg-gun-900/90 p-2.5 transition active:scale-95"
              >
                <div className="mb-2 flex h-24 w-full items-center justify-center overflow-hidden rounded-xl bg-gun-950/80">
                  {r.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image} alt={r.name} className="h-full w-full object-contain" />
                  ) : (
                    <Package className="h-8 w-8" style={{ color: RARITY_COLOR[r.rarity] }} />
                  )}
                </div>
                <span
                  className="mb-1 w-fit rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: RARITY_COLOR[r.rarity] }}
                >
                  {RARITY_LABEL[r.rarity]}
                </span>
                <span className="truncate text-xs font-bold text-white">{r.name}</span>
                <span className="font-mono text-[11px] text-emerald-400">
                  ${r.value.toFixed(2)}
                </span>
              </a>
            ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gun-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the house…"
            className="min-h-[44px] w-full rounded-xl border border-gun-700 bg-gun-950 pl-9 pr-3 text-sm text-white placeholder:text-gun-500 focus:border-cyan-500/60 focus:outline-none"
          />
        </div>
        <button
          onClick={() => setOnlyWinnable((v) => !v)}
          className={`min-h-[44px] rounded-xl border px-3 font-mono text-xs transition ${
            onlyWinnable
              ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
              : 'border-gun-700 bg-gun-900 text-gun-400'
          }`}
        >
          {onlyWinnable ? 'In stock only' : 'Showing claimed too'}
        </button>
      </div>

      {/* The list */}
      <div className="space-y-2">
        {filtered.map((r) => (
          <div
            key={r.id}
            id={`item-${r.id}`}
            data-rarity={r.rarity}
            className="rarity-border flex gap-3 rounded-2xl border bg-gun-900/70 p-3 scroll-mt-24"
          >
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gun-950/80">
              {r.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image} alt={r.name} className="h-full w-full object-contain" />
              ) : (
                <Package className="h-7 w-7" style={{ color: RARITY_COLOR[r.rarity] }} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: RARITY_COLOR[r.rarity] }}
                >
                  {RARITY_LABEL[r.rarity]}
                </span>
                <span className="truncate text-sm font-bold text-white">{r.name}</span>
                <span className="ml-auto font-mono text-sm font-bold text-emerald-400">
                  ${r.value.toFixed(2)}
                </span>
              </div>

              <p className="mt-0.5 font-mono text-[10px] text-gun-400">
                {r.stock > 0 ? `${r.stock} left` : 'claimed — no longer in the pool'}
              </p>

              {/* Chance per box, which is the question this page exists to answer. */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.shardCost ? (
                  <span className="rounded-lg border border-yellow-500/40 bg-yellow-950/30 px-2 py-1 font-mono text-[10px] text-yellow-300">
                    Claimed with <span className="font-bold">{r.shardCost} PC Core Shards</span> — not a box drop
                  </span>
                ) : null}
                {!r.shardCost && BOX_TIERS.map((t) => {
                  const label = pct(r.chance[t]);
                  if (!label) return null;
                  return (
                    <span
                      key={t}
                      className="rounded-lg border border-gun-700 bg-gun-950 px-2 py-1 font-mono text-[10px] text-gun-300"
                    >
                      {TIER_NAME[t]}{' '}
                      <span className="font-bold text-white">{label}</span>
                    </span>
                  );
                })}
                {!r.shardCost && BOX_TIERS.every((t) => !pct(r.chance[t])) && (
                  <span className="font-mono text-[10px] text-gun-500">
                    not currently winnable
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="py-10 text-center font-mono text-sm text-gun-400">
            Nothing matches “{query}”.
          </p>
        )}
      </div>

      <p className="pb-4 font-mono text-[10px] leading-relaxed text-gun-500">
        Chances are live and rebalance as items are won. Legendary and above are
        picked up from Andy in Japan. Anything marked “claimed with shards” is
        assembled from {config.shards_required} PC Core Shards rather than won
        from a box.
      </p>
    </div>
  );
}
