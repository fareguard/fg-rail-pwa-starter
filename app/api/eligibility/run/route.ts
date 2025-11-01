// app/api/eligibility/run/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// --- helpers ---
function isLikelyStationName(s?: string | null) {
  if (!s) return false;
  const t = String(s).trim();

  // length guard
  if (t.length < 2 || t.length > 40) return false;

  // only normal station chars
  if (!/^[A-Za-z&.' -]+$/.test(t)) return false;

  // reject common marketing/junk fragments you just saw
  const bad = [
    "we know", "get a ticket", "buy tickets", "learn more", "help and support",
    "delay repay", "terms", "privacy"
  ];
  const tl = t.toLowerCase();
  if (bad.some(b => tl.includes(b))) return false;

  // ban triple spaces etc
  if (/\s{3,}/.test(t)) return false;

  return true;
}

function isIsoDateLike(x?: string | null) {
  if (!x) return false;
  const d = new Date(x);
  return !Number.isNaN(d.getTime());
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
  } catch {}
  return null;
}

function pickProvider(operator?: string | null, retailer?: string | null) {
  const txt = ((operator || "") + " " + (retailer || "")).toLowerCase();
  if (txt.includes("avanti")) return "avanti";
  if (txt.includes("west midlands")) return "wmt";
  if (txt.includes("lner")) return "lner";
  if (txt.includes("gwr")) return "gwr";
  if (txt.includes("crosscountry")) return "crosscountry";
  if (txt.includes("thameslink")) return "thameslink";
  if (txt.includes("southern")) return "southern";
  if (txt.includes("south western")) return "southwestern";
  if (txt.includes("tpe") || txt.includes("transpennine")) return "tpe";
  return "unknown";
}

// --- route ---
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

  let created = 0, skipped = 0;

  for (const t of trips || []) {
    // validate essentials
    if (!isLikelyStationName(t.origin) || !isLikelyStationName(t.destination)) { skipped++; continue; }

    const userId = await getUserIdForEmail(db, t.user_email);
    if (!userId) { skipped++; continue; }

    // optional: guard booking_ref (simple sanity)
    const refOk = t.booking_ref && String(t.booking_ref).trim().length >= 6 && String(t.booking_ref).trim().length <= 12;
    if (!refOk) { skipped++; continue; }

    // de-dupe: existing claim
    const { data: existing } = await db
      .from("claims")
      .select("id")
      .eq("trip_id", t.id)
      .limit(1);
    if (existing && existing.length) { skipped++; continue; }

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
          depart_planned: isIsoDateLike(t.depart_planned) ? t.depart_planned : null,
          arrive_planned: isIsoDateLike(t.arrive_planned) ? t.arrive_planned : null,
          operator: t.operator,
          retailer: t.retailer,
        },
      })
      .select("id")
      .single();

    if (insErr || !ins?.id) { skipped++; continue; }

    const provider = pickProvider(t.operator, t.retailer);

    await db.from("claim_queue").insert({
      claim_id: ins.id,
      provider,
      status: "queued",
      payload: {
        user_email: t.user_email ?? null,
        booking_ref: t.booking_ref ?? null,
        operator: t.operator ?? null,
        retailer: t.retailer ?? null,
        origin: t.origin ?? null,
        destination: t.destination ?? null,
        depart_planned: isIsoDateLike(t.depart_planned) ? t.depart_planned : null,
        arrive_planned: isIsoDateLike(t.arrive_planned) ? t.arrive_planned : null,
        delay_minutes: null,
      },
    });

    created++;
  }

  return NextResponse.json({ ok: true, examined: trips?.length || 0, created, skipped });
}

export async function POST() {
  return GET();
}
