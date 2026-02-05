// workers/claim-notifier.mjs
// Outbox-based notifier for FareGuard V1 (email CTA to Delay Repay).
// - Normal mode: pops due rows from email_outbox via email_outbox_pop(), sends via Resend,
//   logs to notifications_log, marks outbox sent/failed, updates claims.email_outbox_id/emailed_at/status.
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
const WORKER_ID = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "claim-notifier";
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
 * Operator normalization + Delay Repay URL lookup
 */
function normOp(op) {
  return String(op || "").trim();
}

// optional aliasing for common variations
function canonicalOp(op) {
  const s = normOp(op);
  if (!s) return null;

  const lower = s.toLowerCase();

  // a few useful aliases
  if (lower === "emr") return "East Midlands Railway";
  if (lower === "gwr" || lower.includes("great western")) return "GWR";
  if (lower.includes("west midlands")) return "West Midlands Railway";
  if (lower === "c2c") return "c2c";
  if (lower === "lner") return "LNER";

  return s;
}

// PATCHED getDelayRepayUrl() (drop-in replacement; eq -> ilike exact -> ilike contains)
async function getDelayRepayUrl(operator) {
  const op = (operator || "").trim();
  if (!op) return null;

  // 1) Exact match (fast + deterministic)
  let { data, error } = await db
    .from("delay_repay_rules")
    .select("claim_url")
    .eq("operator", op)
    .maybeSingle();
  if (error) throw error;
  if (data?.claim_url) return data.claim_url;

  // 2) Case-insensitive exact
  ({ data, error } = await db
    .from("delay_repay_rules")
    .select("claim_url")
    .ilike("operator", op)
    .maybeSingle());
  if (error) throw error;
  if (data?.claim_url) return data.claim_url;

  // 3) Fuzzy contains
  const escaped = op.replaceAll("%", "\\%").replaceAll("_", "\\_");
  ({ data, error } = await db
    .from("delay_repay_rules")
    .select("claim_url")
    .ilike("operator", `%${escaped}%`)
    .maybeSingle());
  if (error) throw error;

  return data?.claim_url || null;
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
    ? `Your journey ${origin || ""} → ${destination || ""} looks eligible. Claim on ${operator || "the operator"} site.`
    : `Your journey looks eligible. Open your dashboard for the operator link.`;

  // Remove the "yellow box" branch entirely and always show a clean CTA.
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
      <a href="${escapeHtml(dashboardUrl)}" style="
        display:inline-block;
        text-decoration:none;
        font-weight:700;
        padding:12px 18px;
        border-radius:10px;
        background:#111827;
        color:#ffffff;
        ">
        Open dashboard
      </a>
      <div style="margin-top:10px;color:#6b7280;font-size:12px;">
        We couldn’t match your operator automatically yet — the link will be shown on your dashboard.
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
 * Outbox + logging helpers
 */
async function logOutbox(outboxId, event, detail = {}) {
  const { error } = await db.from("notifications_log").insert({
    outbox_id: outboxId,
    event,
    detail,
  });
  if (error) console.error("notifications_log insert failed", error.message);
}

/**
 * Pop/mark RPC helpers (multi-replica safe)
 */
async function popOutbox(limit) {
  const { data, error } = await db.rpc("email_outbox_pop", { p_limit: limit, p_worker: WORKER_ID });
  if (error) throw error;
  return data || [];
}

async function markSent(id, providerMessageId) {
  const { error } = await db.rpc("email_outbox_mark_sent", {
    p_outbox_id: id,
    p_provider_message_id: providerMessageId || null,
  });
  if (error) throw error;
}

async function markFailed(id, err) {
  const { error } = await db.rpc("email_outbox_mark_failed", {
    p_outbox_id: id,
    p_error: String(err || "unknown_error").slice(0, 2000),
  });
  if (error) throw error;
}

/**
 * Build the email from outbox payload (simple V1)
 * - Always attempt to include operator claim link by looking up delay_repay_rules at send-time
 */
async function buildOutboxEmail(row) {
  const operator = row.payload?.operator || null;

  let claimUrl = row.payload?.claim_url || null;
  if (!claimUrl) {
    claimUrl = await getDelayRepayUrl(operator);
  }

  return buildClaimReadyEmail({
    appUrl: APP_PUBLIC_URL,
    claimId: row.claim_id,
    operator,
    claimUrl,
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

/**
 * FIX 1: Harden claims update (check error + throw)
 */
async function markClaimEmailed(claimId, outboxId) {
  const { error } = await db
    .from("claims")
    .update({
      status: "emailed",
      emailed_at: new Date().toISOString(),
      email_outbox_id: outboxId,
    })
    .eq("id", claimId);

  if (error) throw new Error("claims_update_failed: " + error.message);
}

async function tickOnce() {
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

    const toEmail = TEST_TO_EMAIL ? TEST_TO_EMAIL : row.to_email;
    const email = await buildOutboxEmail(row);

    let res;
    try {
      res = await sendEmail({ to: toEmail, subject: row.subject || email.subject, html: email.html });
    } catch (e) {
      const errMsg = e?.message || String(e);
      console.log(
        JSON.stringify({ ok: true, source: "notify.test", result: { ok: false, error: errMsg, messageId: null } })
      );
      process.exit(0);
    }

    const resendId = res?.data?.id || null;
    const sendErr = res?.error ? res.error.message || JSON.stringify(res.error) : null;

    console.log(
      JSON.stringify({
        ok: true,
        source: "notify.test",
        result: sendErr ? { ok: false, error: sendErr, messageId: resendId } : { ok: true, messageId: resendId },
      })
    );
    process.exit(0);
  }

  const rows = await popOutbox(BATCH);
  if (!rows.length) {
    console.log(JSON.stringify({ ok: true, processed: 0, source: "notify.none" }));
    return;
  }

  let processed = 0;

  for (const o of rows) {
    // keep: worker "sending" log (useful)
    await logOutbox(o.id, "sending", { to: o.to_email, template: o.template, worker: WORKER_ID });

    try {
      const email = await buildOutboxEmail(o);

      const res = await resend.emails.send({
        from: RESEND_FROM,
        to: o.to_email,
        subject: o.subject || email.subject,
        html: email.html,
        ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}),
      });

      const msgId = res?.data?.id || null;
      const sendErr = res?.error?.message || (res?.error ? JSON.stringify(res.error) : null);
      if (sendErr) throw new Error(sendErr);

      // FIX 2: Stop double-logging "sent" (RPC owns "sent" log)
      await markSent(o.id, msgId);

      // keep existing behavior: update claims after send
      if (o.claim_id) {
        await markClaimEmailed(o.claim_id, o.id);
      }

      processed++;
      console.log(
        JSON.stringify({
          ok: true,
          source: "notify.outbox",
          outbox_id: o.id,
          claim_id: o.claim_id,
          result: { ok: true, messageId: msgId },
        })
      );
    } catch (e) {
      const errMsg = e?.message || String(e);

      try {
        await markFailed(o.id, errMsg);
      } catch (markErr) {
        console.error(
          JSON.stringify({
            ok: false,
            source: "notify.mark_failed_error",
            outbox_id: o.id,
            error: markErr?.message || String(markErr),
          })
        );
      }

      // Optional cleanup (per your note): remove noisy extra "failed" log row.
      // email_outbox_mark_failed already logs retry_scheduled/dead.
      // await logOutbox(o.id, "failed", { error: errMsg, worker: WORKER_ID });

      processed++;
      console.log(
        JSON.stringify({
          ok: true,
          source: "notify.outbox",
          outbox_id: o.id,
          claim_id: o.claim_id,
          result: { ok: false, error: errMsg, messageId: null },
        })
      );
    }
  }

  console.log(JSON.stringify({ ok: true, processed, source: "notify.batch" }));
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
