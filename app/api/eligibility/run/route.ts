import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = getSupabaseAdmin();

  // 1) Pull recent trips with minimal required fields
  const { data: trips, error } = await db
    .from("trips")
    .select("id, user_email, operator, retailer, origin, destination, booking_ref, depart_planned, arrive_planned, status")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ ok:false, error: error.message }, { status: 500 });

  let created = 0;

  for (const t of trips || []) {
    // skip if clearly not a rail booking
    const senderLikely =
      (t.retailer || '').toLowerCase().includes("trainline") ||
      (t.retailer || '').toLowerCase().includes("avanti") ||
      (t.operator || '').toLowerCase().includes("avanti") ||
      (t.operator || '').toLowerCase().includes("west midlands") ||
      (t.operator || '').toLowerCase().includes("lner") ||
      (t.operator || '').toLowerCase().includes("gwr") ||
      (t.operator || '').toLowerCase().includes("crosscountry");

    if (!senderLikely) continue;

    // avoid duplicates: if a claim exists for this trip, skip
    const { data: existing } = await db
      .from("claims")
      .select("id")
      .eq("trip_id", t.id)
      .limit(1);

    if (existing && existing.length) continue;

    // 2) Insert a pending claim (even if delay not computed yet)
    const { data: ins, error: e1 } = await db
      .from("claims")
      .insert({
        trip_id: t.id,
        user_email: t.user_email ?? null,
        status: "pending",
        fee_pct: 25,
        meta: {
          origin: t.origin, destination: t.destination,
          booking_ref: t.booking_ref,
          depart_planned: t.depart_planned, arrive_planned: t.arrive_planned,
          operator: t.operator, retailer: t.retailer
        }
      })
      .select("id")
      .single();

    if (e1) continue;

    // 3) Auto-queue it for submission pipeline (we can submit later)
    const provider =
      (t.operator || '').toLowerCase().includes("avanti") ? "avanti" :
      (t.operator || '').toLowerCase().includes("west midlands") ? "wmt" :
      "unknown";

    await db.from("claim_queue").insert({
      claim_id: ins.id,
      provider,
      status: "queued",
      payload: {
        user_email: t.user_email ?? null,
        booking_ref: t.booking_ref ?? null,
        operator: t.operator ?? null,
        origin: t.origin ?? null,
        destination: t.destination ?? null,
        depart_planned: t.depart_planned ?? null,
        arrive_planned: t.arrive_planned ?? null,
        delay_minutes: null
      }
    });

    created++;
  }

  return NextResponse.json({ ok:true, examined: trips?.length || 0, created });
}

// Allow POST too if you prefer
export async function POST() {
  return GET();
}
