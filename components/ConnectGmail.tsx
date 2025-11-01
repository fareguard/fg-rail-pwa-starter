"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useState } from "react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ConnectGmailButton() {
  const [loading, setLoading] = useState(false);

  const connect = useCallback(async () => {
    try {
      setLoading(true);
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // keep read-only at first; we can add gmail.modify later if needed
          scopes: "email profile https://www.googleapis.com/auth/gmail.readonly",
          // optional: force your site url callback if you set it in Google/Supabase
          // redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
        },
      });
    } catch (e) {
      console.error(e);
      alert("Google sign-in failed. Check OAuth redirects in Supabase & Google Cloud.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <button className="btn btnPrimary" onClick={connect} disabled={loading}>
      {loading ? "Connecting…" : "Connect Gmail"}
    </button>
  );
}
