// app/(app)/dashboard/trips/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  return res;
}

export async function GET(req: NextRequest) {
  try {
    // 🔑 1) Read the signed Gmail session from the fg_session cookie
    const cookieStore = cookies();
    const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
    const session = decodeSession(raw);
    const email = session?.email;

    if (!email) {
      // no valid session cookie
      return noStoreJson(
        { ok: false, error: "Not authenticated", trips: [] },
        401
      );
    }

    const supa = getSupabaseAdmin();

    // optional ?sort=asc|desc query param
    const { searchParams } = new URL(req.url);
    const sortDir = searchParams.get("sort") === "asc" ? "asc" : "desc";

    const { data, error } = await supa
      .from("trips")
      .select("*")
      .eq("user_email", email) // 👈 filter by logged-in Gmail
      .order("depart_planned", { ascending: sortDir === "asc" });

    if (error) throw error;

    return noStoreJson({
      ok: true,
      trips: data ?? [],
    });
  } catch (e: any) {
    console.error("dashboard/trips route error", e);
    return noStoreJson(
      { ok: false, error: String(e?.message || e), trips: [] },
      500
    );
  }
}
