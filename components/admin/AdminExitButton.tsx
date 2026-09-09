'use client';

import React, { useState } from 'react';
import { ArrowLeft, Lock, Loader2 } from 'lucide-react';

interface AdminExitButtonProps {
  label?: string;
  showLockNow?: boolean;
}

export function AdminExitButton({
  label = 'Back to Main Menu',
  showLockNow = true,
}: AdminExitButtonProps) {
  const [exiting, setExiting] = useState(false);
  const [locking, setLocking] = useState(false);

  /*
   * Leaving the panel does NOT lock it.
   *
   * This used to DELETE the unlock cookie before navigating, so stepping out to
   * the game for ten seconds cost you the PIN again. The unlock is meant to
   * last 30 minutes of ordinary back-and-forth; the thing it defends against is
   * an unattended phone, and that is what the TTL and the explicit Lock Admin
   * button are for.
   */
  const handleExit = () => {
    setExiting(true);
    window.location.href = '/';
  };

  const handleLockNow = async () => {
    setLocking(true);
    try {
      await fetch('/api/admin/unlock', { method: 'DELETE' });
    } catch {
      // ignore
    }
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleExit}
        disabled={exiting || locking}
        title="Return to the game — admin stays unlocked"
        className="inline-flex items-center gap-1.5 rounded-xl border border-gun-700 bg-gun-850 px-3 py-1.5 text-xs font-mono text-gun-300 hover:text-white hover:border-gun-600 transition disabled:opacity-50"
      >
        {exiting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowLeft className="h-3.5 w-3.5" />
        )}
        <span>{label}</span>
      </button>

      {showLockNow && (
        <button
          onClick={handleLockNow}
          disabled={exiting || locking}
          title="Lock admin session immediately"
          className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-950/20 px-2.5 py-1.5 text-xs font-mono text-red-300 hover:bg-red-900/30 hover:border-red-500/50 transition disabled:opacity-50"
        >
          {locking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>Lock Admin</span>
        </button>
      )}
    </div>
  );
}
