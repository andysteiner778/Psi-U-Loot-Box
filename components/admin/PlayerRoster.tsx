'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  KeyRound,
  Shield,
  ShieldCheck,
  Edit2,
  Check,
  X,
  Search,
  RefreshCw,
  Coins,
  DollarSign,
  Zap,
  Gift,
} from 'lucide-react';
import type { Profile } from '@/lib/types';

export function PlayerRoster() {
  const [players, setPlayers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; type: 'good' | 'bad' } | null>(null);
  const [giftFor, setGiftFor] = useState<string | null>(null);
  const [giftTier, setGiftTier] = useState<'tier_1' | 'tier_2' | 'tier_3'>('tier_1');
  const [giftCount, setGiftCount] = useState('5');
  const [gifting, setGifting] = useState(false);

  /**
   * Gift free spins. Credited as balance so it spends exactly like a deposit,
   * but recorded in the gifts ledger rather than `deposits` -- a gift is not
   * revenue and must not push the pot past the shard gate.
   */
  const giftSpins = async (p: Profile) => {
    const count = parseInt(giftCount, 10);
    if (!Number.isFinite(count) || count < 1) {
      showMsg('Pick a number of spins', 'bad');
      return;
    }
    setGifting(true);
    try {
      const res = await fetch('/api/admin/gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: p.id, tier: giftTier, count }),
      });
      const json = await res.json();
      if (json.ok) {
        showMsg('Gave ' + p.name + ' ' + count + ' free spins ($' + Number(json.data.credited).toFixed(2) + ')');
        setGiftFor(null);
        void fetchPlayers();
      } else {
        showMsg(json.error || 'Gift failed', 'bad');
      }
    } catch {
      showMsg('Network error sending gift', 'bad');
    } finally {
      setGifting(false);
    }
  };

  const showMsg = (text: string, type: 'good' | 'bad' = 'good') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  };

  const fetchPlayers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/players');
      const json = await res.json();
      if (json.ok && json.data) {
        setPlayers(json.data);
      } else {
        showMsg(json.error || 'Failed to load players', 'bad');
      }
    } catch {
      showMsg('Network error loading player roster', 'bad');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlayers();
  }, []);

  const handleStartEdit = (p: Profile) => {
    setEditingId(p.id);
    setEditName(p.name);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleSaveName = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      showMsg('Name cannot be empty', 'bad');
      return;
    }

    setSaving(id);
    try {
      const res = await fetch(`/api/admin/players/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      const json = await res.json();
      if (json.ok && json.data) {
        setPlayers((prev) => prev.map((p) => (p.id === id ? json.data : p)));
        setEditingId(null);
        showMsg(`Renamed player to "${trimmed}"!`);
      } else {
        showMsg(json.error || 'Failed to rename player', 'bad');
      }
    } catch {
      showMsg('Network error saving player name', 'bad');
    } finally {
      setSaving(null);
    }
  };

  const handleResetPin = async (p: Profile) => {
    if (!confirm(`Reset PIN for "${p.name}" to 1234?\nThey will be prompted to pick a new PIN on next login.`)) {
      return;
    }

    setSaving(p.id);
    try {
      const res = await fetch(`/api/admin/players/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_pin: true }),
      });

      const json = await res.json();
      if (json.ok) {
        showMsg(`PIN for "${p.name}" reset to 1234 (must change on login)!`);
      } else {
        showMsg(json.error || 'Failed to reset PIN', 'bad');
      }
    } catch {
      showMsg('Network error resetting PIN', 'bad');
    } finally {
      setSaving(null);
    }
  };

  const handleToggleRole = async (p: Profile) => {
    const nextRole = p.role === 'admin' ? 'player' : 'admin';
    const action = nextRole === 'admin' ? 'Promote' : 'Demote';

    if (!confirm(`${action} "${p.name}" to ${nextRole.toUpperCase()}?`)) {
      return;
    }

    setSaving(p.id);
    try {
      const res = await fetch(`/api/admin/players/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });

      const json = await res.json();
      if (json.ok && json.data) {
        setPlayers((prev) => prev.map((item) => (item.id === p.id ? json.data : item)));
        showMsg(`Updated role for "${p.name}" to ${nextRole}!`);
      } else {
        showMsg(json.error || 'Failed to update role', 'bad');
      }
    } catch {
      showMsg('Network error updating role', 'bad');
    } finally {
      setSaving(null);
    }
  };

  const filtered = players.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {msg && (
        <div
          className={`rounded-xl p-3 text-xs font-semibold flex items-center justify-between border ${
            msg.type === 'good'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/60 border-red-500/40 text-red-300'
          }`}
        >
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-400" />
            <span>Player Roster ({players.length})</span>
          </h2>
          <p className="text-xs text-gun-400">
            Rename seeded placeholders to real housemate names, reset forgotten PINs, or promote co-admins.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gun-500" />
            <input
              type="text"
              placeholder="Search housemates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-xl border border-gun-700 bg-gun-950 py-2 pl-9 pr-3 text-xs text-white placeholder-gun-500 focus:border-indigo-500 focus:outline-none w-48 sm:w-60"
            />
          </div>
          <button
            onClick={fetchPlayers}
            disabled={loading}
            title="Refresh Roster"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-gun-700 bg-gun-850 text-gun-300 hover:text-white transition"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Roster Table */}
      <div className="overflow-x-auto rounded-2xl border border-gun-800 bg-gun-900/80 shadow-xl backdrop-blur-md">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gun-800 bg-gun-950/80 text-[11px] font-mono uppercase tracking-wider text-gun-400">
              <th className="py-3 px-4">Housemate</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4 text-right">Balance</th>
              <th className="py-3 px-4 text-center">Shards</th>
              <th className="py-3 px-4 text-right">Scrap</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gun-850">
            {filtered.map((p) => {
              const isEditing = editingId === p.id;
              const isSavingThis = saving === p.id;

              return (
                <tr key={p.id} className="hover:bg-gun-850/50 transition">
                  {/* Name column */}
                  <td className="py-3 px-4 font-semibold text-white">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveName(p.id);
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                          className="rounded-lg border border-indigo-500 bg-gun-950 px-2 py-1 text-xs text-white focus:outline-none"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveName(p.id)}
                          disabled={isSavingThis}
                          className="rounded-md bg-emerald-600 p-1 text-white hover:bg-emerald-500 transition"
                          title="Save Name"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="rounded-md bg-gun-750 p-1 text-gun-300 hover:bg-gun-700 transition"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{p.name}</span>
                        <button
                          onClick={() => handleStartEdit(p)}
                          className="text-gun-500 hover:text-indigo-400 transition"
                          title="Rename Player"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Role column */}
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleToggleRole(p)}
                      disabled={isSavingThis}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider transition ${
                        p.role === 'admin'
                          ? 'bg-purple-950/80 border border-purple-500/50 text-purple-300 hover:bg-purple-900'
                          : 'bg-gun-800 border border-gun-700 text-gun-300 hover:bg-gun-750'
                      }`}
                      title={p.role === 'admin' ? 'Click to demote to player' : 'Click to promote to admin'}
                    >
                      {p.role === 'admin' ? (
                        <>
                          <ShieldCheck className="h-3 w-3 text-purple-400" />
                          <span>Admin</span>
                        </>
                      ) : (
                        <span>Player</span>
                      )}
                    </button>
                  </td>

                  {/* Balance */}
                  <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                    ${p.balance.toFixed(2)}
                  </td>

                  {/* Shards */}
                  <td className="py-3 px-4 text-center font-mono">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        p.pc_shards > 0
                          ? 'bg-yellow-950/60 border border-yellow-500/30 text-yellow-400'
                          : 'text-gun-500'
                      }`}
                    >
                      {p.pc_shards}/5
                    </span>
                  </td>

                  {/* Scrap coins */}
                  <td className="py-3 px-4 text-right font-mono text-cyan-300">
                    {p.scrap_coins}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleResetPin(p)}
                      disabled={isSavingThis}
                      className="inline-flex items-center gap-1 rounded-lg border border-gun-700 bg-gun-800 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:border-amber-500/50 hover:bg-amber-950/40 transition"
                      title="Reset PIN to 1234 (forces change on login)"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>Reset PIN</span>
                    </button>
                    <button
                      onClick={() => setGiftFor(giftFor === p.id ? null : p.id)}
                      className="ml-1.5 inline-flex items-center gap-1 rounded-lg border border-gun-700 bg-gun-800 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:border-emerald-500/50 hover:bg-emerald-950/40"
                      title="Gift free spins"
                    >
                      <Gift className="h-3.5 w-3.5" />
                      <span>Gift</span>
                    </button>

                    {giftFor === p.id && (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-2">
                        <input
                          value={giftCount}
                          onChange={(e) => setGiftCount(e.target.value.replace(/\D/g, '').slice(0, 2))}
                          inputMode="numeric"
                          className="w-12 rounded bg-gun-950 px-2 py-1 text-center font-mono text-[11px] text-white outline-none"
                          aria-label="Number of spins"
                        />
                        <select
                          value={giftTier}
                          onChange={(e) => setGiftTier(e.target.value as typeof giftTier)}
                          className="rounded bg-gun-950 px-2 py-1 font-mono text-[11px] text-white outline-none"
                          aria-label="Box tier"
                        >
                          <option value="tier_1">Tier 1 ($5)</option>
                          <option value="tier_2">Tier 2 ($20)</option>
                          <option value="tier_3">Tier 3 ($50)</option>
                        </select>
                        <button
                          onClick={() => giftSpins(p)}
                          disabled={gifting}
                          className="rounded-lg bg-emerald-600 px-3 py-1 font-mono text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {gifting ? 'Sending…' : 'Send'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gun-500 font-mono">
                  {loading ? 'Loading roster...' : 'No players match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
