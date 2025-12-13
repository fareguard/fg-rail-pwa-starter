import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

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

// ===== Types =====
type TripRow = {
  id: string;
  user_email: string | null;
  operator: string | null;
  retailer: string | null;
  origin: string | null;
  destination: string | null;
  booking_ref: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  status: string | null;
  created_at: string | null;
};

// ===== Helper =====
async function getUserIdForEmail(db: any, email: string | null) {
  if (!email) return null;

  // profiles has `id` (uuid) + `email` + maybe `user_email`
  const { data: prof, error: profErr } = await db
    .from("profiles")
    .select("id")
    .or(`email.eq.${email},user_email.eq.${email}`)
    .maybeSingle();

  if (profErr) return null;
  if (prof?.id) return prof.id as string;

  // Optional fallback if you have this RPC
  try {
    const { data: authRow } = await db
      .rpc("get_auth_user_id_by_email", { p_email: email })
      .maybeSingle();
    if (authRow?.user_id) return authRow.user_id as string;
  } catch (_) {}

  return null;
}

// ===== MAIN =====
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const db = getSupabaseAdmin();

  const { data: tripsRaw, error } = await db
    .from("trips")
    .select(
      "id, user_email, operator, retailer, origin, destination, booking_ref, depart_planned, arrive_planned, status, created_at"
    )
    .eq("is_ticket", true)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  // ✅ Force a sane type for TS (fixes your build error)
  const trips = (tripsRaw ?? []) as TripRow[];

  let created = 0;

  for (const t of trips) {
    if (!t.origin || !t.destination) continue;

    // skip if claim already exists for this trip
    const { data: existing, error: exErr } = await db
      .from("claims")
      .select("id")
      .eq("trip_id", t.id)
      .limit(1);

    if (exErr) continue;
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
        },
      })
      .select("id")
      .single();

    if (insErr || !ins?.id) continue;

    // provider detection (placeholder)
    const op = (t.operator || "").toLowerCase();
    const provider = op.includes("avanti")
      ? "avanti"
      : op.includes("west midlands")
      ? "wmt"
      : "unknown";

    // ✅ Queue guard: only one queued job per claim
    const { data: existingQ, error: qErr } = await db
      .from("claim_queue")
      .select("id")
      .eq("claim_id", ins.id)
      .limit(1);

    if (qErr) continue;

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
          delay_minutes: null,
        },
      });

      created++;
    }
  }

  return NextResponse.json({
    ok: true,
    examined: trips.length,
    created,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
