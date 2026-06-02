import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes — allow without token check
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // For API routes, let the backend return 401 — the client handles redirect
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // For page routes, check the token cookie (we store a flag cookie on login)
  const hasSession = req.cookies.get('admin_authed');
  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
