// components/ConnectGmailButton.tsx
"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase =
  typeof window !== "undefined"
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : (null as any);

export default function ConnectGmailButton({
  label = "Connect Gmail (1-click)",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <button
      className={`btn btnPrimary ${className}`}
      disabled={loading}
      onClick={async () => {
        if (!supabase) return;
        setLoading(true);
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            // Keep scopes minimal to pass review; expand later if needed.
            scopes:
              "openid email https://www.googleapis.com/auth/gmail.readonly",
            redirectTo: `${window.location.origin}/dashboard`,
          },
        });
        setLoading(false);
      }}
    >
      {loading ? "Opening Google…" : label}
    </button>
  );
}
