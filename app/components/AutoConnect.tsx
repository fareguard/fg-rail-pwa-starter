"use client";
import { useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function AutoConnect() {
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("connect") === "1") {
      const supabase = getSupabaseBrowser();
      const next = "/dashboard";
      const origin = window.location.origin;
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

      supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
    }
  }, []);

  return null;
}
