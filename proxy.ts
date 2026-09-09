import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Proxy — enforces admin lock upon returning to the main menu.
 *
 * When an admin leaves the /admin portal and visits any player page (like /),
 * this proxy automatically strips the `hl_admin_unlock` cookie.
 * Next time they tap "Admin", they must re-enter their admin PIN.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // If navigating anywhere outside /admin and /api/admin, clear the admin unlock cookie
  // so returning to the main menu or player pages immediately re-locks the admin panel.
  if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) {
    if (request.cookies.has('hl_admin_unlock')) {
      const response = NextResponse.next();
      response.cookies.delete('hl_admin_unlock');
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
