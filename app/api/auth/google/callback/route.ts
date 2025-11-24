// app/api/auth/google/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  exchangeCodeForTokens,
  fetchGoogleUser,
} from "@/lib/google";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";
    const error = url.searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        `/dashboard?error=${encodeURIComponent(error)}`
      );
    }

    if (!code) {
      return NextResponse.redirect(
        `/dashboard?error=${encodeURIComponent("missing_code")}`
      );
    }

    const redirectOrigin = process.env.GOOGLE_REDIRECT_URI
      ? new URL(process.env.GOOGLE_REDIRECT_URI).origin
      : `${url.protocol}//${url.host}`;

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ??
      `${redirectOrigin}/api/auth/google/callback`;

    const tokenJson = await exchangeCodeForTokens(code, redirectUri);

    const accessToken = tokenJson.access_token as string | undefined;
    const refreshToken =
      (tokenJson.refresh_token as string | undefined) ?? null;
    const expiresIn =
      (tokenJson.expires_in as number | undefined) ?? null;
    const scope = (tokenJson.scope as string | undefined) ?? null;
    const tokenType =
      (tokenJson.token_type as string | undefined) ?? "Bearer";

    if (!accessToken) {
      throw new Error("No access_token in Google token response");
    }

    const userInfo = await fetchGoogleUser(accessToken);
    const email = userInfo.email;
    const sub = userInfo.sub;

    if (!email) {
      throw new Error("Google userinfo did not return an email");
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = expiresIn ? now + expiresIn : null;

    const supa = getSupabaseAdmin();
    await supa.from("oauth_staging").insert({
      provider: "google",
      user_email: email,
      user_id: null, // gmail-as-identity – we key everything off email
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      scope,
      token_type: tokenType,
    });

    const sessionToken = createSessionToken({
      email,
      provider: "google",
      sub,
    });

    let nextPath = "/dashboard";
    if (state) {
      try {
        const sp = new URLSearchParams(state);
        const maybeNext = sp.get("next");
        if (maybeNext && maybeNext.startsWith("/")) {
          nextPath = maybeNext;
        }
      } catch {
        // ignore bad state
      }
    }

    const res = NextResponse.redirect(nextPath);
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    // little ping for client-side listeners if you want it
    res.headers.set("fg-auth-ok", "1");

    return res;
  } catch (err: any) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(
      `/dashboard?error=${encodeURIComponent("google_oauth_failed")}`
    );
  }
}
