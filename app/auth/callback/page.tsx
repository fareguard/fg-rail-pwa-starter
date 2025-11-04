'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

// Make sure this route never gets statically prerendered
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function ExchangeStep() {
  const router = useRouter();
  const sp = useSearchParams();
  const [msg, setMsg] = useState('Finalising sign-in…');

  useEffect(() => {
    const run = async () => {
      try {
        const code = sp.get('code');
        if (!code) {
          setMsg('No auth code found. Redirecting…');
          router.replace('/dashboard');
          return;
        }

        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // Exchange the PKCE code for a session and persist cookies
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          console.error(error);
          setMsg('Sign-in failed. Redirecting…');
          router.replace('/?auth_error=1');
          return;
        }

        // Success → Go to dashboard
        router.replace('/dashboard');
      } catch (e) {
        console.error(e);
        router.replace('/?auth_error=1');
      }
    };

    run();
  }, [router, sp]);

  return <p>{msg}</p>;
}

export default function AuthCallbackPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>Connecting…</h1>
      <Suspense fallback={<p>Preparing…</p>}>
        <ExchangeStep />
      </Suspense>
    </div>
  );
}
