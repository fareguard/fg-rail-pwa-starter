// workers/claim-notifier.mjs
// Outbox-based notifier for FareGuard V1 (email CTA to Delay Repay).
// - Normal mode: locks worker via email_try_lock(), fetches+locks due rows from email_outbox, sends via Resend,
//   logs to notifications_log, updates email_outbox + claims.email_outbox_id/emailed_at/status.
// - Test mode: if NOTIFY_TEST_CLAIM_ID is set, sends ONE email for latest outbox row for that claim_id and exits (NO DB writes).
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY
//   EMAIL_FROM (or RESEND_FROM)  e.g. 'FareGuard <hello@notify.fareguard.co.uk>'
// Optional:
//   EMAIL_REPLY_TO             e.g. 'support@fareguard.co.uk'
//   APP_PUBLIC_URL             e.g. 'https://fareguard.co.uk' (used for dashboard link)
//   NOTIFY_SLEEP_MS            default 5000
//   NOTIFY_BATCH               default 25
//   EMAIL_LOCK_KEY             default 92233721 (stable int for advisory lock)
//   NOTIFY_TEST_CLAIM_ID       uuid - send once + exit (no DB writes)
//   NOTIFY_TEST_TO_EMAIL       overrides recipient in test mode

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const resendKey = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const RESEND_FROM = process.env.RESEND_FROM || process.env.EMAIL_FROM; // support both env names
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || null;
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || "";

// --- constants (after env parsing) ---
const WORKER_ID = process.env.RAILWAY_SERVICE_NAME || process.env.HOSTNAME || "claim-notifier";
const LOCK_KEY = BigInt(process.env.EMAIL_LOCK_KEY || "92233721"); // pick any stable int
const BATCH = parseInt(process.env.NOTIFY_BATCH || "25", 10);
const SLEEP_MS = parseInt(process.env.NOTIFY_SLEEP_MS || "5000", 10);
// -----------------------------------

const TEST_CLAIM_ID = (process.env.NOTIFY_TEST_CLAIM_ID || "").trim();
const TEST_TO_EMAIL = (process.env.NOTIFY_TEST_TO_EMAIL || "").trim();

function must(val, name) {
  if (!val) {
    console.error(JSON.stringify({ ok: false, error: `Missing ${name}` }));
    process.exit(1);
  }
}

must(supabaseUrl, "SUPABASE_URL");
must(serviceKey, "SUPABASE_SERVICE_ROLE_KEY");
must(resendKey, "RESEND_API_KEY");
must(RESEND_FROM, "EMAIL_FROM (or RESEND_FROM)");

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});
const resend = new Resend(resendKey);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Step 1A — New HTML template helpers + buildClaimReadyEmail
 */
function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUK(dt) {
  if (!dt) return null;
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildClaimReadyEmail({
  appUrl,
  claimId,
  operator,
  claimUrl,
  origin,
  destination,
  departPlanned,
  arrivePlanned,
}) {
  const safeOp = escapeHtml(operator || "your operator");
  const safeOrigin = escapeHtml(origin || "Origin");
  const safeDest = escapeHtml(destination || "Destination");
  const dep = formatUK(departPlanned);
  const arr = formatUK(arrivePlanned);

  const dashboardUrl = `${String(appUrl).replace(/\/$/, "")}/dashboard`;

  const title = "Your Delay Repay claim looks ready";
  const preheader = claimUrl
    ? `Your journey ${origin || ""} → ${destination || ""} looks eligible. Claim on ${
        operator || "the operator"
      } site.`
    : `Your journey looks eligible. We’re fetching the Delay Repay link for ${
        operator || "the operator"
      }.`;

  const ctaHtml = claimUrl
    ? `
      <a href="${escapeHtml(claimUrl)}" style="
        display:inline-block;
        text-decoration:none;
        font-weight:700;
        padding:12px 18px;
        border-radius:10px;
        background:#111827;
        color:#ffffff;
        ">
        Claim compensation
      </a>
      <div style="margin-top:10px;color:#6b7280;font-size:12px;">
        You’ll submit on ${safeOp}’s website. FareGuard never asks for your login.
      </div>
    `
    : `
      <div style="
        border:1px solid #f59e0b;
        background:#fffbeb;
        color:#92400e;
        border-radius:10px;
        padding:12px 14px;
        font-size:14px;
        ">
        We’re fetching the Delay Repay link for <strong>${safeOp}</strong>.
        For now, open your dashboard and you’ll see the correct link there shortly.
      </div>
    `;

  return {
    subject: `${title}${operator ? ` (${operator})` : ""}`,
    html: `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(preheader)}
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:92vw;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,0.06);">
            <tr>
              <td style="padding:18px 22px;border-bottom:1px solid #e5e7eb;">
                <div style="font-weight:800;letter-spacing:0.2px;color:#111827;font-size:16px;">
                  FareGuard
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:22px;">
                <h1 style="margin:0 0 8px;color:#111827;font-size:22px;line-height:1.2;">
                  ${escapeHtml(title)}
                </h1>

                <div style="margin:0 0 16px;color:#374151;font-size:14px;">
                  <strong>${safeOrigin}</strong> → <strong>${safeDest}</strong>
                </div>

                <ul style="margin:0 0 18px;padding-left:18px;color:#374151;font-size:14px;line-height:1.5;">
                  ${dep ? `<li>Planned depart: ${escapeHtml(dep)}</li>` : ""}
                  ${arr ? `<li>Planned arrive: ${escapeHtml(arr)}</li>` : ""}
                </ul>

                ${ctaHtml}

                <div style="margin-top:18px;font-size:13px;color:#374151;">
                  Dashboard: <a href="${escapeHtml(dashboardUrl)}" style="color:#2563eb;">${escapeHtml(
      dashboardUrl
    )}</a>
                </div>

                <div style="margin-top:18px;color:#6b7280;font-size:12px;line-height:1.5;">
                  This is an automated notification. You’re always in control — you submit the claim on the operator’s site.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 22px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">
                Claim ID: ${escapeHtml(claimId || "")}
              </td>
            </tr>
          </table>

          <div style="margin-top:12px;color:#9ca3af;font-size:12px;">
            © ${new Date().getFullYear()} FareGuard
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>
    `.trim(),
  };
}

/**
 * Outbox + locking helpers
 */
async function tryWorkerLock() {
  const { data, error } = await db.rpc("email_try_lock", { p_key: Number(LOCK_KEY) });
  if (error) throw error;
  return !!data;
}

async function unlockWorker() {
  const { error } = await db.rpc("email_unlock", { p_key: Number(LOCK_KEY) });
  if (error) console.error("email_unlock failed", error.message);
}

async function logOutbox(outboxId, event, detail = {}) {
  const { error } = await db.from("notifications_log").insert({
    outbox_id: outboxId,
    event,
    detail,
  });
  if (error) console.error("notifications_log insert failed", error.message);
}

async function fetchAndLockOutbox(limit) {
  // 1) pick due rows
  const { data: rows, error } = await db
    .from("email_outbox")
    .select("id, claim_id, trip_id, to_email, subject, template, payload, attempt_count, status")
    .in("status", ["queued", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .is("locked_at", null)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.id);

  // 2) lock them (best-effort; concurrency-safe enough for v1 if single worker)
  const { error: lockErr } = await db
    .from("email_outbox")
    .update({
      locked_at: new Date().toISOString(),
      locked_by: WORKER_ID,
      status: "sending",
    })
    .in("id", ids);

  if (lockErr) throw lockErr;

  // 3) return the locked rows
  return rows.map((r) => ({ ...r, status: "sending" }));
}

/**
 * Build the email from outbox payload (simple V1)
 */
function buildOutboxEmail(row) {
  return buildClaimReadyEmail({
    appUrl: APP_PUBLIC_URL,
    claimId: row.claim_id,
    operator: row.payload?.operator || null,
    claimUrl: row.payload?.claim_url || null,
    origin: row.payload?.origin || null,
    destination: row.payload?.destination || null,
    departPlanned: row.payload?.depart_planned || null,
    arrivePlanned: row.payload?.arrive_planned || null,
  });
}

async function sendEmail({ to, subject, html }) {
  const payload = {
    from: RESEND_FROM,
    to,
    subject,
    html,
  };
  if (EMAIL_REPLY_TO) payload.reply_to = EMAIL_REPLY_TO;

  const resp = await resend.emails.send(payload);
  return resp;
}

async function processOneOutbox(row, { testMode = false } = {}) {
  const toEmail = testMode && TEST_TO_EMAIL ? TEST_TO_EMAIL : row.to_email;
  const email = buildOutboxEmail(row);

  await logOutbox(row.id, "sending", { to: toEmail, template: row.template });

  let res;
  try {
    res = await sendEmail({ to: toEmail, subject: row.subject || email.subject, html: email.html });
  } catch (e) {
    const errMsg = e?.message || String(e);
    return { ok: false, error: errMsg, messageId: null };
  }

  const resendId = res?.data?.id || null;
  const sendErr = res?.error ? (res.error.message || JSON.stringify(res.error)) : null;

  if (sendErr) return { ok: false, error: sendErr, messageId: resendId };

  return { ok: true, messageId: resendId };
}

async function markOutboxSent(outboxId, messageId) {
  await db
    .from("email_outbox")
    .update({
      status: "sent",
      provider_message_id: messageId,
      last_error: null,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", outboxId);

  await logOutbox(outboxId, "sent", { provider_message_id: messageId });
}

async function markOutboxFailed(outboxId, prevAttempts, errMsg) {
  const attempts = (prevAttempts ?? 0) + 1;
  const backoffMin = Math.min(60, Math.max(2, attempts)); // 2m, 3m, ... capped at 60
  const nextAt = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();

  await db
    .from("email_outbox")
    .update({
      status: attempts >= 8 ? "dead" : "failed",
      attempt_count: attempts,
      last_error: errMsg,
      next_attempt_at: nextAt,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", outboxId);

  await logOutbox(outboxId, attempts >= 8 ? "dead" : "retry_scheduled", {
    error: errMsg,
    attempts,
    nextAt,
  });
}

async function markClaimEmailed(claimId, outboxId) {
  await db
    .from("claims")
    .update({
      status: "emailed",
      emailed_at: new Date().toISOString(),
      email_outbox_id: outboxId,
    })
    .eq("id", claimId);
}

async function tickOnce() {
  const gotLock = await tryWorkerLock();
  if (!gotLock) {
    console.log(JSON.stringify({ ok: true, source: "notify.locked_elsewhere" }));
    return;
  }

  try {
    // TEST MODE: send ONE outbox row by claim id (optional) - NO DB writes beyond provider send (and no logs)
    if (TEST_CLAIM_ID) {
      const { data: row, error } = await db
        .from("email_outbox")
        .select("*")
        .eq("claim_id", TEST_CLAIM_ID)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!row) {
        console.log(JSON.stringify({ ok: false, source: "notify.test", error: "no_outbox_for_claim" }));
        return;
      }

      // in test mode: do not write notifications_log / outbox / claims
      const out = await (async () => {
        const toEmail = TEST_TO_EMAIL ? TEST_TO_EMAIL : row.to_email;
        const email = buildOutboxEmail(row);

        let res;
        try {
          res = await sendEmail({ to: toEmail, subject: row.subject || email.subject, html: email.html });
        } catch (e) {
          const errMsg = e?.message || String(e);
          return { ok: false, error: errMsg, messageId: null };
        }

        const resendId = res?.data?.id || null;
        const sendErr = res?.error ? (res.error.message || JSON.stringify(res.error)) : null;
        if (sendErr) return { ok: false, error: sendErr, messageId: resendId };
        return { ok: true, messageId: resendId };
      })();

      console.log(JSON.stringify({ ok: true, source: "notify.test", result: out }));
      process.exit(0);
    }

    const rows = await fetchAndLockOutbox(BATCH);
    if (!rows.length) {
      console.log(JSON.stringify({ ok: true, processed: 0, source: "notify.none" }));
      return;
    }

    let processed = 0;
    for (const row of rows) {
      const out = await processOneOutbox(row);

      if (out.ok) {
        await markOutboxSent(row.id, out.messageId);
        await markClaimEmailed(row.claim_id, row.id);
      } else {
        await markOutboxFailed(row.id, row.attempt_count, out.error);
      }

      processed++;
      console.log(
        JSON.stringify({
          ok: true,
          source: "notify.outbox",
          outbox_id: row.id,
          claim_id: row.claim_id,
          result: out,
        })
      );
    }

    console.log(JSON.stringify({ ok: true, processed, source: "notify.batch" }));
  } finally {
    await unlockWorker();
  }
}

async function main() {
  while (true) {
    await tickOnce();
    await sleep(SLEEP_MS);
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, worker: "claim-notifier", error: e?.message || String(e) }));
  process.exit(1);
});
