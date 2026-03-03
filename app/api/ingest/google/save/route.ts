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
  if (lower === "northern rail" || lower === "northern railway" || lower === "northern trains") return "Northern";

  return s;
}

type GmailFetchResult =
  | { ok: true; status: number; data: any }
  | { ok: false; status: number; data: any; message: string };

async function fetchGmailJson(url: string, accessToken: string): Promise<GmailFetchResult> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      message: data?.error?.message || `Gmail API error ${res.status}`,
    };
  }

  return { ok: true, status: res.status, data };
}

// ✅ ALWAYS wipe content, mark parsed+redacted for a specific (provider,user_email,message_id)
async function redactRawEmailFailSafe(
  supa: any,
  {
    user_email,
    message_id,
    provider = "gmail",
    redaction_reason,
    is_train,
  }: {
    user_email: string;
    message_id: string;
    provider?: string;
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
    .eq("provider", provider)
    .eq("user_email", user_email)
    .eq("message_id", message_id);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const user_email = session?.email;

    if (!user_email) {
      return noStoreJson({ ok: false, error: "Not authenticated", scanned: 0, saved_trips: 0 }, 401);
    }

    const supa = getSupabaseAdmin();
    const accessToken = await getFreshAccessToken(user_email);

    const OPENAI_ENABLED = !!process.env.OPENAI_API_KEY?.trim();

    const SEARCH_QUERY =
      'in:anywhere ("ticket" OR "eticket" OR "e-ticket" OR "booking" OR "journey" OR "rail" OR "train") newer_than:2y';

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", SEARCH_QUERY);
    listUrl.searchParams.set("maxResults", "50");

    const reqUrl = new URL(req.url);
    const requestPageToken = reqUrl.searchParams.get("pageToken");
    if (requestPageToken) listUrl.searchParams.set("pageToken", requestPageToken);

    const listRes = await fetchGmailJson(listUrl.toString(), accessToken);
    if (!listRes.ok) {
      return noStoreJson(
        {
          ok: false,
          step: "gmail_list",
          status: listRes.status,
          error: listRes.message,
          detail: listRes.data ?? null,
        },
        502
      );
    }

    const list = listRes.data;

    const messageIds: string[] = Array.isArray(list?.messages)
      ? list.messages.map((m: any) => m?.id).filter((x: any) => typeof x === "string" && x.length > 0)
      : [];

    const scanned = messageIds.length;

    if (!messageIds.length) {
      return noStoreJson({
        ok: true,
        scanned: 0,
        saved_raw: 0,
        saved_trips: 0,
        nextPageToken: list?.nextPageToken ?? null,
        user_email,
        trip_errors: [],
        note: OPENAI_ENABLED ? null : "OPENAI_API_KEY missing; LLM parsing skipped",
      });
    }

    let savedRaw = 0;
    let savedTrips = 0;
    const tripErrors: { email_id: string; message: string }[] = [];

    const chunks: string[][] = [];
    for (let i = 0; i < messageIds.length; i += CONCURRENCY) {
      chunks.push(messageIds.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (id) => {
          // ✅ Dedupe by raw_emails (source of truth), not debug table
          const { data: existingRaw } = await supa
            .from("raw_emails")
            .select("message_id")
            .eq("provider", "gmail")
            .eq("user_email", user_email)
            .eq("message_id", id)
            .limit(1)
            .maybeSingle();

          if (existingRaw) return;

          // ✅ Fetch the actual message (and check res.ok)
          const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
          const msgRes = await fetchGmailJson(msgUrl, accessToken);

          if (!msgRes.ok) {
            // Audit row: no content stored, but we record we tried this message_id.
            const reason = `gmail_fetch_failed_${msgRes.status}`;
            const { error: upsertErr } = await supa.from("raw_emails").upsert(
              {
                provider: "gmail",
                user_email,
                message_id: id, // ✅ ALWAYS use list id
                subject: null,
                sender: null,
                snippet: null,
                body_plain: null,
                is_train: false,
                parsed_at: new Date().toISOString(),
                redacted_at: new Date().toISOString(),
                redaction_reason: reason,
              },
              { onConflict: "provider,user_email,message_id" } as any
            );

            if (!upsertErr) savedRaw++;
            tripErrors.push({ email_id: id, message: `${reason}: ${msgRes.message}` });
            return;
          }

          const fullMsg = msgRes.data;

          const subject = headerValue(fullMsg?.payload, "Subject") || "";
          const from = headerValue(fullMsg?.payload, "From") || "";
          const body = extractBody(fullMsg?.payload);
          const snippet = fullMsg?.snippet || "";

          const trainOk = isTrainEmail({ from, subject, body });

          // Non-train: write minimal + redacted immediately
          if (!trainOk) {
            const { error: rawErr } = await supa.from("raw_emails").upsert(
              {
                provider: "gmail",
                user_email,
                message_id: id, // ✅ ALWAYS id
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

            if (rawErr) {
              tripErrors.push({ email_id: id, message: `raw_emails upsert failed: ${rawErr.message}` });
            } else {
              savedRaw++;
            }
            return;
          }

          // Train: store temporarily (subject/from/snippet; body only if OpenAI enabled)
          const { error: rawErr } = await supa.from("raw_emails").upsert(
            {
              provider: "gmail",
              user_email,
              message_id: id, // ✅ ALWAYS id
              subject: subject || null,
              sender: from || null,
              snippet: snippet || null,
              body_plain: OPENAI_ENABLED