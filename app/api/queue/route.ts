// app/api/queue/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scans recent trips and creates missing claims (status=pending).
 * No provider submission here — just ensures claims exist.
 * Safe to run repeatedly (idempotent by trip_id).
 *
 * GET /api/queue
 * GET /api/queue?debug=1   -> returns raw SQL errors (handy during setup)
 */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const db = getSupabaseAdmin();

  try {
    // 1) Pull a recent slab of trips (adjust window as you like)
    const { data: trips, error: tripsErr } = await db
      .from("trips")
      .select("id,user_email,booking_ref,operator,origin,destination,depart_planned,arrive_planned")
      .order("created_at", { ascending: false })
      .limit(200);

    if (tripsErr) {
      if (debug) return NextResponse.json({ ok: false, where: "select trips", error: tripsErr.message }, { status: 500 });
      throw tripsErr;
    }
    if (!trips?.length) return NextResponse.json({ ok: true, examined: 0, created: 0 });

    const tripIds = trips.map(t => t.id).filter(Boolean);
    if (!tripIds.length) return NextResponse.json({ ok: true, examined: 0, created: 0 });

    // 2) Find existing claims for those trips to avoid duplicates
    const { data: existing, error: existErr } = await db
      .from("claims")
      .select("trip_id")
      .in("trip_id", tripIds);

    if (existErr) {
      if (debug) return NextResponse.json({ ok: false, where: "select claims", error: existErr.message }, { status: 500 });
      throw existErr;
    }

    const existingSet = new Set((existing || []).map(r => r.trip_id));
    const toCreate = trips
      .filter(t => t.id && !existingSet.has(t.id))
      .map(t => ({
        trip_id: t.id,
        user_email: t.user_email,
        status: "pending" as const,
        // optional: copy some trip context for convenience
        booking_ref: t.booking_ref ?? null,
        operator: t.operator ?? null,
        origin: t.origin ?? null,
        destination: t.destination ?? null,
        depart_planned: t.depart_planned ?? null,
        arrive_planned: t.arrive_planned ?? null,
      }));

    if (!toCreate.length) {
      return NextResponse.json({ ok: true, examined: trips.length, created: 0 });
    }

    // 3) Insert the new claims
    const { error: insErr } = await db.from("claims").insert(toCreate);
    if (insErr) {
      if (debug) return NextResponse.json({ ok: false, where: "insert claims", error: insErr.message }, { status: 500 });
      throw insErr;
    }

    return NextResponse.json({ ok: true, examined: trips.length, created: toCreate.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
