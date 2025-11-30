// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { encodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateStr = url.searchParams.get("state") || "";

  const stateParams = new URLSearchParams(stateStr);
  const nextPath = stateParams.get("next") || "/dashboard";

  if (!code) {
    // Nothing we can do – just bounce back
    return NextResponse.redirect(nextPath);
  }

  try {
    // 1) Exchange code for tokens
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

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("Google token exchange failed", tokenRes.status, tokenJson);
      return NextResponse.redirect(nextPath);
    }

    const access_token: string = tokenJson.access_token;
    const refresh_token: string | undefined = tokenJson.refresh_token;
    const expires_in: number | undefined = tokenJson.expires_in;
    const scope: string | undefined = tokenJson.scope;
    const token_type: string | undefined = tokenJson.token_type;

    if (!access_token) {
      console.error("No access_token from Google", tokenJson);
      return NextResponse.redirect(nextPath);
    }

    // 2) Fetch user info → email
    const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const userinfo = await userinfoRes.json();

    if (!userinfoRes.ok || !userinfo.email) {
      console.error("Failed to fetch userinfo", userinfoRes.status, userinfo);
      return NextResponse.redirect(nextPath);
    }

    const email: string = userinfo.email;

    // 3) Upsert tokens into oauth_staging (per email!)
    const supa = getSupabaseAdmin();
    const now = Math.floor(Date.now() / 1000);
    const expires_at = expires_in ? now + expires_in : null;

    const { error: oauthErr } = await supa
      .from("oauth_staging")
      .upsert(
        {
          provider: "google",
          user_email: email,
          access_token,
          refresh_token: refresh_token ?? null,
          expires_at,
          scope: scope ?? null,
          token_type: token_type ?? null,
        },
        { onConflict: "provider,user_email" } as any
      );

    if (oauthErr) {
      console.error("Supabase oauth_staging upsert failed", oauthErr);
    }

    // 4) Optional: upsert into profiles table
    try {
      await supa
        .from("profiles")
        .upsert(
          { email },
          { onConflict: "email" } as any
        );
    } catch (e) {
      console.error("profiles upsert failed (non-fatal)", e);
    }

    // 5) Create session cookie
    const sessionToken = encodeSession({ email, iat: now });

    const redirectUrl = new URL(nextPath, process.env.NEXT_PUBLIC_SITE_URL || url.origin);
    const res = NextResponse.redirect(redirectUrl.toString());

    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });

    return res;
  } catch (e) {
    console.error("Unhandled Google callback error", e);
    return NextResponse.redirect(nextPath);
  }
}
