// app/api/ingest/google/save/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { parseEmail, Trip } from "@/lib/parsers";
import { getFreshAccessToken } from "@/lib/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GmailMessage = {
  id: string;
  threadId: string;
  payload?: any;
  snippet?: string;
};

// ---- Gmail helpers -------------------------------------------------

function b64ToUtf8(b64: string) {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64").toString("utf-8");
}

function decodePart(part: any): string {
  if (!part?.body?.data) return "";
  return b64ToUtf8(String(part.body.data));
}

// extract readable text from gmail payload (prefers text/plain, falls back to stripped HTML)
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

async function fetchJson(url: string, accessToken: string) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gmail API ${r.status}: ${txt}`);
  }
  return r.json();
}

// ---- Search query (aligned with preview route) ---------------------

const RETAILERS = [
  "trainline.com",
  "lner.co.uk",
  "avantiwestcoast.co.uk",
  "gwr.com",
  "tpexpress.co.uk",
  "thameslinkrailway.com",
  "scotrail.co.uk",
  "crosscountrytrains.co.uk",
  "northernrailway.co.uk",
  "chilternrailways.co.uk",
  "greateranglia.co.uk",
  "southeasternrailway.co.uk",
  "southwesternrailway.com",
  "c2c-online.co.uk",
  "splitmyfare.co.uk",
  "railsmartr.co.uk",
  "westmidlandsrailway.co.uk",
  "wmtrains.co.uk",
  "mytrainpal.com",
  "merseyrail.org",
  "translink.co.uk",
  "transportforwales.wales",
];

const SUBJECT_HINTS = [
  "eticket",
  "e-ticket",
  "e ticket",
  "tickets",
  "booking confirmation",
  "your journey",
  "your trip",
  "reservation",
  "collect",
  "delayed",
  "delay repay",
];

function buildSearchQuery() {
  const fromParts = RETAILERS.map((d) => `from:${d}`).join(" OR ");
  const subjectParts = SUBJECT_HINTS.map(
    (s) => `subject:"${s}"`
  ).join(" OR ");
  // any folder, last 2 years, include promos/updates
  return `in:anywhere (${fromParts} OR ${subjectParts}) newer_than:2y`;
}

// --------------------------------------------------------------------

export async function GET() {
  try {
    const supa = getSupabaseAdmin();

    // 1) find latest connected Gmail account
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

    const user_email: string = oauthRows[0].user_email;
    const accessToken = await getFreshAccessToken(user_email);

    const SEARCH_QUERY = buildSearchQuery();

    // ---- 2) list messages matching our query ----
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

      const list = await fetchJson(url.toString(), accessToken);
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
        saved: 0,
        trips: 0,
        scanned: 0,
      });
    }

    // ---- 3) hydrate, store raw_emails, parse → trips (with upsert) ----
    let savedRaw = 0;
    let savedTrips = 0;
    let scanned = 0;

    for (const id of messageIds) {
      scanned++;

      let msg: GmailMessage | null = null;
      try {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
        msg = await fetchJson(url, accessToken);
      } catch {
        continue;
      }
      if (!msg) continue;

      const subject = headerValue(msg.payload, "Subject") || "";
      const from = headerValue(msg.payload, "From") || "";
      const body = extractBody(msg.payload);
      const snippet = msg.snippet || "";

      // raw_emails upsert (for debugging / audit)
      const { error: rawErr } = await supa
        .from("raw_emails")
        .upsert(
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

      // parse → candidate trip
      const parsed: Trip = parseEmail(body, from, subject);

      const isTicket =
        parsed.is_ticket === true &&
        !!(parsed.origin && parsed.destination && parsed.depart_planned);

      if (!isTicket) continue;

      // prepare row for trips
      const tripRow = {
        user_email,
        retailer: parsed.retailer ?? null,
        operator: parsed.operator ?? null,
        booking_ref: parsed.booking_ref ?? null,
        origin: parsed.origin ?? null,
        destination: parsed.destination ?? null,
        depart_planned: parsed.depart_planned ?? null,
        arrive_planned: parsed.arrive_planned ?? null,
        is_ticket: true,
        pnr_json: parsed as any,
      };

      // upsert with the same unique key we added in the DB
      const { error: tripErr } = await supa
        .from("trips")
        .upsert(tripRow, {
          onConflict:
            "user_email,booking_ref,depart_planned,origin,destination",
        });

      if (!tripErr) savedTrips++;
    }

    return NextResponse.json({
      ok: true,
      saved: savedRaw,
      trips: savedTrips,
      scanned,
      user_email,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export const POST = GET;
