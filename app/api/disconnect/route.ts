import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSessionEmail, SESSION_COOKIE_NAME } from "@/lib/session";

async function revokeGoogleToken(token: string) {
  // Google revoke endpoint (best-effort)
  // If this fails, we still purge locally, but user may need to revoke manually in Google Security.
  const url = "https://oauth2.googleapis.com/revoke";
  const body = new URLSearchParams({ token });

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  // Google returns 200 even for some “already revoked” cases; treat non-2xx as soft-fail
  return { ok: r.ok, status: r.status, text: await r.text().catch(() => "") };
}

export async function POST() {
  const email = getSessionEmail(cookies());
  if (!email) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const supa = supabaseAdmin();

  // 1) Load tokens (best-effort)
  const { data: tokenRows, error: tokErr } = await supa
    .from("oauth_staging")
    .select("access_token, refresh_token, provider, revoked")
    .eq("user_email", email)
    .limit(5);

  if (tokErr) {
    // still continue to purge
    console.error("disconnect: oauth_staging read failed", tokErr.message);
  }

  // 2) Revoke with Google (best-effort)
  const revocations: any[] = [];
  for (const row of tokenRows || []) {
    // Prefer refresh_token if present; access tokens expire quickly
    const token = row?.refresh_token || row?.access_token;
    if (!token) continue;

    const out = await revokeGoogleToken(token);
    revocations.push({ provider: row.provider, using: row.refresh_token ? "refresh" : "access", ...out });
  }

  // 3) Purge ALL user data
  const { data: purgeData, error: purgeErr } = await supa.rpc("user_purge_v1", {
    p_user_email: email,
  });

  if (purgeErr) {
    console.error("disconnect: purge failed", purgeErr.message);
    return NextResponse.json({ ok: false, error: "purge_failed", detail: purgeErr.message }, { status: 500 });
  }

  // 4) Clear session cookie
  const res = NextResponse.json({ ok: true, revoked: revocations, purge: purgeData });
  res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });

  return res;
}
