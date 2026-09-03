import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await getSession();
  if (session && !session.mustChangePin) {
    redirect('/');
  }

  let roster: { id: string; name: string }[] = [];
  try {
    // Deliberately NOT fetched. The owner wants a plain "type your name" field,
    // and shipping the roster would list every housemate to anyone who loads
    // the login page. The server resolves the typed name exactly.
    roster = [];
  } catch (err) {
    console.error('[LoginPage] roster query failed', err);
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-4 bg-gun-950 bg-radial-gradient">
      {/* Background neon ambient */}
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
        <div className="h-96 w-96 rounded-full bg-purple-600/10 blur-[120px]" />
        <div className="h-96 w-96 rounded-full bg-blue-600/10 blur-[120px] -translate-y-20" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-6">
          {/* Case lid + the chapter's letters, matching the tab icon. */}
          <div className="mx-auto mb-3 flex w-fit flex-col items-center">
            <div className="h-2.5 w-16 rounded-t-md bg-gradient-to-r from-yellow-600 via-yellow-300 to-yellow-600 shadow-lg shadow-yellow-900/40" />
            <div className="mt-0.5 flex h-14 w-20 items-center justify-center rounded-b-xl border border-purple-400/40 bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 text-2xl font-black tracking-tighter text-white shadow-2xl shadow-purple-500/30">
              ΨΥ
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white">PSI U LOOT BOX</h1>
          <p className="mt-1 text-xs font-mono uppercase tracking-widest text-gun-400">
            Moving Out &middot; Mystery Cases
          </p>
        </div>

        {/* Login Card */}
        <LoginForm
          roster={roster}
          initialMustChange={session?.mustChangePin ?? false}
          userName={session?.name}
        />

        {/* Footer Note */}
        <div className="mt-6 text-center text-[11px] font-mono text-gun-400">
          <span>Default seeded PIN: </span>
          <span className="text-yellow-400 font-bold">1234</span>
          <span> (you will be prompted to change it)</span>
        </div>
      </div>
    </main>
  );
}
