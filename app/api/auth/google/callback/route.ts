// app/api/auth/google/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

// Exchange code for tokens
async function exchangeCodeForTokens(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
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

  const json = await res.json();
  if (!res.ok) {
    console.error("Google token exchange failed", res.status, json);
    throw new Error("google_token_exchange_failed");
  }
  return json;
}

// Fetch basic profile (email) using access token
async function fetchUserInfo(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("Google userinfo failed", res.status, json);
    throw new Error("google_userinfo_failed");
  }
  return json;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // "next=%2Fdashboard" etc.

    if (!code) {
      return NextResponse.json(
        { ok: false, error: "missing_code" },
        { status: 400 }
      );
    }

    const tokens = await exchangeCodeForTokens(code);
    const accessToken = tokens.access_token as string;
    const refreshToken = (tokens.refresh_token as string | undefined) || null;
    const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : null;
    const scope = (tokens.scope as string | undefined) || null;
    const tokenType = (tokens.token_type as string | undefined) || "Bearer";
    const expiresAt =
      expiresIn != null ? Math.floor(Date.now() / 1000) + expiresIn : null;

    // Who is this user?
    const profile = await fetchUserInfo(accessToken);
    const email = (profile.email as string | undefined)?.toLowerCase();

    if (!email) {
      throw new Error("no_email_from_google");
    }

    // Decide where to send them after login
    let nextPath = "/dashboard";
    if (state && state.startsWith("next=")) {
      const raw = state.slice("next=".length);
      try {
        const decoded = decodeURIComponent(raw);
        if (decoded.startsWith("/")) nextPath = decoded;
      } catch {
        // ignore bad state
      }
    }

    const redirectRes = NextResponse.redirect(new URL(nextPath, url.origin));

    // 🔑 Set session cookie FIRST (so even if Supabase upsert fails, they are “logged in”)
    createSessionCookie(redirectRes, email);

    // 🔑 Best-effort upserts into Supabase (don’t block login)
    try {
      const supa = getSupabaseAdmin();

      // identity table
      await supa
        .from("oauth_accounts")
        .upsert(
          {
            provider: "google",
            provider_user_id: profile.sub || email,
            email,
            raw_profile: profile,
          },
          { onConflict: "provider,provider_user_id" } as any
        );

      // tokens used by Gmail ingest
      await supa
        .from("oauth_staging")
        .upsert(
          {
            provider: "google",
            user_email: email,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresAt,
            scope,
            token_type: tokenType,
          },
          { onConflict: "provider,user_email" } as any
        );

      // simple profile table if you keep one
      await supa
        .from("profiles")
        .upsert(
          {
            email,
            provider: "google",
            last_login_at: new Date().toISOString(),
          },
          { onConflict: "email" } as any
        );
    } catch (e) {
      console.error("Supabase upsert error in callback", e);
      // we still return redirectRes
    }

    return redirectRes;
  } catch (e: any) {
    console.error("google callback error", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
