import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/supabase";  // <-- 5 dots

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.json({ ok:false, error:"Missing code" }, { status: 400 });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    return NextResponse.json({ ok:false, error:"Token exchange failed", details: tokens }, { status: 400 });
  }

  const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const me = await meRes.json();

  const supa = getSupabaseAdmin();
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  const { error } = await supa.from("oauth_staging").insert({
    provider: "google",
    email: me?.email ?? null,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    expires_at: expiresAt,
    scope: tokens.scope ?? null,
    raw: tokens,
  });
  if (error) return NextResponse.json({ ok:false, error: error.message }, { status: 500 });

  return NextResponse.redirect(new URL("/onboarding?connected=google", req.url));
}
