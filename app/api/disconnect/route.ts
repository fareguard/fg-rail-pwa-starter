// app/api/disconnect/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSessionFromCookies, SESSION_COOKIE_NAME } from "@/lib/session";

async function revokeGoogleToken(token: string) {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // ignore
  }
}

export async function POST() {
  try {
    const session = getSessionFromCookies();
    if (!session?.email) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const userEmail = session.email;
    const supa = getSupabaseAdmin();

    const { data: stg } = await supa
      .from("oauth_staging")
      .select("access_token, refresh_token")
      .eq("user_email", userEmail)
      .maybeSingle();

    const { data: acc } = await supa
      .from("oauth_accounts")
      .select("access_token, refresh_token")
      .eq("email", userEmail)
      .maybeSingle();

    const tokens = [
      stg?.access_token,
      stg?.refresh_token,
      acc?.access_token,
      acc?.refresh_token,
    ].filter(Boolean) as string[];

    for (const t of tokens) await revokeGoogleToken(t);

    const { data: purge, error: purgeErr } = await supa.rpc("user_purge_v1", {
      p_user_email: userEmail,
    });

    if (purgeErr) {
      return NextResponse.json(
        { ok: false, error: "purge_failed", detail: purgeErr.message },
        { status: 500 }
      );
    }

    const res = NextResponse.json({ ok: true, purge }, { status: 200 });

    // Clear session cookie (do it on the response)
    res.cookies.delete(SESSION_COOKIE_NAME);
    // Also clear via server cookies() as a belt-and-braces
    cookies().delete(SESSION_COOKIE_NAME);

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "disconnect_failed", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
