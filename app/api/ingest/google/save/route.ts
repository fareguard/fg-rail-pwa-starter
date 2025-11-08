// app/api/ingest/google/save/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseEmail, Trip } from "@/lib/parsers";
import { getFreshAccessToken } from "@/lib/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GmailMessage = {
  id: string;
  payload?: any;
  snippet?: string;
};

function b64ToUtf8(b64: string) {
  const s = (b64 || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64").toString("utf-8");
}

function decodePart(part: any): string {
  if (!part?.body?.data) return "";
  return b64ToUtf8(String(part.body.data));
}

// Prefer text/plain, else strip html
function extractBody(payload: any): string {
  if (!payload) return "";

  const mt = payload.mimeType || "";
  if (mt.startsWith("text/plain")) return decodePart(payload);
  if (mt.startsWith("text/html")) {
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
    const mt2 = p?.mimeType || "";
    const text = extractBody(p);
    if (!text) continue;
    if (mt2.startsWith("text/plain") && !plain) plain = text;
    if (mt2.startsWith("text/html") && !html) html = text;
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
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gmail API ${r.status}: ${txt}`);
  }
  return r.json();
}

// Broad but safe search (24 months)
const SEARCH_QUERY = [
  "in:anywhere",
  "(",
  'subject:"ticket"',
  'OR subject:"e-ticket"',
  'OR subject:"booking"',
  "OR from:trainline.com",
  "OR from:trainpal.co.uk",
  "OR from:avantiwestcoast.co.uk",
  "OR from:gwr.com",
  "OR from:lner.co.uk",
  "OR from:northernrailway.co.uk",
  "OR from:thameslinkrailway.com",
  "OR from:scotrail.co.uk",
  "OR from:tpexpress.co.uk",
  "OR from:wmtrains.co.uk",
  ")",
  "newer_than:2y",
].join(" ");

async function tripExists(
  supa: ReturnType<typeof getSupabaseAdmin>,
  args: {
    user_email: string;
    booking_ref?: string | null;
    depart_planned?: string | null;
    origin?: string | null;
    destination?: string | null;
  }
) {
  const { user_email, booking_ref, depart_planned, origin, destination } = args;
  if (!booking_ref || !depart_planned) return false;

  const { data } = await supa
    .from("trips")
    .select("id")
    .eq("user_email", user_email)
    .eq("booking_ref", booking_ref)
    .eq("depart_planned", depart_planned)
    .eq("origin", origin ?? null)
    .eq("destination", destination ?? null)
    .limit(1);

  return !!(data && data.length);
}

export async function GET() {
  try {
    const supa = getSupabaseAdmin();

    // Use the most recent connected Google account
    const { data: oauthRows, error: oErr } = await supa
      .from("oauth_staging")
      .select("*")
      .eq("provider", "google")
      .order("created_at", { ascending: false })
      .limit(1);

    if (oErr) throw oErr;
    if (!oauthRows?.length) {
      return NextResponse.json({ ok: false, error: "No Gmail connected" }, { status: 400 });
    }

    const user_email: string = oauthRows[0].user_email;
    const accessToken = await getFreshAccessToken(user_email);

    // 1) list messages (up to a few pages)
    let pageToken: string | undefined;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("q", SEARCH_QUERY);
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const list = await fetchJson(url.toString(), accessToken);
      if (Array.isArray(list.messages)) {
        for (const m of list.messages) if (m?.id) ids.push(m.id);
      }
      pageToken = list.nextPageToken;
      if (!pageToken) break;
    }

    if (!ids.length) {
      return NextResponse.json({ ok: true, saved: 0, trips: 0, scanned: 0, user_email });
    }

    // 2) hydrate + upsert + parse
    let savedRaw = 0;
    let savedTrips = 0;
    let scanned = 0;

    for (const id of ids) {
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

      // raw_emails (dedupe on provider+message_id)
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

      // → trip candidate
      const parsed: Trip = parseEmail(body, from, subject);
      const hasMinimum =
        !!(parsed.origin && parsed.destination) || !!parsed.booking_ref;

      if (!hasMinimum) continue;

      if (
        await tripExists(supa, {
          user_email,
          booking_ref: parsed.booking_ref,
          depart_planned: parsed.depart_planned,
          origin: parsed.origin ?? null,
          destination: parsed.destination ?? null,
        })
      ) {
        continue;
      }

      const { error: tripErr } = await supa.from("trips").insert({
        user_email,
        retailer: parsed.retailer ?? null,
        operator: parsed.operator ?? null,
        booking_ref: parsed.booking_ref ?? null,
        origin: parsed.origin ?? null,
        destination: parsed.destination ?? null,
        depart_planned: parsed.depart_planned ?? null,
        arrive_planned: parsed.arrive_planned ?? null,
        pnr_json: parsed as any,
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
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export const POST = GET;
