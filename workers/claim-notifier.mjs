// workers/claim-notifier.mjs
// Queue-based notifier for FareGuard V1 (email CTA to Delay Repay).
// - Normal mode: pops due claims via public.claims_pop_notify(), sends via Resend, updates claims notify_* fields.
// - Test mode: if NOTIFY_TEST_CLAIM_ID is set, sends ONE email for that claim_id and exits (NO DB writes).
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY
//   EMAIL_FROM                 e.g. 'FareGuard <hello@notify.fareguard.co.uk>'
// Optional:
//   EMAIL_REPLY_TO             e.g. 'support@fareguard.co.uk'
//   APP_PUBLIC_URL             e.g. 'https://fareguard.co.uk' (used for dashboard link)
//   NOTIFY_SLEEP_MS            default 15000
//   NOTIFY_BATCH               default 1
//   NOTIFY_TEST_CLAIM_ID       uuid - send once + exit (no DB writes)
//   NOTIFY_TEST_TO_EMAIL       overrides recipient in test mode

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const resendKey = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || null;
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || "";
const SLEEP_MS = parseInt(process.env.NOTIFY_SLEEP_MS || "15000", 10);
const BATCH = parseInt(process.env.NOTIFY_BATCH || "1", 10);

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
must(EMAIL_FROM, "EMAIL_FROM");

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
 * Existing worker helpers
 */
function safeText(x, fallback = "") {
  if (x === null || x === undefined) return fallback;
  return String(x);
}

async function rpcClaimsPopNotify(limit) {
  const { data, error } = await db.rpc("claims_pop_notify", { p_limit: limit });
  if (error) throw error;
  // returns [{ claim_id: uuid }, ...]
  return (data || []).map((r) => r.claim_id);
}

async function rpcClaimGetCta(claimId) {
  const { data, error } = await db.rpc("claim_get_cta", { p_claim_id: claimId });
  if (error) throw error;
  // returns array with one row or empty
  return data?.[0] || null;
}

async function getClaimRow(claimId) {
  const { data, error } = await db
    .from("claims")
    .select(
      "id, trip_id, user_email, status, meta, operator, origin, destination, depart_planned, arrive_planned, notify_status, notify_attempts"
    )
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function patchClaim(claimId, patch) {
  const { error } = await db.from("claims").update(patch).eq("id", claimId);
  if (error) throw error;
}

async function sendEmail({ to, subject, html }) {
  const payload = {
    from: EMAIL_FROM,
    to,
    subject,
    html,
  };
  if (EMAIL_REPLY_TO) payload.reply_to = EMAIL_REPLY_TO;

  const resp = await resend.emails.send(payload);
  return resp;
}

/**
 * Step 1B/1C — Production-ish notifier state updates + wiring buildClaimReadyEmail
 */
async function processOneClaim(claimId, { testMode = false } = {}) {
  const claim = await getClaimRow(claimId);

  if (!claim) {
    if (!testMode) {
      await patchClaim(claimId, {
        notify_status: "failed",
        notify_attempts: 999,
        notify_last_error: "claim_row_missing",
        updated_at: new Date().toISOString(),
      });
    }
    return { ok: false, error: "claim_row_missing" };
  }

  // C) Bulletproof guard: only email if claim is actually ready.
  if (claim.status !== "ready") {
    // don’t send, put it back
    if (!testMode) {
      await patchClaim(claimId, {
        notify_status: "failed",
        notify_last_error: "claim_not_ready",
        notify_queued_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    return { ok: false, error: "claim_not_ready" };
  }

  // Only email if we can address it.
  const toEmail = testMode && TEST_TO_EMAIL ? TEST_TO_EMAIL : claim.user_email;

  if (!toEmail) {
    if (!testMode) {
      await patchClaim(claimId, {
        notify_status: "suppressed",
        notify_last_error: "missing_user_email",
        updated_at: new Date().toISOString(),
      });
    }
    return { ok: false, error: "missing_user_email" };
  }

  // Get CTA row
  const cta = await rpcClaimGetCta(claimId);

  // Build email params (Step 1C)
  const email = buildClaimReadyEmail({
    appUrl: APP_PUBLIC_URL,
    claimId: cta?.claim_id || claim.id,
    operator: cta?.operator,
    claimUrl: cta?.claim_url,
    origin: claim?.meta?.origin || claim.origin,
    destination: claim?.meta?.destination || claim.destination,
    departPlanned: claim?.meta?.depart_planned || claim.depart_planned,
    arrivePlanned: claim?.meta?.arrive_planned || claim.arrive_planned,
  });

  // Send via Resend
  let res;
  try {
    res = await sendEmail({
      to: toEmail,
      subject: email.subject,
      html: email.html,
    });
  } catch (e) {
    // Hard exception (network, etc.)
    const errMsg = e?.message || String(e);

    if (!testMode) {
      const attempts = (claim.notify_attempts ?? 0) + 1;
      const backoffMin = Math.min(60, Math.max(2, attempts + 1));
      const backoffMs = backoffMin * 60 * 1000;

      await patchClaim(claimId, {
        notify_status: "failed",
        notify_attempts: attempts,
        notify_last_error: errMsg,
        notify_queued_at: new Date(Date.now() + backoffMs).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    return { ok: false, error: errMsg };
  }

  // Resend returns { data: { id }, error } style
  const resendId = res?.data?.id || null;
  const sendErr = res?.error ? res.error.message || JSON.stringify(res.error) : null;

  if (sendErr) {
    if (!testMode) {
      const attempts = (claim.notify_attempts ?? 0) + 1;
      const backoffMin = Math.min(60, Math.max(2, attempts + 1));
      const backoffMs = backoffMin * 60 * 1000;

      await patchClaim(claimId, {
        notify_status: "failed",
        notify_attempts: attempts,
        notify_last_error: sendErr,
        notify_queued_at: new Date(Date.now() + backoffMs).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    return { ok: false, error: sendErr, messageId: resendId };
  }

  // On successful send (Step 1B)
  if (!testMode) {
    await patchClaim(claimId, {
      notify_status: "sent",
      notified_at: new Date().toISOString(),
      notify_provider_id: "resend",
      notify_message_id: resendId,
      notify_last_error: null,
      updated_at: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    messageId: resendId,
    to: toEmail,
    operator: cta?.operator || null,
    claimUrl: cta?.claim_url || null,
  };
}

async function tickOnce() {
  // TEST MODE: send one email and exit (no DB writes)
  if (TEST_CLAIM_ID) {
    const out = await processOneClaim(TEST_CLAIM_ID, { testMode: true });
    console.log(
      JSON.stringify({
        ok: true,
        processed: 1,
        source: "notify.test",
        test_claim_id: TEST_CLAIM_ID,
        result: out,
      })
    );
    process.exit(0);
  }

  const claimIds = await rpcClaimsPopNotify(BATCH);
  if (!claimIds.length) {
    console.log(JSON.stringify({ ok: true, processed: 0, source: "notify.none" }));
    return;
  }

  let processed = 0;
  for (const claimId of claimIds) {
    let out;
    try {
      out = await processOneClaim(claimId, { testMode: false });
    } catch (e) {
      const msg = e?.message || String(e);
      // best-effort mark failed
      try {
        const claim = await getClaimRow(claimId);
        const attempts = (claim?.notify_attempts ?? 0) + 1;
        const backoffMin = Math.min(60, Math.max(2, attempts + 1));
        const backoffMs = backoffMin * 60 * 1000;

        await patchClaim(claimId, {
          notify_status: "failed",
          notify_attempts: attempts,
          notify_last_error: msg,
          notify_queued_at: new Date(Date.now() + backoffMs).toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch {}
      out = { ok: false, error: msg };
    }

    processed += 1;
    console.log(JSON.stringify({ ok: true, processed: 1, source: "notify.send", claim_id: claimId, result: out }));
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
