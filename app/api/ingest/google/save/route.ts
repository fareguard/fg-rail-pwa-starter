import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseEmail } from "@/lib/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const { data } = await supa
      .from("oauth_staging").select("*")
      .eq("provider", "google").order("created_at", { ascending: false }).limit(1);
    if (!data?.length) return NextResponse.json({ ok: false, error: "No Gmail connected" }, { status: 400 });

    const { access_token: accessToken, user_email } = data[0] as any;

    // Broad query – same as preview
    const q = `in:anywhere (subject:"ticket" OR subject:"booking" OR from:trainline.com OR from:lner.co.uk OR from:avantiwestcoast.co.uk OR from:gwr.com) newer_than:2y`;
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) return NextResponse.json({ ok: false, error: await listRes.text() }, { status: 500 });
    const list = await listRes.json();

    const ids = (list.messages || []).map((m: any) => m.id);
    let saved = 0, trips = 0;

    for (const id of ids) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!msgRes.ok) continue;
      const m: any = await msgRes.json();

      const headers: Record<string, string> = {};
      for (const h of m.payload?.headers ?? []) {
        const k = (h.name || "").toLowerCase();
        if (["subject", "from", "date"].includes(k)) headers[k] = h.value || "";
      }

      const body = extractBody(m.payload);

      // store raw
      const { error: rawErr } = await supa.from("raw_emails").upsert({
        provider: "google",
        user_email,
        message_id: id,
        subject: headers.subject || null,
        sender: headers.from || null,
        snippet: m.snippet || null,
        body_plain: body || null,
      }, { onConflict: "provider,message_id" } as any);
      if (!rawErr) saved++;

      // parse → trip
      const parsed = parseEmail(headers.subject, body);
      const anyCore = parsed.origin || parsed.destination || parsed.booking_ref;
      if (anyCore) {
        const { error: tripErr } = await supa.from("trips").insert({
          user_email,
          retailer: parsed.retailer,
          operator: parsed.operator,
          booking_ref: parsed.booking_ref,
          origin: parsed.origin,
          destination: parsed.destination,
          depart_planned: parsed.depart_planned ? new Date(parsed.depart_planned).toISOString() : null,
          arrive_planned: parsed.arrive_planned ? new Date(parsed.arrive_planned).toISOString() : null,
          pnr_json: parsed as any,
        });
        if (!tripErr) trips++;
      }
    }

    return NextResponse.json({ ok: true, saved, trips });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
