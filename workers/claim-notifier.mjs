// workers/claim-notifier.mjs
// Production-safe notifier worker for FareGuard v1
// - Pulls queued notifications (claims_pop_notify)
// - Fetches CTA + operator URL (claim_get_cta)
// - Sends email via Resend
// - Marks claim notify_status=sent or failed with backoff
//
// Requires env:
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// RESEND_API_KEY
// EMAIL_FROM  (e.g. "FareGuard <notify@fareguard.co.uk>")
// EMAIL_REPLY_TO (optional)
// APP_PUBLIC_URL (optional) e.g. https://fareguard.co.uk
// NOTIFY_BATCH (optional, default 5)
// NOTIFY_SLEEP_MS (optional, default 15000)

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendKey = process.env.RESEND_API_KEY;

const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || null;
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || "";

const NOTIFY_BATCH = Number(process.env.NOTIFY_BATCH || 5);
const SLEEP_MS = Number(process.env.NOTIFY_SLEEP_MS || 15000);

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!resendKey) {
  console.error("Missing RESEND_API_KEY");
  process.exit(1);
}
if (!EMAIL_FROM) {
  console.error("Missing EMAIL_FROM");
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const resend = new Resend(resendKey);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function minutesToMs(mins) {
  return mins * 60 * 1000;
}

// Gentle exponential-ish backoff with cap: 2, 5, 10, 20, 40, 60 mins...
function notifyBackoffMinutes(attempts) {
  const seq = [2, 5, 10, 20, 40, 60];
  return seq[Math.min(seq.length - 1, Math.max(0, attempts - 1))];
}

function formatOperator(op) {
  return op || "your train operator";
}

function safeUrl(u) {
  try {
    if (!u) return null;
    // allow https only
    const x = new URL(u);
    if (x.protocol !== "https:") return null;
    return x.toString();
  } catch {
    return null;
  }
}

function buildEmailHtml({ operator, claimUrl, dashboardUrl }) {
  const op = formatOperator(operator);

  const btnStyle =
    "display:inline-block;padding:12px 18px;border-radius:10px;text-decoration:none;" +
    "background:#111827;color:#ffffff;font-weight:700;";

  const boxStyle =
    "border:1px solid #e5e7eb;border-radius:14px;padding:16px;background:#ffffff;";

  return `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:600px;margin:0 auto;line-height:1.45;color:#111827;">
    <h2 style="margin:0 0 12px 0;">Your Delay Repay claim is ready</h2>

    <div style="${boxStyle}">
      <p style="margin:0 0 10px 0;">
        We’ve checked your journey and it looks eligible to claim Delay Repay from <strong>${op}</strong>.
      </p>

      <p style="margin:0 0 14px 0;">
        Use the button below to open the official claim page:
      </p>

      <p style="margin:0 0 16px 0;">
        <a href="${claimUrl}" style="${btnStyle}" target="_blank" rel="noopener noreferrer">
          Claim on ${op}
        </a>
      </p>

      ${
        dashboardUrl
          ? `<p style="margin:0;color:#374151;font-size:14px;">
               Want to track this in FareGuard? <a href="${dashboardUrl}" target="_blank" rel="noopener noreferrer">Open your dashboard</a>.
             </p>`
          : ""
      }
    </div>

    <p style="margin:16px 0 0 0;color:#6b7280;font-size:12px;">
      You’re being sent to the operator’s official Delay Repay site. FareGuard doesn’t submit this claim automatically in v1.
    </p>
  </div>
  `;
}

async function popNotifyIds(limit) {
  const { data, error } = await db.rpc("claims_pop_notify", { p_limit: limit });
  if (error) throw error;
  return (data || []).map((r) => r.claim_id);
}

async function getCta(claimId) {
  const { data, error } = await db.rpc("claim_get_cta", { p_claim_id: claimId });
  if (error) throw error;
  // claim_get_cta returns TABLE, so supabase returns an array
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

async function markSent(claimId, providerId, messageId) {
  const patch = {
    notify_status: "sent",
    notified_at: new Date().toISOString(),
    notify_last_error: null,
    notify_attempts: 0, // reset attempts after success
    updated_at: new Date().toISOString(),
  };

  // optional columns (only if you added them)
  if (providerId) patch.notify_provider_id = providerId;
  if (messageId) patch.notify_message_id = messageId;

  const { error } = await db.from("claims").update(patch).eq("id", claimId);
  if (error) throw error;
}

async function markFailed(claimId, errMsg) {
  // Fetch current attempts
  const { data: cur, error: e1 } = await db
    .from("claims")
    .select("notify_attempts")
    .eq("id", claimId)
    .maybeSingle();
  if (e1) throw e1;

  const attempts = Number(cur?.notify_attempts || 0) + 1;
  const backoffMins = notifyBackoffMinutes(attempts);

  const { error } = await db
    .from("claims")
    .update({
      notify_status: "failed",
      notify_attempts: attempts,
      notify_last_error: String(errMsg || "notify_failed").slice(0, 500),
      notify_queued_at: new Date(Date.now() + minutesToMs(backoffMins)).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", claimId);

  if (error) throw error;
}

async function suppress(claimId, reason) {
  const { error } = await db
    .from("claims")
    .update({
      notify_status: "suppressed",
      notify_last_error: String(reason || "suppressed").slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", claimId);
  if (error) throw error;
}

async function sendOne(claimId) {
  const cta = await getCta(claimId);

  if (!cta) {
    await suppress(claimId, "cta_missing");
    return { claimId, ok: false, suppressed: true, reason: "cta_missing" };
  }

  const to = (cta.user_email || "").trim();
  if (!to) {
    await suppress(claimId, "missing_user_email");
    return { claimId, ok: false, suppressed: true, reason: "missing_user_email" };
  }

  const claimUrl = safeUrl(cta.claim_url);
  if (!claimUrl) {
    await suppress(claimId, "missing_or_invalid_claim_url");
    return { claimId, ok: false, suppressed: true, reason: "missing_or_invalid_claim_url" };
  }

  const operator = cta.operator || "";
  const dashboardUrl = APP_PUBLIC_URL
    ? safeUrl(`${APP_PUBLIC_URL.replace(/\/+$/, "")}/dashboard`)
    : null;

  const subject = `Your Delay Repay claim is ready (${formatOperator(operator)})`;
  const html = buildEmailHtml({ operator, claimUrl, dashboardUrl });

  const emailPayload = {
    from: EMAIL_FROM,
    to,
    subject,
    html,
    ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}),
  };

  const res = await resend.emails.send(emailPayload);

  if (res?.error) {
    throw new Error(res.error.message || "resend_error");
  }

  // Resend returns id like { id: '...' }
  await markSent(claimId, "resend", res?.data?.id || null);

  return { claimId, ok: true, messageId: res?.data?.id || null };
}

async function tickOnce() {
  const ids = await popNotifyIds(NOTIFY_BATCH);

  if (!ids.length) {
    console.log(JSON.stringify({ ok: true, processed: 0, source: "notify.none" }));
    return;
  }

  let okCount = 0;
  let failCount = 0;
  let suppressedCount = 0;

  for (const claimId of ids) {
    try {
      const out = await sendOne(claimId);
      if (out.ok) okCount += 1;
      else if (out.suppressed) suppressedCount += 1;
      else failCount += 1;
    } catch (e) {
      failCount += 1;
      await markFailed(claimId, e?.message || String(e));
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      processed: ids.length,
      sent: okCount,
      failed: failCount,
      suppressed: suppressedCount,
      source: "notify.batch",
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
          worker: "claim-notifier",
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
