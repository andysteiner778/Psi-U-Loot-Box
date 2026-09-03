'use client';

import { useState } from 'react';
import { Volume2, VolumeX, Play } from 'lucide-react';
import { sfx } from '@/lib/sound';
import { RARITY_COLOR, RARITY_LABEL, type Rarity } from '@/lib/types';

/**
 * Sound bench.
 *
 * "The sound doesn't work on purple" is impossible to act on without being able
 * to fire each cue in isolation — the reel only plays one at the end of a
 * six-second spin, and you cannot tell a missing sound from one you did not
 * notice. Every cue is one tap here, in the same escalating order the reel uses.
 */
const RARITY_ORDER: Rarity[] = ['grey', 'blue', 'purple', 'pink', 'gold'];

const CUES: { label: string; run: () => void; note: string }[] = [
  { label: 'Reel start', run: () => sfx.playReelStart(), note: 'when the spin begins' },
  { label: 'Single tick', run: () => sfx.playTick(), note: 'each card passing the marker' },
  { label: 'Near-miss whoosh', run: () => sfx.playNearMissWhoosh(), note: '~1s before the stop' },
  { label: 'Scrap crunch', run: () => sfx.playScrapCrunch(), note: 'consolation result' },
  { label: 'Riser', run: () => sfx.playRiser(), note: 'under a big win' },
  { label: 'Hand-pay bell', run: () => sfx.playHandPayBell(undefined, 2.1, 1), note: 'the clanging jackpot bell' },
  { label: 'Bell (long)', run: () => sfx.playHandPayBell(undefined, 3.4, 1.15), note: 'what an Exotic pull gets' },
  { label: 'Gold fanfare', run: () => sfx.playGoldFanfare(), note: 'top-tier arpeggio' },
  { label: 'Error', run: () => sfx.playError(), note: 'rejected action' },
];

export function SoundTester() {
  const [muted, setMuted] = useState(false);

  const fire = async (run: () => void) => {
    // unlock() must be reached from inside the click, or iOS refuses the
    // context and every button here silently does nothing.
    await sfx.unlock();
    run();
  };

  return (
    <div className="rounded-2xl border border-gun-700 bg-gun-900/90 p-5 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-cyan-400" />
          <h3 className="text-base font-bold text-white">Sound Bench</h3>
        </div>
        <button
          onClick={async () => {
            await sfx.unlock();
            const next = !muted;
            setMuted(next);
            sfx.setMuted?.(next);
          }}
          className="flex items-center gap-1 rounded-lg border border-gun-700 bg-gun-850 px-2 py-1 font-mono text-[11px] text-gun-300 hover:text-white"
        >
          {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          {muted ? 'Muted' : 'Sound on'}
        </button>
      </div>

      <p className="mb-3 font-mono text-[11px] leading-relaxed text-gun-300">
        Tap any cue to hear it on its own. If one is silent here it is genuinely
        broken; if it plays here but not in a spin, the problem is the reel, not
        the sound.
      </p>

      <div className="mb-3">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-gun-400">
          Win cue by rarity (what a player hears when they land one)
        </p>
        <div className="flex flex-wrap gap-1.5">
          {RARITY_ORDER.map((r) => (
            <button
              key={r}
              onClick={() => fire(() => sfx.playWinFor(r))}
              data-rarity={r}
              className="rarity-border flex items-center gap-1.5 rounded-lg border bg-gun-950 px-2.5 py-1.5 font-mono text-[11px] font-bold text-white transition active:scale-95"
            >
              <Play className="h-3 w-3" style={{ color: RARITY_COLOR[r] }} />
              {RARITY_LABEL[r]}
              {r === 'grey' && <span className="text-gun-500">(silent)</span>}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-gun-400">
          Individual cues
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {CUES.map((c) => (
            <button
              key={c.label}
              onClick={() => fire(c.run)}
              title={c.note}
              className="flex items-center gap-1.5 rounded-lg border border-gun-700 bg-gun-950 px-2.5 py-2 text-left font-mono text-[11px] text-gun-200 transition hover:border-gun-600 hover:text-white active:scale-95"
            >
              <Play className="h-3 w-3 shrink-0 text-cyan-400" />
              <span className="truncate">{c.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
