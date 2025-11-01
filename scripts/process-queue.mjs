// scripts/process-queue.mjs
import { createClient } from "@supabase/supabase-js";
import { submitAvantiClaim } from "./provider-avanti.mjs";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUBMIT_LIVE, // "true" to actually click submit
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function normProvider(p) {
  const s = (p || "").toLowerCase().trim();
  if (["avanti", "avanti west coast", "avantiwestcoast"].some(k => s.includes(k))) return "avanti";
  return s || "unknown";
}

async function runOnce() {
  // Oldest queued
  const { data: items, error } = await db
    .from("claim_queue")
    .select("id, claim_id, provider, status, payload, attempts, created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!items?.length) {
    console.log(JSON.stringify({ ok: true, processed: 0 }));
    return;
  }

  const q = items[0];
  const provider = normProvider(q.provider);

  // Mark processing
  await db.from("claim_queue")
    .update({ status: "processing", attempts: (q.attempts ?? 0) + 1, last_error: null })
    .eq("id", q.id);

  try {
    let result;

    if (provider === "unknown") {
      // Don’t burn CI time – fail fast and make it visible upstream
      result = { ok: false, error: "provider:unknown", hint: "add a handler or fix operator mapping" };
    } else if (provider === "avanti") {
      result = await submitAvantiClaim(q.payload || {}, { submitLive: SUBMIT_LIVE === "true" });
    } else {
      result = { ok: false, error: `provider:not-implemented:${provider}` };
    }

    // Update DB
    if (!result.ok) {
      await db.from("claim_queue")
        .update({ status: "failed", last_error: result.error || "submit failed" })
        .eq("id", q.id);
      console.log(JSON.stringify({ ok: true, processed: 1, provider, source: "queue.provider", result }));
      return;
    }

    await db.from("claim_queue")
      .update({ status: "submitted", submitted_at: result.submitted_at, response: result })
      .eq("id", q.id);

    await db.from("claims")
      .update({
        status: "submitted",
        submitted_at: result.submitted_at,
        provider_ref: result.provider_ref ?? null,
      })
      .eq("id", q.claim_id);

    console.log(JSON.stringify({ ok: true, processed: 1, provider, source: "queue.provider", result }));
  } catch (e) {
    await db.from("claim_queue")
      .update({ status: "failed", last_error: e?.message || String(e) })
      .eq("id", q.id);
    console.error(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  }
}

runOnce().catch((e) => {
  console.error(e);
  process.exit(1);
});
