// app/api/eligibility/run/route.ts
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
  eligible: boolean | null;
  eligibility_reason: string | null;
};

async function getProfileIdForEmail(db: any, email: string | null) {
  if (!email) return null;

  const { data: prof, error } = await db
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error) throw error;
  return (prof?.id as string | null) ?? null;
}

function isPastTrip(t: TripRow) {
  // Prefer arrive_planned if present (more reliable), else depart_planned
  const ref = t.arrive_planned || t.depart_planned;
  if (!ref) return false;
  const ms = Date.parse(ref);
  if (!Number.isFinite(ms)) return false;

  // 1 hour buffer to avoid edge cases
  return ms < Date.now() - 60 * 60 * 1000;
}

function providerFromOperator(opRaw: string | null) {
  const op = (opRaw || "").toLowerCase();
  if (op.includes("avanti")) return "avanti";
  if (op.includes("west midlands")) return "wmt";
  if (op.includes("gwr") || op.includes("great western")) return "gwr";
  if (op.includes("lner")) return "lner";
  if (op.includes("thameslink") || op.includes("gtr")) return "gtr";
  return "unknown";
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const db = getSupabaseAdmin();

  // ✅ Only eligible, past, ticket-like trips
  const { data: trips, error } = await db
    .from("trips")
    .select(
      "id, user_email, operator, retailer, origin, destination, booking_ref, depart_planned, arrive_planned, status, created_at, eligible, eligibility_reason"
    )
    .eq("is_ticket", true)
    .eq("eligible", true)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<TripRow[]>();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  let examined = 0;
  let created = 0;
  let skippedNotPast = 0;
  let skippedNoUser = 0;
  let skippedHasClaim = 0;

  for (const t of trips || []) {
    examined++;

    if (!t.origin || !t.destination) continue;

    // Only past trips (real-world rule)
    if (!isPastTrip(t)) {
      skippedNotPast++;
      continue;
    }

    // skip if claim already exists for this trip
    const { data: existing, error: exErr } = await db
      .from("claims")
      .select("id")
      .eq("trip_id", t.id)
      .limit(1);

    if (exErr) throw exErr;
    if (existing && existing.length) {
      skippedHasClaim++;
      continue;
    }

    // resolve profile id (uuid)
    const userId = await getProfileIdForEmail(db, t.user_email);
    if (!userId) {
      skippedNoUser++;
      continue;
    }

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
          eligibility_reason: t.eligibility_reason,
        },
      })
      .select("id")
      .single();

    if (insErr || !ins?.id) continue;

    const provider = providerFromOperator(t.operator);

    // ✅ Queue guard: only one queued job per claim
    const { data: existingQ, error: qErr } = await db
      .from("claim_queue")
      .select("id")
      .eq("claim_id", ins.id)
      .limit(1);

    if (qErr) throw qErr;

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
    examined,
    created,
    skipped: {
      not_past: skippedNotPast,
      no_user: skippedNoUser,
      has_claim: skippedHasClaim,
    },
  });
}

export async function POST(req: Request) {
  return GET(req);
}
