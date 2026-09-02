'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SessionUser } from '@/lib/types';
import { DEFAULT_GAME_CONFIG, type GameConfig, type PlayerStats } from './shared';

/**
 * One source of truth for the three numbers the whole app argues about:
 * balance, scrap coins and PC shards.
 *
 * The header HUD, the box grid and the inventory page all read from here, so a
 * roll updates every one of them at once. Every mutation route echoes the
 * authoritative counters back, and `commit()` overwrites the optimistic guess
 * with them — the client never gets to believe its own arithmetic for long.
 */

export type ToastTone = 'info' | 'good' | 'bad';
export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface PlayerContextValue {
  user: SessionUser;
  config: GameConfig;
  stats: PlayerStats;
  /** Optimistic local adjustment, applied instantly for tap feedback. */
  adjust: (delta: Partial<PlayerStats>) => void;
  /** Authoritative server counters. Always wins. */
  commit: (stats: PlayerStats) => void;
  toast: (message: string, tone?: ToastTone) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({
  user,
  config = DEFAULT_GAME_CONFIG,
  initialStats,
  children,
}: {
  user: SessionUser;
  config?: GameConfig;
  initialStats: PlayerStats;
  children: ReactNode;
}) {
  const [stats, setStats] = useState<PlayerStats>(initialStats);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const adjust = useCallback((delta: Partial<PlayerStats>) => {
    setStats((s) => ({
      balance: Math.max(0, s.balance + (delta.balance ?? 0)),
      scrap_coins: Math.max(0, s.scrap_coins + (delta.scrap_coins ?? 0)),
      pc_shards: Math.max(0, s.pc_shards + (delta.pc_shards ?? 0)),
    }));
  }, []);

  const commit = useCallback((next: PlayerStats) => setStats(next), []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
  }, []);

  const value = useMemo(
    () => ({ user, config, stats, adjust, commit, toast, toasts, dismiss }),
    [user, config, stats, adjust, commit, toast, toasts, dismiss]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}

/** Bottom-anchored, above the tab bar, clear of the home indicator. */
export function ToastStack() {
  const { toasts, dismiss } = usePlayer();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDone={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 4200);
    return () => clearTimeout(timer);
  }, [onDone]);

  const tone =
    toast.tone === 'bad'
      ? 'border-red-500/50 bg-red-950/85 text-red-100'
      : toast.tone === 'good'
        ? 'border-emerald-500/50 bg-emerald-950/85 text-emerald-100'
        : 'border-gun-600 bg-gun-850/90 text-gun-300';

  return (
    <button
      type="button"
      onClick={onDone}
      className={`pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 text-left text-sm font-medium shadow-lg backdrop-blur ${tone}`}
    >
      {toast.message}
    </button>
  );
}
