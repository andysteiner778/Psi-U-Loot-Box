'use client';

import { useRef, useState } from 'react';
import { Images, Trash2, Loader2, CheckCircle2, Sparkles, Square } from 'lucide-react';
import { uploadItemPhoto } from '@/lib/image';
import { rarityForValue, tierForValue } from '@/lib/economy';
import { RARITY_LABEL, type BoxTier, type Rarity } from '@/lib/types';

/**
 * Bulk photo intake.
 *
 * Photographing ~50 items one at a time through the camera-capture flow would
 * take an evening. This takes a whole folder in one go: pick every photo,
 * upload them in the background while you type names and prices, then create
 * them all at once.
 *
 * Rarity and tier stay DERIVED from price. They are never typed, because the
 * scrap recovery rate keys off rarity -- letting someone label a $200 speaker
 * as Common would hand them a 60% recovery on it.
 */

interface Draft {
  key: string;
  file: File;
  preview: string;
  url: string | null;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
  name: string;
  value: string;
  msrp: string;
  qty: string;
  scanning?: boolean;
}

const nameFromFile = (f: File) =>
  f.name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 60);

export function BulkUpload({
  onDone,
  showMsg,
  visionReady,
}: {
  onDone: () => void;
  showMsg: (m: string, kind?: 'ok' | 'bad') => void;
  visionReady: boolean;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [creating, setCreating] = useState(false);
  const [batchScanning, setBatchScanning] = useState(false);
  // A ref, not state: the scan loop reads this between every photo and a state
  // value captured in the closure would never see the update.
  const cancelScan = useRef(false);

  const patch = (key: string, p: Partial<Draft>) =>
    setDrafts((d) => d.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;

    const fresh: Draft[] = files.map((file, i) => ({
      key: Date.now() + '-' + i + '-' + file.name,
      file,
      preview: URL.createObjectURL(file),
      url: null,
      status: 'queued',
      name: nameFromFile(file),
      value: '',
      msrp: '',
      qty: '1',
    }));
    setDrafts((d) => [...d, ...fresh]);

    // Sequential, not parallel: 50 simultaneous uploads over house wifi is how
    // you get a pile of timeouts instead of a pile of photos.
    for (const d of fresh) {
      patch(d.key, { status: 'uploading' });
      try {
        const url = await uploadItemPhoto(d.file, d.name);
        patch(d.key, { url, status: 'done' });
      } catch (err) {
        patch(d.key, {
          status: 'error',
          error: err instanceof Error ? err.message : 'upload failed',
        });
      }
    }
  };

  /** Optional: ask the vision model to name and price one photo. */
  const scanOne = async (d: Draft, quiet = false): Promise<boolean> => {
    if (!d.url) return false;
    patch(d.key, { scanning: true });
    try {
      const b64 = await fetch(d.url)
        .then((r) => r.blob())
        .then(
          (b) =>
            new Promise<string>((res, rej) => {
              const fr = new FileReader();
              fr.onload = () => res(String(fr.result));
              fr.onerror = rej;
              fr.readAsDataURL(b);
            })
        );
      const res = await fetch('/api/vision/scan-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, mediaType: 'image/jpeg' }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        patch(d.key, {
          name: json.data.name ?? d.name,
          value: String(json.data.est_value ?? ''),
        });
        return true;
      }
      if (!quiet) showMsg(json.error || 'Scan failed', 'bad');
      return false;
    } catch {
      if (!quiet) showMsg('Scan request failed', 'bad');
      return false;
    } finally {
      patch(d.key, { scanning: false });
    }
  };

  /** Scan every photo, spaced out so a free-tier key does not hit its rate limit. */
  /**
   * Scan the whole batch, but stoppable and self-limiting.
   *
   * Two ways out. The operator can hit Stop, and the loop checks between every
   * photo. And if the first few all fail -- a missing key, an exhausted free
   * quota, a provider outage -- it gives up on its own rather than grinding
   * through sixty doomed calls while someone watches.
   */
  const scanAll = async () => {
    const ready = drafts.filter((d) => d.status === 'done' && !d.value);
    if (ready.length === 0) return;

    cancelScan.current = false;
    setBatchScanning(true);

    let done = 0;
    let consecutiveFailures = 0;
    let stoppedEarly = false;

    for (let i = 0; i < ready.length; i++) {
      if (cancelScan.current) break;

      const ok = await scanOne(ready[i], true);
      if (ok) {
        done++;
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }

      // Three in a row means the provider is down or out of quota, not that
      // these particular photos are hard.
      if (consecutiveFailures >= 3) {
        stoppedEarly = true;
        break;
      }

      if (i < ready.length - 1 && !cancelScan.current) {
        await new Promise((r) => setTimeout(r, 4500));
      }
    }

    setBatchScanning(false);

    if (cancelScan.current) {
      showMsg('Stopped. ' + done + ' of ' + ready.length + ' scanned — fill in the rest by hand.');
    } else if (stoppedEarly) {
      showMsg(
        'AI scanning gave up after 3 failures in a row (likely out of free quota). ' +
          done + ' scanned — type the rest in by hand.',
        'bad'
      );
    } else {
      showMsg('Scanned ' + done + ' of ' + ready.length + ' photos');
    }
    cancelScan.current = false;
  };

  const createAll = async () => {
    const ready = drafts.filter((d) => d.status === 'done' && d.name.trim() && Number(d.value) > 0);
    if (!ready.length) {
      showMsg('Give each item a name and a price above $0 first', 'bad');
      return;
    }
    setCreating(true);
    let made = 0;
    for (const d of ready) {
      const est = Number(d.value);
      try {
        const res = await fetch('/api/admin/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: d.name.trim(),
            est_value: est,
            stock_qty: Math.max(1, parseInt(d.qty, 10) || 1),
            rarity: rarityForValue(est),
            box_tier: tierForValue(est),
            msrp: Number(d.msrp) > 0 ? Number(d.msrp) : null,
            image_url: d.url,
          }),
        });
        if ((await res.json()).ok) made++;
      } catch {
        /* keep going; one bad row must not abandon the rest */
      }
    }
    setCreating(false);
    setDrafts((d) => d.filter((x) => !ready.includes(x)));
    showMsg('Added ' + made + ' items');
    onDone();
  };

  const doneCount = drafts.filter((d) => d.status === 'done').length;

  return (
    <div className="rounded-2xl border border-gun-700 bg-gun-900/90 p-5 shadow-xl">
      <div className="mb-2 flex items-center gap-2">
        <Images className="h-5 w-5 text-blue-400" />
        <h3 className="text-base font-bold text-white">Bulk Photo Intake</h3>
      </div>
      <p className="mb-3 font-mono text-[11px] leading-relaxed text-gun-300">
        Pick every photo at once from your files. They upload in the background
        while you fill in names and prices. Rarity and tier are worked out from
        the price automatically.
        <br />
        <span className="text-gun-400">
          &ldquo;$ value&rdquo; is the real used value and sets the odds. &ldquo;retail&rdquo; is
          optional, shown to players, and changes nothing.
        </span>
      </p>

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 font-mono text-xs font-bold text-white transition hover:brightness-110 active:scale-95">
        <Images className="h-4 w-4" />
        <span>Choose Photos (select many)</span>
        <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
      </label>

      {drafts.length > 0 && (
        <>
          <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-gun-300">
            <span>
              {doneCount}/{drafts.length} uploaded
            </span>
            {visionReady &&
              (batchScanning ? (
                <button
                  onClick={() => {
                    cancelScan.current = true;
                  }}
                  className="flex items-center gap-1 rounded-lg border border-red-500/50 bg-red-600 px-2 py-1 font-bold text-white hover:bg-red-500"
                >
                  <Square className="h-3 w-3" />
                  Stop AI scanning
                </button>
              ) : (
                <button
                  onClick={scanAll}
                  className="flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-500/10 px-2 py-1 text-purple-300 hover:bg-purple-500/20"
                >
                  <Sparkles className="h-3 w-3" />
                  Auto-name &amp; price all
                </button>
              ))}
          </div>

          <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {drafts.map((d) => {
              const est = Number(d.value);
              const rarity: Rarity | null = est > 0 ? rarityForValue(est) : null;
              const tier: BoxTier | null = est > 0 ? tierForValue(est) : null;
              return (
                <div
                  key={d.key}
                  className="flex items-center gap-2 rounded-xl border border-gun-700 bg-gun-950/60 p-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.preview} alt="" className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />

                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      value={d.name}
                      onChange={(e) => patch(d.key, { name: e.target.value })}
                      placeholder="Item name"
                      className="w-full rounded bg-gun-900 px-2 py-1 font-mono text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex gap-1">
                      <input
                        value={d.value}
                        onChange={(e) => patch(d.key, { value: e.target.value.replace(/[^\d.]/g, '') })}
                        inputMode="decimal"
                        placeholder="$ value"
                        className="w-20 rounded bg-gun-900 px-2 py-1 font-mono text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <input
                        value={d.msrp}
                        onChange={(e) => patch(d.key, { msrp: e.target.value.replace(/[^\d.]/g, '') })}
                        inputMode="decimal"
                        placeholder="retail"
                        title="Retail price shown to players. Display only — does not change the odds."
                        className="w-20 rounded bg-gun-900 px-2 py-1 font-mono text-[11px] text-gun-200 outline-none focus:ring-1 focus:ring-purple-500"
                      />
                      <input
                        value={d.qty}
                        onChange={(e) => patch(d.key, { qty: e.target.value.replace(/\D/g, '') })}
                        inputMode="numeric"
                        placeholder="qty"
                        className="w-14 rounded bg-gun-900 px-2 py-1 font-mono text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {rarity && (
                        <span
                          data-rarity={rarity}
                          className="rarity-border flex items-center rounded border px-2 font-mono text-[10px] uppercase text-white"
                        >
                          {RARITY_LABEL[rarity]} · {tier?.replace('tier_', 'T')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex w-16 flex-shrink-0 flex-col items-center gap-1">
                    {d.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-gun-300" />}
                    {d.status === 'done' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    {d.status === 'error' && (
                      <span className="text-center font-mono text-[9px] text-red-400">{d.error}</span>
                    )}
                    {d.scanning && <Loader2 className="h-3 w-3 animate-spin text-purple-300" />}
                    <button
                      onClick={() => setDrafts((x) => x.filter((y) => y.key !== d.key))}
                      className="text-gun-500 hover:text-red-400"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={createAll}
            disabled={creating}
            className="mt-3 w-full rounded-xl bg-emerald-600 py-3 font-mono text-xs font-bold text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
          >
            {creating ? 'Adding…' : 'Add All Items to the Pool'}
          </button>
        </>
      )}
    </div>
  );
}
