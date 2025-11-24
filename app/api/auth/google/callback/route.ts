// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSessionCookie } from "@/lib/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const state = url.searchParams.get("state") || "";

    // default redirect target
    let next = "/dashboard";
    if (state.startsWith("next=")) {
      const encoded = state.slice("next=".length);
      try {
        next = decodeURIComponent(encoded);
      } catch {
        // ignore bad state
      }
    }

    if (oauthError || !code) {
      console.error("Google OAuth error or missing code:", oauthError);
      return NextResponse.redirect(`${next}?auth_error=oauth`);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      console.error("Missing Google OAuth env vars");
      return NextResponse.redirect(`${next}?auth_error=env`);
    }

    // --- 1) exchange code -> tokens ---
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
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

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Google token exchange failed:", tokenJson);
      return NextResponse.redirect(`${next}?auth_error=token`);
    }

    const accessToken = tokenJson.access_token as string | undefined;
    const refreshToken = tokenJson.refresh_token as string | undefined;
    const expiresIn =
      typeof tokenJson.expires_in === "number" ? tokenJson.expires_in : 0;

    if (!accessToken) {
      console.error("No access_token in Google response:", tokenJson);
      return NextResponse.redirect(`${next}?auth_error=no_access_token`);
    }

    // --- 2) fetch userinfo ---
    const userRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const profile = await userRes.json();

    const email = profile?.email as string | undefined;
    if (!email) {
      console.error("No email in Google userinfo:", profile);
      return NextResponse.redirect(`${next}?auth_error=no_email`);
    }

    // --- 3) store tokens in Supabase ---
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = expiresIn ? now + expiresIn : null;

    try {
      const supa = getSupabaseAdmin();
      const { error: upsertErr } = await supa
        .from("oauth_staging")
        .upsert(
          {
            provider: "google",
            user_email: email,
            access_token: accessToken,
            refresh_token: refreshToken ?? null,
            expires_at: expiresAt,
            scope: tokenJson.scope ?? null,
            token_type: tokenJson.token_type ?? "Bearer",
          },
          { onConflict: "provider,user_email" } as any
        );

      if (upsertErr) {
        console.error("Failed to upsert oauth_staging:", upsertErr);
      }
    } catch (dbErr) {
      console.error("Supabase admin error:", dbErr);
      // don’t block login just because token storage failed once
    }

    // --- 4) create session cookie based on Gmail address ---
    try {
      createSessionCookie(email);
    } catch (cookieErr) {
      console.error("Failed to create session cookie:", cookieErr);
      // still redirect; worst case /api/me sees you as logged out
    }

    // --- 5) bounce back to dashboard ---
    return NextResponse.redirect(next);
  } catch (err) {
    console.error("Google callback handler crashed:", err);
    // last-ditch fallback to avoid a blank 500
    return NextResponse.redirect("/dashboard?auth_error=callback");
  }
}
