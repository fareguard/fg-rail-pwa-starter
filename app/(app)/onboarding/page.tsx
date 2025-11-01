"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true } }
);

const FORWARDING_EMAIL = process.env.NEXT_PUBLIC_FORWARDING_EMAIL || ""; // optional

export default function Onboarding() {
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
      if (error) alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container" style={{ padding: "32px 0" }}>
      <h1 style={{ color: "var(--fg-navy)" }}>Get started</h1>
      <p className="sub">
        Connect your email so we can detect journeys & delays and file Delay Repay for you.
      </p>

      <div className="ctaRow" style={{ marginTop: 16 }}>
        <button
          className="btn btnPrimary"
          onClick={handleGoogle}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? "Connecting…" : "Connect Gmail"}
        </button>
        {FORWARDING_EMAIL ? (
          <a href={`mailto:${FORWARDING_EMAIL}`} className="btn btnGhost">
            Or forward tickets to {FORWARDING_EMAIL}
          </a>
        ) : null}
      </div>

      <ul className="list" style={{ marginTop: 20 }}>
        <li><span className="dot" /> We only use booking emails to track delays and file claims.</li>
        <li><span className="dot" /> No win, no fee on refunds (we keep 20%).</li>
        <li><span className="dot" /> You can disconnect any time.</li>
      </ul>
    </main>
  );
}
