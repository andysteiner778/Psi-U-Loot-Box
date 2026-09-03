/**
 * Route-level loading screen.
 *
 * Server components fetch the config and odds before first paint, which on
 * house wifi is a visible pause. Without this the app showed a blank black page
 * and looked broken.
 *
 * The miniature reel is the point: it says "a case is opening" rather than "a
 * page is loading", so the wait reads as part of the game.
 */
export default function Loading() {
  const cards = ['#4b5563', '#2563eb', '#9333ea', '#ec4899', '#eab308', '#4b5563', '#2563eb', '#9333ea'];

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      {/* Crest */}
      <div className="relative">
        <div className="absolute -inset-7 animate-pulse rounded-full bg-purple-600/25 blur-3xl" />
        <div className="relative flex flex-col items-center">
          <div className="h-2.5 w-20 rounded-t-md bg-gradient-to-r from-yellow-600 via-yellow-300 to-yellow-600 shadow-lg shadow-yellow-900/40" />
          <div className="mt-0.5 flex h-16 w-24 items-center justify-center overflow-hidden rounded-b-xl border border-gun-600 bg-gradient-to-b from-gun-800 to-gun-950 shadow-2xl">
            <span className="text-2xl font-black tracking-tighter text-white/90">ΨΥ</span>
            {/* Light sweeping across the lid */}
            <span className="pointer-events-none absolute h-full w-8 animate-[loot-shimmer_2.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          </div>
        </div>
      </div>

      <div className="text-center">
        <p className="font-mono text-sm font-black tracking-[0.32em] text-white">PSI U LOOT BOX</p>
        <p className="mt-1.5 font-mono text-[11px] text-gun-400">Unsealing the case&hellip;</p>
      </div>

      {/* The reel in miniature: cards sliding past the marker. */}
      <div className="relative h-9 w-48 overflow-hidden rounded-lg border border-gun-700 bg-gun-950/70 shadow-inner">
        <div className="absolute left-1/2 top-0 z-10 h-full w-px -translate-x-1/2 bg-yellow-400/80 shadow-[0_0_8px_rgba(234,179,8,0.8)]" />
        <div className="flex h-full animate-[loot-slide_1.4s_linear_infinite] gap-1.5 p-1.5">
          {[...cards, ...cards].map((c, i) => (
            <div
              key={i}
              className="h-full w-7 flex-shrink-0 rounded"
              style={{ background: c, opacity: 0.8 }}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
