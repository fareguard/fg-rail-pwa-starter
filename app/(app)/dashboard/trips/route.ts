// app/(app)/dashboard/trips/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type DashboardMetrics = {
  potential_refunds_count: number;
  potential_refunds_gbp_max: number;
  claims_in_progress: number;
  refunds_paid_gbp: number;
};

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const raw = cookies().get(SESSION_COOKIE_NAME)?.value ?? null;
    const session = decodeSession(raw);
    const email = session?.email?.trim();

    if (!email) {
      return noStoreJson({ ok: false, error: "Not authenticated", trips: [] }, 401);
    }

    const supa = getSupabaseAdmin();

    const { searchParams } = new URL(req.url);
    const sortDir = searchParams.get("sort") === "asc" ? "asc" : "desc";

    // 1) Trips list (primary)
    const { data: trips, error: tripsErr } = await supa
      .from("trips")
      .select("*")
      .eq("user_email", email)
      .order("depart_planned", { ascending: sortDir === "asc" });

    if (tripsErr) throw tripsErr;

    // 2) Metrics (best-effort but should not depend on profiles.id)
    const metrics: DashboardMetrics = {
      potential_refunds_count: 0,
      potential_refunds_gbp_max: 0, // until we confirm tickets schema
      claims_in_progress: 0,
      refunds_paid_gbp: 0, // until claims.amount_paid_gbp exists
    };

    // Claims in progress
    const inProgressStatuses = ["pending", "queued", "processing", "submitted"];
    const { count: inProgressCount, error: cipErr } = await supa
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("user_email", email)
      .in("status", inProgressStatuses);

    if (cipErr) throw cipErr;
    metrics.claims_in_progress = inProgressCount ?? 0;

    // Potential refunds count (real): eligible trips not already claimed (non-failed)
    const eligibleTrips = (trips ?? []).filter((t: any) => t?.eligible === true);
    const eligibleTripIds = eligibleTrips
      .map((t: any) => String(t?.id || "").trim())
      .filter(Boolean);

    const alreadyClaimedTripIds = new Set<string>();

    if (eligibleTripIds.length) {
      const { data: existingClaims, error: ecErr } = await supa
        .from("claims")
        .select("trip_id,status")
        .eq("user_email", email)
        .in("trip_id", eligibleTripIds);

      if (ecErr) throw ecErr;

      for (const c of existingClaims ?? []) {
        const tid = String((c as any)?.trip_id || "").trim();
        const st = String((c as any)?.status || "").trim().toLowerCase();
        if (tid && st !== "failed") alreadyClaimedTripIds.add(tid);
      }
    }

    const eligibleUnclaimed = eligibleTrips.filter(
      (t: any) => !alreadyClaimedTripIds.has(String(t?.id || "").trim())
    );

    metrics.potential_refunds_count = eligibleUnclaimed.length;

    // Potential £ max:
    // We will make this real once we standardize tickets linkage.
    // Returning 0 is truthful and prevents breaking trips.
    metrics.potential_refunds_gbp_max = 0;

    return noStoreJson({ ok: true, trips: trips ?? [], metrics });
  } catch (e: any) {
    console.error("dashboard/trips route error", e);
    return noStoreJson(
      { ok: false, error: String(e?.message || e), trips: [] },
      500
    );
  }
}
