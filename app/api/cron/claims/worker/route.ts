import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { submitClaimByProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = getSupabaseAdmin();

  // Grab ONE queued item to avoid stampede
  const { data: queueItems, error } = await db
    .from("claim_queue")
    .select("id, claim_id, provider, status, payload")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!queueItems?.length) return NextResponse.json({ ok: true, processed: 0 });

  const q = queueItems[0];
  // mark processing
  await db
    .from("claim_queue")
    .update({ status: "processing", attempts: (q as any).attempts + 1 })
    .eq("id", q.id);

  try {
    const result = await submitClaimByProvider(q.provider, q.payload || {});

    if (!result.ok) {
      await db
        .from("claim_queue")
        .update({
          status: "failed",
          last_error: JSON.stringify(result.raw ?? { error: "submit failed" }),
        })
        .eq("id", q.id);
      return NextResponse.json({ ok: true, processed: 1, result });
    }

    // mark queue + claim as submitted
    await db.from("claim_queue").update({
      status: "submitted",
      submitted_at: result.submitted_at,
      response: result.raw ?? null,
    }).eq("id", q.id);

    await db.from("claims").update({
      status: "submitted",
      submitted_at: result.submitted_at,
      provider_ref: result.provider_ref ?? null,
    }).eq("id", q.claim_id);

    return NextResponse.json({ ok: true, processed: 1, result });
  } catch (e: any) {
    await db
      .from("claim_queue")
      .update({ status: "failed", last_error: e?.message || String(e) })
      .eq("id", q.id);
    return NextResponse.json({ ok: false, processed: 1, error: e?.message || String(e) });
  }
}

export async function POST() {
  return GET();
}
