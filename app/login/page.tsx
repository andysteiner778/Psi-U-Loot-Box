import { getSession, playerRoster } from '@/lib/session';
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
    roster = await playerRoster();
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
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 font-black text-white text-xl shadow-2xl shadow-purple-500/30 ring-1 ring-purple-400/40">
            HL
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white">HOUSE LOOT</h1>
          <p className="mt-1 text-xs font-mono uppercase tracking-widest text-gun-400">
            Frat Moving Out CS:GO Mystery Boxes
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
