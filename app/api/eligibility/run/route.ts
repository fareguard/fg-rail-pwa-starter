import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ===== SECURITY GATE =====
const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

function isAuthorized(request: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  const hdr = request.headers.get("x-admin-key") || "";
  return hdr === ADMIN_KEY;
}

// ===== Helper =====
async function getUserIdForEmail(db: any, email: string | null) {
  if (!email) return null;

  // profiles has: id + email + user_email
  const { data: prof } = await db
    .from("profiles")
    .select("id")
    .or(`email.eq.${email},user_email.eq.${email}`)
    .maybeSingle();

  if (prof?.id) return prof.id;

  // Optional fallback: Supabase RPC function (keep if you want)
  try {
    const { data: authRow } = await db
      .rpc("get_auth_user_id_by_email", { p_email: email })
      .maybeSingle();
    if (authRow?.user_id) return authRow.user_id;
  } catch (_) {}

  return null;
}

// ===== MAIN =====
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    // Hide from public
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const db = getSupabaseAdmin();

  // ✅ Only consider ticket-like trips
  const { data: trips, error } = await db
    .from("trips")
    .select(
      [
        "id",
        "user_email",
        "operator",
        "retailer",
        "origin",
        "destination",
        "booking_ref",
        "depart_planned",
        "arrive_planned",
        "status",
        "created_at",
        // ✅ required eligibility fields
        "eligible",
        "eligibility_reason",
        // ✅ optional (if exists on trips)
        "delay_minutes",
      ].join(",")
    )
    .eq("is_ticket", true)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let created = 0;

  for (const t of trips || []) {
    if (!t.origin || !t.destination) continue;

    // ----- Past-trip guard (arrive preferred + 1hr buffer) -----
    const now = Date.now();
    const departMs = t.depart_planned ? new Date(t.depart_planned).getTime() : 0;
    const arriveMs = t.arrive_planned ? new Date(t.arrive_planned).getTime() : 0;

    // only process past trips (prefer arrive time) with a buffer
    const finishedMs = arriveMs || departMs;
    const bufferMs = 60 * 60 * 1000; // 1 hour safety
    const isPast = finishedMs > 0 && finishedMs < now - bufferMs;

    // ✅ DO NOT create claims unless it's proven eligible
    if (t.eligible !== true) continue;
    if (!isPast) continue;
    // -------------------------------------------

    // skip if claim already exists for this trip
    const { data: existing } = await db
      .from("claims")
      .select("id")
      .eq("trip_id", t.id)
      .limit(1);

    if (existing && existing.length) continue;

    // resolve user_id
    const userId = await getUserIdForEmail(db, t.user_email);
    if (!userId) continue;

    // insert claim
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
          eligibility_reason: t.eligibility_reason ?? null,
          delay_minutes: t.delay_minutes ?? null,
        },
      })
      .select("id")
      .single();

    if (insErr || !ins?.id) continue;

    // detect provider from operator name
    const op = (t.operator || "").toLowerCase();
    const provider = op.includes("avanti")
      ? "avanti"
      : op.includes("west midlands")
      ? "wmt"
      : "unknown";

    // ✅ Queue guard: only one queued job per claim
    const { data: existingQ } = await db
      .from("claim_queue")
      .select("id")
      .eq("claim_id", ins.id)
      .limit(1);

    if (!existingQ || existingQ.length === 0) {
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
          // ✅ carry through if present; otherwise null
          delay_minutes: t.delay_minutes ?? null,
          eligibility_reason: t.eligibility_reason ?? null,
        },
      });

      created++;
    }
  }

  return NextResponse.json({
    ok: true,
    examined: trips?.length || 0,
    created,
  });
}

// POST = same as GET (manual trigger)
export async function POST(req: Request) {
  return GET(req);
}
