import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ==== SECURITY GATE ====
// Option A: Only allow in development
const DEV_ONLY = process.env.NODE_ENV !== "production";

// Option B: Allow in prod only with an admin header key
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

function isAuthorized(request: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  const hdr = request.headers.get("x-admin-key") || "";
  return hdr === ADMIN_KEY;
}

// ===== Helpers =====
async function getUserIdForEmail(db: any, email: string | null) {
  if (!email) return null;

  const { data: prof } = await db
    .from("profiles")
    .select("user_id")
    .eq("user_email", email)
    .maybeSingle();

  if (prof?.user_id) return prof.user_id;

  try {
    const { data: authRow } = await db
      .rpc("get_auth_user_id_by_email", { p_email: email })
      .maybeSingle();
    if (authRow?.user_id) return authRow.user_id;
  } catch (_) {}

  return null;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    // Don’t reveal this route exists to the public
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const db = getSupabaseAdmin();

  // Pull recent likely-ticket trips only
  const { data: trips, error } = await db
    .from("trips")
    .select(
      "id, user_email, operator, retailer, origin, destination, booking_ref, depart_planned, arrive_planned, status, created_at"
    )
    .eq("is_ticket", true) // 👈 only real tickets
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let created = 0;

  for (const t of trips || []) {
    if (!t.origin || !t.destination) continue;

    const { data: existing } = await db
      .from("claims")
      .select("id")
      .eq("trip_id", t.id)
      .limit(1);

    if (existing && existing.length) continue;

    const userId = await getUserIdForEmail(db, t.user_email);
    if (!userId) continue;

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

    const op = (t.operator || "").toLowerCase();
    const provider = op.includes("avanti")
      ? "avanti"
      : op.includes("west midlands")
      ? "wmt"
      : "unknown";

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

export async function POST(req: Request) {
  return GET(req);
}
