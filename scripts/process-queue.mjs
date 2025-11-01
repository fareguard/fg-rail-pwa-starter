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

function detectFromStrings(...vals) {
  const txt = vals.filter(Boolean).join(" ").toLowerCase();
  if (txt.includes("avanti")) return "avanti";
  if (txt.includes("west midlands")) return "wmt";
  if (txt.includes("lner")) return "lner";
  if (txt.includes("gwr")) return "gwr";
  if (txt.includes("crosscountry")) return "crosscountry";
  return "unknown";
}

async function inferProvider(db, queueRow) {
  // 1) try payload fields
  const p1 = detectFromStrings(
    queueRow?.payload?.operator,
    queueRow?.payload?.retailer,
    queueRow?.payload?.origin,
    queueRow?.payload?.destination
  );
  if (p1 !== "unknown") return { provider: p1, source: "payload" };

  // 2) try claims.meta + trips
  const { data: claim, error: e1 } = await db
    .from("claims")
    .select("id, trip_id, meta")
    .eq("id", queueRow.claim_id)
    .single();
  if (!e1 && claim) {
    const claimOp = claim?.meta?.operator;
    const p2 = detectFromStrings(claimOp);
    if (p2 !== "unknown") return { provider: p2, source: "claim.meta" };

    if (claim.trip_id) {
      const { data: trip, error: e2 } = await db
        .from("trips")
        .select("operator, retailer, origin, destination")
        .eq("id", claim.trip_id)
        .single();
      if (!e2 && trip) {
        const p3 = detectFromStrings(
          trip.operator,
          trip.retailer,
          trip.origin,
          trip.destination
        );
        if (p3 !== "unknown") return { provider: p3, source: "trip" };
      }
    }
  }

  return { provider: "unknown", source: "none" };
}

async function runOnce() {
  // 1) get oldest queued/processing (processing gets retried cleanly)
  const { data: items, error } = await db
    .from("claim_queue")
    .select("id, claim_id, provider, status, payload, attempts, created_at")
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!items?.length) {
    console.log(JSON.stringify({ ok: true, processed: 0 }));
    return;
  }

  const q = items[0];

  // 2) mark processing
  await db
    .from("claim_queue")
    .update({
      status: "processing",
      attempts: (q.attempts ?? 0) + 1,
      last_error: null,
    })
    .eq("id", q.id);

  // 3) decide provider
  let provider = (q.provider || "").toLowerCase();
  let source = "queue.provider";

  if (!provider || provider === "unknown") {
    const inferred = await inferProvider(db, q);
    provider = inferred.provider;
    source = inferred.source;
    await db.from("claim_queue").update({ provider }).eq("id", q.id);
  }

  let result;
  try {
    // 4) route
    if (provider === "avanti") {
      result = await submitAvantiClaim(q.payload || {}, {
        submitLive: SUBMIT_LIVE === "true",
      });
    } else {
      result = { ok: false, error: `Unknown provider ${provider}` };
    }

    // 5) persist outcome
    if (!result.ok) {
      await db
        .from("claim_queue")
        .update({
          status: "failed",
          last_error: result.error || "submit failed",
        })
        .eq("id", q.id);

      console.log(
        JSON.stringify({ ok: true, processed: 1, provider, source, result })
      );
      return;
    }

    await db
      .from("claim_queue")
      .update({
        status: "submitted",
        submitted_at: result.submitted_at,
        response: result,
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

    console.log(
      JSON.stringify({ ok: true, processed: 1, provider, source, result })
    );
  } catch (e) {
    await db
      .from("claim_queue")
      .update({
        status: "failed",
        last_error: e?.message || String(e),
      })
      .eq("id", q.id);
    console.error(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  }
}

runOnce().catch((e) => {
  console.error(e);
  process.exit(1);
});
