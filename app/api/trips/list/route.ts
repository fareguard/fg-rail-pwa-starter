// app/api/trips/list/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

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

export async function GET() {
  try {
    let email: string | null = null;

    // 1) Try normal Supabase auth (same as /api/me)
    try {
      const supa = getSupabaseServer();
      const {
        data: { user },
      } = await supa.auth.getUser();
      if (user?.email) {
        email = user.email;
      }
    } catch {
      // ignore and fall back to Gmail OAuth
    }

    // 2) Fallback: Gmail OAuth (same idea as /api/me)
    if (!email) {
      const admin = getSupabaseAdmin();
      const { data } = await admin
        .from("oauth_staging")
        .select("user_email, provider, created_at")
        .eq("provider", "google")
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length) {
        email = data[0].user_email as string;
      }
    }

    // 3) If still no email, treat as unauthenticated for trips
    if (!email) {
      return noStoreJson({
        ok: true,
        authenticated: false,
        trips: [],
      });
    }

    // 4) Load trips for this email
    const supa = getSupabaseServer();
    const { data, error } = await supa
      .from("trips")
      .select(
        [
          "id",
          "origin",
          "destination",
          "booking_ref",
          "operator",
          "retailer",
          "depart_planned",
          "arrive_planned",
          "status",
          "is_ticket",
          "created_at",
        ].join(",")
      )
      .eq("user_email", email)
      .is("is_ticket", true) // e-tickets only
      .order("depart_planned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return noStoreJson(
        { ok: false, error: error.message, trips: [] },
        500
      );
    }

    return noStoreJson({
      ok: true,
      authenticated: true,
      trips: data ?? [],
    });
  } catch (e: any) {
    return noStoreJson(
      {
        ok: false,
        authenticated: false,
        error: String(e?.message || e),
        trips: [],
      },
      500
    );
  }
}
