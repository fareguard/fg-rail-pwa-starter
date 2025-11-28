// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSessionFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  return res;
}

export async function GET(req: Request) {
  try {
    // 🔑 Read fg_session cookie → { email } or null
    const session = await getSessionFromRequest(req);
    const email = session?.email;

    if (!email) {
      return noStoreJson({ authenticated: false });
    }

    // Optional: check that this Gmail actually has OAuth tokens in oauth_staging
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("oauth_staging")
      .select("user_email")
      .eq("provider", "google")
      .eq("user_email", email)
      .maybeSingle();

    const gmailConnected = !error && !!data;

    return noStoreJson({
      authenticated: true,
      email,
      via: "gmail-session",
      gmailConnected,
    });
  } catch (e: any) {
    return noStoreJson({
      authenticated: false,
      error: String(e?.message || e),
    });
  }
}
