'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  KeyRound,
  Lock,
  User,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Check,
  X,
} from 'lucide-react';
import { apiLogin, apiSetPin } from '@/app/(player)/_lib/api';
import { sfx } from '@/lib/sound';

export interface LoginFormProps {
  roster: { id: string; name: string }[];
  initialMustChange?: boolean;
  userName?: string;
}

export function LoginForm({ roster, initialMustChange = false, userName = '' }: LoginFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(userName || '');
  const [name, setName] = useState(userName);
  const [isComboboxOpen, setIsComboboxOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'login' | 'changePin'>(initialMustChange ? 'changePin' : 'login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filteredRoster = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((p) => p.name.toLowerCase().includes(q));
  }, [query, roster]);

  const selectedPlayer = useMemo(
    () => roster.find((p) => p.name.toLowerCase() === name.toLowerCase()),
    [name, roster]
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setIsComboboxOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPlayer = (player: { id: string; name: string }) => {
    setName(player.name);
    setQuery(player.name);
    setIsComboboxOpen(false);
    setError(null);
    setHighlightedIndex(-1);
  };

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setIsComboboxOpen(true);
    setHighlightedIndex(0);
    setError(null);
    const exact = roster.find((p) => p.name.toLowerCase() === val.trim().toLowerCase());
    if (exact) {
      setName(exact.name);
    } else {
      setName('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isComboboxOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsComboboxOpen(true);
        setHighlightedIndex(0);
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredRoster.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredRoster.length - 1));
    } else if (e.key === 'Enter') {
      if (isComboboxOpen && highlightedIndex >= 0 && filteredRoster[highlightedIndex]) {
        e.preventDefault();
        handleSelectPlayer(filteredRoster[highlightedIndex]);
      } else if (isComboboxOpen && filteredRoster.length === 1) {
        e.preventDefault();
        handleSelectPlayer(filteredRoster[0]);
      }
    } else if (e.key === 'Escape') {
      setIsComboboxOpen(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedPlayer = roster.find(
      (p) => p.name.toLowerCase() === (name || query).trim().toLowerCase()
    );

    if (!resolvedPlayer) {
      setError('No such player. Please pick your name from the roster.');
      setIsComboboxOpen(true);
      return;
    }

    if (pin.length !== 4) {
      setError('PIN must be exactly 4 digits');
      return;
    }

    setLoading(true);
    setError(null);
    await sfx.unlock();

    try {
      const res = await apiLogin(resolvedPlayer.name, pin);
      if (res.ok) {
        if (res.value.mustChangePin) {
          setStep('changePin');
        } else {
          router.push('/');
          router.refresh();
        }
      } else {
        sfx.playError();
        setError(res.error || 'Invalid name or PIN');
      }
    } catch {
      setError('Network error, please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 4) {
      setError('New PIN must be 4 digits');
      return;
    }
    if (newPin === '1234') {
      setError('Pick something other than 1234');
      return;
    }
    if (newPin !== confirmPin) {
      setError('PINs do not match');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiSetPin(newPin);
      if (res.ok) {
        sfx.playGoldFanfare();
        router.push('/');
        router.refresh();
      } else {
        sfx.playError();
        setError(res.error || 'Could not update PIN');
      }
    } catch {
      setError('Network error updating PIN');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'changePin') {
    return (
      <div className="rounded-2xl border border-yellow-500/40 bg-gun-900/90 p-6 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-500/20 border border-yellow-500/40 text-yellow-400">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Set Your Private PIN</h2>
            <p className="text-xs text-gun-400">First-time login security requirement.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-950/80 border border-red-500/40 p-3 text-xs text-red-200">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleChangePin} className="space-y-4">
          <div>
            <label className="text-xs font-mono text-gun-300 block mb-1">New 4-Digit PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]*"
              placeholder="••••"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full rounded-xl border border-gun-700 bg-gun-950 py-3 text-center font-mono text-2xl tracking-[0.5em] text-white focus:border-yellow-400 focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-mono text-gun-300 block mb-1">Confirm New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]*"
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full rounded-xl border border-gun-700 bg-gun-950 py-3 text-center font-mono text-2xl tracking-[0.5em] text-white focus:border-yellow-400 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading || newPin.length !== 4 || confirmPin.length !== 4}
            className="w-full flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 py-3 font-bold text-black shadow-lg shadow-yellow-500/20 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{loading ? 'Saving...' : 'Set PIN & Enter Game'}</span>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gun-700/80 bg-gun-900/95 p-6 shadow-2xl backdrop-blur-md">
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-950/80 border border-red-500/40 p-3 text-xs text-red-200">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        {/* Name Combobox */}
        <div ref={comboboxRef} className="space-y-1.5">
          <label className="text-xs font-mono text-gun-300 block flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-blue-400" />
              <span>Select or Type Player Name</span>
            </span>
            {selectedPlayer && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                <Check className="h-3 w-3" />
                <span>Verified Roster</span>
              </span>
            )}
          </label>

          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => setIsComboboxOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Type your name (e.g. Andy, Tyler)..."
              className={`w-full min-h-[44px] rounded-xl border bg-gun-950 py-2.5 pl-3 pr-16 text-sm font-medium text-white transition focus:outline-none ${
                selectedPlayer
                  ? 'border-emerald-500/60 focus:border-emerald-400'
                  : 'border-gun-700 focus:border-purple-500'
              }`}
            />

            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-gun-400">
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setName('');
                    setIsComboboxOpen(true);
                    inputRef.current?.focus();
                  }}
                  className="p-1 hover:text-white transition"
                  title="Clear name"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsComboboxOpen((prev) => !prev)}
                className="p-1 hover:text-white transition"
                tabIndex={-1}
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${isComboboxOpen ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </div>

          {/* In-flow suggestions list: pushes PIN field down instead of covering it */}
          {isComboboxOpen && (
            <div className="mt-1.5 max-h-44 overflow-y-auto rounded-xl border border-gun-750 bg-gun-950/95 p-1 shadow-xl backdrop-blur-md">
              {filteredRoster.length > 0 ? (
                filteredRoster.map((player, idx) => {
                  const isHighlighted = idx === highlightedIndex;
                  const isSelected = player.name.toLowerCase() === name.toLowerCase();

                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => handleSelectPlayer(player)}
                      className={`flex w-full min-h-[40px] items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition ${
                        isHighlighted
                          ? 'bg-purple-600/30 text-white font-semibold'
                          : isSelected
                            ? 'bg-gun-800 text-emerald-300 font-medium'
                            : 'text-gun-200 hover:bg-gun-850 hover:text-white'
                      }`}
                    >
                      <span>{player.name}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-3 text-center text-xs font-mono text-gun-400">
                  No matching player found
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4-Digit PIN */}
        <div>
          <label className="text-xs font-mono text-gun-300 block mb-1.5 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-purple-400" />
            <span>4-Digit PIN</span>
          </label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]*"
            placeholder="••••"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
              setError(null);
            }}
            className="w-full rounded-xl border border-gun-700 bg-gun-950 py-3 text-center font-mono text-2xl tracking-[0.5em] text-white focus:border-purple-500 focus:outline-none"
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || !name || pin.length !== 4}
          className="w-full flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 py-3 font-bold text-white shadow-lg shadow-purple-600/30 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
        >
          <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
