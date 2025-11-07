// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

// keep in one place so UI + DB match
const OAUTH_SCOPE =
  "openid email https://www.googleapis.com/auth/gmail.readonly";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const next = searchParams.get("next") || "/dashboard";
    if (!code) {
      return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
    }

    // 1) Exchange code -> tokens
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
      console.error("Token exchange failed:", tokens);
      return NextResponse.json({ ok: false, error: "Token exchange failed", details: tokens }, { status: 400 });
    }

    // 2) Fetch user's email
    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = await meRes.json();
    const email = me?.email as string | undefined;

    if (!email) {
      console.error("No email from Google:", me);
      return NextResponse.json({ ok: false, error: "No email returned from Google" }, { status: 400 });
    }

    // 3) Compute expires_at (unix seconds)
    const expiresAt =
      typeof tokens.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + tokens.expires_in
        : null;

    const supa = getSupabaseAdmin();

    // 4) Upsert the credentials (store scope too)
    const { error } = await supa
      .from("oauth_staging")
      .upsert(
        {
          user_email: email,
          provider: "google",
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          expires_at: expiresAt,
          scope: OAUTH_SCOPE,
        },
        { onConflict: "user_email,provider" } as any
      );

    if (error) {
      console.error("Supabase upsert error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // 5) Back to dashboard (or next)
    return NextResponse.redirect(new URL(next, req.url));
  } catch (e: any) {
    console.error("Callback crash:", e);
    return NextResponse.json({ ok: false, error: e.message || "callback_failed" }, { status: 500 });
  }
}
