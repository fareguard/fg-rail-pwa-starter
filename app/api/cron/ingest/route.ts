// app/api/cron/ingest/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { makeGmailForUser } from "@/lib/google";
import { parseEmail } from "@/lib/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ok(data: any, code = 200) { return NextResponse.json(data, { status: code }); }
function authFail() { return ok({ ok:false, error: "unauthorized" }, 401); }

export async function GET(req: Request) {
  // 🔐 protect with CRON_SECRET
  const secret = process.env.CRON_SECRET || "";
  const hdr = req.headers.get("authorization") || "";
  if (secret && hdr !== `Bearer ${secret}`) return authFail();

  const db = getSupabaseAdmin();

  // 1) Who should we ingest for? (anyone with google tokens)
  const { data: users, error: uErr } = await db
    .from("oauth_staging")
    .select("user_email")
    .eq("provider", "google")
    .order("created_at", { ascending: false });

  if (uErr) return ok({ ok:false, error: uErr.message }, 500);
  const emails = [...new Set((users || []).map(r => r.user_email).filter(Boolean))];

  // Operators + retailers we care about
  const froms = [
    "thetrainline.com",
    "avantiwestcoast.co.uk",
    "northernrailway.co.uk",
    "scotrail.co.uk",
    "lner.co.uk",
    "wmtickets.co.uk",
  ];
  const query = `newer_than:30d (${froms.map(f=>`from:${f}`).join(" OR ")})`;

  const results: any[] = [];

  for (const user_email of emails) {
    try {
      const { gmail } = await makeGmailForUser(user_email);

      // 2) list candidate messages
      const list = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 25,
      });

      const messages = list.data.messages || [];
      let seen = 0, inserted = 0, tripsMade = 0;

      for (const m of messages) {
        if (!m.id) continue;

        // avoid duplicates by (user_email,message_id)
        const { data: dup } = await db
          .from("raw_emails")
          .select("id")
          .eq("user_email", user_email)
          .eq("message_id", m.id)
          .maybeSingle();
        if (dup) { seen++; continue; }

        // 3) fetch full message
        const full = await gmail.users.messages.get({
          userId: "me",
          id: m.id,
          format: "FULL",
        });

        const headers = (full.data.payload?.headers || []) as { name: string; value: string }[];
        const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "";
        const from = headers.find(h => h.name.toLowerCase() === "from")?.value || "";

        // text body (prefer plain)
        function decode(b64?: string) {
          if (!b64) return "";
          return Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        }
        const parts = full.data.payload?.parts || [];
        let body = "";
        const plain = parts.find(p => p.mimeType === "text/plain");
        const html  = parts.find(p => p.mimeType === "text/html");
        if (plain?.body?.data) body = decode(plain.body.data);
        else if (html?.body?.data) body = decode(html.body.data);

        // 4) store raw email
        const { error: insErr, data: raw } = await db
          .from("raw_emails")
          .insert({
            provider: "google",
            user_email,
            message_id: m.id,
            subject,
            sender: from,
            snippet: full.data.snippet || null,
            body_plain: body || null,
          })
          .select("id")
          .single();

        if (insErr) continue;
        inserted++;

        // 5) parse → trip
        const parsed = parseEmail(subject, body || "");
        if (!parsed) continue;

        // upsert trip by (user_email, booking_ref, depart_planned)
        const { error: tErr } = await db.from("trips").upsert({
          user_email,
          retailer: parsed.retailer ?? null,
          operator: parsed.operator ?? null,
          booking_ref: parsed.booking_ref ?? null,
          origin: parsed.origin ?? null,
          destination: parsed.destination ?? null,
          depart_planned: parsed.depart_planned ?? null,
          arrive_planned: parsed.arrive_planned ?? null,
          message_id: m.id,
          is_ticket: true,
        }, { onConflict: "user_email,booking_ref,depart_planned" });

        if (!tErr) tripsMade++;
      }

      results.push({ user_email, messages: messages.length, seen, inserted, tripsMade });
    } catch (e: any) {
      results.push({ user_email, error: e.message || String(e) });
    }
  }

  return ok({ ok: true, results });
}
