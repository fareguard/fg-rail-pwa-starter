import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const EVENTS_KEEP_DAYS = Number(process.env.DARWIN_EVENTS_KEEP_DAYS ?? "21");
const MSGS_KEEP_DAYS = Number(process.env.DARWIN_MSGS_KEEP_DAYS ?? "7");
const CALLS_KEEP_DAYS = Number(process.env.DARWIN_CALLS_KEEP_DAYS ?? "60");
const BATCH = Number(process.env.DARWIN_RETENTION_BATCH ?? "50000");

// run around 03:15 UTC daily by default
const TARGET_HOUR_UTC = Number(process.env.DARWIN_RETENTION_HOUR_UTC ?? "3");
const TARGET_MIN_UTC = Number(process.env.DARWIN_RETENTION_MIN_UTC ?? "15");

let lastRunDay = null;

async function runCleanup() {
  const { data, error } = await db.rpc("darwin_retention_cleanup", {
    p_events_keep_days: EVENTS_KEEP_DAYS,
    p_msgs_keep_days: MSGS_KEEP_DAYS,
    p_calls_keep_days: CALLS_KEEP_DAYS,
    p_batch: BATCH,
  });

  if (error) {
    console.error("[retention] rpc error", error.message);
    return;
  }

  console.log("[retention] ok", data);
}

function shouldRunNow() {
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC

  if (lastRunDay === dayKey) return false;

  const h = now.getUTCHours();
  const m = now.getUTCMinutes();

  // run once after target time
  if (h > TARGET_HOUR_UTC) return true;
  if (h === TARGET_HOUR_UTC && m >= TARGET_MIN_UTC) return true;

  return false;
}

async function loop() {
  try {
    if (shouldRunNow()) {
      lastRunDay = new Date().toISOString().slice(0, 10);
      await runCleanup();
    }
  } catch (e) {
    console.error("[retention] loop error", e);
  } finally {
    setTimeout(loop, 60_000); // check every minute
  }
}

console.log("[retention] started", {
  EVENTS_KEEP_DAYS,
  MSGS_KEEP_DAYS,
  CALLS_KEEP_DAYS,
  BATCH,
  TARGET_HOUR_UTC,
  TARGET_MIN_UTC,
});

loop();
