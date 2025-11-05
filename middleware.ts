// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  if (url.pathname === '/' && url.searchParams.has('code')) {
    const next = url.searchParams.get('next') || '/dashboard';
    const code = url.searchParams.get('code')!;
    return NextResponse.redirect(
      new URL(`/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`, url)
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/auth/callback'],
};
