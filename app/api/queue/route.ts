// app/api/queue/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

function pickProvider(op?: string | null) {
  const s = (op || "").toLowerCase();
  if (s.includes("avanti")) return "avanti";
  if (s.includes("west midlands")) return "wmt";
  return "avanti"; // default to avanti for testing loop
}

export async function POST(req: Request) {
  const db = getSupabaseAdmin();
  try {
    const { trip_id } = await req.json();
    if (!trip_id) return NextResponse.json({ ok: false, error: "trip_id required" }, { status: 400 });

    const { data: trip, error: tErr } = await db
      .from("trips")
      .select(
        "id, user_email, operator, retailer, origin, destination, booking_ref, depart_planned, arrive_planned"
      )
      .eq("id", trip_id)
      .maybeSingle();

    if (tErr || !trip) return NextResponse.json({ ok: false, error: "Trip not found" }, { status: 404 });

    // Ensure a claim row exists (one per trip)
    let claimId: string | null = null;
    const { data: existing } = await db.from("claims").select("id").eq("trip_id", trip_id).limit(1);
    if (existing && existing.length) {
      claimId = existing[0].id;
    } else {
      const { data: ins, error: cErr } = await db
        .from("claims")
        .insert({
          trip_id,
          user_id: null, // optional until Gmail/user-profile link exists
          user_email: trip.user_email ?? null,
          status: "pending",
          fee_pct: 20,
          meta: {
            origin: trip.origin,
            destination: trip.destination,
            booking_ref: trip.booking_ref,
            depart_planned: trip.depart_planned,
            arrive_planned: trip.arrive_planned,
            operator: trip.operator,
            retailer: trip.retailer,
          },
        })
        .select("id")
        .single();
      if (cErr || !ins?.id) return NextResponse.json({ ok: false, error: cErr?.message || "Claim insert failed" }, { status: 500 });
      claimId = ins.id;
    }

    const provider = pickProvider(trip.operator);
    const payload = {
      user_email: trip.user_email ?? null,
      booking_ref: trip.booking_ref ?? null,
      operator: trip.operator ?? null,
      origin: trip.origin ?? null,
      destination: trip.destination ?? null,
      depart_planned: trip.depart_planned ?? null,
      arrive_planned: trip.arrive_planned ?? null,
      delay_minutes: null,
    };

    const { error: qErr } = await db.from("claim_queue").insert({
      claim_id: claimId,
      provider,
      status: "queued",
      payload,
    });

    if (qErr) return NextResponse.json({ ok: false, error: qErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, claim_id: claimId, provider });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}