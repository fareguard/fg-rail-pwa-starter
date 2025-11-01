// app/api/eligibility/run/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sanitizeStation(raw: string | null): string | null {
  if (!raw) return null;
  // keep first line, strip marketing sentences, keep only station-like chars
  let s = String(raw).split(/\r?\n/)[0]
    .replace(/\s{2,}/g, " ")
    .trim();

  // kill obvious non-stations your screenshot showed
  const badStarts = [
    "you are about to travel",
    "your tickets have been issued",
    "booking reference",
    "you recently contacted",
    "if someone you know",
    "make a new request",
    "get your feedback",
  ];
  if (badStarts.some(b => s.toLowerCase().startsWith(b))) return null;

  // keep letters, spaces, apostrophes, ampersands and hyphens
  s = s.match(/[A-Za-z&' -]+/g)?.join("").trim() || "";
  if (!s) return null;

  // a station is unlikely to be longer than ~4 words
  const words = s.split(" ").filter(Boolean);
  if (words.length > 6) s = words.slice(0, 6).join(" ");

  return s || null;
}

function pickProvider(operator?: string | null, retailer?: string | null): "avanti" | "wmt" | "unknown" {
  const op = (operator || retailer || "").toLowerCase();
  if (op.includes("avanti")) return "avanti";
  if (op.includes("west midlands")) return "wmt";
  return "unknown";
}

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

export async function GET() {
  const db = getSupabaseAdmin();

  const { data: trips, error } = await db
    .from("trips")
    .select("id, user_email, operator, retailer, origin, destination, booking_ref, depart_planned, arrive_planned, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let created = 0;

  for (const t of trips || []) {
    // sanitize fields coming from parsers
    const origin = sanitizeStation(t.origin);
    const destination = sanitizeStation(t.destination);
    if (!origin || !destination) continue;

    // Skip if a claim already exists
    const { data: existing, error: exErr } = await db
      .from("claims")
      .select("id")
      .eq("trip_id", t.id)
      .limit(1);
    if (exErr || (existing && existing.length)) continue;

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
          origin,
          destination,
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

    const provider = pickProvider(t.operator, t.retailer);

    if (provider === "unknown") {
      // Don’t enqueue unknowns; mark for a quick manual look instead.
      await db.from("claims")
        .update({ status: "needs_review" })
        .eq("id", ins.id);
      continue;
    }

    await db.from("claim_queue").insert({
      claim_id: ins.id,
      provider,
      status: "queued",
      payload: {
        user_email: t.user_email ?? null,
        booking_ref: t.booking_ref ?? null,
        operator: t.operator ?? null,
        origin,
        destination,
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
