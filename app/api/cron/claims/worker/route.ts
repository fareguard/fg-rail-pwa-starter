import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { submitAvanti } from "@/lib/providers/avanti"; // we'll add this below

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = getSupabaseAdmin();

  // 1) pick one job
  const { data: jobs, error } = await db
    .from("claim_queue")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) return NextResponse.json({ ok:false, error: error.message }, { status: 500 });
  if (!jobs?.length) return NextResponse.json({ ok:true, processed: 0 });

  const job = jobs[0];

  // 2) mark processing
  await db.from("claim_queue").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", job.id);

  // 3) load claim + trip
  const { data: claimRow } = await db.from("claims").select("*").eq("id", job.claim_id).single();
  const { data: tripRow }  = claimRow?.trip_id ? await db.from("trips").select("*").eq("id", claimRow.trip_id).single() : { data: null };

  // 4) call provider adapter (stub = Avanti)
  const payload = {
    user_email: claimRow?.user_email,
    booking_ref: tripRow?.booking_ref,
    operator: tripRow?.operator,
    origin: tripRow?.origin,
    destination: tripRow?.destination,
    depart_planned: tripRow?.depart_planned,
    arrive_planned: tripRow?.arrive_planned,
    delay_minutes: tripRow?.delay_minutes,
  };

  let res: any = { ok:false };
  try {
    if (job.provider === "avanti") res = await submitAvanti(payload);
    else res = { ok:false, error: `Unsupported provider ${job.provider}` };
  } catch (e:any) {
    res = { ok:false, error: e?.message || String(e) };
  }

  // 5) write result
  const status = res.ok ? "submitted" : "failed";
  await db.from("claim_queue").update({
    status,
    finished_at: new Date().toISOString(),
    response: res
  }).eq("id", job.id);

  // (optional) bump claims.status too
  if (res.ok) await db.from("claims").update({ status: "submitted" }).eq("id", job.claim_id);

  return NextResponse.json({ ok:true, processed: 1, result: res });
}
