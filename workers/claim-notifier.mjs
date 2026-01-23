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

function safeText(x, fallback = "") {
  if (x === null || x === undefined) return fallback;
  return String(x);
}

function fmtDateTime(isoOrDate) {
  try {
    const d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return safeText(isoOrDate, "");
    return d.toLocaleString("en-GB", { timeZone: "Europe/London" });
  } catch {
    return safeText(isoOrDate, "");
  }
}

function buildEmail({ claim, cta }) {
  const meta = (claim?.meta && typeof claim.meta === "object") ? claim.meta : {};

  const operator = safeText(cta?.operator || claim?.operator || meta.operator, "Unknown operator");
  const claimUrl = safeText(cta?.claim_url, "");

  const origin = safeText(claim?.origin || meta.origin, meta.origin_crs || "");
  const destination = safeText(claim?.destination || meta.destination, meta.destination_crs || "");
  const departPlanned = claim?.depart_planned || meta.depart_planned || "";
  const arrivePlanned = claim?.arrive_planned || meta.arrive_planned || "";
  const delayMinutes = meta.delay_minutes ?? meta.late_arrive_min ?? null;

  const dashboardUrl =
    APP_PUBLIC_URL
      ? `${APP_PUBLIC_URL.replace(/\/$/, "")}/dashboard`
      : "";

  // Subject: keep it simple for V1
  const subject = `Your Delay Repay claim looks ready (${operator})`;

  const title = "Your claim looks ready";
  const journeyLine =
    (origin || destination)
      ? `${origin || "Origin"} → ${destination || "Destination"}`
      : "Your journey";

  const details = [
    departPlanned ? `Planned depart: ${fmtDateTime(departPlanned)}` : null,
    arrivePlanned ? `Planned arrive: ${fmtDateTime(arrivePlanned)}` : null,
    (delayMinutes !== null && delayMinutes !== undefined && delayMinutes !== "")
      ? `Delay (estimated): ${safeText(delayMinutes)} min`
      : null,
  ].filter(Boolean);

  const detailsHtml = details.length
    ? `<ul style="margin:12px 0 0 18px;padding:0;">${details.map((d) => `<li>${d}</li>`).join("")}</ul>`
    : "";

  const ctaHtml = claimUrl
    ? `
      <div style="margin-top:18px;">
        <a href="${claimUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:600;">
          Claim Delay Repay
        </a>
      </div>
      <div style="margin-top:10px;font-size:12px;color:#555;">
        If the button doesn't work, copy/paste: <span style="word-break:break-all;">${claimUrl}</span>
      </div>
    `
    : `
      <div style="margin-top:18px;padding:12px;border:1px solid #f0c;border-radius:10px;background:#fff5fb;">
        We couldn't find the Delay Repay link for <b>${operator}</b> yet.
        Please reply to this email and we’ll add it.
      </div>
    `;

  const dashHtml = dashboardUrl
    ? `<div style="margin-top:18px;font-size:12px;color:#555;">Dashboard: <a href="${dashboardUrl}">${dashboardUrl}</a></div>`
    : "";

  const html = `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:620px;margin:0 auto;padding:18px;">
    <div style="font-size:12px;color:#666;margin-bottom:8px;">FareGuard</div>
    <h2 style="margin:0 0 8px 0;font-size:20px;">${title}</h2>
    <div style="font-size:14px;color:#222;">
      <div style="font-weight:600;">${journeyLine}</div>
      ${detailsHtml}
      ${ctaHtml}
      ${dashHtml}
      <hr style="margin:18px 0;border:none;border-top:1px solid #eee;" />
      <div style="font-size:12px;color:#666;line-height:1.4;">
        This is an automated reminder. You’re always in control — you submit the claim on the operator’s site.
      </div>
    </div>
  </div>`;

  const text = [
    "FareGuard",
    "",
    subject,
    "",
    journeyLine,
    ...details,
    "",
    claimUrl ? `Claim here: ${claimUrl}` : `No claim URL found for operator: ${operator}`,
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : "",
  ].filter(Boolean).join("\n");

  return { subject, html, text };
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
  return (data && data[0]) ? data[0] : null;
}

async function getClaimRow(claimId) {
  const { data, error } = await db
    .from("claims")
    .select("id, trip_id, user_email, status, meta, operator, origin, destination, depart_planned, arrive_planned, notify_status, notify_attempts")
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function patchClaim(claimId, patch) {
  const { error } = await db.from("claims").update(patch).eq("id", claimId);
  if (error) throw error;
}

async function sendEmail({ to, subject, html, text }) {
  const payload = {
    from: EMAIL_FROM,
    to,
    subject,
    html,
    text,
  };
  if (EMAIL_REPLY_TO) payload.reply_to = EMAIL_REPLY_TO;

  const resp = await resend.emails.send(payload);
  return resp;
}

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

  // Only email if we can address it.
  const toEmail = (testMode && TEST_TO_EMAIL)
    ? TEST_TO_EMAIL
    : claim.user_email;

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

  const cta = await rpcClaimGetCta(claimId);

  // If no claim_url, suppress in real mode (don’t spam users with broken CTA).
  const claimUrl = cta?.claim_url || null;
  if (!claimUrl && !testMode) {
    await patchClaim(claimId, {
      notify_status: "suppressed",
      notify_last_error: "missing_claim_url_for_operator",
      updated_at: new Date().toISOString(),
    });
    return { ok: false, error: "missing_claim_url_for_operator", operator: cta?.operator || null };
  }

  const { subject, html, text } = buildEmail({ claim, cta });

  const res = await sendEmail({ to: toEmail, subject, html, text });

  // Resend returns { data: { id }, error } style
  const messageId = res?.data?.id || null;
  const sendErr = res?.error ? (res.error.message || JSON.stringify(res.error)) : null;

  if (sendErr) {
    if (!testMode) {
      const attempts = (claim.notify_attempts ?? 0) + 1;
      const backoffMin = Math.min(60, Math.max(2, attempts + 1));
      await patchClaim(claimId, {
        notify_status: "failed",
        notify_attempts: attempts,
        notify_last_error: sendErr,
        notify_queued_at: new Date(Date.now() + backoffMin * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    return { ok: false, error: sendErr, messageId };
  }

  if (!testMode) {
    await patchClaim(claimId, {
      notify_status: "sent",
      notified_at: new Date().toISOString(),
      notify_last_error: null,
      notify_provider_id: "resend",
      notify_message_id: messageId,
      updated_at: new Date().toISOString(),
    });
  }

  return { ok: true, messageId, to: toEmail, operator: cta?.operator || null, claimUrl: claimUrl || null };
}

async function tickOnce() {
  // TEST MODE: send one email and exit (no DB writes)
  if (TEST_CLAIM_ID) {
    const out = await processOneClaim(TEST_CLAIM_ID, { testMode: true });
    console.log(JSON.stringify({ ok: true, processed: 1, source: "notify.test", test_claim_id: TEST_CLAIM_ID, result: out }));
    process.exit(0);
  }

  const claimIds = await rpcClaimsPopNotify(BATCH);
  if (!claimIds.length) {
    console.log(JSON.stringify({ ok: true, processed: 0, source: "notify.none" }));
    return;
  }

  let processed = 0;
  for (const claimId of claimIds) {
    // Mark as "in-flight" (leased already by pop function); we just attempt send.
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
        await patchClaim(claimId, {
          notify_status: "failed",
          notify_attempts: attempts,
          notify_last_error: msg,
          notify_queued_at: new Date(Date.now() + backoffMin * 60 * 1000).toISOString(),
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
