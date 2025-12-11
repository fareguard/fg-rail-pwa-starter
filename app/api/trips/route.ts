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

// Shape of the dashboard metrics the frontend can consume
type DashboardMetrics = {
  potential_refunds: number;
  claims_in_progress: number;
  refunds_paid_gbp: number;
};

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
    const session = decodeSession(raw);
    const email = session?.email;

    if (!email) {
      return noStoreJson(
        {
          ok: false,
          authenticated: false,
          error: "Not authenticated",
          trips: [],
          metrics: null as DashboardMetrics | null,
        },
        401,
      );
    }

    const supa = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const sortDir = searchParams.get("sort") === "asc" ? "asc" : "desc";

    // ---- 1) Load trips for this user ----
    const { data: trips, error: tripsError } = await supa
      .from("trips")
      .select("*")
      .eq("user_email", email)
      .order("depart_planned", { ascending: sortDir === "asc" });

    if (tripsError) throw tripsError;

    // ---- 2) Compute metrics from trips + claims ----
    let metrics: DashboardMetrics | null = null;

    try {
      const { data: claims, error: claimsError } = await supa
        .from("claims")
        .select("id, trip_id, status")
        .eq("user_email", email);

      if (!claimsError) {
        const safeTrips = trips ?? [];
        const safeClaims = claims ?? [];

        const claimTripIds = new Set(
          safeClaims
            .map((c: any) => c.trip_id)
            .filter((id: any): id is string => Boolean(id)),
        );

        const potentialRefunds = safeTrips.filter(
          (t: any) => t.eligible && !claimTripIds.has(t.id),
        ).length;

        const claimsInProgress = safeClaims.filter((c: any) =>
          ["pending", "submitted"].includes(c.status),
        ).length;

        metrics = {
          potential_refunds: potentialRefunds,
          claims_in_progress: claimsInProgress,
          // No monetary amounts in schema yet – keep at 0 for now.
          refunds_paid_gbp: 0,
        };
      } else {
        console.error("claims query error", claimsError);
      }
    } catch (metricsErr) {
      console.error("metrics computation error", metricsErr);
      metrics = null;
    }

    return noStoreJson({
      ok: true,
      authenticated: true,
      trips: trips ?? [],
      metrics,
    });
  } catch (e: any) {
    console.error("trips api error", e);
    return noStoreJson(
      {
        ok: false,
        authenticated: true,
        error: String(e?.message || e),
        trips: [],
        metrics: null as DashboardMetrics | null,
      },
      500,
    );
  }
}
