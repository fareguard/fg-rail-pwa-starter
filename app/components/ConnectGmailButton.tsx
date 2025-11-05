// app/components/ConnectGmailButton.tsx
'use client';

import { useState, useCallback } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.fareguard.co.uk';

export default function ConnectGmailButton({
  label = 'Connect Gmail (1–click)',
  next = '/dashboard',
  className = 'btn btnPrimary',
}: {
  label?: string;
  next?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    try {
      setBusy(true);
      const supabase = getSupabaseBrowser();

      const redirectTo = `${SITE}/auth/callback?next=${encodeURIComponent(
        next
      )}`;

      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          scopes: 'openid email https://www.googleapis.com/auth/gmail.readonly',
          queryParams: { access_type: 'offline', prompt: 'consent' },
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
