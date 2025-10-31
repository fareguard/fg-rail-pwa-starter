import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { guessProvider } from "@/lib/submitters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleQueue(claimId: string) {
  const supa = getSupabaseAdmin();

  // Load claim
  const { data: claim, error: e1 } = await supa
    .from("claims")
    .select("id,status,trip_id,user_email")
    .eq("id", claimId)
    .single();
  if (e1 || !claim) return { ok:false, status:404, error:"Claim not found" };
  if (claim.status !== "pending") return { ok:false, status:400, error:`Claim is ${claim.status}` };

  // Load trip
  const { data: trip, error: e2 } = await supa
    .from("trips")
    .select("id,operator")
    .eq("id", claim.trip_id)
    .single();
  if (e2 || !trip) return { ok:false, status:404, error:"Trip not found" };

  const provider = guessProvider(trip.operator);

  // Avoid double-queue
  const { data: existing } = await supa
    .from("claim_submissions")
    .select("id,status")
    .eq("claim_id", claimId)
    .in("status", ["queued","submitting"])
    .maybeSingle();

  if (!existing) {
    const { error: e3 } = await supa.from("claim_submissions").insert({
      claim_id: claimId,
      provider,
      status: "queued"
    });
    if (e3) return { ok:false, status:500, error:e3.message };
  }

  return { ok:true, status:200, provider };
}

export async function POST(_req: Request, ctx: { params: { claimId: string } }) {
  const res = await handleQueue(ctx.params.claimId);
  return NextResponse.json(res, { status: res.status });
}

// Enable quick testing via browser:
export async function GET(_req: Request, ctx: { params: { claimId: string } }) {
  const res = await handleQueue(ctx.params.claimId);
  return NextResponse.json(res, { status: res.status });
}
