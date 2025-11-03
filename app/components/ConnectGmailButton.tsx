// app/components/ConnectGmailButton.tsx
"use client";

import { createClient } from "@supabase/supabase-js";
import * as React from "react";

type Props = { label?: string; className?: string };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ConnectGmailButton({
  label = "Connect Gmail (1–click)",
  className = "btn btnPrimary",
}: Props) {
  const onClick = async () => {
    const redirectTo = `${window.location.origin}/dashboard?auth=1`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes:
          "https://www.googleapis.com/auth/gmail.readonly openid email profile",
      },
    });
  };

  return (
    <button onClick={onClick} className={className}>
      {label}
    </button>
  );
}
