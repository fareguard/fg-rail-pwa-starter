// app/api/trips/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
    const session = decodeSession(raw);
    const email = session?.email;

    if (!email) {
      return noStoreJson(
        { ok: false, error: "Not authenticated", trips: [] },
        401
      );
    }

    const supa = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const sortDir = searchParams.get("sort") === "asc" ? "asc" : "desc";

    const { data, error } = await supa
      .from("trips")
      .select("*")
      .eq("user_email", email)
      .order("depart_planned", { ascending: sortDir === "asc" });

    if (error) throw error;

    return noStoreJson({ ok: true, trips: data ?? [] });
  } catch (e: any) {
    console.error("trips api error", e);
    return noStoreJson(
      { ok: false, error: String(e?.message || e), trips: [] },
      500
    );
  }
}
