// workers/email-sender.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM; // e.g. "FareGuard <noreply@yourdomain.com>"

const MAX_BATCH = Number(process.env.EMAIL_SENDER_MAX_BATCH ?? "50");
const LOOP_SLEEP_MS = Number(process.env.EMAIL_SENDER_LOOP_SLEEP_MS ?? "1500");
const LOCK_KEY = Number(process.env.EMAIL_SENDER_LOCK_KEY ?? "92345678");
const WORKER_ID = process.env.RAILWAY_SERVICE_NAME || `email-sender-${process.pid}`;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase env");
if (!RESEND_API_KEY || !RESEND_FROM) throw new Error("Missing Resend env (RESEND_API_KEY, RESEND_FROM)");

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }});
const resend = new Resend(RESEND_API_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryLock() {
  const { data, error } = await db.rpc("darwin_try_lock"); // you already created this; reuse pattern
  // If you want a separate lock function for email worker, create email_try_lock(lock_key). For now we’ll do SQL below.
  if (error) throw error;
  return !!data;
}

// Better: dedicated lock for email worker (recommended). Use this if you create it.
async function tryEmailLock() {
  const { data, error } = await db.rpc("email_try_lock", { p_key: LOCK_KEY });
  if (error) throw error;
  return !!data;
}

async function unlockEmailLock() {
  await db.rpc("email_unlock", { p_key: LOCK_KEY }).catch(() => {});
}

function backoffSeconds(attempt) {
  // 1m, 2m, 4m, 8m, 15m, 30m, 60m (cap)
  const mins = Math.min(60, Math.pow(2, Math.min(6, attempt)));
  return mins * 60;
}

async function logEvent(outbox_id, event, detail) {
  await db.from("notifications_log").insert({ outbox_id, event, detail }).catch(() => {});
}

async function fetchDueJobs() {
  // We take a simple approach: select due queued/failed jobs.
  // We’ll “lock” them by updating to 'sending' and setting locked_at/locked_by.
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("email_outbox")
    .select("*")
    .in("status", ["queued", "failed"])
    .lte("next_attempt_at", now)
    .order("next_attempt_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) throw error;
  return data || [];
}

async function claimJob(id) {
  // Move to sending if still eligible
  const { data, error } = await db
    .from("email_outbox")
    .update({
      status: "sending",
      locked_at: new Date().toISOString(),
      locked_by: WORKER_ID,
    })
    .eq("id", id)
    .in("status", ["queued", "failed"])
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data; // null if already taken or changed
}

async function markSent(job, provider_message_id) {
  await db.from("email_outbox").update({
    status: "sent",
    provider_message_id,
    last_error: null,
    locked_at: null,
    locked_by: null,
  }).eq("id", job.id);

  await db.from("claims").update({
    status: "emailed",
    emailed_at: new Date().toISOString(),
  }).eq("id", job.claim_id);

  await logEvent(job.id, "sent", { provider_message_id });
}

async function markFailed(job, errMsg) {
  const attempt = (job.attempt_count || 0) + 1;
  const delaySec = backoffSeconds(attempt);
  const next = new Date(Date.now() + delaySec * 1000).toISOString();

  const dead = attempt >= 7; // after ~1-2 hours worth of retries

  await db.from("email_outbox").update({
    status: dead ? "dead" : "failed",
    attempt_count: attempt,
    next_attempt_at: dead ? null : next,
    last_error: errMsg?.slice(0, 1000) ?? "unknown_error",
    locked_at: null,
    locked_by: null,
  }).eq("id", job.id);

  await logEvent(job.id, dead ? "dead" : "failed", {
    attempt,
    next_attempt_at: dead ? null : next,
    error: errMsg?.slice(0, 1000),
  });
}

function buildEmail(job) {
  // Keep this aligned with how your earlier resend code was structured.
  // Payload contains trip_id, delay_minutes, crs, rid, ssd.
  const p = job.payload || {};
  const delay = p.delay_minutes ?? null;

  const subject = job.subject || "Your delay claim is ready";

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.4;">
      <h2>Claim ready</h2>
      <p>Your journey looks eligible.</p>
      <ul>
        <li><b>Delay (mins):</b> ${delay ?? "unknown"}</li>
        <li><b>RID:</b> ${p.rid ?? "unknown"}</li>
        <li><b>Date:</b> ${p.ssd ?? "unknown"}</li>
        <li><b>Station matched:</b> ${p.crs ?? "unknown"}</li>
      </ul>
      <p>Open FareGuard to continue.</p>
    </div>
  `;

  return { subject, html };
}

async function sendOne(job) {
  await logEvent(job.id, "sending", { to: job.to_email, template: job.template });

  const { subject, html } = buildEmail(job);

  const res = await resend.emails.send({
    from: RESEND_FROM,
    to: job.to_email,
    subject,
    html,
  });

  // Resend returns { id: "..."} on success
  const providerId = res?.data?.id || res?.id || null;
  if (!providerId) throw new Error("Resend returned no message id");

  await markSent(job, providerId);
}

async function main() {
  console.log("[email-sender] boot", { WORKER_ID, MAX_BATCH, LOOP_SLEEP_MS });

  // Recommended: create these lock RPCs (SQL below). If not, remove lock and rely on row-claim updates.
  while (true) {
    try {
      // If you created email_try_lock/email_unlock, use it.
      // If not, comment these 2 lines out. Row-claiming still prevents double-sends in practice.
      const locked = await tryEmailLock().catch(() => false);
      if (!locked) {
        await sleep(LOOP_SLEEP_MS);
        continue;
      }

      const due = await fetchDueJobs();
      if (!due.length) {
        await unlockEmailLock().catch(() => {});
        await sleep(LOOP_SLEEP_MS);
        continue;
      }

      for (const j of due) {
        const job = await claimJob(j.id);
        if (!job) continue;

        try {
          await sendOne(job);
        } catch (e) {
          await markFailed(job, e?.message || String(e));
        }
      }

      await unlockEmailLock().catch(() => {});
    } catch (e) {
      console.error("[email-sender] tick error:", e?.message || e);
      await unlockEmailLock().catch(() => {});
    }

    await sleep(LOOP_SLEEP_MS);
  }
}

main().catch((e) => {
  console.error("[email-sender] crashed:", e?.message || e);
  process.exit(1);
});
