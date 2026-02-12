// app/api/ingest/google/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getFreshAccessToken } from "@/lib/google";
import { isTrainEmail } from "@/lib/trainEmailFilter";
// ✅ IMPORTANT: DO NOT import ingestEmail at top-level (it may init OpenAI during build)
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
  if (isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

/** Normalise operator names (small UX thing) */
function normaliseOperatorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const lower = s.toLowerCase();

  if (lower.startsWith("west midlands")) return "West Midlands Railway";

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

// Fail-safe redaction helper (ALWAYS wipe content, mark parsed+redacted)
async function redactTrainRawEmailFailSafe(
  supa: any,
  {
    user_email,
    message_id,
    provider = "gmail",
    redaction_reason,
    is_train = true,
  }: {
    user_email: string;
    message_id: string;
    provider?: string;
    redaction_reason: string;
    is_train?: boolean;
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
      return noStoreJson(
        { ok: false, error: "Not authenticated", scanned: 0, saved_trips: 0 },
        401
      );
    }

    const supa = getSupabaseAdmin();
    const accessToken = await getFreshAccessToken(user_email);

    // ✅ If key missing (e.g. local build / Codespaces), skip LLM parsing safely.
    const OPENAI_ENABLED = !!process.env.OPENAI_API_KEY?.trim();

    // 2) Build Gmail search query
    const SEARCH_QUERY =
      'in:anywhere ("ticket" OR "eticket" OR "e-ticket" OR "booking" OR "journey" OR "rail" OR "train") newer_than:2y';

    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", SEARCH_QUERY);
    url.searchParams.set("maxResults", "50");

    const reqUrl = new URL(req.url);
    const requestPageToken = reqUrl.searchParams.get("pageToken");
    if (requestPageToken) {
      url.searchParams.set("pageToken", requestPageToken);
    }

    const list = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((x) => x.json());

    const messageIds: string[] = Array.isArray(list.messages)
      ? list.messages.map((m: any) => m?.id).filter((id: string | undefined) => !!id)
      : [];

    const scanned = messageIds.length;

    if (!messageIds.length) {
      return noStoreJson({
        ok: true,
        scanned: 0,
        saved_raw: 0,
        saved_trips: 0,
        nextPageToken: list.nextPageToken ?? null,
        user_email,
        trip_errors: [],
        note: OPENAI_ENABLED ? null : "OPENAI_API_KEY missing; LLM parsing skipped",
      });
    }

    let savedRaw = 0;
    let savedTrips = 0;
    const tripErrors: { email_id: string; message: string }[] = [];

    // Chunk IDs for limited concurrency
    const chunks: string[][] = [];
    for (let i = 0; i < messageIds.length; i += CONCURRENCY) {
      chunks.push(messageIds.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (id) => {
          // Skip if already in debug table (means already parsed)
          const { data: existingDebug } = await supa
            .from("debug_llm_outputs")
            .select("id")
            .eq("email_id", id)
            .limit(1)
            .maybeSingle();

          if (existingDebug) {
            return;
          }

          const fullMsg = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ).then((x) => x.json());

          const subject = headerValue(fullMsg.payload, "Subject") || "";
          const from = headerValue(fullMsg.payload, "From") || "";
          const body = extractBody(fullMsg.payload);
          const snippet = fullMsg.snippet || "";

          // Decide train eligibility BEFORE writing anything sensitive
          const trainOk = isTrainEmail({ from, subject, body });

          // Write raw email, but minimise aggressively
          if (!trainOk) {
            // keep only the dedupe keys + audit fields; delete content immediately
            const { error: rawErr } = await supa.from("raw_emails").upsert(
              {
                provider: "gmail",
                user_email,
                message_id: fullMsg.id,
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

            if (!rawErr) savedRaw++;
            return;
          }

          // train email: store (temporarily) for parsing
          // If OpenAI is disabled, don't persist body at all (no parse to justify retention).
          const { error: rawErr } = await supa.from("raw_emails").upsert(
            {
              provider: "gmail",
              user_email,
              message_id: fullMsg.id,
              subject: subject || null,
              sender: from || null,
              snippet: snippet || null,
              body_plain: OPENAI_ENABLED ? body || null : null,
              is_train: true,
              redacted_at: null,
              redaction_reason: null,
              // parsed_at intentionally set later (but will always be set in fail-safe redaction)
            },
            { onConflict: "provider,user_email,message_id" } as any
          );

          if (!rawErr) savedRaw++;

          // ✅ If OpenAI key missing, we stop here (body already not persisted).
          // Mark as done + redact other content to avoid retention.
          if (!OPENAI_ENABLED) {
            await redactTrainRawEmailFailSafe(supa, {
              user_email,
              message_id: fullMsg.id,
              redaction_reason: "openai_disabled_no_parse",
              is_train: true,
            });
            return;
          }

          // -------------------------
          // ✅ FAIL-SAFE TRAIN FLOW:
          // Always redact in `finally`, regardless of downstream success/failure.
          // -------------------------
          let parsed: any = null;
          let tripInserted = false;
          let redactionReason = "train_processed_unknown";

          try {
            // ✅ Lazy import at runtime only (prevents build-time OpenAI init)
            const { ingestEmail } = await import("@/lib/ingestEmail");

            parsed = await ingestEmail({
              id,
              from,
              subject,
              body_plain: body,
              snippet,
            });

            // Log parser output for debugging (after parsing)
            try {
              await supa.from("debug_llm_outputs").insert({
                email_id: id,
                user_email, // ✅ add this now that column exists
                from_addr: from,
                subject,
                raw_input: null, // ✅ don’t store bodies
                raw_output: JSON.stringify(parsed),
              });
            } catch {
              // ignore debug errors
            }

            // ✅ TrainOk but not a ticket: redact immediately after decision (still via finally)
            if (!parsed?.is_ticket) {
              redactionReason = "train_filter_not_ticket";
              return;
            }

            // Normalisation for DB
            const operatorRaw = parsed.operator ?? parsed.provider ?? null;
            const operator = normaliseOperatorName(operatorRaw);
            const retailer = parsed.retailer ?? parsed.provider ?? null;

            const departStr = parsed.depart_planned || parsed.outbound_departure || null;
            const arriveStr = parsed.arrive_planned || null;
            const outboundStr = parsed.outbound_departure || parsed.depart_planned || null;

            const departIso = safeTimestamp(departStr);
            const arriveIso = safeTimestamp(arriveStr);
            const outboundIso = safeTimestamp(outboundStr);

            // Check for existing trip by booking_ref + origin + destination
            let existingTrip: { id: string; depart_planned: string | null } | null = null;

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

            let finalDepart = departIso;
            if (existingTrip?.depart_planned && finalDepart) {
              const existingDate = new Date(existingTrip.depart_planned);
              const newDate = new Date(finalDepart);
              if (existingDate <= newDate) {
                finalDepart = existingTrip.depart_planned;
              }
            }

            const baseRecord = {
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
              const { error } = await supa.from("trips").update(baseRecord).eq("id", existingTrip.id);
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

              redactionReason = "trip_write_failed";
              tripInserted = false;
              return;
            }

            // ✅ Trip success
            savedTrips++;
            tripInserted = true;
            redactionReason = "ticket_parsed_redact";
          } catch (err) {
            console.error("[train] unexpected parsing/insert error:", err);
            // Keep reason specific for auditing (no content retained)
            redactionReason = tripInserted ? "unexpected_error_after_trip" : "llm_parse_or_insert_failed";
            // Re-throw so it still shows up in Promise.allSettled as rejected (keeps your current visibility)
            throw err;
          } finally {
            // ✅ ALWAYS redact raw email (even if parsing/insert fails)
            const { error: redactErr } = await redactTrainRawEmailFailSafe(supa, {
              user_email,
              message_id: fullMsg.id,
              redaction_reason: redactionReason || (tripInserted ? "ticket_parsed_redact" : "parse_or_insert_failed"),
              is_train: true,
            });

            if (redactErr) {
              console.error("[train] raw email redaction failed:", redactErr.message);
            } else {
              console.log("[train] raw email redacted (fail-safe)", {
                email_id: id,
                reason: redactionReason,
              });
            }
          }
        })
      );

      for (const r of results) {
        if (r.status === "rejected") {
          console.error("Error processing Gmail message:", r.reason);
        }
      }
    }

    return noStoreJson({
      ok: true,
      scanned,
      saved_raw: savedRaw,
      saved_trips: savedTrips,
      nextPageToken: list.nextPageToken ?? null,
      user_email,
      trip_errors: tripErrors,
      note: OPENAI_ENABLED ? null : "OPENAI_API_KEY missing; LLM parsing skipped",
    });
  } catch (e: any) {
    console.error("ingest/google/save error", e);
    return noStoreJson({ ok: false, error: e?.message || String(e) }, 500);
  }
}

export const POST = GET;
