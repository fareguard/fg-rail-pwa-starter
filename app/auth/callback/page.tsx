// app/auth/callback/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SupabaseCallback() {
  const router = useRouter();
  const search = useSearchParams();
  const [msg, setMsg] = useState("Finishing sign in…");

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabaseBrowser();

        // Handle Supabase OAuth result in the URL:
        const href = window.location.href;
        const { data, error } = await supabase.auth.exchangeCodeForSession(href);

        if (error) {
          console.error("exchangeCodeForSession error:", error);
          setMsg("Sign in failed. Please try again.");
          // small delay so the message is visible
          setTimeout(() => router.replace("/?connect=1"), 1000);
          return;
        }

        // Go to the intended page (defaults to dashboard)
        const next = search.get("next") || "/dashboard";
        router.replace(next);
      } catch (e) {
        console.error(e);
        setMsg("Unexpected error. Please try again.");
        setTimeout(() => router.replace("/?connect=1"), 1000);
      }
    })();
  }, [router, search]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Connecting…</h1>
      <p>{msg}</p>
    </div>
  );
}
