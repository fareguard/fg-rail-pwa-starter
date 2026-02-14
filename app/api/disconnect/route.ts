// app/api/disconnect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  SESSION_COOKIE_NAME,
  getSessionIdFromCookies,
  requireSessionEmailFromCookies,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function revokeGoogleToken(token: string) {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // best-effort
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();

    // 1) Resolve user email from server-side session record
    const userEmail = await requireSessionEmailFromCookies(db, {
      user_agent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for"),
    });

    if (!userEmail) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    // 2) Best-effort revoke tokens (if present)
    const { data: stg } = await db
      .from("oauth_staging")
      .select("access_token, refresh_token")
      .eq("user_email", userEmail)
      .maybeSingle();

    const { data: acc } = await db
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

    // 3) Revoke the current app session immediately (server-side)
    //    (Even if purge fails, the user is logged out.)
    const sid = getSessionIdFromCookies();
    if (sid) {
      await db
        .from("app_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", sid);
    }

    // 4) Purge everything (your current behaviour)
    const { data: purge, error: purgeErr } = await db.rpc("user_purge_v1", {
      p_user_email: userEmail,
    });

    if (purgeErr) {
      // Still clear cookie even if purge fails
      const res = NextResponse.json(
        { ok: false, error: "purge_failed", detail: purgeErr.message },
        { status: 500 }
      );
      res.cookies.delete(SESSION_COOKIE_NAME);
      cookies().delete(SESSION_COOKIE_NAME);
      return res;
    }

    // 5) Clear cookie
    const res = NextResponse.json({ ok: true, purge }, { status: 200 });
    res.cookies.delete(SESSION_COOKIE_NAME);
    cookies().delete(SESSION_COOKIE_NAME);

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "disconnect_failed", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
