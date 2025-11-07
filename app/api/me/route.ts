// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server"; // if your helper is named differently, use that
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET() {
  try {
    // Try normal Supabase auth first (if you keep using it anywhere)
    try {
      const supabase = getSupabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        return noStoreJson({
          authenticated: true,
          email: user.email,
          userId: user.id,
          via: "supabase",
        });
      }
    } catch {
      // swallow – we’ll fall back to Gmail OAuth below
    }

    // Fallback: if user has granted Gmail access via our Google OAuth, treat as connected
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("oauth_staging")
      .select("user_email, provider, created_at")
      .eq("provider", "google")
      .order("created_at", { ascending: false })
      .limit(1);

    if (data && data.length) {
      return noStoreJson({
        authenticated: true,
        email: data[0].user_email,
        via: "gmail-oauth",
      });
    }

    return noStoreJson({ authenticated: false });
  } catch (e: any) {
    return noStoreJson({ authenticated: false, error: String(e?.message || e) });
  }
}
