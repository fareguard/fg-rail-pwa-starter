import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { submitClaimByProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Guard: only allow Playwright runs when enabled
const ALLOW_PLAYWRIGHT = process.env.PLAYWRIGHT_ENABLED === "true";

async function jsonError(status: number, msg: string, extra?: any) {
  console.error("[worker:error]", msg, extra || "");
  return NextResponse.json({ ok: false, status, error: msg, extra }, { status });
}

export async function GET() {
  const db = getSupabaseAdmin();

  if (!ALLOW_PLAYWRIGHT) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      note: "Playwright disabled (set PLAYWRIGHT_ENABLED=true to run).",
    });
  }

  const { data: queueItems, error } = await db
    .from("claim_queue")
    .select("id, claim_id, provider, status, payload, attempts, created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) return jsonError(500, "DB select claim_queue failed", error);
  if (!queueItems?.length) return NextResponse.json({ ok: true, processed: 0 });

  const q = queueItems[0];

  const { error: up1 } = await db
    .from("claim_queue")
    .update({
      status: "processing",
      attempts: (q.attempts ?? 0) + 1,
      last_error: null,
    })
    .eq("id", q.id);
  if (up1) return jsonError(500, "DB update -> processing failed", up1);

  try {
    const result: any = await submitClaimByProvider(q.provider, q.payload || {});
    console.log("[worker:submit]", q.id, q.provider, result?.ok);

    if (!result?.ok) {
      const { error: upFail } = await db
        .from("claim_queue")
        .update({
          status: "failed",
          last_error: JSON.stringify(result?.raw ?? result?.error ?? "submit failed"),
        })
        .eq("id", q.id);
      if (upFail) console.error("[worker:update failed err]", upFail);
      return NextResponse.json({ ok: true, processed: 1, result });
    }

    const { error: upQ } = await db
      .from("claim_queue")
      .update({
        status: "submitted",
        submitted_at: result.submitted_at,
        response: result.raw ?? null,
      })
      .eq("id", q.id);
    if (upQ) console.error("[worker:update queue submit err]", upQ);

    const { error: upC } = await db
      .from("claims")
      .update({
        status: "submitted",
        submitted_at: result.submitted_at,
        provider_ref: result.provider_ref ?? null,
      })
      .eq("id", q.claim_id);
    if (upC) console.error("[worker:update claim submit err]", upC);

    return NextResponse.json({ ok: true, processed: 1, result });
  } catch (e: any) {
    console.error("[worker:exception]", e?.stack || e?.message || e);
    const { error: upFail } = await db
      .from("claim_queue")
      .update({
        status: "failed",
        last_error: e?.stack || e?.message || String(e),
      })
      .eq("id", q.id);
    if (upFail) console.error("[worker:update failed on exception err]", upFail);

    return jsonError(500, "Worker exception", { message: e?.message || String(e) });
  }
}

export async function POST() {
  return GET();
}
