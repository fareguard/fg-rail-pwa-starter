'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export default function AuthCallback() {
  const router = useRouter();
  const sp = useSearchParams();
  const [msg, setMsg] = useState('Finalising sign-in…');

  useEffect(() => {
    const run = async () => {
      try {
        const code = sp.get('code');
        if (!code) {
          setMsg('Missing auth code. Redirecting…');
          router.replace('/dashboard');
          return;
        }

        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // Exchanges the `code` for a session and stores cookies
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          console.error(error);
          setMsg('Sign-in failed. Redirecting…');
          router.replace('/?auth_error=1');
          return;
        }

        // Success → go to dashboard
        router.replace('/dashboard');
      } catch (e) {
        console.error(e);
        router.replace('/?auth_error=1');
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Connecting…</h1>
      <p>{msg}</p>
    </div>
  );
}
