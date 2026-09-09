/**
 * THE ADMIN UNLOCK MUST SURVIVE LOOKING AT THE REST OF THE APP.
 *
 *   npm run adminlock
 *
 * The unlock cookie kept vanishing the instant it was issued. The cause was
 * middleware (`proxy.ts`) that deleted `hl_admin_unlock` on any request outside
 * /admin — and `app/admin/page.tsx` renders <Link href="/">, which Next
 * PREFETCHES as it enters the viewport. So merely opening the admin page fired
 * a background request for `/` that stripped the operator's own unlock.
 *
 * Nothing in the app may delete that cookie except the explicit lock endpoints.
 * This is a static guard rather than an HTTP test on purpose: reproducing it
 * live needs a real session, and writing rows into the party database to prove
 * a cookie rule is a bad trade.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

let fails = 0;
const ok = (g: boolean, m: string) => { console.log((g ? '  ok    ' : '  FAIL  ') + m); if (!g) fails++; };

const COOKIE = 'hl_admin_unlock';

/** Files allowed to clear the unlock — the deliberate lock endpoints. */
const ALLOWED = [
  'lib/admin-lock.ts',                 // lockAdmin(), the one implementation
  'app/api/admin/lock/route.ts',       // POST/GET lock
  'app/api/admin/unlock/route.ts',     // DELETE unlock
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [
  ...(existsSync('app') ? walk('app') : []),
  ...(existsSync('lib') ? walk('lib') : []),
  ...(existsSync('components') ? walk('components') : []),
  ...(existsSync('proxy.ts') ? ['proxy.ts'] : []),
  ...(existsSync('middleware.ts') ? ['middleware.ts'] : []),
];

const offenders: string[] = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = f.replace(/\\/g, '/');
  if (ALLOWED.some((a) => rel.endsWith(a))) continue;
  // A deletion looks like cookies.delete(COOKIE) or set(COOKIE, '', maxAge 0).
  const deletes =
    new RegExp('cookies\\s*\\.\\s*delete\\s*\\(\\s*[\'"`]' + COOKIE).test(src) ||
    new RegExp(COOKIE + '[\'"`]\\s*,\\s*[\'"`][\'"`]').test(src);
  if (deletes) offenders.push(rel);
}

console.log('\n  scanned ' + files.length + ' source files\n');
ok(offenders.length === 0,
  'only the lock endpoints clear the unlock cookie' +
  (offenders.length ? ' — but these also do: ' + offenders.join(', ') : ''));

/*
 * And middleware must not be sitting on every request able to do it.
 *
 * Comments are stripped first: this file's own history is written in the
 * comments of proxy.ts, and a guard that fails because someone documented the
 * bug it prevents is a guard people delete.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

for (const mw of ['proxy.ts', 'middleware.ts']) {
  if (!existsSync(mw)) continue;
  const code = stripComments(readFileSync(mw, 'utf8'));
  ok(!code.includes(COOKIE),
    mw + ' has no executable reference to the unlock cookie');
}

// The TTL must be a real window, not a value someone trimmed to nothing.
const lock = readFileSync('lib/admin-lock.ts', 'utf8');
const ttl = /TTL_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(lock);
const minutes = ttl ? Number(ttl[1]) : 0;
ok(minutes >= 15, 'the unlock lasts at least 15 minutes (' + minutes + ')');
ok(/jar\.set\(COOKIE/.test(lock) || /re-issued/.test(lock),
  'and is re-issued on use, so it cannot expire mid-edit');

console.log('\n  ' + (fails ? fails + ' FAILURE(S)' : 'nothing can silently revoke the admin unlock') + '\n');
process.exit(fails ? 1 : 0);
