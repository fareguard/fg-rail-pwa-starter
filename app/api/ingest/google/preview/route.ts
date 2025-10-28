import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// expand retailers & subject hints
const RETAILERS = [
  "trainline.com","lner.co.uk","avantiwestcoast.co.uk","gwr.com","tpexpress.co.uk",
  "thameslinkrailway.com","scotrail.co.uk","crosscountrytrains.co.uk","northernrailway.co.uk",
  "chilternrailways.co.uk","greateranglia.co.uk","southeasternrailway.co.uk",
  "southwesternrailway.com","c2c-online.co.uk","splitmyfare.co.uk","railsmartr.co.uk",
  "westmidlandsrailway.co.uk","merseyrail.org","translink.co.uk","transportforwales.wales"
];

const SUBJECT_HINTS = [
  "eticket","e-ticket","e ticket","tickets","booking confirmation",
  "your journey","your trip","reservation","collect","delayed","delay repay"
];

function buildQuery() {
  const fromParts = RETAILERS.map(d => `from:${d}`).join(" OR ");
  const subjectParts = SUBJECT_HINTS.map(s => `subject:"${s}"`).join(" OR ");
  // broaden: any folder, last 2 years, include promos/updates
  return `in:anywhere (${fromParts} OR ${subjectParts}) newer_than:2y`;
}

async function g<T>(token: string, url: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

// try to grab a human-readable body (plain or HTML->text)
function decodePart(part: any): string {
  if (!part?.body?.data) return "";
  const b64 = String(part.body.data).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf-8");
}
function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType?.startsWith("text/plain")) return decodePart(payload);
  if (payload.mimeType?.startsWith("text/html")) {
    const html = decodePart(payload);
    return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
  }
  for (const p of payload.parts || []) {
    const t = extractBody(p);
    if (t) return t;
  }
  return "";
}

export async function GET() {
  try {
    const supa = getSupabaseAdmin();
    const { data, error } = await supa
      .from("oauth_staging").select("*")
      .eq("provider","google").order("created_at",{ascending:false}).limit(1);
    if (error) throw error;
    if (!data?.length)
      return NextResponse.json({ ok:false, error:"No connected Gmail account yet." }, { status: 400 });

    const { access_token: accessToken, user_email } = data[0] as any;

    const q = buildQuery();
    const list = await g<{ messages?: { id: string }[] }>(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=25`
    );

    const ids = list.messages?.map(m => m.id) ?? [];
    const details = await Promise.all(ids.map(async id => {
      const m:any = await g(
        accessToken,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`
      );

      const headers:Record<string,string> = {};
      for (const h of m.payload?.headers ?? []) {
        const name = (h.name||"").toLowerCase();
        if (["subject","from","date"].includes(name)) headers[name] = h.value||"";
      }

      const body = extractBody(m.payload);
      const ref = (body.match(/\b([A-Z0-9]{6,8})\b/) || [null])[0];

      // very loose station detection (improves later)
      const od = body.match(/\b([A-Za-z][A-Za-z\s]{2,})\s+(?:to|->)\s+([A-Za-z][A-Za-z\s]{2,})\b/i);

      return {
        id, headers, snippet: m.snippet, bookingRef: ref,
        origin: od?.[1]?.trim() || null, destination: od?.[2]?.trim() || null
      };
    }));

    return NextResponse.json({ ok:true, email:user_email, matches:details });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
