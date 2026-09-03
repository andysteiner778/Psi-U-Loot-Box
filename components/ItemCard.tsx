'use client';

import React from 'react';
import type { Rarity } from '@/lib/types';
import { RARITY_COLOR, RARITY_LABEL, isScrappable } from '@/lib/types';
import { Package, Sparkles } from 'lucide-react';

export interface ItemCardProps {
  name: string;
  rarity: Rarity;
  estValue?: number;
  scrapValue?: number;
  imageUrl?: string | null;
  stockQty?: number;
  description?: string | null;
  isNearMiss?: boolean;
  isWinner?: boolean;
  compact?: boolean;
  onClick?: () => void;
  actionButton?: React.ReactNode;
}

export function ItemCard({
  name,
  rarity,
  estValue,
  scrapValue,
  imageUrl,
  stockQty,
  description,
  isNearMiss,
  isWinner,
  compact = false,
  onClick,
  actionButton,
}: ItemCardProps) {
  const color = RARITY_COLOR[rarity] || RARITY_COLOR.grey;
  const label = RARITY_LABEL[rarity] || 'Common';
  const scrappable = isScrappable(rarity);

  if (compact) {
    return (
      <div
        data-rarity={rarity}
        onClick={onClick}
        className={`relative flex flex-col items-center justify-between rounded-xl border bg-gun-850/90 p-2.5 transition-all select-none ${
          onClick ? 'cursor-pointer hover:scale-[1.02] hover:bg-gun-800' : ''
        } ${
          isWinner
            ? 'rarity-border ring-2 ring-yellow-400 shadow-xl'
            : isNearMiss
              ? 'border-pink-500/60 shadow-lg shadow-pink-500/20'
              : 'border-gun-700 hover:border-gun-600'
        }`}
        style={{
          boxShadow: isWinner
            ? `0 0 20px -2px ${color}80, inset 0 0 15px -5px ${color}40`
            : undefined,
        }}
      >
        {/* Top Rarity Pip */}
        <div className="flex w-full items-center justify-between gap-1 text-[10px] font-semibold">
          <span
            className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white font-mono"
            style={{ backgroundColor: `${color}99` }}
          >
            {label}
          </span>
          {estValue !== undefined && estValue > 0 && (
            <span className="font-mono text-emerald-400">${estValue.toFixed(0)}</span>
          )}
        </div>

        {/* Thumbnail Image / Fallback */}
        <div className="relative my-2 flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-gun-950/60">
          {imageUrl ? (
            <img src={imageUrl} alt={name} className="h-full w-full object-contain p-1" />
          ) : (
            <Package className="h-9 w-9 text-gun-400" style={{ color }} />
          )}
          {isWinner && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          )}
        </div>

        {/* Title */}
        <div className="w-full text-center">
          <p className="truncate text-xs font-semibold text-white" title={name}>
            {name}
          </p>
        </div>

        {/* Bottom neon accent bar */}
        <div
          className="mt-2 h-1 w-full rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    );
  }

  return (
    <div
      data-rarity={rarity}
      className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-gun-850/95 p-4 shadow-xl backdrop-blur transition-all ${
        isWinner
          ? 'rarity-border ring-2 ring-yellow-400/80 shadow-2xl'
          : 'border-gun-700/80 hover:border-gun-600'
      }`}
      style={{
        boxShadow: `0 8px 24px -6px rgba(0, 0, 0, 0.5), 0 0 20px -8px ${color}50`,
      }}
    >
      {/* Background glow gradient */}
      <div
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full blur-2xl"
        style={{ background: `${color}25` }}
      />

      <div>
        {/* Header Badges */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white font-mono shadow-sm"
              style={{ backgroundColor: color }}
            >
              {label}
            </span>
            {stockQty !== undefined && (
              <span className="rounded bg-gun-950/80 px-1.5 py-0.5 text-[10px] font-mono text-gun-300">
                {stockQty > 0 ? `${stockQty} in stock` : 'Out of stock'}
              </span>
            )}
          </div>

          {estValue !== undefined && estValue > 0 && (
            <div className="flex items-center gap-1 font-mono text-sm font-bold text-emerald-400 bg-gun-950/80 px-2 py-0.5 rounded-lg border border-emerald-500/20">
              <Sparkles className="h-3 w-3" />
              <span>${estValue.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Media Container */}
        <div className="relative my-3 flex h-36 w-full items-center justify-center overflow-hidden rounded-xl bg-gun-950/70 border border-gun-750/50">
          {imageUrl ? (
            <img src={imageUrl} alt={name} className="h-full w-full object-contain p-2" />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1">
              <Package className="h-14 w-14" style={{ color }} />
              <span className="text-[10px] uppercase font-mono text-gun-400">Physical Loot</span>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white line-clamp-1" title={name}>
            {name}
          </h3>
          {description && (
            <p className="text-xs text-gun-300 line-clamp-2 leading-relaxed">{description}</p>
          )}
        </div>
      </div>

      {/* Footer / Actions */}
      <div className="mt-4 pt-3 border-t border-gun-700/60 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-gun-400">Scrap Rule:</span>
          {scrappable && scrapValue && scrapValue > 0 ? (
            <span className="text-cyan-400 font-semibold">+{scrapValue} Scrap Coins</span>
          ) : (
            <span className="text-amber-400 font-semibold flex items-center gap-1">
              🔒 Pickup from Andy — Japan
            </span>
          )}
        </div>

        {actionButton && <div className="mt-1">{actionButton}</div>}
      </div>

      {/* Bottom neon rarity accent */}
      <div
        className="absolute bottom-0 inset-x-0 h-1"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        }}
      />
    </div>
  );
}
