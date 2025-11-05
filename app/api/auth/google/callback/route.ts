// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const next = searchParams.get("next") || "/dashboard";
    if (!code) return NextResponse.redirect(new URL("/auth/callback/signing-in?err=no_code", req.url));

    // 1) exchange code -> tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
        access_type: "offline",
      }),
    });
    const tokens = await tokenRes.json();

    if (!tokenRes.ok || !tokens.access_token) {
      console.error("google token exchange failed", tokens);
      return NextResponse.redirect(new URL("/auth/callback/signing-in?err=token_exchange", req.url));
    }

    // 2) fetch minimal profile (email)
    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = await meRes.json();
    const email = me?.email as string | undefined;
    if (!email) {
      console.error("google no email", me);
      return NextResponse.redirect(new URL("/auth/callback/signing-in?err=no_email", req.url));
    }

    const expiresAt =
      typeof tokens.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + tokens.expires_in
        : null;

    // 3) upsert, but DO NOT overwrite an existing refresh_token with null
    const db = getSupabaseAdmin();
    const { error } = await db.rpc("upsert_oauth_staging", {
      p_user_email: email,
      p_provider: "google",
      p_access_token: tokens.access_token as string,
      p_refresh_token: (tokens.refresh_token ?? null) as string | null,
      p_expires_at: expiresAt,
    });

    if (error) {
      console.error("oauth upsert failed", error);
      return NextResponse.redirect(new URL("/auth/callback/signing-in?err=upsert_failed", req.url));
    }

    return NextResponse.redirect(new URL(next, req.url));
  } catch (e: any) {
    console.error("callback crash", e);
    return NextResponse.redirect(new URL("/auth/callback/signing-in?err=exception", req.url));
  }
}
