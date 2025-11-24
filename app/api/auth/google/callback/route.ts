// app/api/auth/google/callback/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { setSessionCookie } from "@/lib/session";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

type GoogleIdTokenPayload = {
  sub: string;
  email: string;
  email_verified?: boolean;
};

function decodeJwtWithoutVerify(token: string): GoogleIdTokenPayload {
  const [, payload] = token.split(".");
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(padded + "===".slice((padded.length + 3) % 4), "base64");
  return JSON.parse(buf.toString("utf8"));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return NextResponse.redirect("/?error=missing_code");
  }

  let next = "/dashboard";
  if (state) {
    try {
      const parsed = JSON.parse(decodeURIComponent(state));
      if (parsed.next && typeof parsed.next === "string") {
        next = parsed.next;
      }
    } catch {
      // ignore
    }
  }

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

  const tokenJson = (await tokenRes.json()) as GoogleTokenResponse;

  if (!tokenRes.ok) {
    console.error("Google token error", tokenJson);
    return NextResponse.redirect("/?error=google_token_error");
  }

  if (!tokenJson.id_token) {
    console.error("Missing id_token from Google");
    return NextResponse.redirect("/?error=missing_id_token");
  }

  const idPayload = decodeJwtWithoutVerify(tokenJson.id_token);
  const email = idPayload.email;
  const userId = idPayload.sub;

  if (!email || !userId) {
    return NextResponse.redirect("/?error=invalid_id_payload");
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = tokenJson.expires_in ? now + tokenJson.expires_in : null;

  const admin = getSupabaseAdmin();

  // 2) Upsert into oauth_staging keyed by (provider, user_id)
  const { error } = await admin.from("oauth_staging").upsert(
    {
      provider: "google",
      user_email: email,
      user_id: userId,
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token ?? null,
      expires_at: expiresAt,
      scope: tokenJson.scope ?? null,
      token_type: tokenJson.token_type ?? "Bearer",
    },
    {
      onConflict: "provider,user_id",
    } as any
  );

  if (error) {
    console.error("Supabase oauth_staging upsert error", error);
    return NextResponse.redirect("/?error=oauth_store_error");
  }

  // 3) Redirect to dashboard with session cookie set
  const res = NextResponse.redirect(next, { status: 302 });
  setSessionCookie(res, { user_id: userId, email });

  return res;
}
