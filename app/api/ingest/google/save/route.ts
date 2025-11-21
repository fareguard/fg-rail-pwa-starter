// app/api/ingest/google/save/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getFreshAccessToken } from "@/lib/google";

import { isTrainEmail } from "@/lib/trainEmailFilter";
import { ingestEmail } from "@/lib/ingestEmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

// ------------------------------------------------------------------

export async function GET() {
  try {
    const supa = getSupabaseAdmin();

    // 1) Most recent connected Google account
    const { data: oauthRows, error: oErr } = await supa
      .from("oauth_staging")
      .select("*")
      .eq("provider", "google")
      .order("created_at", { ascending: false })
      .limit(1);

    if (oErr) throw oErr;
    if (!oauthRows?.length) {
      return NextResponse.json(
        { ok: false, error: "No Gmail connected" },
        { status: 400 }
      );
    }

    const { user_email, user_id: userId } = oauthRows[0] as any;
    const accessToken = await getFreshAccessToken(user_email);

    // 2) Gmail search query
    const SEARCH_QUERY =
      'in:anywhere ("ticket" OR "eticket" OR "e-ticket" OR "booking" OR "journey" OR "rail" OR "train") newer_than:2y';

    let pageToken: string | undefined = undefined;
    const messageIds: string[] = [];
    const MAX_PAGES = 3;

    for (let i = 0; i < MAX_PAGES; i++) {
      const url = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages"
      );
      url.searchParams.set("q", SEARCH_QUERY);
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const list = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((x) => x.json());

      if (Array.isArray(list.messages)) {
        for (const m of list.messages) {
          if (m?.id) messageIds.push(m.id);
        }
      }

      pageToken = list.nextPageToken;
      if (!pageToken) break;
    }

    if (!messageIds.length) {
      return NextResponse.json({
        ok: true,
        saved_raw: 0,
        saved_trips: 0,
        scanned: 0,
        user_email,
        trip_errors: [],
      });
    }

    // 3) Hydrate, store raw, parse trips
    let savedRaw = 0;
    let savedTrips = 0;
    let scanned = 0;
    const tripErrors: { email_id: string; message: string }[] = [];

    for (const id of messageIds) {
      scanned++;

      const fullMsg = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ).then((x) => x.json());

      const subject = headerValue(fullMsg.payload, "Subject") || "";
      const from = headerValue(fullMsg.payload, "From") || "";
      const body = extractBody(fullMsg.payload);
      const snippet = fullMsg.snippet || "";

      // ---- Save raw email ----
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
        continue;
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
        continue;
      }
        
      
      const toInsert = {
        user_id: userId,
        user_email,
        retailer: parsed.provider,                // TrainPal / Trainline / Avanti etc.
        email_id: id,
        operator: parsed.operator || parsed.provider, // <- use separate operator if present
        booking_ref: parsed.booking_ref,
        origin: parsed.origin,
        destination: parsed.destination,
        depart_planned: parsed.depart_planned,
        arrive_planned: parsed.arrive_planned,
        outbound_departure: parsed.outbound_departure,
        is_ticket: true,
        pnr_json: parsed,
        source: "gmail",
      };


      const { error: tripErr } = await supa.from("trips").upsert(toInsert, {
        onConflict:
          "user_email,booking_ref,depart_planned,origin,destination",
      });

      if (tripErr) {
        tripErrors.push({
          email_id: id,
          message: tripErr.message ?? String(tripErr),
        });
      } else {
        savedTrips++;
      }
    }

    return NextResponse.json({
      ok: true,
      saved_raw: savedRaw,
      saved_trips: savedTrips,
      scanned,
      user_email,
      trip_errors: tripErrors,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export const POST = GET;
