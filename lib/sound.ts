'use client';

/**
 * PROCEDURAL SOUND ENGINE — Workstream 2 (CS:GO Reel & Audio)
 *
 * Zero audio files. Everything is synthesised with the Web Audio API, which
 * keeps the bundle honest and means the reel sounds right on a phone with a
 * cold cache on house wifi.
 *
 * Three rules govern this file:
 *
 *  1. AUDIO NEVER BREAKS THE GAME. Every public method is total: if there is no
 *     AudioContext, if the context is suspended, if a browser policy blocks us,
 *     if localStorage throws inside an in-app webview — we return quietly. A
 *     player never loses a roll because their browser dislikes oscillators.
 *
 *  2. THE CONTEXT IS BUILT LAZILY, ON A GESTURE. Constructing an AudioContext
 *     at import time gets it created in the `suspended` state (and warned about
 *     in the console); on iOS Safari it stays mute forever unless it is both
 *     created and resumed inside a user gesture. `unlock()` is the gesture
 *     hook — call it from the first tap. `autoUnlock()` wires that up for you.
 *
 *  3. EVERYTHING GOES THROUGH THE MASTER GAIN. Volume and mute are one control.
 *     Ticks additionally pass through their own sub-bus so the tick train can
 *     be ducked without also swallowing the fanfare that plays over the end of
 *     it.
 *
 * Graph:
 *
 *     tick osc -> tick env -.
 *                            > tickBus(gain) -> tickHP(highpass) -.
 *     other voices ------------------------------------------------> master(gain)
 *                                                                     -> limiter
 *                                                                     -> destination
 */

const MUTE_KEY = 'houseloot:muted';
const VOLUME_KEY = 'houseloot:volume';

const DEFAULT_VOLUME = 0.75;

/** Never schedule into the past; give the audio thread a moment. */
const LOOKAHEAD = 0.02;

/**
 * Ticks spaced tighter than this (seconds) get progressively quieter. At the
 * top of the spin they arrive ~5ms apart; 60 overlapping 15ms transients with
 * no ducking is a fuzz of clipping rather than a rattle.
 */
const TICK_COMFORT_GAP = 0.075;
const TICK_DUCK_FLOOR = 0.34;

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  tickBus: GainNode;
}

class SoundEngine {
  private graphRef: Graph | null = null;
  /** Set once construction has failed, so we stop retrying every tick. */
  private unavailable = false;
  private noiseBuffer: AudioBuffer | null = null;

  private prefsLoaded = false;
  private mutedValue = false;
  private volumeValue = DEFAULT_VOLUME;

  /** Sources we scheduled but that have not fired yet, so we can cancel them. */
  private pending = new Set<AudioScheduledSourceNode>();
  private lastTickAt = Number.NEGATIVE_INFINITY;

  // -------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------

  /**
   * localStorage access throws outright in some embedded webviews and in
   * Safari with cookies blocked — not "returns null", throws. Hence the guard
   * around every read and write.
   */
  private loadPrefs(): void {
    if (this.prefsLoaded) return;
    this.prefsLoaded = true;
    if (typeof window === 'undefined') return;
    try {
      const muted = window.localStorage.getItem(MUTE_KEY);
      if (muted !== null) this.mutedValue = muted === '1';
      const vol = window.localStorage.getItem(VOLUME_KEY);
      if (vol !== null) {
        const parsed = Number.parseFloat(vol);
        if (Number.isFinite(parsed)) this.volumeValue = clamp(parsed, 0, 1);
      }
    } catch {
      /* private mode / embedded webview — defaults are fine */
    }
  }

  private persist(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* preference simply does not survive the session */
    }
  }

  get muted(): boolean {
    this.loadPrefs();
    return this.mutedValue;
  }

  get volume(): number {
    this.loadPrefs();
    return this.volumeValue;
  }

  setMuted(muted: boolean): void {
    this.loadPrefs();
    this.mutedValue = muted;
    this.persist(MUTE_KEY, muted ? '1' : '0');
    this.applyMasterGain();
    if (muted) this.cancelPending();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.mutedValue;
  }

  setVolume(volume: number): void {
    this.loadPrefs();
    this.volumeValue = clamp(volume, 0, 1);
    this.persist(VOLUME_KEY, String(this.volumeValue));
    this.applyMasterGain();
  }

  private applyMasterGain(): void {
    const g = this.graphRef;
    if (!g) return;
    const target = this.mutedValue ? 0 : this.volumeValue;
    try {
      const t = g.ctx.currentTime;
      g.master.gain.cancelScheduledValues(t);
      g.master.gain.setValueAtTime(g.master.gain.value, t);
      // Ramp rather than step: a hard gain change mid-note is an audible click.
      g.master.gain.linearRampToValueAtTime(target, t + 0.03);
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------
  // Context lifecycle
  // -------------------------------------------------------------------------

  /**
   * Build (or fetch) the audio graph. Returns null when audio is unavailable —
   * every caller must handle that, and none of them may throw.
   */
  private graph(): Graph | null {
    if (this.graphRef) {
      // A backgrounded tab suspends the context; nudge it awake. resume()
      // returns a promise that rejects if we are not in a gesture — ignore it,
      // the next real gesture will get there.
      if (this.graphRef.ctx.state === 'suspended') {
        void this.graphRef.ctx.resume().catch(() => {});
      }
      return this.graphRef;
    }
    if (this.unavailable) return null;

    const Ctor = audioContextCtor();
    if (!Ctor) {
      this.unavailable = true;
      return null;
    }

    try {
      this.loadPrefs();
      const ctx = new Ctor();

      const master = ctx.createGain();
      master.gain.value = this.mutedValue ? 0 : this.volumeValue;

      // A limiter on the master is the cheap insurance against the one moment
      // everything overlaps: the last ticks, the near-miss whoosh and the
      // fanfare all land inside ~700ms.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 12;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.18;

      // Ticks get their own bus: a shared highpass (so the 1200->80Hz sweep
      // reads as a click, not a thud) and a gain we can duck independently of
      // the master, which must stay put so the fanfare is not ducked with it.
      const tickBus = ctx.createGain();
      tickBus.gain.value = 1;
      const tickHP = ctx.createBiquadFilter();
      tickHP.type = 'highpass';
      tickHP.frequency.value = 340;
      tickHP.Q.value = 0.7;

      tickBus.connect(tickHP);
      tickHP.connect(master);
      master.connect(limiter);
      limiter.connect(ctx.destination);

      this.graphRef = { ctx, master, tickBus };
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      return this.graphRef;
    } catch {
      this.unavailable = true;
      return null;
    }
  }

  /**
   * Call from the first user gesture (tap, click, key). Safe to call repeatedly.
   * Plays one sample of silence, which is the incantation iOS Safari wants
   * before it will let a context out of `suspended`.
   */
  async unlock(): Promise<void> {
    const g = this.graph();
    if (!g) return;
    try {
      if (g.ctx.state === 'suspended') await g.ctx.resume();
      const buf = g.ctx.createBuffer(1, 1, g.ctx.sampleRate);
      const src = g.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g.master);
      src.start(0);
    } catch {
      /* still unavailable; every play call degrades to a no-op */
    }
  }

  /**
   * Register one-shot unlock listeners. Returns a disposer, so a component can
   * do `useEffect(() => sfx.autoUnlock(), [])`.
   */
  autoUnlock(): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = (): void => {
      void this.unlock();
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchend', 'keydown'];
    for (const e of events) window.addEventListener(e, handler, { once: true, passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, handler);
    };
  }

  /** AudioContext clock, or 0 when there is no context. */
  now(): number {
    return this.graphRef?.ctx.currentTime ?? 0;
  }

  get available(): boolean {
    return this.graphRef !== null || (!this.unavailable && audioContextCtor() !== null);
  }

  // -------------------------------------------------------------------------
  // Voice plumbing
  // -------------------------------------------------------------------------

  private track(node: AudioScheduledSourceNode): void {
    this.pending.add(node);
    node.onended = () => {
      this.pending.delete(node);
    };
  }

  /** Stop and forget everything still queued. Used on unmount and on mute. */
  cancelPending(): void {
    const nodes = Array.from(this.pending);
    this.pending.clear();
    for (const n of nodes) {
      try {
        n.onended = null;
        n.stop();
      } catch {
        /* already stopped or never started */
      }
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    const g = this.graphRef;
    if (g) {
      try {
        g.tickBus.gain.cancelScheduledValues(g.ctx.currentTime);
        g.tickBus.gain.setValueAtTime(1, g.ctx.currentTime);
      } catch {
        /* ignore */
      }
    }
  }

  /** One second of white noise, built once and reused by every noisy voice. */
  private noise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const len = Math.floor(ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  // -------------------------------------------------------------------------
  // Voices
  // -------------------------------------------------------------------------

  /**
   * The reel tick. Fires ~47 times in 5.5 seconds, so it is deliberately three
   * nodes and nothing more.
   *
   * The pitch jitter matters more than it sounds like it should: 47 identical
   * transients reads as a digital buzz, while +/-14% of random detune reads as
   * a physical ratchet.
   */
  playTick(at?: number, gain = 0.3): AudioScheduledSourceNode | null {
    const g = this.graph();
    if (!g || this.mutedValue) return null;
    try {
      const t = at ?? g.ctx.currentTime + LOOKAHEAD;

      // Realtime (unscheduled) ticks duck the bus from the measured gap. The
      // scheduled train in scheduleTicks() does this properly, up front.
      if (at === undefined) {
        const gap = t - this.lastTickAt;
        const scale = clamp(gap / TICK_COMFORT_GAP, TICK_DUCK_FLOOR, 1);
        g.tickBus.gain.cancelScheduledValues(t);
        g.tickBus.gain.linearRampToValueAtTime(scale, t + 0.005);
      }
      this.lastTickAt = t;

      const osc = g.ctx.createOscillator();
      const env = g.ctx.createGain();
      osc.type = 'triangle';

      const base = 1200 * (0.86 + Math.random() * 0.28);
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.015);

      env.gain.setValueAtTime(gain, t);
      env.gain.exponentialRampToValueAtTime(0.0008, t + 0.016);

      osc.connect(env);
      env.connect(g.tickBus);
      osc.start(t);
      osc.stop(t + 0.02);
      this.track(osc);
      return osc;
    } catch {
      /* a dropped tick is not worth an exception */
      return null;
    }
  }

  /**
   * Pre-schedule an entire tick train on the audio clock.
   *
   * `offsetsMs` comes from `tickTimes()` in lib/reel.ts, which derives it by
   * inverting the same cubic-bezier that drives the visual motion. Scheduling
   * on the AudioContext clock rather than with 47 setTimeouts is the difference
   * between sample-accurate ticks and a rattle that smears whenever the main
   * thread hitches — which it will, because 60 cards are compositing at the
   * same time.
   *
   * Returns a cancel function; call it if the spin is interrupted.
   */
  scheduleTicks(offsetsMs: readonly number[], startDelayMs = 0): () => void {
    const g = this.graph();
    if (!g || this.mutedValue || offsetsMs.length === 0) return () => {};

    const created: AudioScheduledSourceNode[] = [];
    try {
      const base = g.ctx.currentTime + LOOKAHEAD + startDelayMs / 1000;

      // Duck the tick bus by local density: dense at the top of the spin
      // (quiet, blurred), sparse at the end (loud, individual clunks). This is
      // the sub-bus, not the master, so the fanfare that overlaps the tail of
      // the train is untouched.
      const bus = g.tickBus.gain;
      bus.cancelScheduledValues(base);
      bus.setValueAtTime(TICK_DUCK_FLOOR, base);

      let previous = offsetsMs[0] - TICK_COMFORT_GAP * 1000;
      for (const offset of offsetsMs) {
        const at = base + offset / 1000;
        const gapSeconds = (offset - previous) / 1000;
        previous = offset;
        bus.linearRampToValueAtTime(clamp(gapSeconds / TICK_COMFORT_GAP, TICK_DUCK_FLOOR, 1), at);
        this.playTick(at);
      }
      const last = base + offsetsMs[offsetsMs.length - 1] / 1000;
      bus.linearRampToValueAtTime(1, last + 0.25);

      for (const node of this.pending) created.push(node);
    } catch {
      /* fall through; whatever got scheduled will still play */
    }

    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      for (const node of created) {
        try {
          node.onended = null;
          node.stop();
        } catch {
          /* already fired */
        }
        this.pending.delete(node);
      }
      try {
        const gg = this.graphRef;
        if (gg) {
          gg.tickBus.gain.cancelScheduledValues(gg.ctx.currentTime);
          gg.tickBus.gain.setValueAtTime(1, gg.ctx.currentTime);
        }
      } catch {
        /* ignore */
      }
    };
  }

  /** Sub-bass swell plus a filtered noise sweep: the "oh no, so close" cue. */
  playNearMissWhoosh(at?: number): void {
    const g = this.graph();
    if (!g || this.mutedValue) return;
    try {
      const t = at ?? g.ctx.currentTime + LOOKAHEAD;
      const dur = 0.55;

      const sub = g.ctx.createOscillator();
      const subEnv = g.ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(58, t);
      sub.frequency.exponentialRampToValueAtTime(148, t + dur * 0.75);
      subEnv.gain.setValueAtTime(0.0008, t);
      subEnv.gain.exponentialRampToValueAtTime(0.55, t + 0.09);
      subEnv.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      sub.connect(subEnv);
      subEnv.connect(g.master);
      sub.start(t);
      sub.stop(t + dur + 0.02);
      this.track(sub);

      const air = g.ctx.createBufferSource();
      air.buffer = this.noise(g.ctx);
      air.loop = true;
      const band = g.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.4;
      band.frequency.setValueAtTime(320, t);
      band.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.8);
      const airEnv = g.ctx.createGain();
      airEnv.gain.setValueAtTime(0.0008, t);
      airEnv.gain.exponentialRampToValueAtTime(0.16, t + 0.16);
      airEnv.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      air.connect(band);
      band.connect(airEnv);
      airEnv.connect(g.master);
      air.start(t);
      air.stop(t + dur + 0.02);
      this.track(air);
    } catch {
      /* ignore */
    }
  }

  /** C major arpeggio into a held chord. Gold, pink and shard pulls only. */
  playGoldFanfare(at?: number): void {
    const g = this.graph();
    if (!g || this.mutedValue) return;
    try {
      const t0 = at ?? g.ctx.currentTime + LOOKAHEAD;
      const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99];

      notes.forEach((freq, idx) => {
        const start = t0 + idx * 0.08;
        // Two saws a few cents apart: the beating between them is what makes a
        // synth arpeggio sound like a fanfare instead of a doorbell.
        for (const detune of [-6, 7]) {
          const osc = g.ctx.createOscillator();
          const env = g.ctx.createGain();
          const tone = g.ctx.createBiquadFilter();
          osc.type = 'sawtooth';
          osc.frequency.value = freq;
          osc.detune.value = detune;
          tone.type = 'lowpass';
          tone.frequency.setValueAtTime(1200, start);
          tone.frequency.exponentialRampToValueAtTime(4200, start + 0.12);
          tone.Q.value = 0.6;
          env.gain.setValueAtTime(0.0008, start);
          env.gain.linearRampToValueAtTime(0.16, start + 0.02);
          env.gain.exponentialRampToValueAtTime(0.0008, start + 0.62);
          osc.connect(tone);
          tone.connect(env);
          env.connect(g.master);
          osc.start(start);
          osc.stop(start + 0.65);
          this.track(osc);
        }
      });

      // Held C major triad under the run so the arpeggio lands on something.
      const chordAt = t0 + notes.length * 0.08;
      for (const freq of [261.63, 329.63, 392.0]) {
        const osc = g.ctx.createOscillator();
        const env = g.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        env.gain.setValueAtTime(0.0008, chordAt);
        env.gain.linearRampToValueAtTime(0.13, chordAt + 0.05);
        env.gain.exponentialRampToValueAtTime(0.0008, chordAt + 1.1);
        osc.connect(env);
        env.connect(g.master);
        osc.start(chordAt);
        osc.stop(chordAt + 1.15);
        this.track(osc);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Metallic crunch for the Scrap Compactor (and for scrap results on the reel).
   * Inharmonic square partials through a bandpass is the standard cheap recipe
   * for "metal" — integer harmonics would read as a musical note instead.
   */
  playScrapCrunch(at?: number): void {
    const g = this.graph();
    if (!g || this.mutedValue) return;
    try {
      const t0 = at ?? g.ctx.currentTime + LOOKAHEAD;

      const ratios = [1, 1.71, 2.43, 3.17, 4.09];
      for (let grain = 0; grain < 3; grain++) {
        const start = t0 + grain * 0.085 + Math.random() * 0.02;
        const body = g.ctx.createGain();
        const band = g.ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 900 + Math.random() * 1700;
        band.Q.value = 3.5;
        body.gain.setValueAtTime(0.11, start);
        body.gain.exponentialRampToValueAtTime(0.0008, start + 0.16);
        band.connect(body);
        body.connect(g.master);

        const root = 190 + Math.random() * 60;
        for (const r of ratios) {
          const osc = g.ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.value = root * r;
          osc.connect(band);
          osc.start(start);
          osc.stop(start + 0.17);
          this.track(osc);
        }

        const grit = g.ctx.createBufferSource();
        grit.buffer = this.noise(g.ctx);
        grit.loop = true;
        const gritEnv = g.ctx.createGain();
        gritEnv.gain.setValueAtTime(0.09, start);
        gritEnv.gain.exponentialRampToValueAtTime(0.0008, start + 0.1);
        grit.connect(band);
        band.connect(gritEnv);
        gritEnv.connect(g.master);
        grit.start(start);
        grit.stop(start + 0.11);
        this.track(grit);
      }

      // Low thud so the crunch has weight on a phone speaker.
      const thud = g.ctx.createOscillator();
      const thudEnv = g.ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(105, t0);
      thud.frequency.exponentialRampToValueAtTime(44, t0 + 0.3);
      thudEnv.gain.setValueAtTime(0.32, t0);
      thudEnv.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.33);
      thud.connect(thudEnv);
      thudEnv.connect(g.master);
      thud.start(t0);
      thud.stop(t0 + 0.35);
      this.track(thud);
    } catch {
      /* ignore */
    }
  }

  /** Mechanical clack plus a rising sweep as the reel takes off. */
  playReelStart(at?: number): void {
    const g = this.graph();
    if (!g || this.mutedValue) return;
    try {
      const t = at ?? g.ctx.currentTime + LOOKAHEAD;

      const sweep = g.ctx.createOscillator();
      const sweepEnv = g.ctx.createGain();
      const lp = g.ctx.createBiquadFilter();
      sweep.type = 'sawtooth';
      sweep.frequency.setValueAtTime(110, t);
      sweep.frequency.exponentialRampToValueAtTime(880, t + 0.26);
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + 0.26);
      sweepEnv.gain.setValueAtTime(0.0008, t);
      sweepEnv.gain.exponentialRampToValueAtTime(0.2, t + 0.06);
      sweepEnv.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
      sweep.connect(lp);
      lp.connect(sweepEnv);
      sweepEnv.connect(g.master);
      sweep.start(t);
      sweep.stop(t + 0.32);
      this.track(sweep);

      const clack = g.ctx.createBufferSource();
      clack.buffer = this.noise(g.ctx);
      const clackHP = g.ctx.createBiquadFilter();
      clackHP.type = 'highpass';
      clackHP.frequency.value = 1800;
      const clackEnv = g.ctx.createGain();
      clackEnv.gain.setValueAtTime(0.22, t);
      clackEnv.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
      clack.connect(clackHP);
      clackHP.connect(clackEnv);
      clackEnv.connect(g.master);
      clack.start(t);
      clack.stop(t + 0.06);
      this.track(clack);
    } catch {
      /* ignore */
    }
  }

  /** Two descending square blips. Insufficient balance, locked PIN, bad state. */
  playError(at?: number): void {
    const g = this.graph();
    if (!g || this.mutedValue) return;
    try {
      const t0 = at ?? g.ctx.currentTime + LOOKAHEAD;
      [220, 165].forEach((freq, idx) => {
        const start = t0 + idx * 0.12;
        const osc = g.ctx.createOscillator();
        const env = g.ctx.createGain();
        const lp = g.ctx.createBiquadFilter();
        osc.type = 'square';
        osc.frequency.value = freq;
        lp.type = 'lowpass';
        lp.frequency.value = 1400;
        env.gain.setValueAtTime(0.0008, start);
        env.gain.linearRampToValueAtTime(0.2, start + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0008, start + 0.1);
        osc.connect(lp);
        lp.connect(env);
        env.connect(g.master);
        osc.start(start);
        osc.stop(start + 0.12);
        this.track(osc);
      });
    } catch {
      /* ignore */
    }
  }
}

/** Module-level singleton. One AudioContext per tab is the browser's budget. */
export const sfx = new SoundEngine();

export type { SoundEngine };
