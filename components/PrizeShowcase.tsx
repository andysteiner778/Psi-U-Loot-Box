'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Package, ChevronRight } from 'lucide-react';
import { BOX_TIERS, RARITY_COLOR, RARITY_LABEL, type BoxTier, type Rarity } from '@/lib/types';
import type { PlayerBoxOdds } from '@/app/(player)/_lib/shared';

const TIER_SHORT: Record<BoxTier, string> = {
  tier_0: '$1',
  tier_1: '$5',
  tier_2: '$20',
  tier_3: '$50',
};

const RANK: Record<Rarity, number> = { gold: 0, pink: 1, purple: 2, blue: 3, grey: 4 };

interface Prize {
  id: string;
  name: string;
  image: string | null;
  value: number;
  rarity: Rarity;
  /** Cheapest box that can drop it, and the chance there. */
  bestTier: BoxTier | null;
  bestChance: number;
}

/**
 * THE GOOD STUFF, SCROLLING PAST.
 *
 * The loot table answers "what can I win?" but only once you go looking. This
 * puts the answer on the front page without a tap: the Legendary and above,
 * with their real photos, drifting past on their own.
 *
 * It reuses the ticker's CSS marquee rather than framer-motion, for the reason
 * documented in globals.css -- a JS keyframe animation restarts on every React
 * re-render, and this page re-renders on every roll in the house.
 *
 * Only what is actually in stock appears. Advertising a monitor somebody
 * already took home is the kind of thing that reads as a rigged machine.
 */
export function PrizeShowcase({ oddsList }: { oddsList: PlayerBoxOdds[] }) {
  const prizes = useMemo(() => {
    const byId = new Map<string, Prize>();
    for (const odds of oddsList) {
      for (const it of odds.items) {
        if (it.rarity !== 'purple' && it.rarity !== 'pink' && it.rarity !== 'gold') continue;
        if (it.stock_qty <= 0 || it.probability <= 0) continue;
        const existing = byId.get(it.item_id);
        if (!existing) {
          byId.set(it.item_id, {
            id: it.item_id,
            name: it.name,
            image: it.image_url ?? null,
            value: it.est_value,
            rarity: it.rarity,
            bestTier: odds.tier,
            bestChance: it.probability,
          });
        } else if (it.probability > existing.bestChance) {
          existing.bestTier = odds.tier;
          existing.bestChance = it.probability;
        }
      }
    }
    return [...byId.values()].sort((a, b) => RANK[a.rarity] - RANK[b.rarity] || b.value - a.value);
  }, [oddsList]);

  if (prizes.length === 0) return null;

  // Slower than the ticker: these are meant to be looked at, not read past.
  const durationSec = Math.max(24, prizes.length * 6);

  const card = (p: Prize, key: string) => (
    <div
      key={key}
      data-rarity={p.rarity}
      className="rarity-border mr-3 flex w-40 shrink-0 flex-col rounded-2xl border bg-gun-900/90 p-2.5"
    >
      <div className="mb-2 flex h-24 w-full items-center justify-center overflow-hidden rounded-xl bg-gun-950/80">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt={p.name} className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <Package className="h-8 w-8" style={{ color: RARITY_COLOR[p.rarity] }} />
        )}
      </div>
      <span
        className="mb-1 w-fit rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
        style={{ backgroundColor: RARITY_COLOR[p.rarity] }}
      >
        {RARITY_LABEL[p.rarity]}
      </span>
      <span className="truncate text-xs font-bold text-white">{p.name}</span>
      <div className="mt-0.5 flex items-baseline justify-between gap-1">
        <span className="font-mono text-[11px] font-bold text-emerald-400">
          ${p.value.toFixed(0)}
        </span>
        {p.bestTier && (
          <span className="font-mono text-[9px] text-gun-400">
            {TIER_SHORT[p.bestTier]} box &middot; {(p.bestChance * 100).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-gun-300">
          Still up for grabs
        </h2>
        <Link
          href="/loot"
          className="flex items-center gap-0.5 font-mono text-[11px] text-cyan-400 transition hover:text-cyan-300"
        >
          All items
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <Link
        href="/loot"
        aria-label="See every item in the house"
        className="relative block w-full overflow-hidden rounded-2xl border border-gun-800 bg-gun-950/60 py-3"
      >
        {/* Edge fades, so cards drift in and out rather than being cut off. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-gun-950 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-gun-950 to-transparent" />

        <div className="ticker-track pl-3" style={{ animationDuration: `${durationSec}s` }}>
          {prizes.map((p) => card(p, p.id))}
          {prizes.map((p) => card(p, p.id + '-b'))}
        </div>
      </Link>
    </section>
  );
}
