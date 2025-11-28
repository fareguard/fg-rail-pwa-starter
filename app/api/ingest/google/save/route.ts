// app/api/ingest/google/save/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getFreshAccessToken } from "@/lib/google";

import { isTrainEmail } from "@/lib/trainEmailFilter";
import { ingestEmail } from "@/lib/ingestEmail";
import { getSessionFromRequest } from "@/lib/session";

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

/**
 * Normalise operator names so the UI doesn’t get a bunch of
 * slightly different labels for the same thing.
 */
function normaliseOperatorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const lower = s.toLowerCase();

  // West Midlands
  if (lower.startsWith("west midlands")) {
    return "West Midlands Railway";
  }

  // CrossCountry brands
  if (lower === "crosscountry trains" || lower === "cross country trains") {
    return "CrossCountry";
  }

  // Northern variants
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
    const supa = getSupabaseAdmin();

    // 0) Get SESSION email – this is the logged-in user
    const session = await getSessionFromRequest(req);
    const sessionEmail = session?.email;

    if (!sessionEmail) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated; no session email" },
        { status: 401 }
      );
    }

    // 1) Find this user's Google OAuth tokens
    const { data: oauthRows, error: oErr } = await supa
      .from("oauth_staging")
      .select("*")
      .eq("provider", "google")
      .eq("user_email", sessionEmail)
      .order("created_at", { ascending: false })
      .limit(1);

    if (oErr) throw oErr;
    if (!oauthRows?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "No Gmail connection found for this user",
        },
        { status: 400 }
      );
    }

    const { user_email, user_id: userId } = oauthRows[0] as any;
    // NOTE: user_email should be the same as sessionEmail,
    // but we keep it in case the DB row has a canonical casing.
    const accessToken = await getFreshAccessToken(user_email);

    // 2) Gmail search query – restricted to this user's mailbox via access token
    const SEARCH_QUERY =
      'in:anywhere ("ticket" OR "eticket" OR "e-ticket" OR "booking" OR "journey" OR "rail" OR "train") newer_than:2y';

    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    );
    url.searchParams.set("q", SEARCH_QUERY);
    url.searchParams.set("maxResults", "50");

    // Optional pageToken passed in as query param
    const reqUrl = new URL(req.url);
    const requestPageToken = reqUrl.searchParams.get("pageToken");
    if (requestPageToken) {
      url.searchParams.set("pageToken", requestPageToken);
    }

    const list = await fetch(url.toString(), {
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

    // 3) Hydrate, store raw, parse trips (with batched concurrency)
    let savedRaw = 0;
    let savedTrips = 0;
    const tripErrors: { email_id: string; message: string }[] = [];

    // Chunk message IDs so we only have CONCURRENCY in flight at once
    const chunks: string[][] = [];
    for (let i = 0; i < messageIds.length; i += CONCURRENCY) {
      chunks.push(messageIds.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (id) => {
          // Skip messages we've already fully parsed for THIS user
          const { data: existing } = await supa
            .from("debug_llm_outputs")
            .select("id")
            .eq("email_id", id)
            .eq("from_addr", user_email)
            .limit(1)
            .maybeSingle();

          if (existing) {
            return;
          }

          // Fetch full Gmail message
          const fullMsg = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ).then((x) => x.json());

          const subject = headerValue(fullMsg.payload, "Subject") || "";
          const from = headerValue(fullMsg.payload, "From") || "";
          const body = extractBody(fullMsg.payload);
          const snippet = fullMsg.snippet || "";

          // ---- Save raw email (idempotent upsert) ----
          const { error: rawErr } = await supa.from("raw_emails").upsert(
            {
              provider: "google",
              user_email,
              message_id: id,
              subject,
              sender: from,
              snippet,
              body_plain: body || null,
            },
            { onConflict: "provider,message_id" } as any
          );

          if (!rawErr) savedRaw++;

          // ---- Filter non-train emails BEFORE parsing ----
          if (!isTrainEmail({ from, subject, body })) {
            return;
          }

          // ---- Call ingestEmail (LLM parser + gating) ----
          const parsed: any = await ingestEmail({
            id,
            from,
            subject,
            body_plain: body,
            snippet,
          });

          // ---- Log into debug_llm_outputs for inspection ----
          try {
            await supa.from("debug_llm_outputs").insert({
              email_id: id,
              from_addr: from,
              subject,
              raw_input: body || snippet || "",
              raw_output: JSON.stringify(parsed),
            });
          } catch {
            // swallow debug errors
          }

          // If ingestEmail says "not a usable ticket", skip
          if (!parsed?.is_ticket) {
            return;
          }

          // ------------------------------- 
          // Normalised fields for insert
          // -------------------------------
          const operatorRaw =
            parsed.operator ?? parsed.provider ?? null;
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

          // De-duplication for THIS user: same booking_ref + route
          let existingTrip:
            | { id: string; depart_planned: string | null }
            | null = null;

          if (parsed.booking_ref && parsed.origin && parsed.destination) {
            const { data: existingRows, error: existingErr } = await supa
              .from("trips")
              .select("id, depart_planned")
              .eq("user_email", user_email)
              .eq("booking_ref", parsed.booking_ref)
              .eq("origin", parsed.origin)
              .eq("destination", parsed.destination)
              .limit(1);

            if (!existingErr && existingRows && existingRows.length) {
              existingTrip = existingRows[0] as any;
            }
          }

          // If we already have a trip, keep the earliest depart_planned
          let finalDepart = departIso;
          if (existingTrip?.depart_planned && finalDepart) {
            const existingDate = new Date(existingTrip.depart_planned);
            const newDate = new Date(finalDepart);
            if (existingDate <= newDate) {
              finalDepart = existingTrip.depart_planned;
            }
          }

          const baseRecord = {
            user_id: userId ?? null,
            user_email,  // <= this is the Gmail address tied to this session
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
    console.error("Ingest error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export const POST = GET;
