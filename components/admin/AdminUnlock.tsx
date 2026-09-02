'use client';

import { useState } from 'react';
import { ShieldCheck, Lock, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

/**
 * Admin step-up PIN screen.
 *
 * The PIN is posted to the server and compared there in constant time; it is
 * never held in client state beyond the keystroke, and the check cannot be
 * skipped by editing anything in the browser. See lib/admin-lock.ts.
 */
export function AdminUnlock({ configured }: { configured: boolean }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error ?? 'Incorrect PIN');
      setPin('');
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="w-full max-w-md space-y-4 rounded-3xl border border-amber-500/40 bg-gun-900/90 p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/40 bg-amber-500/20 text-amber-400">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-black tracking-tight">Admin PIN not set</h1>
        <p className="font-mono text-xs leading-relaxed text-gun-300">
          Set <span className="text-amber-300">ADMIN_PIN</span> in your environment
          (and in the Vercel dashboard) to lock the house controls behind a second
          factor. Until then the panel is open to anyone signed in as an admin.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md space-y-5 rounded-3xl border border-purple-500/40 bg-gun-900/90 p-8 text-center shadow-2xl"
    >
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-purple-500/40 bg-purple-500/20 text-purple-300">
        <Lock className="h-8 w-8" />
      </div>
      <div>
        <h1 className="text-2xl font-black tracking-tight">House Controls Locked</h1>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-gun-300">
          Enter the admin PIN. Unlocks for 30 minutes, then re-locks on its own so
          an unattended phone can&apos;t be used to change the odds.
        </p>
      </div>

      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
        placeholder="••••"
        aria-label="Admin PIN"
        className="w-full rounded-xl border border-gun-700 bg-gun-950 py-4 text-center font-mono text-2xl tracking-[0.6em] text-white outline-none focus:border-purple-500"
      />

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-950/40 py-2 font-mono text-xs text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pin.length < 4 || busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 py-3 font-mono text-xs font-bold text-white transition hover:bg-purple-500 disabled:opacity-40"
      >
        <ShieldCheck className="h-4 w-4" />
        {busy ? 'Checking…' : 'Unlock House Controls'}
      </button>

      <Link
        href="/"
        className="block font-mono text-[11px] text-gun-400 transition hover:text-white"
      >
        Back to Game
      </Link>
    </form>
  );
}
