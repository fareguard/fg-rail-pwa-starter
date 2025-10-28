import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RETAILERS = [
  "trainline.com","avantiwestcoast.co.uk","gwr.com","lner.co.uk","tpexpress.co.uk",
  "thameslinkrailway.com","scotrail.co.uk","crosscountrytrains.co.uk","northernrailway.co.uk",
  "chilternrailways.co.uk","greateranglia.co.uk","southeasternrailway.co.uk",
  "southwesternrailway.com","c2c-online.co.uk","splitmyfare.co.uk","railsmartr.co.uk"
];

function buildQuery() {
  const fromParts = RETAILERS.map(d => `from:${d}`).join(" OR ");
  return `(${fromParts}) newer_than:180d`;
}

async function gmailFetch<T>(accessToken: string, url: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export async function GET() {
  try {
    const supa = getSupabaseAdmin();
    const { data, error } = await supa
      .from("oauth_staging").select("*")
      .eq("provider","google").order("created_at",{ascending:false}).limit(1);
    if (error) throw error;
    if (!data?.length) return NextResponse.json({ ok:false, error:"No connected Gmail account yet." }, { status: 400 });

    const { access_token: accessToken, user_email } = data[0] as any;

    // search
    const q = buildQuery();
    const list = await gmailFetch<{ messages?: { id: string }[] }>(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=8`
    );

    const ids = list.messages?.map(m => m.id) ?? [];
    const details = await Promise.all(ids.map(async id => {
      const m:any = await gmailFetch(
        accessToken,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`
      );

      const headers:Record<string,string> = {};
      for (const h of m.payload?.headers ?? []) {
        const name = (h.name||"").toLowerCase();
        if (["subject","from","date"].includes(name)) headers[name] = h.value||"";
      }

      // grab a plain-text part if present (for early ref/route guesses)
      const part = (m.payload?.parts||[]).find((p:any)=>String(p.mimeType).startsWith("text/plain"));
      let text = "";
      if (part?.body?.data) {
        const b64 = part.body.data.replace(/-/g,"+").replace(/_/g,"/");
        text = Buffer.from(b64, "base64").toString("utf-8");
      }
      const bookingRef = (text.match(/\b[A-Z0-9]{6,8}\b/) || [null])[0];

      return { id, headers, snippet: m.snippet, bookingRef };
    }));

    return NextResponse.json({ ok:true, email:user_email, matches:details });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
