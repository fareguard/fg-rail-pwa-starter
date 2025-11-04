'use client';

import { createBrowserClient } from '@supabase/ssr';

type Props = { label?: string; className?: string };

export default function ConnectGmailButton({ label = 'Connect Gmail (1–click)', className }: Props) {
  async function handleClick() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const origin = window.location.origin;

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // 👇 after Google → come back to our callback page
        redirectTo: `${origin}/auth/callback`,
        scopes: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
  }

  return (
    <button onClick={handleClick} className={className ?? 'btn btnPrimary'} type="button">
      {label}
    </button>
  );
}
