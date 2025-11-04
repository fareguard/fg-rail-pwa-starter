'use client';

import { getSupabaseBrowser } from '@/lib/supabase';
import { useState, useCallback } from 'react';

export default function ConnectGmailButton({
  label = 'Connect Gmail (1–click)',
  next = '/dashboard',
  className = 'btn btnPrimary',
}: {
  label?: string;
  next?: string;         // where to land after OAuth
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    try {
      setBusy(true);
      const supabase = getSupabaseBrowser();
      const origin =
        typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL || '';

      // Always bounce through our callback and then to `next`
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            // limit to Gmail scope for e-tickets; safe defaults
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  }, [next]);

  return (
    <button onClick={onClick} className={className} disabled={busy}>
      {busy ? 'Opening Google…' : label}
    </button>
  );
}
