import Link from 'next/link';

/**
 * 404.
 *
 * Framed as an unboxing that came up empty rather than as a server error,
 * because most people who hit this will have mistyped the link on a phone at a
 * party, and a stack-trace-shaped page makes them think the app is broken.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      {/* An empty case: lid ajar, nothing inside. */}
      <div className="relative">
        <div className="absolute -inset-8 rounded-full bg-purple-700/10 blur-3xl" />
        <div className="relative flex flex-col items-center">
          <div className="h-2 w-24 -rotate-6 rounded-t-md bg-gradient-to-r from-yellow-600 to-yellow-400 shadow-lg" />
          <div className="mt-1 flex h-20 w-28 items-center justify-center rounded-b-xl rounded-t-sm border border-gun-600 bg-gradient-to-b from-gun-800 to-gun-950 shadow-2xl">
            <span className="font-mono text-3xl font-black tracking-tighter text-gun-600">404</span>
          </div>
        </div>
      </div>

      <div className="max-w-xs">
        <h1 className="text-xl font-black tracking-tight text-white">This case came up empty</h1>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-gun-400">
          That page isn&apos;t in the house. Check the link, or head back and open
          something that actually has loot in it.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <Link
          href="/"
          className="rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 py-3 font-mono text-xs font-bold text-white shadow-lg shadow-indigo-900/40 transition hover:brightness-110 active:scale-95"
        >
          Back to the Cases
        </Link>
        <Link
          href="/inventory"
          className="rounded-xl border border-gun-700 bg-gun-800/60 py-3 font-mono text-xs font-semibold text-gun-300 transition hover:text-white"
        >
          My Inventory
        </Link>
      </div>
    </main>
  );
}
