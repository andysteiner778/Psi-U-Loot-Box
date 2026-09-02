/**
 * Route-level loading screen.
 *
 * Server components fetch the roster, config and odds before first paint, which
 * on house wifi is a visible pause. Without this the app showed a blank black
 * page and looked broken.
 */
export default function Loading() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6">
      <div className="relative">
        <div className="absolute -inset-6 animate-pulse rounded-full bg-purple-600/20 blur-2xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 text-xl font-black tracking-tight text-white shadow-2xl shadow-purple-900/50">
          HL
        </div>
      </div>

      <div className="text-center">
        <p className="font-mono text-sm font-bold tracking-[0.3em] text-white">HOUSE LOOT</p>
        <p className="mt-1 font-mono text-[11px] text-gun-400">Unsealing the case&hellip;</p>
      </div>

      {/* Three cards sliding past a marker: the reel in miniature. */}
      <div className="relative h-8 w-44 overflow-hidden rounded-lg border border-gun-700 bg-gun-950/70">
        <div className="absolute left-1/2 top-0 z-10 h-full w-px -translate-x-1/2 bg-yellow-400/70" />
        <div className="flex h-full animate-[loot-slide_1.4s_linear_infinite] gap-1.5 p-1.5">
          {['#4b5563', '#2563eb', '#9333ea', '#ec4899', '#eab308', '#4b5563', '#2563eb', '#9333ea'].map(
            (c, i) => (
              <div
                key={i}
                className="h-full w-7 flex-shrink-0 rounded"
                style={{ background: c, opacity: 0.75 }}
              />
            )
          )}
        </div>
      </div>
    </main>
  );
}
