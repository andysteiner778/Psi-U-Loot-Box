import { NextResponse } from 'next/server';

/**
 * DELIBERATELY DOES NOTHING. Safe to delete this file.
 *
 * It used to strip the `hl_admin_unlock` cookie on any request whose path was
 * not under /admin or /api/admin, to "re-lock the panel the moment you go back
 * to the main menu". That is why unlocking never held: enter the PIN, land on
 * the admin page, and the panel reports itself locked again on the very next
 * action.
 *
 * The reason is prefetching. `app/admin/page.tsx` renders <Link href="/">, and
 * Next prefetches links as they enter the viewport — so simply LOOKING at the
 * admin page fired a background request for `/`, which this middleware matched
 * and used to delete the unlock cookie while the admin was still sitting on the
 * page. Nothing the operator did caused it and nothing they could do avoided
 * it. Any player-page request would do it: a poll, an image, an RSC prefetch.
 *
 * Stripping a cookie on navigation was never the right mechanism anyway. The
 * threat is an unattended phone, and that is covered by the 30-minute idle
 * expiry in lib/admin-lock.ts (re-issued on use, so it cannot expire mid-edit)
 * and by the explicit "Lock Admin" button.
 *
 * The matcher is narrowed to a path that does not exist so the edge function is
 * effectively never invoked. `git rm proxy.ts` is the tidier end state; it is
 * left here as a no-op because deleting it was not something to do quietly in
 * the middle of a deploy the owner was actively testing.
 */
export function proxy() {
  return NextResponse.next();
}

export const config = {
  // Matches nothing real. See the note above.
  matcher: ['/__proxy_disabled__'],
};
