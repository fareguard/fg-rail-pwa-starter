// app/(app)/dashboard/trips-live/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireSessionEmailFromCookies } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();

    const email = await requireSessionEmailFromCookies(supa, {
      user_agent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for"), // Vercel will set this (may be a list)
    });

    if (!email) {
      return noStoreJson({ ok: false, error: "Not authenticated", trips: [] }, 401);
    }

    // optional sort param: /dashboard/trips-live?sort=asc|desc
    const { searchParams } = new URL(req.url);
    const sortDir = searchParams.get("sort") === "asc" ? "asc" : "desc";

    const { data, error } = await supa
      .from("trips")
      .select("*")
      .eq("user_email", email)
      .order("depart_planned", { ascending: sortDir === "asc" });

    if (error) throw error;

    return noStoreJson({
      ok: true,
      trips: data ?? [],
    });
  } catch (e: any) {
    console.error("trips-live route error", e);
    return noStoreJson({ ok: false, error: String(e?.message || e), trips: [] }, 500);
  }
}
