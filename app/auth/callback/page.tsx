'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function OAuthCallback() {
  const [status, setStatus] = useState<'working'|'ok'|'err'>('working');
  const [msg, setMsg] = useState<string>('Connecting…');

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) throw error;
        setStatus('ok');
        setMsg('Connected! Redirecting…');
        // Send them back to dashboard/home
        setTimeout(() => { window.location.href = '/dashboard'; }, 800);
      } catch (e: any) {
        setStatus('err');
        setMsg(e?.message || 'Sign-in failed');
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold mb-2">Google Sign-in</h1>
      <p className={status === 'err' ? 'text-red-600' : 'text-gray-700'}>
        {msg}
      </p>
      {status === 'err' && (
        <p className="mt-4">
          <Link className="text-blue-600 underline" href="/">Go back</Link>
        </p>
      )}
    </main>
  );
}
