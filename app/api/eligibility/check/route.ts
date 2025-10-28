import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supa = getSupabaseAdmin();

  const { data, error } = await supa
    .from("trips")
    .select("*")
    .is("eligible", null)
    .limit(100);

  if (error) return NextResponse.json({ ok:false, error: error.message }, { status:500 });

  let updated = 0;
  for (const t of data || []) {
    const looksClaimable = !!(t.operator && t.depart_planned && t.arrive_planned);
    const { error: uerr } = await supa
      .from("trips")
      .update({
        eligible: looksClaimable ? true : null,
        eligible_reason: looksClaimable ? "Has operator + timings (MVP rule)" : null,
        status: "review",
      })
      .eq("id", t.id);
    if (!uerr) updated++;
  }

  return NextResponse.json({ ok:true, reviewed: updated });
}
