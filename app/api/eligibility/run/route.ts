import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// very simple placeholder rule: only trips that have both planned times
function isEligible(trip: any) {
  if (!trip?.depart_planned || !trip?.arrive_planned) {
    return { eligible: false, reason: "missing_times" };
  }
  return { eligible: true, reason: "placeholder_rule" };
}

async function runCheck() {
  const supa = getSupabaseAdmin();

  // pull trips (don’t assume any extra columns exist)
  const { data: trips, error } = await supa
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) throw error;

  let examined = 0;
  let created = 0;

  for (const t of trips ?? []) {
    examined++;
    const res = isEligible(t);
    if (!res.eligible) continue;

    // create a claim record (ignore if already created for this trip)
    const { error: insErr } = await supa
      .from("claims")
      .insert({
        trip_id: t.id,
        user_email: t.user_email ?? null,
        status: "pending",
        fee_pct: 25,
        meta: { reason: res.reason },
      });

    // ignore duplicate-key errors if you added a unique constraint later
    if (!insErr) created++;
  }

  return { ok: true, examined, created };
}

export async function POST() {
  try {
    const out = await runCheck();
    return NextResponse.json(out);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

// allow manual GET in the browser too
export const GET = POST;
