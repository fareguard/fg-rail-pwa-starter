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
    "no-store, no-cache, must-revalidate, max-age=0",
  );
  return res;
}

type DashboardMetrics = {
  potential_refunds: number;       // count of eligible, unclaimed trips
  potential_refunds_gbp: number;   // sum of ticket value for those trips
  claims_in_progress: number;
  refunds_paid_gbp: number;
};

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

    // optional ?sort=asc|desc query param
    const { searchParams } = new URL(req.url);
    const sortDir = searchParams.get("sort") === "asc" ? "asc" : "desc";

    // ---- 1) Load trips for this user ----
    const { data: trips, error } = await supa
      .from("trips")
      .select("*")
      .eq("user_email", email) // 👈 filter by logged-in Gmail
      .order("depart_planned", { ascending: sortDir === "asc" });

    if (error) throw error;

    const safeTrips = trips ?? [];

    // ---- 2) Compute dashboard metrics from trips + claims + tickets ----
    let metrics: DashboardMetrics | null = null;

    try {
      // 2a) claims for this user
      const { data: claims, error: claimsError } = await supa
        .from("claims")
        .select("id, trip_id, status")
        .eq("user_email", email);

      if (claimsError) {
        console.error("claims query error", claimsError);
      } else {
        const safeClaims = claims ?? [];

        // claim_trip_ids = all trip_ids that already have a claim
        const claimTripIds = new Set(
          safeClaims
            .map((c: any) => c.trip_id)
            .filter((id: any): id is string => Boolean(id)),
        );

        // Eligible, unclaimed trips
        const eligibleTrips = safeTrips.filter(
          (t: any) => t.eligible && !claimTripIds.has(t.id),
        );

        const potential_refunds = eligibleTrips.length;

        // 2b) claims in progress: pending or submitted
        const claims_in_progress = safeClaims.filter((c: any) =>
          ["pending", "submitted"].includes(c.status),
        ).length;

        // 2c) Sum ticket value (total_paid_gbp) for those eligible trips
        // We look up tickets by booking_ref, but only using refs that came
        // from this user's own trips → no cross-user leakage.
        const bookingRefs = Array.from(
          new Set(
            eligibleTrips
              .map((t: any) => (t.booking_ref || "").trim())
              .filter(
                (br: string) => br && br.toUpperCase() !== "UNKNOWN",
              ),
          ),
        );

        let potential_refunds_gbp = 0;

        if (bookingRefs.length > 0) {
          const { data: tickets, error: ticketsError } = await supa
            .from("tickets")
            .select("booking_ref, total_paid_gbp")
            .in("booking_ref", bookingRefs);

          if (ticketsError) {
            console.error("tickets query error", ticketsError);
          } else {
            for (const row of tickets ?? []) {
              const rawVal = (row as any).total_paid_gbp;
              const n =
                typeof rawVal === "number"
                  ? rawVal
                  : Number(rawVal ?? 0);
              if (!Number.isNaN(n)) {
                potential_refunds_gbp += n;
              }
            }
          }
        }

        // 2d) Refunds actually paid: still 0 until we track payouts
        const refunds_paid_gbp = 0;

        metrics = {
          potential_refunds,
          potential_refunds_gbp,
          claims_in_progress,
          refunds_paid_gbp,
        };
      }
    } catch (metricsErr) {
      console.error("dashboard metrics error", metricsErr);
      metrics = null;
    }

    // ---- 3) Final response ----
    return noStoreJson({
      ok: true,
      authenticated: true,
      trips: safeTrips,
      metrics,
    });
  } catch (e: any) {
    console.error("dashboard/trips route error", e);
    return noStoreJson(
      {
        ok: false,
        authenticated: false,
        error: String(e?.message || e),
        trips: [],
        metrics: null as DashboardMetrics | null,
      },
      500,
    );
  }
}
