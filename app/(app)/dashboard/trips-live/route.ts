// app/dashboard/trips-live/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSessionFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
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
      .eq("user_email", email)   // <-- 🔑 only this user’s journeys
      .order("depart_planned", { ascending: sortDir === "asc" });

    if (error) throw error;

    return noStoreJson({ ok: true, trips: data ?? [] });
  } catch (e: any) {
    console.error("trips-live error", e);
    return noStoreJson(
      { ok: false, error: String(e?.message || e), trips: [] },
      500
    );
  }
}
