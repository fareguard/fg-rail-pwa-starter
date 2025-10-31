import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getUserIdForEmail(db: any, email: string | null) {
  if (!email) return null;

  // Prefer profiles.user_id if present
  const { data: prof } = await db
    .from("profiles")
    .select("user_id")
    .eq("user_email", email)
    .maybeSingle();

  if (prof?.user_id) return prof.user_id;

  // Fallback to auth.users via helper RPC
  try {
    const { data: authRow } = await db
      .rpc("get_auth_user_id_by_email", { p_email: email })
      .maybeSingle();
    if (authRow?.user_id) return authRow.user_id;
  } catch (_) {}

  return null;
}

export async function GET() {
  const db = getSupabaseAdmin();

  // Pull recent trips; minimal fields needed
  const { data: trips, error } = await db
    .from("trips")
    .select(
      "id, user_email, operator, retailer, origin, destination, booking_ref, depart_planned, arrive_planned, status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let created = 0;

  for (const t of trips || []) {
    // Basic sanity: we need at least origin & destination to be useful
    if (!t.origin || !t.destination) continue;

    // Skip if a claim already exists
    const { data: existing, error: exErr } = await db
      .from("claims")
      .select("id")
      .eq("trip_id", t.id)
      .limit(1);

    if (exErr) continue;
    if (existing && existing.length) continue;

    // Resolve user_id (required by your schema)
    const userId = await getUserIdForEmail(db, t.user_email);
    if (!userId) continue;

    // Create claim
    const { data: ins, error: insErr } = await db
      .from("claims")
      .insert({
        trip_id: t.id,
        user_id: userId,
        user_email: t.user_email ?? null,
        status: "pending",
        fee_pct: 25,
        meta: {
          origin: t.origin,
          destination: t.destination,
          booking_ref: t.booking_ref,
          depart_planned: t.depart_planned,
          arrive_planned: t.arrive_planned,
          operator: t.operator,
          retailer: t.retailer,
        },
      })
      .select("id")
      .single();

    if (insErr || !ins?.id) continue;

    // Pick provider for queue (best-effort)
    const op = (t.operator || "").toLowerCase();
    const provider = op.includes("avanti")
      ? "avanti"
      : op.includes("west midlands")
      ? "wmt"
      : "unknown";

    // Queue it
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
        delay_minutes: null,
      },
    });

    created++;
  }

  return NextResponse.json({ ok: true, examined: trips?.length || 0, created });
}

export async function POST() {
  return GET();
}
