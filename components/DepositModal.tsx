'use client';

import React, { useState } from 'react';
import { X, DollarSign, Send, CheckCircle2, ShieldCheck } from 'lucide-react';
import { usePlayer } from '@/app/(player)/_lib/player-store';

export interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_AMOUNTS = [5, 20, 50, 100];

export function DepositModal({ isOpen, onClose }: DepositModalProps) {
  const { user, toast } = usePlayer();
  const [amount, setAmount] = useState<number>(20);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const activeAmount = customAmount ? parseFloat(customAmount) : amount;
  const venmoNote = `#BOX-${user.name}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAmount || activeAmount <= 0) {
      toast('Please enter a valid amount', 'bad');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: activeAmount,
          venmoNote,
        }),
      });

      const json = await res.json();
      if (res.ok && json.ok) {
        setSubmitted(true);
        toast(`Deposit request for $${activeAmount.toFixed(2)} submitted!`, 'good');
      } else {
        toast(json.error || 'Failed to submit deposit', 'bad');
      }
    } catch {
      toast('Network error submitting deposit', 'bad');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setCustomAmount('');
    setAmount(20);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-md rounded-2xl border border-gun-700 bg-gun-900 p-6 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={handleReset}
          className="absolute right-4 top-4 rounded-full bg-gun-800 p-1.5 text-gun-400 hover:bg-gun-700 hover:text-white transition"
        >
          <X className="h-4 w-4" />
        </button>

        {!submitted ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Deposit House Credits</h3>
                <p className="text-xs text-gun-400">Venmo approvals are instant & atomic.</p>
              </div>
            </div>

            {/* Venmo Instructions Box & Deep Link */}
            <div className="rounded-xl bg-gun-950 p-4 border border-gun-800 text-xs space-y-2 mb-5">
              <div className="flex items-center justify-between">
                <span className="text-gun-400">1. Venmo Recipient:</span>
                <span className="font-mono font-bold text-cyan-400">@Tyler-HouseLoot</span>
              </div>
              <div className="flex items-center justify-between border-t border-gun-850 pt-2">
                <span className="text-gun-400">2. Mandatory Note:</span>
                <span className="rounded bg-gun-800 px-2 py-0.5 font-mono font-bold text-yellow-400">
                  {venmoNote}
                </span>
              </div>
              <div className="pt-1">
                <a
                  href={`https://venmo.com/?txn=pay&recipients=Tyler-HouseLoot&amount=${activeAmount || 20}&note=${encodeURIComponent(venmoNote)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-sky-600/20 border border-sky-500/40 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-600/30 transition"
                >
                  <span>Open Venmo App Directly ↗</span>
                </a>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Presets */}
              <div>
                <label className="text-xs font-mono text-gun-300 mb-1.5 block">Select Amount</label>
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setAmount(amt);
                        setCustomAmount('');
                      }}
                      className={`rounded-xl py-2.5 font-mono text-sm font-bold border transition ${
                        !customAmount && amount === amt
                          ? 'border-emerald-500 bg-emerald-950/60 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                          : 'border-gun-750 bg-gun-850 text-gun-300 hover:border-gun-600 hover:text-white'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Input */}
              <div>
                <label className="text-xs font-mono text-gun-300 mb-1.5 block">Or Custom Amount ($)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 font-mono text-gun-400">$</span>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    placeholder="Other amount..."
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full rounded-xl border border-gun-700 bg-gun-950 py-2 pl-7 pr-3 font-mono text-sm text-white placeholder-gun-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !activeAmount || activeAmount <= 0}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>{submitting ? 'Submitting...' : `I Sent $${activeAmount || 0} via Venmo`}</span>
              </button>
            </form>
          </div>
        ) : (
          <div className="py-4 text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 border-2 border-emerald-400 text-emerald-400">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-white">Deposit Submitted!</h3>
            <p className="text-xs text-gun-300 leading-relaxed max-w-xs mx-auto">
              Your deposit request for <strong className="text-emerald-400">${activeAmount.toFixed(2)}</strong> with note <strong className="text-yellow-400">{venmoNote}</strong> has been logged in the admin queue.
            </p>
            <p className="text-[11px] text-gun-400 font-mono flex items-center justify-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Balance will update automatically once verified.</span>
            </p>
            <button
              onClick={handleReset}
              className="w-full rounded-xl bg-gun-800 py-2.5 font-semibold text-white hover:bg-gun-700 transition"
            >
              Back to Boxes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
