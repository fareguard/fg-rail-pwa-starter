// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createAppSessionAndSetCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;
const PUBLIC_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.fareguard.co.uk";

function json(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

export async function GET(req: Request) {
  const supa = getSupabaseAdmin();
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state") ?? "";

  if (!code) {
    return json({ ok: false, step: "no_code", error: "Missing ?code" }, 400);
  }

  // --- 1) Decode state → next path (defaults to /dashboard) ---
  let nextPath = "/dashboard";
  try {
    // state is like "next=%2Fdashboard" but double-encoded in the URL
    const stateDecoded = decodeURIComponent(stateRaw); // "next=/dashboard"
    const params = new URLSearchParams(stateDecoded);
    const n = params.get("next");
    if (n && n.startsWith("/")) {
      nextPath = n;
    }
  } catch (e) {
    // non-fatal – we just fall back to /dashboard
    console.warn("Failed to parse OAuth state:", e);
  }

  try {
    // --- 2) Exchange code for tokens ---
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

    if (!tokenRes.ok) {
      console.error("Google token error:", tokens);
      return json(
        {
          ok: false,
          step: "token_exchange",
          error: "Google token endpoint failed",
          detail: tokens,
        },
        400
      );
    }

    const accessToken: string | undefined = tokens.access_token;
    const refreshToken: string | undefined = tokens.refresh_token;
    const expiresIn: number | undefined = tokens.expires_in;

    if (!accessToken) {
      return json(
        {
          ok: false,
          step: "token_exchange",
          error: "No access_token in Google response",
        },
        400
      );
    }

    // --- 3) Fetch user info to get Gmail address ---
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const profile = await profileRes.json();

    if (!profileRes.ok || !profile?.email) {
      console.error("Google profile error:", profile);
      return json(
        {
          ok: false,
          step: "userinfo",
          error: "Failed to fetch Google profile / email",
          detail: profile,
        },
        400
      );
    }

    const email: string = profile.email;

    // --- 4) Upsert tokens into oauth_staging for this Gmail ---
    const now = Math.floor(Date.now() / 1000);

    const { error: upsertErr } = await supa.from("oauth_staging").upsert(
      {
        provider: "google",
        user_email: email,
        access_token: accessToken,
        refresh_token: refreshToken ?? null,
        expires_at: expiresIn ? now + expiresIn : null,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? "Bearer",
      },
      // composite conflict target – adjust to your table definition
      { onConflict: "provider,user_email" } as any
    );

    if (upsertErr) {
      console.error("oauth_staging upsert error:", upsertErr);
      return json(
        {
          ok: false,
          step: "oauth_staging",
          error: upsertErr.message ?? String(upsertErr),
        },
        500
      );
    }

    // --- 5) Optional: basic profiles table by email ---
    try {
      await supa
        .from("profiles")
        .upsert(
          { email },
          { onConflict: "email", ignoreDuplicates: true } as any
        );
    } catch (e) {
      console.warn("profiles upsert failed (non-fatal):", e);
    }

    // --- 6) Build absolute redirect URL ---
    const redirectUrl = new URL(nextPath, PUBLIC_SITE_URL);

    // --- 7) Set session cookie + redirect ---
    const res = NextResponse.redirect(redirectUrl);

    // Create DB session row + set opaque cookie
    await createAppSessionAndSetCookie(req, res, email);

    return res;
  } catch (e: any) {
    console.error("Fatal error in Google callback:", e);
    return json(
      {
        ok: false,
        step: "fatal",
        error: e?.message || String(e),
      },
      500
    );
  }
}

export const POST = GET;
