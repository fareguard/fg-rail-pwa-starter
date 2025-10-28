import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const supa = getSupabaseAdmin();

  // 1) find trips that look like real rail bookings and don't already have a claim
  const { data: candidates, error: qErr } = await supa
    .from("trips")
    .select("id, operator, booking_ref, origin, destination, depart_planned, user_email")
    .gt("depart_planned", "2000-01-01") // avoid nulls/garbage
    .is("eligible", null)                 // only untouched (or use = false if you've run once)
    .limit(50);

  if (qErr) return NextResponse.json({ ok:false, error:qErr.message }, { status: 500 });

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok:true, marked: 0, createdClaims: 0 });
  }

  // very dumb heuristic: if it has an operator and booking_ref, treat as a real trip
  const looksReal = (t: any) => !!t.operator || !!t.booking_ref;

  const toMark = candidates.filter(looksReal).map(t => t.id);
  let created = 0;

  if (toMark.length) {
    // 2) mark eligible
    const { error: updErr } = await supa
      .from("trips")
      .update({ eligible: true, eligibility_reason: "mvp-placeholder" })
      .in("id", toMark);
    if (updErr) return NextResponse.json({ ok:false, error:updErr.message }, { status: 500 });

    // 3) create pending claims for newly eligible trips that don't already have one
    //    (left join style in SQL, but we'll do it in two steps for simplicity)
    const { data: haveClaims, error: hcErr } = await supa
      .from("claims")
      .select("trip_id")
      .in("trip_id", toMark);
    if (hcErr) return NextResponse.json({ ok:false, error:hcErr.message }, { status:500 });

    const claimedSet = new Set((haveClaims ?? []).map(r => r.trip_id));
    const toClaim = candidates.filter(t => toMark.includes(t.id) && !claimedSet.has(t.id));

    if (toClaim.length) {
      const rows = toClaim.map(t => ({
        trip_id: t.id,
        user_email: t.user_email ?? "unknown@fareguard.co.uk",
        status: "pending",
        fee_pct: 25,
        meta: { reason: "mvp-placeholder" }
      }));
      const { error: insErr } = await supa.from("claims").insert(rows);
      if (insErr) return NextResponse.json({ ok:false, error:insErr.message }, { status: 500 });
      created = rows.length;
    }
  }

  return NextResponse.json({ ok:true, marked: toMark.length, createdClaims: created });
}
