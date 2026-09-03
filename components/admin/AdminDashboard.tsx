'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  DollarSign,
  Camera,
  Flame,
  Shield,
  Zap,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Plus,
  Package,
  Layers,
  Sparkles,
  AlertTriangle,
  Sliders,
  Trash2,
  Lock,
  Users,
  ImagePlus,
} from 'lucide-react';
import { uploadItemPhoto } from '@/lib/image';
import { BulkUpload } from './BulkUpload';
import type { BoxTier, EconomyConfig, Item, Rarity, SessionUser } from '@/lib/types';
import { RARITIES, BOX_TIERS, RARITY_COLOR, RARITY_LABEL, isScrappable } from '@/lib/types';
import { rarityForValue, tierForValue } from '@/lib/economy';
import { usd, pct, oneIn, ago, countdown, TIER_LABEL } from './format';
import { PlayerRoster } from './PlayerRoster';

export interface AdminDashboardProps {
  admin: SessionUser;
  initialConfig: EconomyConfig;
  initialDeposits: any[];
  initialItems: Item[];
  initialOverrides: any[];
  roster: { id: string; name: string }[];
}

export function AdminDashboard({
  admin,
  initialConfig,
  initialDeposits,
  initialItems,
  initialOverrides,
  roster,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<'deposits' | 'vision' | 'controls' | 'solvency' | 'players'>('deposits');
  const [config, setConfig] = useState<EconomyConfig>(initialConfig);
  const [deposits, setDeposits] = useState<any[]>(initialDeposits);
  const [items, setItems] = useState<Item[]>(initialItems);
  // Whether a vision provider is actually configured. Drives whether the
  // auto-name button is offered at all -- both keys are commonly blank.
  const [visionAvailable, setVisionAvailable] = useState(false);
  useEffect(() => {
    fetch('/api/vision/scan-item')
      .then((r) => r.json())
      .then((j) => setVisionAvailable(Boolean(j?.ok && j?.data?.available)))
      .catch(() => setVisionAvailable(false));
  }, []);
  const [overrides, setOverrides] = useState<any[]>(initialOverrides);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'good' | 'bad' } | null>(null);

  // Vision scanner & Quick Add state
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [scanImage, setScanImage] = useState<string | null>(null);
  const [scanMediaType, setScanMediaType] = useState<string>('image/jpeg');
  const [scanning, setScanning] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [itemForm, setItemForm] = useState<{
    name: string;
    description: string;
    est_value: string;
    box_tier: BoxTier;
    rarity: Rarity;
    scrap_value: string;
    stock_qty: string;
    image_url: string;
  }>({
    name: '',
    description: '',
    est_value: '4.00',
    box_tier: 'tier_1',
    rarity: 'grey',
    scrap_value: '40',
    stock_qty: '1',
    image_url: '',
  });

  // Manual Override form
  const [overrideUser, setOverrideUser] = useState('');
  const [overrideItem, setOverrideItem] = useState('');

  // Flash Sale Timer
  const [saleTimeLeft, setSaleTimeLeft] = useState<number>(0);

  const showMsg = (text: string, type: 'good' | 'bad' = 'good') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  };

  // Poll deposits
  const refreshDeposits = async () => {
    try {
      const res = await fetch('/api/admin/deposits');
      const json = await res.json();
      if (json.ok) setDeposits(json.data);
    } catch {}
  };

  const refreshItems = async () => {
    try {
      const res = await fetch('/api/admin/items');
      const json = await res.json();
      if (json.ok) setItems(json.data);
    } catch {}
  };

  const refreshConfig = async () => {
    try {
      const res = await fetch('/api/admin/config');
      const json = await res.json();
      if (json.ok) setConfig(json.data);
    } catch {}
  };

  const refreshOverrides = async () => {
    try {
      const res = await fetch('/api/admin/override');
      const json = await res.json();
      if (json.ok) setOverrides(json.data);
    } catch {}
  };

  useEffect(() => {
    const timer = setInterval(() => {
      refreshDeposits();
      if (config.flash_sale && config.flash_sale_ends_at) {
        const left = new Date(config.flash_sale_ends_at).getTime() - Date.now();
        setSaleTimeLeft(Math.max(0, left));
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [config]);

  // Handle Venmo approval
  const handleApproveDeposit = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/deposits/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositId: id }),
      });
      const json = await res.json();
      if (json.ok) {
        showMsg(`Deposit approved! Credited $${json.data.amount} to player.`);
        refreshDeposits();
      } else {
        showMsg(json.error || 'Failed to approve', 'bad');
      }
    } catch {
      showMsg('Network error', 'bad');
    } finally {
      setLoading(false);
    }
  };

  const handleRejectDeposit = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/deposits/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositId: id }),
      });
      const json = await res.json();
      if (json.ok) {
        showMsg('Deposit marked rejected.', 'good');
        refreshDeposits();
      } else {
        showMsg(json.error || 'Failed to reject', 'bad');
      }
    } catch {
      showMsg('Network error', 'bad');
    } finally {
      setLoading(false);
    }
  };

  // Image upload & Scan with client-side downscaling for fast mobile party wifi
  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanMediaType('image/jpeg');

    const img = new Image();
    img.onload = () => {
      const maxDim = 1024;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setScanImage(dataUrl);
      }
      URL.revokeObjectURL(img.src);
    };
    setScanFile(file);
    img.src = URL.createObjectURL(file);
  };

  /**
   * Attach a photo WITHOUT running the AI scan.
   *
   * Uploading used to happen only inside handleScanItem, so with no vision API
   * key configured -- the default -- there was no way to give an item a picture
   * at all. The reel is mostly images, so that made every card a placeholder.
   */
  const handleDirectPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadItemPhoto(file, itemForm.name || 'item');
      setItemForm((f) => ({ ...f, image_url: url }));
      showMsg('Photo stored');
    } catch (err) {
      showMsg(
        'Photo upload failed: ' + (err instanceof Error ? err.message : 'unknown'),
        'bad'
      );
    } finally {
      setUploading(false);
    }
  };

  /**
   * Wipe the test run. Two-step on purpose: this deletes real rows on a live
   * database, and one stray tap on a phone must not be able to clear a party
   * that is already underway.
   */
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    if (!resetArmed) { setResetArmed(true); return; }
    setResetting(true);
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const json = await res.json();
      if (json.ok) {
        const d = json.data ?? {};
        showMsg(
          'Reset done — cleared ' + (d.rolls_cleared ?? 0) + ' rolls and $' +
            Number(d.pot_cleared ?? 0).toFixed(2) + ' of test pot. Stock restored.'
        );
        setTimeout(() => window.location.reload(), 1200);
      } else {
        showMsg(json.error || 'Reset failed', 'bad');
      }
    } catch {
      showMsg('Reset request failed', 'bad');
    } finally {
      setResetting(false);
      setResetArmed(false);
    }
  };

  // Item deletion. Selection is a Set so "select all" stays O(1) per row.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteOne = async (id: string, name: string) => {
    if (!window.confirm('Delete "' + name + '" permanently?')) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/admin/items/' + id, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        showMsg('Deleted ' + name);
        setSelectedIds((p) => {
          const n = new Set(p);
          n.delete(id);
          return n;
        });
        refreshItems();
      } else {
        showMsg(json.error || 'Delete failed', 'bad');
      }
    } finally {
      setDeleting(false);
    }
  };

  const deleteSelected = async () => {
    if (!confirmBulk) {
      setConfirmBulk(true);
      return;
    }
    setDeleting(true);
    const ids = [...selectedIds];
    let gone = 0;
    // Sequential so one failure does not abandon the rest, and so the server
    // is not hit with 50 concurrent deletes.
    for (const id of ids) {
      try {
        const res = await fetch('/api/admin/items/' + id, { method: 'DELETE' });
        if ((await res.json()).ok) gone++;
      } catch {
        /* keep going */
      }
    }
    setDeleting(false);
    setConfirmBulk(false);
    setSelectedIds(new Set());
    showMsg('Deleted ' + gone + ' of ' + ids.length + ' items');
    refreshItems();
  };

  const handleScanItem = async () => {
    if (!scanImage) return;
    setScanning(true);
    try {
      const res = await fetch('/api/vision/scan-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: scanImage,
          mediaType: scanMediaType,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        const scan = json.data;
        setItemForm({
          name: scan.name,
          description: scan.description || scan.condition || '',
          est_value: scan.est_value.toFixed(2),
          box_tier: scan.box_tier,
          rarity: scan.rarity,
          scrap_value: String(scan.scrap_value),
          stock_qty: '1',
          // Deliberately blank: `scanImage` is a base64 data URI. Persisting it
          // would put a multi-hundred-KB string in every items row, every
          // box_odds payload and every reel frame. The real photo is uploaded
          // to Supabase Storage below and referenced by URL instead.
          image_url: '',
        });
        showMsg(`AI Identified: "${scan.name}" ($${scan.est_value.toFixed(2)})`);

        // Upload in the background. A failed upload must never block adding the
        // item -- the party will not wait for the wifi.
        if (scanFile) {
          setUploading(true);
          uploadItemPhoto(scanFile, scan.name)
            .then((url) => {
              setItemForm((f) => ({ ...f, image_url: url }));
              showMsg('Photo stored');
            })
            .catch((e: unknown) => {
              showMsg(
                'Photo upload failed (item can still be saved): ' +
                  (e instanceof Error ? e.message : 'unknown'),
                'bad'
              );
            })
            .finally(() => setUploading(false));
        }
      } else {
        showMsg(json.error || 'AI scan failed', 'bad');
      }
    } catch {
      showMsg('Vision request failed', 'bad');
    } finally {
      setScanning(false);
    }
  };

  const handleEstValueChange = (valStr: string) => {
    const num = Math.max(0, parseFloat(valStr) || 0);
    const derivedRarity = rarityForValue(num);
    const derivedTier = tierForValue(num);
    const derivedScrap = isScrappable(derivedRarity) ? String(Math.round(num * 10)) : '0';

    setItemForm((prev) => ({
      ...prev,
      est_value: valStr,
      rarity: derivedRarity,
      box_tier: derivedTier,
      scrap_value: derivedScrap,
    }));
  };

  const handleCreateItem = async (e?: React.FormEvent, keepFocus = false) => {
    if (e) e.preventDefault();
    if (!itemForm.name.trim()) return;

    setLoading(true);
    try {
      const valNum = Math.max(0.01, parseFloat(itemForm.est_value) || 0.01);
      const autoRarity = rarityForValue(valNum);
      const autoTier = tierForValue(valNum);
      const autoScrap = isScrappable(autoRarity) ? Math.round(valNum * 10) : 0;

      const res = await fetch('/api/admin/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: itemForm.name.trim(),
          description: itemForm.description.trim() || undefined,
          est_value: valNum,
          box_tier: autoTier,
          rarity: autoRarity,
          scrap_value: autoScrap,
          stock_qty: parseInt(itemForm.stock_qty || '1', 10),
          image_url: itemForm.image_url || undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        showMsg(`Added "${itemForm.name}" (${autoRarity.toUpperCase()} · ${autoTier})!`);
        setItemForm((prev) => ({
          ...prev,
          name: '',
          description: '',
          image_url: '',
        }));
        setScanImage(null);
        refreshItems();
        if (keepFocus && nameInputRef.current) {
          nameInputRef.current.focus();
        }
      } else {
        showMsg(json.error || 'Failed to create item', 'bad');
      }
    } catch {
      showMsg('Network error saving item', 'bad');
    } finally {
      setLoading(false);
    }
  };

  // Stock modifier
  const handleUpdateStock = async (itemId: string, delta: number, current: number) => {
    const next = Math.max(0, current + delta);
    try {
      const res = await fetch(`/api/admin/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_qty: next }),
      });
      if (res.ok) refreshItems();
    } catch {}
  };

  // Toggle Item active
  const handleToggleItemActive = async (itemId: string, active: boolean) => {
    try {
      const res = await fetch(`/api/admin/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !active }),
      });
      if (res.ok) refreshItems();
    } catch {}
  };

  // Flash sale toggle
  const handleToggleFlashSale = async (active: boolean) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/flash-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, durationMinutes: 15 }),
      });
      const json = await res.json();
      if (json.ok) {
        setConfig(json.data);
        showMsg(active ? '🔥 15-Minute Flash Sale Started!' : 'Flash Sale Stopped.');
      } else {
        showMsg(json.error || 'Failed to update flash sale', 'bad');
      }
    } catch {
      showMsg('Network error', 'bad');
    } finally {
      setLoading(false);
    }
  };

  // Pot gate threshold update
  // Local draft so the slider stays responsive; only the released value is saved.
  const [thresholdDraft, setThresholdDraft] = useState<number>(
    Number(config.pot_revenue_threshold) || 0
  );
  useEffect(() => {
    setThresholdDraft(Number(config.pot_revenue_threshold) || 0);
  }, [config.pot_revenue_threshold]);

  const handleUpdatePotThreshold = async (threshold: number) => {
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pot_revenue_threshold: threshold }),
      });
      const json = await res.json();
      if (json.ok) {
        setConfig(json.data);
        showMsg(`Pot threshold set to $${threshold}`);
      }
    } catch {}
  };

  // Manual Drop Override
  const handleSetOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideUser || !overrideItem) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: overrideUser, itemId: overrideItem }),
      });
      const json = await res.json();
      if (json.ok) {
        showMsg('Drop override armed! Next spin for this player is guaranteed.');
        setOverrideUser('');
        setOverrideItem('');
        refreshOverrides();
      } else {
        showMsg(json.error || 'Failed to arm override', 'bad');
      }
    } catch {
      showMsg('Network error', 'bad');
    } finally {
      setLoading(false);
    }
  };

  const handleClearOverride = async (userId: string) => {
    try {
      const res = await fetch(`/api/admin/override?userId=${userId}`, { method: 'DELETE' });
      if (res.ok) {
        showMsg('Override cleared');
        refreshOverrides();
      }
    } catch {}
  };

  const pendingDeposits = deposits.filter((d) => d.status === 'pending');
  const approvedDeposits = deposits.filter((d) => d.status === 'approved');
  const grossPot = approvedDeposits.reduce((s, d) => s + Number(d.amount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {msg && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-2xl border p-4 shadow-2xl backdrop-blur font-mono text-xs font-bold ${
            msg.type === 'good'
              ? 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200'
              : 'border-red-500/50 bg-red-950/90 text-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Admin Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gun-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-purple-500/20 border border-purple-500/40 px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-purple-300">
              Admin Portal
            </span>
            <span className="text-xs font-mono text-gun-400">Signed in as {admin.name}</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1">
            HOUSE CONTROLS & LEDGER
          </h1>
        </div>

        {/* Quick Pot Counter */}
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="rounded-xl bg-gun-900 border border-gun-750 px-4 py-2">
            <span className="text-gun-400 block text-[10px]">Gross House Pot</span>
            <span className="text-emerald-400 font-bold text-base">${grossPot.toFixed(2)}</span>
          </div>
          <div className="rounded-xl bg-gun-900 border border-gun-750 px-4 py-2">
            <span className="text-gun-400 block text-[10px]">Shard Gate ($400)</span>
            <span className={`font-bold text-base ${grossPot >= config.pot_revenue_threshold ? 'text-emerald-400' : 'text-amber-400'}`}>
              {grossPot >= config.pot_revenue_threshold ? 'UNLOCKED' : 'LOCKED'}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-gun-800 gap-2">
        <button
          onClick={() => setTab('deposits')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-mono font-bold transition ${
            tab === 'deposits'
              ? 'border-purple-500 text-purple-300'
              : 'border-transparent text-gun-400 hover:text-white'
          }`}
        >
          <DollarSign className="h-4 w-4" />
          <span>Venmo Ledger</span>
          {pendingDeposits.length > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.2 text-[10px] font-bold text-white animate-pulse">
              {pendingDeposits.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setTab('vision')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-mono font-bold transition ${
            tab === 'vision'
              ? 'border-purple-500 text-purple-300'
              : 'border-transparent text-gun-400 hover:text-white'
          }`}
        >
          <Camera className="h-4 w-4" />
          <span>AI Item Scanner & Loot</span>
        </button>

        <button
          onClick={() => setTab('controls')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-mono font-bold transition ${
            tab === 'controls'
              ? 'border-purple-500 text-purple-300'
              : 'border-transparent text-gun-400 hover:text-white'
          }`}
        >
          <Sliders className="h-4 w-4" />
          <span>Emergency Controls</span>
        </button>

        <button
          onClick={() => setTab('solvency')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-mono font-bold transition ${
            tab === 'solvency'
              ? 'border-purple-500 text-purple-300'
              : 'border-transparent text-gun-400 hover:text-white'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          <span>Economy Solvency</span>
        </button>

        <button
          onClick={() => setTab('players')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-mono font-bold transition ${
            tab === 'players'
              ? 'border-purple-500 text-purple-300'
              : 'border-transparent text-gun-400 hover:text-white'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Players & PINs</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: VENMO DEPOSITS QUEUE */}
      {/* ========================================================================= */}
      {tab === 'deposits' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Venmo Approval Queue</h2>
              <p className="text-xs font-mono text-gun-400">
                Matches incoming Venmo payments against deposit requests. One-tap balance crediting.
              </p>
            </div>
            <button
              onClick={refreshDeposits}
              className="flex items-center gap-1.5 rounded-xl border border-gun-700 bg-gun-850 px-3 py-1.5 text-xs font-mono text-gun-300 hover:text-white transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          {/* Pending Queue */}
          <div className="rounded-2xl border border-gun-750 bg-gun-900/90 overflow-hidden shadow-xl">
            <div className="p-4 bg-gun-950 border-b border-gun-800 flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                <span>Pending Approvals ({pendingDeposits.length})</span>
              </span>
            </div>

            <div className="divide-y divide-gun-800">
              {pendingDeposits.map((dep) => (
                <div key={dep.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-gun-850/40 transition">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-white">{dep.player_name}</span>
                      <span className="rounded bg-yellow-400/20 px-2 py-0.5 text-xs font-mono font-bold text-yellow-300">
                        {dep.venmo_note}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-gun-400 mt-1">
                      Requested {dep.amount ? `$${dep.amount.toFixed(2)}` : '$0'} · {ago(dep.created_at)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApproveDeposit(dep.id)}
                      disabled={loading}
                      className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 font-mono text-xs font-bold text-white shadow-lg shadow-emerald-600/20 hover:brightness-110 active:scale-95 disabled:opacity-50"
                    >
                      <CheckCircle className="h-4 w-4" />
                      <span>Approve (${dep.amount})</span>
                    </button>
                    <button
                      onClick={() => handleRejectDeposit(dep.id)}
                      disabled={loading}
                      className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 font-mono text-xs font-semibold text-red-300 hover:bg-red-900/60 active:scale-95 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              ))}

              {pendingDeposits.length === 0 && (
                <div className="p-8 text-center text-xs font-mono text-gun-500">
                  No pending deposit requests in queue.
                </div>
              )}
            </div>
          </div>

          {/* Historical Deposits */}
          <div>
            <h3 className="text-sm font-bold text-gun-300 mb-3 font-mono">Recent Processed Deposits</h3>
            <div className="rounded-2xl border border-gun-800 bg-gun-950/60 overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-gun-950 text-gun-400 border-b border-gun-800">
                  <tr>
                    <th className="py-2.5 px-4">Player</th>
                    <th className="py-2.5 px-3">Venmo Note</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-4 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gun-850">
                  {deposits.slice(0, 15).map((dep) => (
                    <tr key={dep.id} className="hover:bg-gun-900/40">
                      <td className="py-2.5 px-4 text-white font-semibold">{dep.player_name}</td>
                      <td className="py-2.5 px-3 text-gun-400">{dep.venmo_note}</td>
                      <td className="py-2.5 px-3 font-bold text-emerald-400">${Number(dep.amount).toFixed(2)}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] uppercase font-bold ${
                            dep.status === 'approved'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                              : dep.status === 'pending'
                                ? 'bg-amber-950 text-amber-400'
                                : 'bg-red-950 text-red-400'
                          }`}
                        >
                          {dep.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-gun-500">{ago(dep.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: AI ITEM SCANNER & LOOT MANAGEMENT */}
      {/* ========================================================================= */}
      {tab === 'vision' && (
        <div className="space-y-8">
          <BulkUpload
            visionReady={visionAvailable}
            showMsg={(m, k) => showMsg(m, k === 'bad' ? 'bad' : 'good')}
            onDone={refreshItems}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Camera & AI Scanner */}
            <div className="rounded-2xl border border-gun-700 bg-gun-900/90 p-5 shadow-xl">
              <h3 className="text-base font-bold text-white flex items-center gap-2 mb-1">
                <Camera className="h-5 w-5 text-purple-400" />
                <span>Multimodal Vision Ingestion</span>
              </h3>
              <p className="text-xs font-mono text-gun-400 mb-4">
                Take a photo of any item in the frat house. AI estimates used market value, CS:GO rarity, and tier.
              </p>

              <div className="space-y-4">
                {/* Upload / Camera capture */}
                <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gun-700 bg-gun-950/80 p-6 text-center hover:border-purple-500 transition">
                  {scanImage ? (
                    <div className="relative w-full max-h-56 flex items-center justify-center overflow-hidden rounded-xl">
                      <img src={scanImage} alt="Scan preview" className="max-h-56 object-contain rounded-xl" />
                      <button
                        type="button"
                        onClick={() => setScanImage(null)}
                        className="absolute top-2 right-2 rounded-full bg-black/80 p-1.5 text-white hover:bg-red-600 transition"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center cursor-pointer">
                      <Camera className="h-10 w-10 text-gun-400 mb-2" />
                      <span className="text-xs font-bold text-white">Take Photo or Upload Image</span>
                      <span className="text-[10px] font-mono text-gun-500 mt-1">JPEG, PNG, WEBP</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleImageFile}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {scanImage && (
                  <button
                    onClick={handleScanItem}
                    disabled={scanning}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 py-3 font-mono text-xs font-bold text-white shadow-lg shadow-purple-600/30 hover:brightness-110 active:scale-95 disabled:opacity-50"
                  >
                    <Sparkles className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
                    <span>{scanning ? 'Analyzing with Vision AI...' : 'Scan Item with AI Vision'}</span>
                  </button>
                )}

                {uploading && (
                  <p className="mt-2 text-center font-mono text-[11px] text-gun-300">
                    Storing photo&hellip;
                  </p>
                )}
                {/* Works with no AI key configured, which is the default. */}
                <div className="mt-2">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-gun-600 bg-gun-800 py-2.5 font-mono text-[11px] font-bold text-gun-200 transition hover:border-gun-500 hover:text-white">
                    <ImagePlus className="h-4 w-4" />
                    <span>{itemForm.image_url ? 'Replace Photo' : 'Add Photo (no AI needed)'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handleDirectPhoto}
                      disabled={uploading}
                    />
                  </label>
                  <p className="mt-1 text-center font-mono text-[10px] text-gun-500">
                    Resized on your phone before upload, so it works on house wifi.
                  </p>
                </div>

                {!uploading && itemForm.image_url && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={itemForm.image_url}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                    <span className="font-mono text-[11px] text-emerald-300">
                      Photo stored &mdash; this is what players will see on the reel.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Item Form */}
            <form onSubmit={(e) => handleCreateItem(e, false)} className="rounded-2xl border border-gun-700 bg-gun-900/90 p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Plus className="h-5 w-5 text-emerald-400" />
                  <span>Item Entry & Configuration</span>
                </h3>
                <span className="text-[10px] font-mono text-purple-300 bg-purple-950/60 border border-purple-500/30 px-2 py-0.5 rounded-full">
                  Auto-Tiered by Value
                </span>
              </div>

              <div>
                <label className="text-xs font-mono text-gun-300 block mb-1">Item Title</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  required
                  placeholder="e.g., HDMI Cable / Keychron Keyboard"
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  className="w-full rounded-xl border border-gun-700 bg-gun-950 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-gun-300 block mb-1">Description / Location (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g., Room 4 closet, mint condition"
                  value={itemForm.description}
                  onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                  className="w-full rounded-xl border border-gun-700 bg-gun-950 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono text-gun-300 block mb-1">Est. Value ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={itemForm.est_value}
                    onChange={(e) => handleEstValueChange(e.target.value)}
                    className="w-full rounded-xl border border-gun-700 bg-gun-950 px-3 py-2 font-mono text-sm text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-gun-300 block mb-1">Stock Quantity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={itemForm.stock_qty}
                    onChange={(e) => setItemForm({ ...itemForm, stock_qty: e.target.value })}
                    className="w-full rounded-xl border border-gun-700 bg-gun-950 px-3 py-2 font-mono text-sm text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Auto-derived anti-exploit badges */}
              <div className="rounded-xl border border-gun-800 bg-gun-950/80 p-3">
                <span className="text-[10px] font-mono text-gun-400 block mb-2 uppercase tracking-wider">
                  Mathematical Attributes (Anti-Exploit Protected)
                </span>
                <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                  <div className="rounded-lg bg-gun-900 border border-gun-800 p-2">
                    <span className="text-gun-500 text-[9px] block">BOX TIER</span>
                    <span className="font-bold text-indigo-300 uppercase text-[11px]">
                      {itemForm.box_tier.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="rounded-lg bg-gun-900 border border-gun-800 p-2">
                    <span className="text-gun-500 text-[9px] block">RARITY</span>
                    <span
                      className="font-bold uppercase text-[11px]"
                      style={{ color: RARITY_COLOR[itemForm.rarity] || '#fff' }}
                    >
                      {itemForm.rarity}
                    </span>
                  </div>
                  <div className="rounded-lg bg-gun-900 border border-gun-800 p-2">
                    <span className="text-gun-500 text-[9px] block">SCRAP COINS</span>
                    <span className="font-bold text-cyan-300 text-[11px]">
                      +{itemForm.scrap_value}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <button
                  type="submit"
                  disabled={loading || !itemForm.name.trim()}
                  className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 font-mono text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:brightness-110 active:scale-95 disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add Item'}
                </button>

                <button
                  type="button"
                  onClick={() => handleCreateItem(undefined, true)}
                  disabled={loading || !itemForm.name.trim()}
                  className="w-full rounded-xl border border-indigo-500/40 bg-indigo-950/60 py-3 font-mono text-xs font-bold text-indigo-200 shadow-lg hover:bg-indigo-900/80 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  title="Adds item and readies form for rapid sequential scanning"
                >
                  <Zap className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Quick Add & Next ⚡</span>
                </button>
              </div>
            </form>
          </div>

          {/* Loot Pool Table with live stock management */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-white font-mono">Loot Pool ({items.length})</h3>
              <div className="flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <button
                    onClick={deleteSelected}
                    disabled={deleting}
                    className={`flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-mono font-bold transition disabled:opacity-50 ${
                      confirmBulk
                        ? 'bg-red-600 text-white hover:bg-red-500'
                        : 'border border-red-500/40 bg-red-950/40 text-red-300 hover:bg-red-950/70'
                    }`}
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>
                      {deleting
                        ? 'Deleting…'
                        : confirmBulk
                          ? `Confirm — delete ${selectedIds.size}`
                          : `Delete ${selectedIds.size}`}
                    </span>
                  </button>
                )}
                {confirmBulk && (
                  <button
                    onClick={() => setConfirmBulk(false)}
                    className="rounded-xl px-2 py-1 text-xs font-mono text-gun-400 hover:text-white"
                  >
                    Cancel
                  </button>
                )}
              <button
                onClick={refreshItems}
                className="flex items-center gap-1 rounded-xl border border-gun-700 bg-gun-850 px-2.5 py-1 text-xs font-mono text-gun-300 hover:text-white"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Refresh</span>
              </button>
              </div>
            </div>

            <div className="rounded-2xl border border-gun-800 bg-gun-950/60 overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-gun-950 text-gun-400 border-b border-gun-800">
                  <tr>
                    <th className="py-3 pl-4 pr-1 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all items"
                        checked={items.length > 0 && selectedIds.size === items.length}
                        onChange={(e) =>
                          setSelectedIds(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())
                        }
                        className="h-3.5 w-3.5 accent-red-500"
                      />
                    </th>
                    <th className="py-3 px-4">Item</th>
                    <th className="py-3 px-3">Tier</th>
                    <th className="py-3 px-3">Rarity</th>
                    <th className="py-3 px-3 text-right">Value</th>
                    <th className="py-3 px-3 text-center">Stock</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gun-850">
                  {items.map((item) => {
                    const rColor = RARITY_COLOR[item.rarity] || '#fff';
                    const rLabel = RARITY_LABEL[item.rarity] || item.rarity;

                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-gun-900/40 ${selectedIds.has(item.id) ? 'bg-red-950/20' : ''}`}
                      >
                        <td className="py-3 pl-4 pr-1">
                          <input
                            type="checkbox"
                            aria-label={'Select ' + item.name}
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleSelected(item.id)}
                            className="h-3.5 w-3.5 accent-red-500"
                          />
                        </td>
                        <td className="py-3 px-4 font-sans font-semibold text-white">
                          <div className="flex items-center gap-2">
                            <span>{item.name}</span>
                            {!item.is_active && (
                              <span className="rounded bg-red-950 px-1.5 py-0.5 text-[9px] font-mono text-red-400">
                                Inactive
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-gun-300">{item.box_tier.replace('_', ' ')}</td>
                        <td className="py-3 px-3">
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white"
                            style={{ backgroundColor: rColor }}
                          >
                            {rLabel}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right text-emerald-400 font-bold">${Number(item.est_value).toFixed(2)}</td>
                        <td className="py-3 px-3 text-center">
                          <div className="inline-flex items-center gap-1.5 rounded-lg bg-gun-900 px-2 py-1 border border-gun-800">
                            <button
                              onClick={() => handleUpdateStock(item.id, -1, item.stock_qty)}
                              className="text-gun-400 hover:text-white px-1"
                            >
                              -
                            </button>
                            <span className={`font-bold ${item.stock_qty > 0 ? 'text-white' : 'text-red-400'}`}>
                              {item.stock_qty}
                            </span>
                            <button
                              onClick={() => handleUpdateStock(item.id, 1, item.stock_qty)}
                              className="text-gun-400 hover:text-white px-1"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleToggleItemActive(item.id, item.is_active)}
                            className={`rounded px-2 py-1 text-[10px] font-mono font-bold transition ${
                              item.is_active
                                ? 'bg-gun-800 text-gun-300 hover:bg-red-950 hover:text-red-300'
                                : 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {item.is_active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            onClick={() => deleteOne(item.id, item.name)}
                            disabled={deleting}
                            title="Delete permanently"
                            className="ml-1.5 rounded bg-gun-800 px-2 py-1 text-gun-400 transition hover:bg-red-950 hover:text-red-300 disabled:opacity-50"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: EMERGENCY CONTROLS */}
      {/* ========================================================================= */}
      {tab === 'controls' && (
        <div className="space-y-6">
          {/* Reset — clears the test run before the party starts for real */}
          <div className="rounded-2xl border border-amber-500/40 bg-gun-900/90 p-5 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">Reset Party State</h3>
            </div>
            <p className="mb-3 font-mono text-[11px] leading-relaxed text-gun-300">
              Clears every roll, deposit, balance, scrap coin and shard, and restores
              all items to their opening stock. Player names, roles and PINs are kept.
              <br />
              <span className="text-amber-300">
                Run this when you finish testing — approved test deposits count toward
                the pot and can unlock the shard gate before anyone has actually played.
              </span>
            </p>
            <button
              onClick={handleReset}
              disabled={resetting}
              className={`w-full rounded-xl py-3 font-mono text-xs font-bold transition active:scale-95 disabled:opacity-50 ${
                resetArmed
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
              }`}
            >
              {resetting
                ? 'Resetting…'
                : resetArmed
                  ? 'Tap again to confirm — this cannot be undone'
                  : 'Reset Party State'}
            </button>
            {resetArmed && !resetting && (
              <button
                onClick={() => setResetArmed(false)}
                className="mt-2 w-full font-mono text-[11px] text-gun-400 hover:text-white"
              >
                Cancel
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Flash Sale Control */}
            <div className="rounded-2xl border border-red-500/30 bg-gun-900/90 p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-2">
                <Flame className="h-5 w-5 text-red-400" />
                <h3 className="text-base font-bold text-white">Flash Sale Engine</h3>
              </div>
              <p className="text-xs text-gun-300 mb-4">
                Triggers a 15-minute 20% discount on all box prices across all connected phones.
              </p>

              <div className="rounded-xl bg-gun-950 p-4 border border-gun-800 mb-4 font-mono text-xs">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-gun-400">Sale Status:</span>
                  <span className={`font-bold ${config.flash_sale ? 'text-red-400' : 'text-gun-400'}`}>
                    {config.flash_sale ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>
                {config.flash_sale && (
                  <div className="flex justify-between items-center text-yellow-400">
                    <span>Time Remaining:</span>
                    <span className="font-bold">{countdown(saleTimeLeft)}</span>
                  </div>
                )}
              </div>

              {config.flash_sale ? (
                <button
                  onClick={() => handleToggleFlashSale(false)}
                  disabled={loading}
                  className="w-full rounded-xl bg-gun-800 py-3 font-mono text-xs font-bold text-red-300 border border-red-500/40 hover:bg-red-950 transition"
                >
                  Stop Flash Sale Immediately
                </button>
              ) : (
                <button
                  onClick={() => handleToggleFlashSale(true)}
                  disabled={loading}
                  className="w-full rounded-xl bg-gradient-to-r from-red-600 to-amber-600 py-3 font-mono text-xs font-bold text-white shadow-lg shadow-red-600/30 hover:brightness-110 active:scale-95 transition"
                >
                  Trigger 15-Minute Flash Sale (20% OFF)
                </button>
              )}
            </div>

            {/* Pot Threshold Control */}
            <div className="rounded-2xl border border-yellow-500/30 bg-gun-900/90 p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="h-5 w-5 text-yellow-400" />
                <h3 className="text-base font-bold text-white">Pot Gate Revenue Threshold</h3>
              </div>
              <p className="text-xs text-gun-300 mb-4">
                PC Shards stay locked at 0% chance until approved Venmo deposits cross this amount.
              </p>

              <div className="rounded-xl bg-gun-950 p-4 border border-gun-800 mb-4 font-mono text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-gun-400">Current Threshold:</span>
                  <span className="text-yellow-400 font-bold">${config.pot_revenue_threshold}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gun-400">Current Gross Pot:</span>
                  <span className="text-emerald-400 font-bold">${grossPot.toFixed(2)}</span>
                </div>
              </div>

              {/* Slider in $10 steps. The preset buttons only offered 0/200/400/600,
                  which could not express the ~$150 the owner actually wants. Value
                  is committed on release, not on every drag frame, so one gesture
                  is one write. */}
              <div className="space-y-2">
                <div className="flex items-baseline justify-between font-mono text-xs">
                  <span className="text-gun-400">Unlock at</span>
                  <span className="text-lg font-black text-yellow-300">${thresholdDraft}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={10}
                  value={thresholdDraft}
                  onChange={(e) => setThresholdDraft(Number(e.target.value))}
                  onMouseUp={() => handleUpdatePotThreshold(thresholdDraft)}
                  onTouchEnd={() => handleUpdatePotThreshold(thresholdDraft)}
                  onKeyUp={() => handleUpdatePotThreshold(thresholdDraft)}
                  className="w-full accent-yellow-400"
                  aria-label="Pot gate threshold"
                />
                <div className="flex justify-between font-mono text-[10px] text-gun-500">
                  <span>$0 (always on)</span>
                  <span>$500</span>
                  <span>$1000</span>
                </div>
                <p className="font-mono text-[10px] leading-relaxed text-gun-400">
                  {grossPot >= thresholdDraft
                    ? 'Gross pot is $' + grossPot.toFixed(2) + ' — shards are UNLOCKED at this setting.'
                    : 'Needs $' +
                      (thresholdDraft - grossPot).toFixed(2) +
                      ' more in approved deposits before shards start dropping.'}
                </p>
              </div>
            </div>
          </div>

          {/* Manual Drop Override */}
          <div className="rounded-2xl border border-gun-700 bg-gun-900/90 p-5 shadow-xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2 mb-1">
              <Zap className="h-5 w-5 text-indigo-400" />
              <span>Manual Drop Override (God Mode)</span>
            </h3>
            <p className="text-xs font-mono text-gun-400 mb-4">
              Force a specific player's next mystery box spin to guarantee a chosen item from the loot pool.
            </p>

            <form onSubmit={handleSetOverride} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="text-xs font-mono text-gun-300 block mb-1">Select Player</label>
                <select
                  value={overrideUser}
                  onChange={(e) => setOverrideUser(e.target.value)}
                  required
                  className="w-full rounded-xl border border-gun-700 bg-gun-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">-- Choose Player --</option>
                  {roster.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-mono text-gun-300 block mb-1">Guaranteed Item</label>
                <select
                  value={overrideItem}
                  onChange={(e) => setOverrideItem(e.target.value)}
                  required
                  className="w-full rounded-xl border border-gun-700 bg-gun-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">-- Choose Item --</option>
                  {items
                    .filter((i) => i.stock_qty > 0)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} (${Number(item.est_value).toFixed(0)}) [{item.rarity}]
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={loading || !overrideUser || !overrideItem}
                  className="w-full rounded-xl bg-indigo-600 py-2.5 font-mono text-xs font-bold text-white shadow-lg hover:bg-indigo-500 active:scale-95 disabled:opacity-50 transition"
                >
                  Arm Guaranteed Drop
                </button>
              </div>
            </form>

            {/* Active Overrides List */}
            {overrides.length > 0 && (
              <div className="border-t border-gun-800 pt-3">
                <span className="text-[11px] font-mono text-gun-400 uppercase">Active Overrides Queued:</span>
                <div className="mt-2 space-y-2">
                  {overrides.map((ov) => (
                    <div
                      key={ov.user_id}
                      className="flex items-center justify-between rounded-xl bg-gun-950 p-3 border border-indigo-500/30 text-xs font-mono"
                    >
                      <div>
                        <span className="font-bold text-white">{ov.profiles?.name}</span>
                        <span className="text-gun-400"> will receive </span>
                        <span className="text-yellow-400 font-bold">{ov.items?.name}</span>
                      </div>
                      <button
                        onClick={() => handleClearOverride(ov.user_id)}
                        className="text-red-400 hover:text-red-300 text-[10px]"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: ECONOMY SOLVENCY & LIVE ODDS */}
      {/* ========================================================================= */}
      {tab === 'solvency' && (
        <div className="space-y-6 font-mono text-xs">
          <div className="rounded-2xl border border-gun-700 bg-gun-900/90 p-5 shadow-xl">
            <h3 className="text-base font-bold text-white font-sans flex items-center gap-2 mb-1">
              <Sparkles className="h-5 w-5 text-yellow-400" />
              <span>Corrected Dual-Anchor Engine Status</span>
            </h3>
            <p className="text-gun-400 mb-4 font-sans text-xs">
              Every mystery box solves dynamic anchor probabilities to strictly hold a 20% house edge.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-gun-950 p-3 border border-gun-800">
                <span className="text-gun-400 block text-[10px]">House Margin</span>
                <span className="text-emerald-400 font-bold text-sm">{(config.house_margin * 100).toFixed(0)}%</span>
              </div>
              <div className="rounded-xl bg-gun-950 p-3 border border-gun-800">
                <span className="text-gun-400 block text-[10px]">PC Rig Valuation</span>
                <span className="text-white font-bold text-sm">${config.pc_value}</span>
              </div>
              <div className="rounded-xl bg-gun-950 p-3 border border-gun-800">
                <span className="text-gun-400 block text-[10px]">Shards Required</span>
                <span className="text-yellow-400 font-bold text-sm">{config.shards_required} shards</span>
              </div>
              <div className="rounded-xl bg-gun-950 p-3 border border-gun-800">
                <span className="text-gun-400 block text-[10px]">PC Minted</span>
                <span className="text-cyan-300 font-bold text-sm">{config.pc_shards_minted} shards</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gun-800 bg-gun-950/60 p-5">
            <h4 className="font-bold text-white text-sm mb-3">Tier Shard Probabilities</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {BOX_TIERS.map((tier) => (
                <div key={tier} className="rounded-xl bg-gun-900 p-3 border border-gun-800">
                  <span className="text-gun-400 block uppercase text-[10px]">{tier.replace('_', ' ')}</span>
                  <span className="text-yellow-400 font-bold text-base">
                    {(config.shard_probs[tier] * 100).toFixed(1)}% Shard Drop
                  </span>
                  <span className="block text-gun-500 text-[10px] mt-1">
                    Price: ${config.box_prices[tier]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: PLAYER ROSTER & PIN RESETS */}
      {/* ========================================================================= */}
      {tab === 'players' && (
        <PlayerRoster />
      )}
    </div>
  );
}
