'use client';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ConnectGmail() {
  const onClick = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // This must match the origins you added in Google Cloud.
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'openid email profile'
      }
    });
  };

  return (
    <button
      onClick={onClick}
      className="rounded-lg border px-4 py-2 font-medium hover:bg-gray-50"
      aria-label="Connect your Gmail account"
    >
      Connect Gmail
    </button>
  );
}
