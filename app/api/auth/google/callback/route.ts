// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

function parseState(state: string | null): { next: string } {
  if (!state) return { next: "/dashboard" };

  try {
    const params = new URLSearchParams(state);
    const next = params.get("next") || "/dashboard";
    return { next };
  } catch {
    return { next: "/dashboard" };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Health check: no code → just confirm it’s reachable
  if (!code) {
    return NextResponse.json({
      ok: true,
      reached: true,
      code_present: false,
      code: null,
      state,
    });
  }

  const { next } = parseState(state);

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
      console.error("Google token error:", tokenJson);
      return NextResponse.json(
        {
          ok: false,
          error: "google_token_exchange_failed",
          details: tokenJson,
        },
        { status: 500 }
      );
    }

    const access_token = tokenJson.access_token as string | undefined;
    const refresh_token = tokenJson.refresh_token as string | undefined;
    const expires_in = tokenJson.expires_in as number | undefined;
    const scope = tokenJson.scope as string | undefined;
    const token_type =
      (tokenJson.token_type as string | undefined) ?? "Bearer";

    if (!access_token) {
      return NextResponse.json(
        { ok: false, error: "no_access_token_in_response", raw: tokenJson },
        { status: 500 }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const expires_at = expires_in ? now + expires_in : null;

    // 2) Fetch user profile (to get Gmail address)
    const userRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    const userJson = await userRes.json();

    if (!userRes.ok) {
      console.error("Google userinfo error:", userJson);
      return NextResponse.json(
        { ok: false, error: "google_userinfo_failed", details: userJson },
        { status: 500 }
      );
    }

    const email = userJson.email as string | undefined;

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "no_email_from_google_profile", raw: userJson },
        { status: 500 }
      );
    }

    // 3) Upsert tokens into oauth_staging for this email
    const supa = getSupabaseAdmin();

    const { error: upsertErr } = await supa.from("oauth_staging").upsert(
      {
        provider: "google",
        user_email: email,
        access_token,
        refresh_token: refresh_token ?? null,
        expires_at,
        scope: scope ?? null,
        token_type,
        user_id: null, // we’re using Gmail-as-identity, no Supabase auth user
      },
      { onConflict: "provider,user_email" } as any
    );

    if (upsertErr) {
      console.error("Supabase upsert oauth_staging error:", upsertErr);
      // we still continue and set a session – user can retry ingest if needed
    }

    // 4) Set fg_session cookie and redirect back
    const res = NextResponse.redirect(new URL(next, url.origin));
    createSessionCookie(res, email);

    return res;
  } catch (e: any) {
    console.error("Google callback fatal error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
