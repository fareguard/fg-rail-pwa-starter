// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  encodeSession,
  SESSION_COOKIE_NAME,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";

  // default redirect target
  const stateParams = new URLSearchParams(state);
  const nextPath = stateParams.get("next") || "/dashboard";

  // If no code, just bounce home
  if (!code) {
    const fallback = new URL("/", `${url.protocol}//${url.host}`);
    return NextResponse.redirect(fallback);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("Missing Google OAuth env vars");
    return NextResponse.json(
      { ok: false, error: "Missing Google OAuth env vars" },
      { status: 500 }
    );
  }

  try {
    // 1) Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenJson: any = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("Google token exchange failed:", tokenRes.status, tokenJson);
      const errorRedirect = new URL(
        "/?error=google_auth",
        `${url.protocol}//${url.host}`
      );
      return NextResponse.redirect(errorRedirect);
    }

    const {
      access_token,
      refresh_token,
      expires_in,
      scope,
      token_type,
    } = tokenJson;

    if (!access_token) {
      console.error("No access_token in Google response:", tokenJson);
      return NextResponse.json(
        { ok: false, error: "No access_token from Google" },
        { status: 500 }
      );
    }

    // 2) Get user profile (email) from Google
    const meRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const meJson: any = await meRes.json();

    if (!meRes.ok || !meJson?.email) {
      console.error("Failed to fetch Google userinfo:", meRes.status, meJson);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch Google user info" },
        { status: 500 }
      );
    }

    const email: string = meJson.email;

    // 3) Store tokens in oauth_staging (per email, for ingest)
    const supa = getSupabaseAdmin();
    const now = Math.floor(Date.now() / 1000);
    const expires_at = typeof expires_in === "number" ? now + expires_in : null;

    await supa.from("oauth_staging").insert({
      provider: "google",
      user_email: email,
      access_token,
      refresh_token: refresh_token ?? null,
      expires_at,
      scope: scope ?? null,
      token_type: token_type ?? null,
    });

    // 4) Create our own signed session cookie (gmail-as-identity)
    const sessionValue = encodeSession({
      email,
      createdAt: Date.now(),
    });

    const redirectTo = new URL(
      nextPath || "/dashboard",
      `${url.protocol}//${url.host}`
    );

    const res = NextResponse.redirect(redirectTo);

    res.cookies.set(SESSION_COOKIE_NAME, sessionValue, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180, // 180 days
    });

    return res;
  } catch (err: any) {
    console.error("Google callback error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export const POST = GET;
