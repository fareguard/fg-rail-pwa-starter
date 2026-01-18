import { createClient } from "@supabase/supabase-js";
import { submitAvantiClaim } from "./provider-avanti.mjs";
import { submitWMTClaim } from "./provider-wmt.mjs";
import { submitGWRClaim } from "./provider-gwr.mjs";
import { submitLNERClaim } from "./provider-lner.mjs";
import { submitGTRClaim } from "./provider-gtr.mjs";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBMIT_LIVE = String(process.env.SUBMIT_LIVE || "").toLowerCase();
const SLEEP_MS = parseInt(process.env.CLAIM_SUBMIT_SLEEP_MS || "15000", 10);

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(supabaseUrl, serviceKey);

const LIVE = ["true", "1", "yes", "y"].includes(SUBMIT_LIVE);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function operatorToProvider(op) {
  const p = String(op || "").trim().toLowerCase();
  // map your rules/operators to provider modules
  // IMPORTANT: match whatever is stored in delay_repay_rules.operator / claims.meta->>'operator'

  if (p.includes("west midlands")) return "wmt";
  if (p.includes("avanti")) return "avanti";
  if (p.includes("gwr") || p.includes("great western")) return "gwr";
  if (p.includes("lner")) return "lner";

  // c2c support — ONLY because it is intentionally routed via GTR
  // If this ever stops being true, remove this and it will fail cleanly
  if (p === "c2c" || p.includes("c2c")) return "gtr";

  if (
    p.includes("gtr") ||
    p.includes("thameslink") ||
    p.includes("southern") ||
    p.includes("great northern")
  ) return "gtr";

  return null;
}

async function popClaimId() {
  const { data, error } = await db.rpc("claims_pop_submit", { p_limit: 1 });
  if (error) throw error;
  return data?.[0]?.claim_id || null;
}

async function getClaim(claimId) {
  const { data, error } = await db
    .from("claims")
    .select(
      "id, trip_id, status, provider_ref, error, submitted_at, operator, booking_ref, user_email, meta"
    )
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateClaim(claimId, patch) {
  const { error } = await db.from("claims").update(patch).eq("id", claimId);
  if (error) throw error;
}

async function updateQueue(claimId, patch) {
  // stage-based queue is keyed by claim_id
  const { error } = await db
    .from("claim_queue")
    .update(patch)
    .eq("claim_id", claimId);
  if (error) throw error;
}

async function runProvider(providerId, payload) {
  const submitOpts = { submitLive: LIVE };
  switch (providerId) {
    case "avanti":
      return submitAvantiClaim(payload, submitOpts);
    case "wmt":
      return submitWMTClaim(payload, submitOpts);
    case "gwr":
      return submitGWRClaim(payload, submitOpts);
    case "lner":
      return submitLNERClaim(payload, submitOpts);
    case "gtr":
      return submitGTRClaim(payload, submitOpts);
    default:
      return { ok: false, error: `Unknown provider ${providerId}` };
  }
}

function backoffMinutes(attempts) {
  // 2,3,4,... up to 60 mins
  return Math.min(60, Math.max(2, attempts + 1));
}

async function tickOnce() {
  const claimId = await popClaimId();
  if (!claimId) {
    console.log(
      JSON.stringify({ ok: true, processed: 0, source: "submit.none" })
    );
    return;
  }

  const claim = await getClaim(claimId);
  if (!claim) {
    // queue row exists but claim row missing: park it
    await updateQueue(claimId, {
      stage: "check",
      last_error: "claim_missing",
      next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    return;
  }

  // SAFETY: never mark submitted on dry-run
  // We'll treat dry-run success as "ready" and re-queue.
  const operator =
    claim.operator ||
    claim.meta?.operator ||
    claim.meta?.operator_name ||
    claim.meta?.["operator"];

  const provider = operatorToProvider(operator);

  if (!provider) {
    await updateClaim(claimId, {
      status: "failed",
      error: "no_provider_for_operator",
    });
    await updateQueue(claimId, {
      stage: "check",
      last_error: "no_provider_for_operator",
      next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    return;
  }

  // Build payload from claim/meta (single source of truth)
  const payload = {
    ...(claim.meta && typeof claim.meta === "object" ? claim.meta : {}),
    user_email: claim.user_email || claim.meta?.user_email,
    booking_ref: claim.booking_ref || claim.meta?.booking_ref,
    operator,
  };

  // Mark queue processing-ish (temporary lock window)
  await updateQueue(claimId, {
    last_error: null,
    next_attempt_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });

  let result;
  try {
    result = await runProvider(provider, payload);
  } catch (e) {
    result = { ok: false, error: e?.message || "provider_throw" };
  }

  const ok = !!result?.ok;

  if (!LIVE && ok) {
    // Dry run: keep it ready, do NOT mark submitted
    await updateClaim(claimId, {
      status: "ready",
      error: null,
    });
    await updateQueue(claimId, {
      stage: "submit",
      last_error: "dry_run_no_submit",
      next_attempt_at: new Date(
        Date.now() + 6 * 60 * 60 * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        ok: true,
        processed: 1,
        claimId,
        provider,
        live: LIVE,
        dry_run: true,
      })
    );
    return;
  }

  if (ok) {
    await updateClaim(claimId, {
      status: "submitted",
      provider_ref: result?.provider_ref || null,
      submitted_at: new Date().toISOString(),
      error: null,
    });
    await updateQueue(claimId, {
      stage: "check",
      last_error: null,
      next_attempt_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  } else {
    // Retry with backoff
    const { data: qrow } = await db
      .from("claim_queue")
      .select("attempts")
      .eq("claim_id", claimId)
      .maybeSingle();

    const attempts = (qrow?.attempts ?? 0) + 1;
    const mins = backoffMinutes(attempts);

    await updateClaim(claimId, {
      status: "failed",
      error: result?.error || "submit_failed",
    });
    await updateQueue(claimId, {
      stage: "submit",
      attempts,
      last_error: result?.error || "submit_failed",
      next_attempt_at: new Date(Date.now() + mins * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  console.log(
    JSON.stringify({
      ok: true,
      processed: 1,
      claimId,
      provider,
      live: LIVE,
      result,
    })
  );
}

async function main() {
  while (true) {
    try {
      await tickOnce();
    } catch (e) {
      console.error(
        JSON.stringify({
          ok: false,
          worker: "claim-submitter",
          error: e?.message || String(e),
        })
      );
    }
    await sleep(SLEEP_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
