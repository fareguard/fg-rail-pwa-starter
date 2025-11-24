// app/api/ingest/google/save/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getFreshAccessTokenForUser } from "@/lib/google";
import { getSession } from "@/lib/session";

import { isTrainEmail } from "@/lib/trainEmailFilter";
import { ingestEmail } from "@/lib/ingestEmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONCURRENCY = 5;

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

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function safeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function normaliseOperatorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const lower = s.toLowerCase();

  if (lower.startsWith("west midlands")) {
    return "West Midlands Railway";
  }
  if (lower === "crosscountry trains" || lower === "cross country trains") {
    return "CrossCountry";
  }
  if (
    lower === "northern rail" ||
    lower === "northern railway" ||
    lower === "northern trains"
  ) {
    return "Northern";
  }

  return s;
}

// ------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const session = getSession();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { user_id: userId, email: user_email } = session;

    const supa = getSupabaseAdmin();

    // Get access token for THIS user
    const { accessToken } = await getFreshAccessTokenForUser(userId);

    // 2) Gmail search query
    const SEARCH_QUERY =
      'in:anywhere ("ticket" OR "eticket" OR "e-ticket" OR "booking" OR "journey" OR "rail" OR "train") newer_than:2y';

    const gmailUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    );
    gmailUrl.searchParams.set("q", SEARCH_QUERY);
    gmailUrl.searchParams.set("maxResults", "50");

    // Optional pageToken passed in as query param
    const reqUrl = new URL(req.url);
    const requestPageToken = reqUrl.searchParams.get("pageToken");
    if (requestPageToken) {
      gmailUrl.searchParams.set("pageToken", requestPageToken);
    }

    const list = await fetch(gmailUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((x) => x.json());

    const messageIds: string[] = Array.isArray(list.messages)
      ? list.messages
          .map((m: any) => m?.id)
          .filter((id: string | undefined) => !!id)
      : [];

    const scanned = messageIds.length;

    if (!messageIds.length) {
      return NextResponse.json({
        ok: true,
        scanned: 0,
        saved_raw: 0,
        saved_trips: 0,
        nextPageToken: list.nextPageToken ?? null,
        user_email,
        trip_errors: [],
      });
    }

    let savedRaw = 0;
    let savedTrips = 0;
    const tripErrors: { email_id: string; message: string }[] = [];

    const chunks: string[][] = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < messageIds.length; i += CONCURRENCY) {
      chunks.push(messageIds.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (id) => {
          const { data: existing } = await supa
            .from("debug_llm_outputs")
            .select("id")
            .eq("email_id", id)
            .limit(1)
            .maybeSingle();

          if (existing) return;

          const fullMsg = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ).then((x) => x.json());

          const subject = headerValue(fullMsg.payload, "Subject") || "";
          const from = headerValue(fullMsg.payload, "From") || "";
          const body = extractBody(fullMsg.payload);
          const snippet = fullMsg.snippet || "";

          const { error: rawErr } = await supa.from("raw_emails").upsert(
            {
              provider: "google",
              user_email,
              user_id: userId,
              message_id: id,
              subject,
              sender: from,
              snippet,
              body_plain: body || null,
            },
            { onConflict: "provider,message_id" } as any
          );

          if (!rawErr) savedRaw++;

          if (!isTrainEmail({ from, subject, body })) {
            return;
          }

          const parsed: any = await ingestEmail({
            id,
            from,
            subject,
            body_plain: body,
            snippet,
          });

          try {
            await supa.from("debug_llm_outputs").insert({
              email_id: id,
              from_addr: from,
              subject,
              raw_input: body || snippet || "",
              raw_output: JSON.stringify(parsed),
            });
          } catch {
            // ignore
          }

          if (!parsed?.is_ticket) return;

          const operatorRaw = parsed.operator ?? parsed.provider ?? null;
          const operator = normaliseOperatorName(operatorRaw);
          const retailer = parsed.retailer ?? parsed.provider ?? null;

          const departStr =
            parsed.depart_planned || parsed.outbound_departure || null;
          const arriveStr = parsed.arrive_planned || null;
          const outboundStr =
            parsed.outbound_departure || parsed.depart_planned || null;

          const departIso = safeTimestamp(departStr);
          const arriveIso = safeTimestamp(arriveStr);
          const outboundIso = safeTimestamp(outboundStr);

          let existingTrip:
            | { id: string; depart_planned: string | null }
            | null = null;

          if (parsed.booking_ref && parsed.origin && parsed.destination) {
            const { data: existingRows, error: existingErr } = await supa
              .from("trips")
              .select("id, depart_planned")
              .eq("user_id", userId)
              .eq("booking_ref", parsed.booking_ref)
              .eq("origin", parsed.origin)
              .eq("destination", parsed.destination)
              .limit(1);

            if (!existingErr && existingRows && existingRows.length) {
              existingTrip = existingRows[0] as any;
            }
          }

          let finalDepart = departIso;
          if (existingTrip?.depart_planned && finalDepart) {
            const existingDate = new Date(existingTrip.depart_planned);
            const newDate = new Date(finalDepart);
            if (existingDate <= newDate) {
              finalDepart = existingTrip.depart_planned;
            }
          }

          const baseRecord = {
            user_id: userId,
            user_email,
            retailer,
            email_id: id,
            operator,
            booking_ref: parsed.booking_ref || null,
            origin: parsed.origin || null,
            destination: parsed.destination || null,
            depart_planned: finalDepart,
            arrive_planned: arriveIso,
            outbound_departure: outboundIso,
            is_ticket: true,
            pnr_json: parsed,
            source: "gmail",
          };

          let tripErr: any = null;

          if (existingTrip) {
            const { error } = await supa
              .from("trips")
              .update(baseRecord)
              .eq("id", existingTrip.id);
            tripErr = error;
          } else {
            const { error } = await supa.from("trips").insert(baseRecord);
            tripErr = error;
          }

          if (tripErr) {
            tripErrors.push({
              email_id: id,
              message: tripErr.message ?? String(tripErr),
            });
          } else {
            savedTrips++;
          }
        })
      );

      for (const r of results) {
        if (r.status === "rejected") {
          console.error("Error processing Gmail message:", r.reason);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      scanned,
      saved_raw: savedRaw,
      saved_trips: savedTrips,
      nextPageToken: list.nextPageToken ?? null,
      user_email,
      trip_errors: tripErrors,
    });
  } catch (e: any) {
    console.error("ingest error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export const POST = GET;
