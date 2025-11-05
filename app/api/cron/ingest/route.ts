// app/api/cron/ingest/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ensureValidAccessToken } from "@/lib/google-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getSupabaseAdmin();

  // pick one connected account (yours, for now)
  const { data: acct } = await db
    .from("oauth_staging")
    .select("user_email")
    .eq("provider", "google")
    .eq("revoked", false)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!acct?.user_email) {
    return NextResponse.json({ ok: true, gmail: { ok: false, error: "no_connected_accounts" } });
  }

  const tok = await ensureValidAccessToken(acct.user_email);
  if (!tok.ok) {
    return NextResponse.json({ ok: true, gmail: tok });
  }

  // ... your Gmail fetch + ingest logic here using tok.access_token ...
  // keep response short for now
  return NextResponse.json({ ok: true, gmail: { ok: true } });
}
