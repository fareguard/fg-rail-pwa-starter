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

async function runOnce() {
  // 1) Get the oldest queued item
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

  // 2) Mark processing
  await db.from("claim_queue").update({
    status: "processing",
    attempts: (q.attempts ?? 0) + 1,
    last_error: null,
  }).eq("id", q.id);

  let result;
  try {
    // 3) Route by provider
    const p = (q.provider || "").toLowerCase();
    if (p === "avanti") {
      result = await submitAvantiClaim(q.payload || {}, { submitLive: SUBMIT_LIVE === "true" });
    } else {
      result = { ok: false, error: `Unknown provider ${q.provider}` };
    }

    // 4) Update DB based on result
    if (!result.ok) {
      await db.from("claim_queue").update({
        status: "failed",
        last_error: result.error || "submit failed",
      }).eq("id", q.id);

      console.log(JSON.stringify({ ok: true, processed: 1, result }));
      return;
    }

    await db.from("claim_queue").update({
      status: "submitted",
      submitted_at: result.submitted_at,
      response: result,
    }).eq("id", q.id);

    await db.from("claims").update({
      status: "submitted",
      submitted_at: result.submitted_at,
      provider_ref: result.provider_ref ?? null,
    }).eq("id", q.claim_id);

    console.log(JSON.stringify({ ok: true, processed: 1, result }));
  } catch (e) {
    await db.from("claim_queue").update({
      status: "failed",
      last_error: e?.message || String(e),
    }).eq("id", q.id);
    console.error(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  }
}

runOnce().catch((e) => {
  console.error(e);
  process.exit(1);
});
