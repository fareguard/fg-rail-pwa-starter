// app/api/ingest/google/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getFreshAccessToken } from "@/lib/google";
import { isTrainEmail } from "@/lib/trainEmailFilter";
import { getSessionFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const CONCURRENCY = 5;

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

function b64ToUtf8(b64: string) {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64").toString("utf-8");
}

function decodePart(part: any): string {
  if (!part?.body?.data) return "";
  return b64ToUtf8(String(part.body.data));
}

function extractBody(payload: any): string {
  if (!payload) return "";

  const mime = payload.mimeType || "";

  if (mime.startsWith("text/plain")) return decodePart(payload);

  if (mime.startsWith("text/html")) {
    const html = decodePart(payload);
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  let plain = "";
  let html = "";

  for (const p of payload.parts || []) {
    const t = extractBody(p);
    if (!t) continue;
    if ((p.mimeType || "").startsWith("text/plain") && !plain) plain = t;
    if ((p.mimeType || "").startsWith("text/html") && !html) html = t;
  }

  return plain || html || "";
}

function headerValue(payload: any, name: string): string | undefined {
  const h = (payload?.headers || []).find(
    (x: any) => String(x.name).toLowerCase() === name.toLowerCase()
  );
  return h?.value;
}

function safeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normaliseOperatorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const lower = s.toLowerCase();

  if (lower.startsWith("west midlands")) return "West Midlands Railway";
  if (lower === "crosscountry trains" || lower === "cross country trains") return "CrossCountry";
  if (lower === "northern rail" || lower === "northern railway" || lower === "northern trains")
    return "Northern";

  return s;
}

async function fetchGmailJson(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
  };
}

async function redactRawEmail(
  supa: any,
  {
    user_email,
    message_id,
    redaction_reason,
    is_train,
  }: {
    user_email: string;
    message_id: string;
    redaction_reason: string;
    is_train: boolean;
  }
) {
  const nowIso = new Date().toISOString();

  return await supa
    .from("raw_emails")
    .update({
      subject: null,
      sender: null,
      snippet: null,
      body_plain: null,
      parsed_at: nowIso,
      redacted_at: nowIso,
      redaction_reason,
      is_train,
    })
    .eq("provider", "gmail")
    .eq("user_email", user_email)
    .eq("message_id", message_id);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const user_email = session?.email;

    if (!user_email) {
      return noStoreJson({ ok: false, error: "Not authenticated" }, 401);
    }

    const supa = getSupabaseAdmin();
    const accessToken = await getFreshAccessToken(user_email);
    const OPENAI_ENABLED = !!process.env.OPENAI_API_KEY?.trim();

    const SEARCH_QUERY =
      'in:anywhere ("ticket" OR "eticket" OR "e-ticket" OR "booking" OR "journey" OR "rail" OR "train") newer_than:2y';

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", SEARCH_QUERY);
    listUrl.searchParams.set("maxResults", "50");

    const listRes = await fetchGmailJson(listUrl.toString(), accessToken);

    if (!listRes.ok) {
      return noStoreJson({
        ok: false,
        step: "gmail_list_failed",
        status: listRes.status,
        detail: listRes.data,
      });
    }

    const messageIds: string[] = Array.isArray(listRes.data?.messages)
      ? listRes.data.messages.map((m: any) => m?.id).filter(Boolean)
      : [];

    let savedRaw = 0;
    let savedTrips = 0;
    const tripErrors: { email_id: string; message: string }[] = [];

    for (const id of messageIds) {
      const { data: existing } = await supa
        .from("raw_emails")
        .select("message_id")
        .eq("provider", "gmail")
        .eq("user_email", user_email)
        .eq("message_id", id)
        .maybeSingle();

      if (existing) continue;

      const msgRes = await fetchGmailJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        accessToken
      );

      if (!msgRes.ok) {
        await supa.from("raw_emails").upsert(
          {
            provider: "gmail",
            user_email,
            message_id: id,
            subject: null,
            sender: null,
            snippet: null,
            body_plain: null,
            is_train: false,
            parsed_at: new Date().toISOString(),
            redacted_at: new Date().toISOString(),
            redaction_reason: `gmail_fetch_failed_${msgRes.status}`,
          },
          { onConflict: "provider,user_email,message_id" } as any
        );
        savedRaw++;
        continue;
      }

      const fullMsg = msgRes.data;
      const subject = headerValue(fullMsg?.payload, "Subject") || "";
      const from = headerValue(fullMsg?.payload, "From") || "";
      const body = extractBody(fullMsg?.payload);
      const snippet = fullMsg?.snippet || "";

      const trainOk = isTrainEmail({ from, subject, body });

      if (!trainOk) {
        await supa.from("raw_emails").upsert(
          {
            provider: "gmail",
            user_email,
            message_id: id,
            subject: null,
            sender: null,
            snippet: null,
            body_plain: null,
            is_train: false,
            parsed_at: new Date().toISOString(),
            redacted_at: new Date().toISOString(),
            redaction_reason: "non_train_filtered",
          },
          { onConflict: "provider,user_email,message_id" } as any
        );
        savedRaw++;
        continue;
      }

      await supa.from("raw_emails").upsert(
        {
          provider: "gmail",
          user_email,
          message_id: id,
          subject: subject || null,
          sender: from || null,
          snippet: snippet || null,
          body_plain: OPENAI_ENABLED ? body || null : null,
          is_train: true,
          redacted_at: null,
          redaction_reason: null,
        },
        { onConflict: "provider,user_email,message_id" } as any
      );
      savedRaw++;

      if (!OPENAI_ENABLED) {
        await redactRawEmail(supa, {
          user_email,
          message_id: id,
          redaction_reason: "openai_disabled_no_parse",
          is_train: true,
        });
        continue;
      }

      try {
        const { ingestEmail } = await import("@/lib/ingestEmail");

        const parsed = await ingestEmail({
          id,
          from,
          subject,
          body_plain: body,
          snippet,
        });

        if (!parsed?.is_ticket) {
          await redactRawEmail(supa, {
            user_email,
            message_id: id,
            redaction_reason: "train_filter_not_ticket",
            is_train: true,
          });
          continue;
        }

        await supa.from("trips").insert({
          user_email,
          email_id: id,
          operator: normaliseOperatorName(parsed.operator),
          booking_ref: parsed.booking_ref || null,
          origin: parsed.origin || null,
          destination: parsed.destination || null,
          depart_planned: safeTimestamp(parsed.depart_planned),
          arrive_planned: safeTimestamp(parsed.arrive_planned),
          is_ticket: true,
          pnr_json: parsed,
          source: "gmail",
        });

        savedTrips++;

        await redactRawEmail(supa, {
          user_email,
          message_id: id,
          redaction_reason: "ticket_parsed_redact",
          is_train: true,
        });
      } catch (err: any) {
        tripErrors.push({ email_id: id, message: err?.message || String(err) });

        await redactRawEmail(supa, {
          user_email,
          message_id: id,
          redaction_reason: "llm_parse_or_insert_failed",
          is_train: true,
        });
      }
    }

    return noStoreJson({
      ok: true,
      scanned: messageIds.length,
      saved_raw: savedRaw,
      saved_trips: savedTrips,
      user_email,
      trip_errors: tripErrors,
    });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message || String(e) }, 500);
  }
}

export const POST = GET;