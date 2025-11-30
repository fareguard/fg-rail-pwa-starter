// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/google/callback`;

function noStoreRedirect(url: string) {
  const res = NextResponse.redirect(url);
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  return res;
}

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
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state") || "";

    // Fallback if something weird happens
    let nextPath = "/dashboard";
    const m = state.match(/next=([^&]+)/);
    if (m) {
      try {
        nextPath = decodeURIComponent(m[1]);
      } catch {
        nextPath = "/dashboard";
      }
    }

    if (!code) {
      // If Google hits us without a code, just bounce to dashboard
      return noStoreRedirect(nextPath);
    }

    // 1) Exchange auth code for tokens
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

    const tokenJson: any = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("Google token exchange failed", tokenRes.status, tokenJson);
      return noStoreJson(
        {
          ok: false,
          step: "token",
          error: "google_token_exchange_failed",
          detail: tokenJson,
        },
        500
      );
    }

    const access_token: string | undefined = tokenJson.access_token;
    const refresh_token: string | undefined = tokenJson.refresh_token;
    const expires_in: number | undefined = tokenJson.expires_in;
    const scope: string | undefined = tokenJson.scope;
    const token_type: string | undefined = tokenJson.token_type;

    if (!access_token) {
      console.error("No access_token in token response", tokenJson);
      return noStoreJson(
        { ok: false, step: "token", error: "no_access_token" },
        500
      );
    }

    // 2) Use access_token to get the user's email
    const userinfoRes = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const userinfo: any = await userinfoRes.json();
    if (!userinfoRes.ok) {
      console.error(
        "Google userinfo failed",
        userinfoRes.status,
        userinfo
      );
      return noStoreJson(
        {
          ok: false,
          step: "userinfo",
          error: "google_userinfo_failed",
          detail: userinfo,
        },
        500
      );
    }

    const email: string | undefined = userinfo.email;
    if (!email) {
      console.error("No email in userinfo payload", userinfo);
      return noStoreJson(
        { ok: false, step: "userinfo", error: "no_email" },
        500
      );
    }

    // 3) Persist tokens in oauth_staging for this Gmail address
    const supa = getSupabaseAdmin();

    const expires_at =
      typeof expires_in === "number"
        ? Math.floor(Date.now() / 1000) + expires_in
        : null;

    const { error: oauthErr } = await supa.from("oauth_staging").insert({
      provider: "google",
      user_email: email,
      access_token,
      refresh_token: refresh_token ?? null,
      expires_at,
      scope: scope ?? null,
      token_type: token_type ?? "Bearer",
    });

    if (oauthErr) {
      console.error("Failed to insert into oauth_staging", oauthErr);
      // We still continue, because the session is useful even if tokens fail
    }

   // (Optional) basic profiles table – safe upsert on email
try {
  await supa
    .from("profiles")
    .upsert(
      { email },
      // TS types for `onConflict` are a bit picky, so cast options
      { onConflict: "email", ignoreDuplicates: true } as any
    );
} catch (e) {
  // Non-fatal if profiles table isn't exactly this shape
  console.warn("profiles upsert failed (non-fatal):", e);
}

    // 4) Create the session cookie from Gmail address
    await createSessionCookie(email);

    // 5) Redirect back to dashboard (or the requested next path)
    return noStoreRedirect(nextPath);
  } catch (e: any) {
    console.error("OAuth callback fatal error", e);
    return noStoreJson(
      { ok: false, step: "fatal", error: String(e?.message || e) },
      500
    );
  }
}
