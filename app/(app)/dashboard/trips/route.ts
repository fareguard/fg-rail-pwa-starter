// app/(app)/dashboard/trips/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

function toNumberOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export async function GET(req: NextRequest) {
  try {
    // 1) Read session
    const cookieStore = cookies();
    const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
    const session = decodeSession(raw);
    const email = session?.email;

    if (!email) {
      return noStoreJson({ ok: false, error: "Not authenticated", trips: [] }, 401);
    }

    const supa = getSupabaseAdmin();

    const { searchParams } = new URL(req.url);
    const sortDir = searchParams.get("sort") === "asc" ? "asc" : "desc";

    // 2) Trips list (as before)
    const { data: trips, error: tripsErr } = await supa
      .from("trips")
      .select("*")
      .eq("user_email", email)
      .order("depart_planned", { ascending: sortDir === "asc" });

    if (tripsErr) throw tripsErr;

    // 3) Find profile id (for tickets.user_id join)
    const { data: profile, error: profErr } = await supa
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (profErr) throw profErr;

    const userId: string | null = profile?.id ?? null;

    // 4) Claims in progress (real)
    // Define "in progress" = anything not resolved/paid/failed.
    // Adjust these statuses as your pipeline evolves.
    const inProgressStatuses = ["pending", "queued", "processing", "submitted"];

    const { count: inProgressCount, error: cipErr } = await supa
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("user_email", email)
      .in("status", inProgressStatuses);

    if (cipErr) throw cipErr;

    // 5) Refunds paid (real, but you currently have no amount column)
    // Until you store payout amount, this must be 0.00 (truthful).
    // When you add `claims.amount_paid_gbp`, we’ll sum it here.
    const refundsPaidGbp = 0;

    // 6) Potential refunds (real)
    // Based on trips.eligible = true, excluding trips that already have a non-failed claim.
    const eligibleTrips = (trips ?? []).filter((t: any) => t?.eligible === true);

    const eligibleTripIds = eligibleTrips
      .map((t: any) => String(t?.id || "").trim())
      .filter(Boolean);

    let alreadyClaimedTripIds = new Set<string>();

    if (eligibleTripIds.length > 0) {
      const { data: existingClaims, error: ecErr } = await supa
        .from("claims")
        .select("trip_id,status")
        .eq("user_email", email)
        .in("trip_id", eligibleTripIds);

      if (ecErr) throw ecErr;

      for (const c of existingClaims ?? []) {
        const tid = String((c as any)?.trip_id || "").trim();
        const st = String((c as any)?.status || "").trim().toLowerCase();
        // Treat anything not "failed" as already claimed / in flight / done.
        if (tid && st !== "failed") alreadyClaimedTripIds.add(tid);
      }
    }

    const eligibleUnclaimed = eligibleTrips.filter(
      (t: any) => !alreadyClaimedTripIds.has(String(t?.id || "").trim())
    );

    const potentialRefundsCount = eligibleUnclaimed.length;

    // 7) Potential £ (real upper-bound): sum ticket total_paid_gbp matched by booking_ref (when available)
    // This is "up to" because delay repay compensation is <= ticket price.
    let potentialRefundsGbpMax = 0;

    const bookingRefs = eligibleUnclaimed
      .map((t: any) => String(t?.booking_ref || "").trim())
      .filter((br) => br && br.toUpperCase() !== "UNKNOWN");

    if (userId && bookingRefs.length > 0) {
      // Deduplicate to avoid double counting
      const uniqueRefs = Array.from(new Set(bookingRefs));

      const { data: tickets, error: tkErr } = await supa
        .from("tickets")
        .select("booking_ref,total_paid_gbp")
        .eq("user_id", userId)
        .in("booking_ref", uniqueRefs);

      if (tkErr) throw tkErr;

      for (const tk of tickets ?? []) {
        potentialRefundsGbpMax += toNumberOrZero((tk as any)?.total_paid_gbp);
      }
    }

    return noStoreJson({
      ok: true,
      trips: trips ?? [],
      metrics: {
        potential_refunds_count: potentialRefundsCount,
        potential_refunds_gbp_max: Number(potentialRefundsGbpMax.toFixed(2)),
        claims_in_progress: inProgressCount ?? 0,
        refunds_paid_gbp: refundsPaidGbp,
      },
    });
  } catch (e: any) {
    console.error("dashboard/trips route error", e);
    return noStoreJson(
      { ok: false, error: String(e?.message || e), trips: [] },
      500
    );
  }
}
