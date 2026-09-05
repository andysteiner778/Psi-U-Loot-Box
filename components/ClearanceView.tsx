'use client';

import React, { useState, useEffect, useId } from 'react';
import confetti from 'canvas-confetti';
import {
  Package,
  Sparkles,
  Check,
  X,
  AlertCircle,
  Clock,
  RotateCw,
  ShoppingBag,
  Coins,
  ShieldCheck,
  ChevronRight,
  Plus,
} from 'lucide-react';
import type { BoxTier, Rarity, SessionUser } from '@/lib/types';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/types';

interface ClearanceItem {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  est_value: number;
  msrp: number | null;
  rarity: Rarity;
  stock_qty: number;
  box_tier: BoxTier;
}

interface ClearanceConfig {
  enabled: boolean;
  spin_discount_rate: number;
  allow_venmo_reserve: boolean;
}

interface ClearanceViewProps {
  user: SessionUser | null;
  initialBalance?: number;
  onRefreshPlayer?: () => void;
}

export function ClearanceView({ user, initialBalance = 0, onRefreshPlayer }: ClearanceViewProps) {
  const [items, setItems] = useState<ClearanceItem[]>([]);
  const [config, setConfig] = useState<ClearanceConfig>({
    enabled: true,
    spin_discount_rate: 0.75,
    allow_venmo_reserve: true,
  });
  const [balance, setBalance] = useState(initialBalance);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'good' | 'bad' } | null>(null);

  // Buyout modal state
  const [buyoutTarget, setBuyoutTarget] = useState<ClearanceItem | null>(null);
  const [buyoutSuccess, setBuyoutSuccess] = useState<{
    item: ClearanceItem;
    paymentMethod: string;
    price: number;
  } | null>(null);

  // Spin animation state
  const [spinModalOpen, setSpinModalOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [spinHighlightIndex, setSpinHighlightIndex] = useState(0);
  const [spinWinner, setSpinWinner] = useState<ClearanceItem | null>(null);
  const [spinPaymentMethod, setSpinPaymentMethod] = useState<'balance' | 'venmo_reserve'>('balance');

  const loadCatalog = async () => {
    try {
      const res = await fetch('/api/clearance/catalog');
      const j = await res.json();
      if (j.ok) {
        setItems(j.items || []);
        if (j.config) setConfig(j.config);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  useEffect(() => {
    setBalance(initialBalance);
  }, [initialBalance]);

  const selectedItems = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean) as ClearanceItem[];

  const avgEst =
    selectedItems.length > 0
      ? selectedItems.reduce((acc, i) => acc + i.est_value, 0) / selectedItems.length
      : 0;
  const spinPrice =
    selectedItems.length === 3
      ? Math.max(0.5, Math.round(avgEst * config.spin_discount_rate * 100) / 100)
      : 0;

  const toggleSelect = (item: ClearanceItem) => {
    if (selectedIds.includes(item.id)) {
      setSelectedIds(selectedIds.filter((id) => id !== item.id));
    } else {
      if (selectedIds.length >= 3) {
        setMsg({ text: 'Custom box is full (3 items). Remove one first.', type: 'bad' });
        return;
      }
      setSelectedIds([...selectedIds, item.id]);
    }
  };

  const handleDirectBuy = async (item: ClearanceItem, method: 'balance' | 'venmo_reserve') => {
    if (!user) {
      setMsg({ text: 'Please sign in to buy or reserve items', type: 'bad' });
      return;
    }
    setActionBusy(true);
    try {
      const clientRollId = crypto.randomUUID();
      const res = await fetch('/api/clearance/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          paymentMethod: method,
          clientRollId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.balance !== undefined) setBalance(data.balance);
        setBuyoutSuccess({
          item,
          paymentMethod: method,
          price: data.price,
        });
        loadCatalog();
        if (onRefreshPlayer) onRefreshPlayer();
        confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
      } else {
        setMsg({ text: data.error || 'Failed to complete buyout', type: 'bad' });
      }
    } catch (err: any) {
      setMsg({ text: err.message || 'Error processing buyout', type: 'bad' });
    } finally {
      setActionBusy(false);
    }
  };

  const startCustomSpin = async (method: 'balance' | 'venmo_reserve') => {
    if (!user) {
      setMsg({ text: 'Please sign in to spin', type: 'bad' });
      return;
    }
    if (selectedItems.length !== 3) {
      setMsg({ text: 'Pick exactly 3 items to build your custom box.', type: 'bad' });
      return;
    }

    setSpinPaymentMethod(method);
    setSpinWinner(null);
    setSpinModalOpen(true);
    setSpinning(true);
    setActionBusy(true);

    try {
      const clientRollId = crypto.randomUUID();
      const res = await fetch('/api/clearance/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: selectedItems.map((i) => i.id),
          paymentMethod: method,
          clientRollId,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setSpinning(false);
        setSpinModalOpen(false);
        setMsg({ text: data.error || 'Spin failed', type: 'bad' });
        return;
      }

      const winningIndex = data.winningIndex as number;
      const targetWinner = selectedItems[winningIndex] || data.winner;

      // Run roulette cycling animation across the 3 cards
      let currentIndex = 0;
      let stepCount = 0;
      const totalSteps = 24 + winningIndex; // ~4-5 full cycles before landing on target
      let speed = 60;

      const step = () => {
        currentIndex = (currentIndex + 1) % 3;
        setSpinHighlightIndex(currentIndex);
        stepCount++;

        if (stepCount < totalSteps) {
          if (stepCount > totalSteps - 8) {
            speed += 40; // Decelerate on final stretch
          }
          setTimeout(step, speed);
        } else {
          // Reached winning card
          setSpinHighlightIndex(winningIndex);
          setSpinWinner(targetWinner);
          setSpinning(false);
          if (data.balance !== undefined) setBalance(data.balance);
          loadCatalog();
          if (onRefreshPlayer) onRefreshPlayer();
          confetti({ particleCount: 100, spread: 80, origin: { y: 0.5 } });
        }
      };

      setTimeout(step, speed);
    } catch (err: any) {
      setSpinning(false);
      setSpinModalOpen(false);
      setMsg({ text: err.message || 'Spin failed', type: 'bad' });
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {msg && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl p-4 font-mono text-xs shadow-2xl transition ${
            msg.type === 'good'
              ? 'border border-emerald-500/40 bg-emerald-950 text-emerald-200'
              : 'border border-red-500/40 bg-red-950 text-red-200'
          }`}
        >
          {msg.type === 'good' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="ml-2 hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Banner */}
      <div className="rounded-3xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950 via-gun-900 to-blue-950 p-6 shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-cyan-500/20 px-2.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300 border border-cyan-500/30 uppercase">
                Post-Party Special
              </span>
              <span className="rounded-lg bg-emerald-500/20 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300 border border-emerald-500/30 uppercase">
                {Math.round((1 - config.spin_discount_rate) * 100)}% Spin Discount
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              CLEARANCE &amp; CUSTOM BOXES
            </h1>
            <p className="text-xs font-mono text-cyan-200/80 max-w-2xl leading-relaxed">
              The mystery boxes are done! Pick any leftover item to buyout directly at 100% of its base value,
              or bundle 3 items into your own custom box to spin at a {Math.round((1 - config.spin_discount_rate) * 100)}% discount (equal 33.3% odds).
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="rounded-2xl border border-gun-700 bg-gun-900/90 px-4 py-3 font-mono text-right">
              <span className="text-[10px] text-gun-400 block uppercase">Your Balance</span>
              <span className="text-lg font-black text-emerald-400">${balance.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* DOCK: Custom Box Builder (Pick 3, Win 1) */}
      <div className="rounded-3xl border border-gun-700 bg-gun-900/95 p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-yellow-400" />
              <span>CUSTOM BOX BUILDER (PICK 3, WIN 1)</span>
            </h2>
            <p className="text-xs font-mono text-gun-400">
              Select 3 items from below. You get a 33.3% chance at each, priced at {Math.round(config.spin_discount_rate * 100)}% of the average value.
            </p>
          </div>

          {selectedIds.length > 0 && (
            <button
              onClick={() => setSelectedIds([])}
              className="text-xs font-mono text-gun-400 hover:text-white underline"
            >
              Clear selection
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* 3 Slots */}
          <div className="lg:col-span-8 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((slotIdx) => {
              const item = selectedItems[slotIdx];
              return (
                <div
                  key={slotIdx}
                  className={`relative min-h-[140px] sm:min-h-[160px] rounded-2xl border p-3 flex flex-col justify-between transition ${
                    item
                      ? 'border-cyan-500/50 bg-gun-950/80 shadow-md'
                      : 'border-dashed border-gun-750 bg-gun-950/30'
                  }`}
                >
                  {item ? (
                    <>
                      <button
                        onClick={() => toggleSelect(item)}
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-500 shadow-md transition"
                        title="Remove item"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className="text-[9px] font-mono font-bold uppercase rounded px-1.5 py-0.5 border"
                            style={{
                              borderColor: RARITY_COLOR[item.rarity] + '40',
                              color: RARITY_COLOR[item.rarity],
                              backgroundColor: RARITY_COLOR[item.rarity] + '15',
                            }}
                          >
                            {RARITY_LABEL[item.rarity]}
                          </span>
                          <span className="text-[10px] font-mono text-gun-400">33.3%</span>
                        </div>
                        <h4 className="text-xs sm:text-sm font-bold text-white line-clamp-2">
                          {item.name}
                        </h4>
                      </div>

                      <div className="mt-2 pt-2 border-t border-gun-850 flex items-baseline justify-between font-mono text-xs">
                        <span className="text-gun-400 text-[10px]">Value:</span>
                        <span className="font-bold text-emerald-400">${item.est_value.toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center p-2">
                      <div className="h-8 w-8 rounded-full border border-gun-700 bg-gun-850 flex items-center justify-center text-gun-400 mb-1">
                        <Plus className="h-4 w-4" />
                      </div>
                      <span className="font-mono text-[10px] text-gun-400">
                        Slot {slotIdx + 1}: Select an item below
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pricing & Spin Action */}
          <div className="lg:col-span-4 rounded-2xl border border-gun-750 bg-gun-950 p-4 flex flex-col justify-between">
            <div className="space-y-2 mb-3">
              <div className="flex justify-between text-xs font-mono text-gun-400">
                <span>Average Value:</span>
                <span className="text-white font-bold">${avgEst.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs font-mono text-gun-400">
                <span>Bundle Discount:</span>
                <span className="text-cyan-400 font-bold">
                  {Math.round((1 - config.spin_discount_rate) * 100)}% OFF
                </span>
              </div>
              <div className="pt-2 border-t border-gun-800 flex justify-between items-baseline font-mono">
                <span className="text-xs text-gun-300">Custom Box Price:</span>
                <span className="text-xl font-black text-yellow-400">
                  {selectedItems.length === 3 ? `$${spinPrice.toFixed(2)}` : '—'}
                </span>
              </div>
            </div>

            {selectedItems.length === 3 ? (
              <div className="space-y-2">
                {balance >= spinPrice ? (
                  <button
                    onClick={() => startCustomSpin('balance')}
                    disabled={actionBusy}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-yellow-500 via-amber-500 to-yellow-600 font-mono text-xs font-black text-black shadow-lg shadow-yellow-500/20 hover:brightness-110 active:scale-95 transition disabled:opacity-50"
                  >
                    SPIN CUSTOM BOX (${spinPrice.toFixed(2)})
                  </button>
                ) : (
                  <>
                    <button
                      disabled
                      className="w-full py-2.5 rounded-xl bg-gun-800 font-mono text-xs font-bold text-gun-500 cursor-not-allowed"
                    >
                      Insufficient Balance (${balance.toFixed(2)} / ${spinPrice.toFixed(2)})
                    </button>
                    {config.allow_venmo_reserve && (
                      <button
                        onClick={() => startCustomSpin('venmo_reserve')}
                        disabled={actionBusy}
                        className="w-full py-2.5 rounded-xl border border-cyan-500/50 bg-cyan-950/60 font-mono text-xs font-bold text-cyan-300 hover:bg-cyan-900/60 active:scale-95 transition disabled:opacity-50"
                      >
                        Reserve &amp; Spin (${spinPrice.toFixed(2)} via Venmo)
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl bg-gun-900/60 p-3 text-center font-mono text-[11px] text-gun-400">
                Select {3 - selectedItems.length} more item{3 - selectedItems.length === 1 ? '' : 's'} from the catalog below to unlock custom spin.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CATALOG: Available Leftover Goods */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-xl font-black text-white tracking-tight">REMAINING INVENTORY</h3>
            <p className="text-xs font-mono text-gun-400">
              {items.length} unique physical items available for buyout or bundling.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center font-mono text-xs text-gun-400">
            Loading clearance catalog...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-gun-800 bg-gun-900/60 p-12 text-center font-mono text-gun-400">
            All leftover inventory has been claimed! Thank you for playing.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => {
              const isSelected = selectedIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 flex flex-col justify-between transition ${
                    isSelected
                      ? 'border-cyan-500 bg-cyan-950/20 shadow-lg shadow-cyan-500/10'
                      : 'border-gun-800 bg-gun-900/80 hover:border-gun-700'
                  }`}
                >
                  <div>
                    {/* Header: Rarity & Stock */}
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className="text-[9px] font-mono font-bold uppercase rounded px-2 py-0.5 border"
                        style={{
                          borderColor: RARITY_COLOR[item.rarity] + '40',
                          color: RARITY_COLOR[item.rarity],
                          backgroundColor: RARITY_COLOR[item.rarity] + '15',
                        }}
                      >
                        {RARITY_LABEL[item.rarity]}
                      </span>
                      <span className="text-[10px] font-mono text-gun-400">
                        {item.stock_qty} unit{item.stock_qty === 1 ? '' : 's'} left
                      </span>
                    </div>

                    {/* Image */}
                    <div className="h-32 rounded-xl bg-gun-950/70 border border-gun-800 flex items-center justify-center overflow-hidden mb-3">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="h-full w-full object-contain p-2"
                        />
                      ) : (
                        <Package className="h-10 w-10 text-gun-600" />
                      )}
                    </div>

                    {/* Name & Pricing */}
                    <h4 className="text-sm font-bold text-white line-clamp-2 mb-1">{item.name}</h4>
                    {item.description && (
                      <p className="text-[11px] font-mono text-gun-400 line-clamp-1 mb-2">
                        {item.description}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-gun-800 space-y-3">
                    <div className="flex items-baseline justify-between font-mono">
                      <div>
                        <span className="text-[10px] text-gun-400 block uppercase">Buyout Price</span>
                        <span className="text-base font-black text-emerald-400">
                          ${item.est_value.toFixed(2)}
                        </span>
                      </div>
                      {item.msrp && item.msrp > item.est_value && (
                        <div className="text-right">
                          <span className="text-[10px] text-gun-500 block uppercase">Retail</span>
                          <span className="text-xs text-gun-400 line-through">
                            ${item.msrp.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                      <button
                        type="button"
                        onClick={() => toggleSelect(item)}
                        className={`py-2 px-2 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                          isSelected
                            ? 'bg-cyan-500 text-black shadow-md'
                            : 'border border-gun-700 bg-gun-800 text-gun-200 hover:text-white hover:bg-gun-750'
                        }`}
                      >
                        {isSelected ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>In Box</span>
                          </>
                        ) : (
                          <>
                            <Plus className="h-3.5 w-3.5" />
                            <span>Bundle</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setBuyoutTarget(item)}
                        className="py-2 px-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 font-bold text-emerald-300 hover:bg-emerald-900/60 active:scale-95 transition"
                      >
                        Buy / Reserve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: Direct Buyout / Reserve Modal */}
      {buyoutTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-gun-750 bg-gun-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gun-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-emerald-400" />
                <span>Direct Clearance Buyout</span>
              </h3>
              <button
                onClick={() => setBuyoutTarget(null)}
                className="text-gun-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex gap-4 items-center rounded-2xl bg-gun-950 p-4 border border-gun-800">
              <div className="h-16 w-16 rounded-xl bg-gun-900 border border-gun-800 shrink-0 flex items-center justify-center overflow-hidden">
                {buyoutTarget.image_url ? (
                  <img
                    src={buyoutTarget.image_url}
                    alt={buyoutTarget.name}
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <Package className="h-6 w-6 text-gun-600" />
                )}
              </div>
              <div className="font-mono">
                <h4 className="font-bold text-white text-sm line-clamp-1">{buyoutTarget.name}</h4>
                <div className="text-xs text-gun-400 mt-1">
                  100% Base Value: <span className="font-bold text-emerald-400">${buyoutTarget.est_value.toFixed(2)}</span>
                </div>
                <div className="text-[10px] text-gun-500">
                  {buyoutTarget.stock_qty} in stock
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="space-y-3 font-mono text-xs">
              {/* Pay with balance */}
              <div className="rounded-2xl border border-gun-800 bg-gun-950/60 p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-white">Pay with In-App Balance</span>
                  <span className="text-gun-400">Available: ${balance.toFixed(2)}</span>
                </div>
                {balance >= buyoutTarget.est_value ? (
                  <button
                    onClick={() => handleDirectBuy(buyoutTarget, 'balance')}
                    disabled={actionBusy}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 active:scale-95 transition disabled:opacity-50"
                  >
                    Pay ${buyoutTarget.est_value.toFixed(2)} &amp; Claim Item
                  </button>
                ) : (
                  <div className="text-gun-500 text-[11px]">
                    Not enough balance (${balance.toFixed(2)}). You can deposit first or reserve to Venmo below.
                  </div>
                )}
              </div>

              {/* Reserve with Venmo */}
              {config.allow_venmo_reserve && (
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-cyan-300">Reserve &amp; Venmo at Pickup</span>
                    <span className="text-[10px] text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/30">
                      INSTANT HOLD
                    </span>
                  </div>
                  <p className="text-[11px] text-cyan-200/80 leading-relaxed">
                    Decrements stock immediately so no one else can take it. Venmo Andy when you grab your item!
                  </p>
                  <button
                    onClick={() => handleDirectBuy(buyoutTarget, 'venmo_reserve')}
                    disabled={actionBusy}
                    className="w-full py-2.5 rounded-xl border border-cyan-500/50 bg-cyan-600/20 font-bold text-cyan-200 hover:bg-cyan-600/40 active:scale-95 transition disabled:opacity-50"
                  >
                    Reserve Now (${buyoutTarget.est_value.toFixed(2)} via Venmo)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Buyout Success Modal */}
      {buyoutSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-emerald-500/50 bg-gun-900 p-6 shadow-2xl space-y-4 text-center">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400">
                <Check className="h-8 w-8" />
              </div>
            </div>

            <div>
              <h3 className="text-xl font-black text-white">ITEM CLAIMED!</h3>
              <p className="text-xs font-mono text-gun-300 mt-1">
                {buyoutSuccess.item.name} has been added to your inventory shelf.
              </p>
            </div>

            {buyoutSuccess.paymentMethod === 'venmo_reserve' && (
              <div className="rounded-2xl border border-yellow-500/40 bg-yellow-950/30 p-4 font-mono text-xs text-left space-y-2">
                <div className="font-bold text-yellow-300 flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  <span>Venmo Payment Instructions</span>
                </div>
                <p className="text-yellow-200/90 text-[11px] leading-relaxed">
                  Your item is reserved! Please Venmo <strong>${buyoutSuccess.price.toFixed(2)}</strong> with the note:
                </p>
                <div className="rounded-lg bg-black/50 p-2 text-center text-yellow-400 font-bold tracking-wide select-all">
                  CLEARANCE: {buyoutSuccess.item.name}
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setBuyoutSuccess(null);
                setBuyoutTarget(null);
              }}
              className="w-full py-3 rounded-xl bg-emerald-600 font-mono text-xs font-bold text-white shadow-lg hover:bg-emerald-500 transition"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* MODAL 3: Pick 3 Custom Spin Roulette Dialog */}
      {spinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="w-full max-w-lg rounded-3xl border border-yellow-500/50 bg-gun-900 p-6 shadow-2xl space-y-6 text-center">
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-yellow-400 block mb-1">
                Custom Box Opening
              </span>
              <h3 className="text-2xl font-black text-white">
                {spinning ? 'DRAWING YOUR PRIZE...' : 'WINNER SELECTED!'}
              </h3>
            </div>

            {/* 3-card Roulette strip */}
            <div className="grid grid-cols-3 gap-3">
              {selectedItems.map((item, idx) => {
                const isCurrent = spinHighlightIndex === idx;
                const isWon = !spinning && spinWinner?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-3 flex flex-col justify-between transition-all duration-150 ${
                      isWon
                        ? 'border-yellow-400 bg-yellow-500/20 scale-105 shadow-xl shadow-yellow-500/20'
                        : isCurrent
                          ? 'border-cyan-400 bg-cyan-950/60 scale-105'
                          : 'border-gun-800 bg-gun-950 opacity-60'
                    }`}
                  >
                    <div className="h-20 rounded-xl bg-gun-900/60 border border-gun-800 flex items-center justify-center overflow-hidden mb-2">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="h-full w-full object-contain p-1"
                        />
                      ) : (
                        <Package className="h-6 w-6 text-gun-600" />
                      )}
                    </div>
                    <div>
                      <h5 className="text-[11px] font-bold text-white line-clamp-2 leading-tight">
                        {item.name}
                      </h5>
                      <span className="text-[10px] font-mono text-emerald-400 block mt-1">
                        ${item.est_value.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Winner reveal info */}
            {!spinning && spinWinner && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-yellow-500/40 bg-yellow-950/20 p-4 font-mono text-xs">
                  <p className="text-yellow-300 font-bold text-base">
                    🎉 You won: {spinWinner.name}!
                  </p>
                  <p className="text-gun-400 text-[11px] mt-1">
                    Value: ${spinWinner.est_value.toFixed(2)} (Paid: ${spinPrice.toFixed(2)})
                  </p>
                </div>

                {spinPaymentMethod === 'venmo_reserve' && (
                  <div className="rounded-2xl border border-yellow-500/40 bg-yellow-950/40 p-4 font-mono text-xs text-left space-y-2">
                    <div className="font-bold text-yellow-300">Venmo Instruction:</div>
                    <p className="text-yellow-200/90 text-[11px]">
                      Please Venmo <strong>${spinPrice.toFixed(2)}</strong> with note:
                    </p>
                    <div className="rounded-lg bg-black/60 p-2 text-center text-yellow-400 font-bold tracking-wide select-all">
                      CLEARANCE SPIN: {spinWinner.name}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    setSpinModalOpen(false);
                    setSelectedIds([]);
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 font-mono text-xs font-black text-black shadow-lg hover:brightness-110 transition"
                >
                  Collect Prize &amp; Continue
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
