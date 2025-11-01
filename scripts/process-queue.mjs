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

async function inferProviderForClaim(claimId) {
  const { data, error } = await db
    .from("claims")
    .select("id, trip_id, status")
    .eq("id", claimId)
    .maybeSingle();

  if (error || !data?.trip_id) return null;

  const { data: trip } = await db
    .from("trips")
    .select("operator, retailer")
    .eq("id", data.trip_id)
    .maybeSingle();

  const op = (trip?.operator || trip?.retailer || "").toLowerCase();

  if (op.includes("avanti")) return "avanti";
  // add more as we implement: wmt, gwr, lner, crosscountry, etc.
  return null;
}

function isTransientError(msg = "") {
  const m = msg.toLowerCase();
  return (
    m.includes("timeout") ||
    m.includes("net::") ||
    m.includes("navigation") ||
    m.includes("detached") ||
    m.includes("intercepts pointer events") ||
    m.includes("execution context was destroyed")
  );
}

async function runOnce() {
  // 1) Oldest queued row
  const { data: items, error } = await db
    .from("claim_queue")
    .select("id, claim_id, provider, status, payload, attempts, created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!items?.length) {
    console.log(JSON.stringify({ ok: true, processed: 0, note: "nothing queued" }));
    return;
  }

  const q = items[0];

  // 2) If provider unknown, infer from trip/operator
  let provider = (q.provider || "").toLowerCase();
  if (!provider || provider === "unknown") {
    const inferred = await inferProviderForClaim(q.claim_id);
    if (inferred) {
      provider = inferred;
      await db.from("claim_queue").update({ provider: inferred }).eq("id", q.id);
    }
  }

  // 3) Mark processing
  await db
    .from("claim_queue")
    .update({
      status: "processing",
      attempts: (q.attempts ?? 0) + 1,
      last_error: null,
      started_at: new Date().toISOString(),
    })
    .eq("id", q.id);

  const attempt = (q.attempts ?? 0) + 1;
  const maxAttempts = 3;

  let result;
  try {
    if (provider === "avanti") {
      result = await submitAvantiClaim(q.payload || {}, { submitLive: SUBMIT_LIVE === "true" });
    } else {
      result = { ok: false, error: `Unknown provider ${provider || "unknown"}` };
    }

    if (!result?.ok) {
      // Transient? retry up to maxAttempts; otherwise fail
      const transient = isTransientError(result?.error || "");
      const newStatus = transient && attempt < maxAttempts ? "queued" : "failed";

      await db
        .from("claim_queue")
        .update({
          status: newStatus,
          last_error: result?.error || "submit failed",
          response: result || null,
          // tiny backoff: push it back a bit if retrying
          ...(newStatus === "queued" ? { created_at: new Date().toISOString() } : {}),
          finished_at: new Date().toISOString(),
        })
        .eq("id", q.id);

      console.log(JSON.stringify({ ok: true, processed: 1, retry: newStatus === "queued", result }));
      return;
    }

    await db
      .from("claim_queue")
      .update({
        status: "submitted",
        submitted_at: result.submitted_at,
        response: result,
        finished_at: new Date().toISOString(),
      })
      .eq("id", q.id);

    await db
      .from("claims")
      .update({
        status: "submitted",
        submitted_at: result.submitted_at,
        provider_ref: result.provider_ref ?? null,
      })
      .eq("id", q.claim_id);

    console.log(JSON.stringify({ ok: true, processed: 1, result }));
  } catch (e) {
    const msg = e?.message || String(e);
    const transient = isTransientError(msg);
    const newStatus = transient && attempt < maxAttempts ? "queued" : "failed";

    await db
      .from("claim_queue")
      .update({
        status: newStatus,
        last_error: msg,
        finished_at: new Date().toISOString(),
      })
      .eq("id", q.id);

    console.error(JSON.stringify({ ok: false, error: msg, retry: newStatus === "queued" }));
  }
}

runOnce().catch((e) => {
  console.error(e);
  process.exit(1);
});