import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { submitClaimToProvider } from "@/lib/submitters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleProcess() {
  const supa = getSupabaseAdmin();

  const { data: queued, error: e1 } = await supa
    .from("claim_submissions")
    .select("id,claim_id,provider,status,started_at")
    .eq("status","queued")
    .order("started_at", { ascending:true })
    .limit(1)
    .maybeSingle();

  if (e1) return { ok:false, status:500, error:e1.message };
  if (!queued) return { ok:true, status:200, processed:0, message:"No queued items" };

  await supa.from("claim_submissions")
    .update({ status:"submitting", started_at:new Date().toISOString() })
    .eq("id", queued.id);

  const { data: claim, error: e2 } = await supa
    .from("claims")
    .select("id,user_email,trip_id")
    .eq("id", queued.claim_id)
    .single();
  if (e2 || !claim) {
    await supa.from("claim_submissions").update({
      status:"failed", finished_at:new Date().toISOString(), response:{ error:"Claim not found" }
    }).eq("id", queued.id);
    return { ok:false, status:404, error:"Claim not found" };
  }

  const { data: trip } = await supa
    .from("trips")
    .select("operator,booking_ref,origin,destination,depart_planned,arrive_planned,delay_minutes")
    .eq("id", claim.trip_id)
    .single();

  const payload = {
    user_email: claim.user_email,
    booking_ref: trip?.booking_ref ?? null,
    operator: trip?.operator ?? null,
    origin: trip?.origin ?? null,
    destination: trip?.destination ?? null,
    depart_planned: trip?.depart_planned ?? null,
    arrive_planned: trip?.arrive_planned ?? null,
    delay_minutes: trip?.delay_minutes ?? null
  };

  try {
    const result = await submitClaimToProvider(queued.provider || "generic", payload);

    await supa.from("claim_submissions").update({
      status: result.ok ? "submitted" : "failed",
      finished_at: new Date().toISOString(),
      response: result
    }).eq("id", queued.id);

    if (result.ok) {
      await supa.from("claims").update({ status:"submitted" }).eq("id", queued.claim_id);
    }

    return { ok:true, status:200, processed:1, result };
  } catch (err:any) {
    await supa.from("claim_submissions").update({
      status:"failed", finished_at:new Date().toISOString(),
      response:{ error: err?.message || String(err) }
    }).eq("id", queued.id);
    return { ok:false, status:500, error:"submit failed" };
  }
}

export async function POST() {
  const res = await handleProcess();
  return NextResponse.json(res, { status: res.status });
}

// Allow testing in browser:
export async function GET() {
  const res = await handleProcess();
  return NextResponse.json(res, { status: res.status });
}
