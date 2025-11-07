// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!; // must match OAuth client

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state") || "";
    const next = new URLSearchParams(state).get("next") || "/dashboard";

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
      return NextResponse.json(
        { ok: false, error: "Token exchange failed", details: tokens },
        { status: 400 }
      );
    }

    // 2) Fetch user’s email
    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = await meRes.json();
    const email = me?.email as string | undefined;

    if (!email) {
      return NextResponse.json({ ok: false, error: "No email from Google" }, { status: 400 });
    }

    // 3) Upsert into oauth_staging (so reconnects replace old/invalid tokens)
    const supa = getSupabaseAdmin();

    // Optional: ensure table has a unique constraint on (provider, user_email) for true upsert
    // Otherwise this still works as a best-effort dedupe.
    await supa
      .from("oauth_staging")
      .delete()
      .eq("provider", "google")
      .eq("user_email", email);

    const expiresAt =
      typeof tokens.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + tokens.expires_in
        : null;

    const { error: insErr } = await supa.from("oauth_staging").insert({
      provider: "google",
      user_email: email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null, // may be null if Google didn’t send one
      expires_at: expiresAt,
      scope: tokens.scope || null,
      token_type: tokens.token_type || "Bearer",
    });

    if (insErr) {
      console.error("Supabase insert error:", insErr);
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    // 4) Return to your app
    return NextResponse.redirect(new URL(next, req.url));
  } catch (e: any) {
    console.error("Callback crash:", e);
    return NextResponse.json({ ok: false, error: e.message || "callback_failed" }, { status: 500 });
  }
}
