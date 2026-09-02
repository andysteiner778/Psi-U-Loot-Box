'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Lock, User, ShieldCheck, AlertCircle, ArrowRight } from 'lucide-react';
import { apiLogin, apiSetPin } from '@/app/(player)/_lib/api';
import { sfx } from '@/lib/sound';

export interface LoginFormProps {
  roster: { id: string; name: string }[];
  initialMustChange?: boolean;
  userName?: string;
}

export function LoginForm({ roster, initialMustChange = false, userName = '' }: LoginFormProps) {
  const router = useRouter();
  const [name, setName] = useState(userName);
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'login' | 'changePin'>(initialMustChange ? 'changePin' : 'login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      setError('Please choose your name');
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
      const res = await apiLogin(name, pin);
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
        {/* Name Selector */}
        <div>
          <label className="text-xs font-mono text-gun-300 block mb-1.5 flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-blue-400" />
            <span>Select Player Name</span>
          </label>
          <select
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            className="w-full rounded-xl border border-gun-700 bg-gun-950 py-3 px-3 text-sm font-medium text-white focus:border-purple-500 focus:outline-none"
          >
            <option value="">-- Choose your profile --</option>
            {roster.map((player) => (
              <option key={player.id} value={player.name}>
                {player.name}
              </option>
            ))}
          </select>
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
