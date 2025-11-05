// app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server'; // <- if your helper is named differently, import that
// If your server helper currently lives at "@/lib/supabase", use that import instead.

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.fareguard.co.uk';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/dashboard';

  try {
    const supabase = getSupabaseServer();

    // Only try to exchange if we actually received a code
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('[callback] exchangeCodeForSession error:', error);
        return NextResponse.redirect(new URL('/auth/callback?error=exchange_failed', SITE));
      }
    } else {
      // If we arrived here without a code, bounce to dashboard anyway —
      // worst case the user still sees "Connect Gmail"
      return NextResponse.redirect(new URL(next, SITE));
    }

    // fire-and-forget ingestion kick (no await)
    fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ''}/api/ingest/kickoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }).catch(() => {});

    // Success: redirect to canonical host + desired page
    return NextResponse.redirect(new URL(next, SITE));
  } catch (e: any) {
    console.error('[callback] exception:', e?.message || e);
    return NextResponse.redirect(new URL('/auth/callback?error=exception', SITE));
  }
}
