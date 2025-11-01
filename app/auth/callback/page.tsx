"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
);

export default function AuthCallback() {
  const router = useRouter();
  const [msg, setMsg] = useState("Finalising sign-in…");

  useEffect(() => {
    (async () => {
      try {
        // Exchange the ?code= for a session and set cookies/local storage
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) throw error;
        setMsg("Connected! Redirecting…");
        router.replace("/onboarding"); // or "/"
      } catch (e: any) {
        setMsg(e?.message || "Could not complete sign-in");
      }
    })();
  }, [router]);

  return (
    <main style={{padding:24}}>
      <h1>Connecting Gmail…</h1>
      <p>{msg}</p>
    </main>
  );
}
