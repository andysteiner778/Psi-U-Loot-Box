'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase, TICKER_TOPIC } from '@/lib/supabase/browser';
import type { TickerEvent } from '@/lib/types';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/types';
import { Trophy, Zap, Skull, RefreshCw } from 'lucide-react';

/**
 * The ticker starts EMPTY.
 *
 * It previously shipped three fabricated wins -- "Tyler pulled the Audioengine
 * A5+ Speakers", "Alex found a PC Core Shard (3/5)" -- with names that are not
 * even in the roster. In an app where people put real money in, that is
 * fabricated social proof of the exact top prizes: players would believe the
 * speakers were already gone and that shards were dropping while the pot gate
 * was still locked. Every line here must correspond to a real roll.
 */
const INITIAL_EVENTS: TickerEvent[] = [];

export function Ticker() {
  const [events, setEvents] = useState<TickerEvent[]>(INITIAL_EVENTS);

  // Seed from recent history. Realtime only carries what happens while you are
  // watching, so navigating away and back used to leave the banner blank.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ticker')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok || !Array.isArray(j.data) || j.data.length === 0) return;
        setEvents((live) => {
          // Live events that arrived while this was in flight win; history fills
          // in behind them, de-duplicated on player+item+timestamp.
          const seen = new Set(live.map((e) => e.player + '|' + e.item + '|' + e.at));
          const history = (j.data as TickerEvent[]).filter(
            (e) => !seen.has(e.player + '|' + e.item + '|' + e.at)
          );
          return [...live, ...history].slice(0, 30);
        });
      })
      .catch(() => {
        /* a blank ticker is not worth an error message */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const channel = supabase
        .channel(TICKER_TOPIC)
        .on('broadcast', { event: 'roll' }, ({ payload }) => {
          if (payload) {
            setEvents((prev) => [payload as TickerEvent, ...prev.slice(0, 19)]);
          }
        })
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    } catch (err) {
      console.warn('[Ticker] Realtime subscription fallback', err);
    }
  }, []);

  const formatEvent = (evt: TickerEvent, index: number) => {
    const color = RARITY_COLOR[evt.rarity] || '#9aa3b8';
    const label = RARITY_LABEL[evt.rarity] || '';

    let icon = <Trophy className="h-3.5 w-3.5 text-amber-400" />;
    let text = (
      <span>
        <strong className="text-white font-semibold">{evt.player}</strong> just pulled{' '}
        <span className="font-bold" style={{ color }}>
          {evt.item}
        </span>{' '}
        <span className="text-[10px] uppercase font-mono text-gun-400">({label})</span>
      </span>
    );

    if (evt.kind === 'shard') {
      icon = <Zap className="h-3.5 w-3.5 text-yellow-400 animate-pulse" />;
      text = (
        <span>
          <strong className="text-white font-semibold">{evt.player}</strong> found a{' '}
          <span className="font-bold text-yellow-400">PC Core Shard!</span>{' '}
          {/* No hardcoded denominator: shards_required is a live config value
              and has already changed from 5 to 4 once. */}
          <span className="font-mono text-yellow-300">({evt.shards ?? 1})</span>
        </span>
      );
    } else if (evt.kind === 'scrap') {
      icon = <Skull className="h-3.5 w-3.5 text-gun-400" />;
      text = (
        <span>
          <strong className="text-white font-semibold">{evt.player}</strong> received{' '}
          <span className="text-gun-300 font-mono">{evt.item}</span>
        </span>
      );
    } else if (evt.kind === 'respin') {
      icon = <RefreshCw className="h-3.5 w-3.5 text-blue-400" />;
      text = (
        <span>
          <strong className="text-white font-semibold">{evt.player}</strong> scored a{' '}
          <span className="text-blue-400 font-semibold">Free Re-Roll Token!</span>
        </span>
      );
    }

    return (
      <div
        key={`${evt.at}-${index}-${evt.player}`}
        className="inline-flex items-center gap-2 rounded-full bg-gun-900/80 px-3 py-1 border border-gun-750/70 text-xs text-gun-200 shadow-sm mx-2 whitespace-nowrap backdrop-blur-sm"
      >
        {icon}
        {text}
      </div>
    );
  };

  return (
    <div className="relative w-full overflow-hidden border-b border-gun-800 bg-gun-950/95 py-2 select-none">
      {/* Live Badge */}
      <div className="absolute left-0 top-0 bottom-0 z-20 flex items-center bg-gradient-to-r from-gun-950 via-gun-950 to-transparent pl-3 pr-6">
        <div className="flex items-center gap-1.5 rounded-md bg-red-950/80 border border-red-500/40 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.2)]">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />
          <span>Live</span>
        </div>
      </div>

      {/* Right Fade */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-20 w-12 bg-gradient-to-l from-gun-950 to-transparent" />

      {/* Marquee Track using Framer Motion */}
      <motion.div
        animate={{ x: [0, -1000] }}
        transition={{
          x: {
            repeat: events.length === 0 ? 0 : Infinity,
            repeatType: 'loop',
            duration: 25,
            ease: 'linear',
          },
        }}
        className="flex w-max pl-20"
      >
        {events.length === 0 ? (
          <span className="px-4 py-1 font-mono text-[11px] text-gun-400">
            No pulls yet &mdash; be the first to open a case.
          </span>
        ) : (
          <>
            {events.map((evt, idx) => formatEvent(evt, idx))}
            {events.map((evt, idx) => formatEvent(evt, idx + events.length))}
            {events.map((evt, idx) => formatEvent(evt, idx + events.length * 2))}
          </>
        )}
      </motion.div>
    </div>
  );
}
