// workers/email-retention.mjs
// Purpose: enforce Gmail/raw email + LLM debug retention policies.
// - Redacts raw_emails (non-train immediately; train after N days)
// - Redacts debug_llm_outputs orphans (user_email is null)
// - Optionally wipes debug_llm_outputs.raw_input everywhere (recommended)
// Runs once per day (same pattern as darwin-retention.mjs)

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// NOTE: workers use SUPABASE_URL + SERVICE ROLE (like your other workers)
const SUPABASE_URL = must("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = must("SUPABASE_SERVICE_ROLE_KEY");

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Tunables
const NON_TRAIN_REDACT_AFTER_MIN = Number(process.env.RAW_EMAILS_NON_TRAIN_REDACT_AFTER_MIN ?? "0");
const TRAIN_REDACT_AFTER_DAYS = Number(process.env.RAW_EMAILS_TRAIN_REDACT_AFTER_DAYS ?? "7");
const BATCH = Number(process.env.RAW_EMAILS_RETENTION_BATCH ?? "2000");

// Run around 03:20 UTC daily by default
const TARGET_HOUR_UTC = Number(process.env.EMAIL_RETENTION_HOUR_UTC ?? "3");
const TARGET_MIN_UTC = Number(process.env.EMAIL_RETENTION_MIN_UTC ?? "20");

// Safety switches
const WIPE_DEBUG_RAW_INPUT = String(process.env.WIPE_DEBUG_RAW_INPUT ?? "true").toLowerCase() === "true";

let lastRunDay = null;

async function runCleanup() {
  // 1) Raw emails retention (uses your existing RPC)
  const { data: rawData, error: rawErr } = await db.rpc("raw_emails_retention_redact", {
    p_non_train_redact_after_minutes: NON_TRAIN_REDACT_AFTER_MIN,
    p_train_redact_after_days: TRAIN_REDACT_AFTER_DAYS,
    p_batch: BATCH,
  });

  if (rawErr) {
    console.error("[email-retention] raw_emails_retention_redact error:", rawErr.message);
  } else {
    console.log("[email-retention] raw_emails_retention_redact ok:", rawData);
  }

  // 2) Debug retention for orphans (uses your existing RPC)
  const { data: dbgData, error: dbgErr } = await db.rpc("debug_llm_outputs_retention_redact_orphans");

  if (dbgErr) {
    console.error("[email-retention] debug_llm_outputs_retention_redact_orphans error:", dbgErr.message);
  } else {
    console.log("[email-retention] debug_llm_outputs_retention_redact_orphans ok:", dbgData);
  }

  // 3) Belt & braces: wipe raw_input everywhere (recommended)
  // Call RPC instead of direct update and log returned { wiped: n }.
  if (WIPE_DEBUG_RAW_INPUT) {
    const { data: wipeData, error: wipeErr } = await db.rpc("debug_llm_outputs_wipe_raw_input");

    if (wipeErr) {
      console.error("[email-retention] debug_llm_outputs_wipe_raw_input error:", wipeErr.message);
    } else {
      // Expected shape: { wiped: n }
      console.log("[email-retention] debug_llm_outputs_wipe_raw_input ok:", wipeData);
      console.log("[email-retention] wiped debug_llm_outputs.raw_input:", {
        wiped: wipeData?.wiped ?? null,
      });
    }
  }
}

function shouldRunNow() {
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
  if (lastRunDay === dayKey) return false;

  const h = now.getUTCHours();
  const m = now.getUTCMinutes();

  if (h > TARGET_HOUR_UTC) return true;
  if (h === TARGET_HOUR_UTC && m >= TARGET_MIN_UTC) return true;
  return false;
}

async function loop() {
  try {
    if (shouldRunNow()) {
      lastRunDay = new Date().toISOString().slice(0, 10);
      console.log("[email-retention] running", {
        NON_TRAIN_REDACT_AFTER_MIN,
        TRAIN_REDACT_AFTER_DAYS,
        BATCH,
        TARGET_HOUR_UTC,
        TARGET_MIN_UTC,
        WIPE_DEBUG_RAW_INPUT,
      });
      await runCleanup();
      console.log("[email-retention] done");
    }
  } catch (e) {
    console.error("[email-retention] loop error:", e?.message || e);
  } finally {
    setTimeout(loop, 60_000); // check every minute
  }
}

console.log("[email-retention] started", {
  NON_TRAIN_REDACT_AFTER_MIN,
  TRAIN_REDACT_AFTER_DAYS,
  BATCH,
  TARGET_HOUR_UTC,
  TARGET_MIN_UTC,
  WIPE_DEBUG_RAW_INPUT,
});

loop();
