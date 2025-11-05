// app/auth/callback/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.fareguard.co.uk';

export default function OAuthCallbackPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState('Finishing sign-in…');

  useEffect(() => {
    (async () => {
      try {
        const code = sp.get('code');
        const next = sp.get('next') || '/dashboard';
        if (!code) {
          setMsg('No auth code found.');
          // send them somewhere useful
          router.replace('/dashboard');
          return;
        }

        const supabase = getSupabaseBrowser();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error('exchangeCodeForSession error:', error);
          setMsg('Sign-in failed. Please try again.');
          return;
        }

        // Hard redirect to canonical host so cookies are read on that host
        window.location.assign(`${SITE}${next}`);
      } catch (e) {
        console.error(e);
        setMsg('Something went wrong. Please try again.');
      }
    })();
  }, [sp, router]);

  return (
    <div className="container" style={{ padding: '40px 0' }}>
      <h1 className="h1">Signing you in…</h1>
      <p className="sub">{msg}</p>
    </div>
  );
}
