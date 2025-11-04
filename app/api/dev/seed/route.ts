import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { parseEmail } from "@/lib/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUBJECT = "Your e-ticket: London Euston to Manchester Piccadilly";
const BODY = `
Booking reference ABC1234
From London Euston to Manchester Piccadilly
Depart 08:15 – 10:38 on 27/10/2025
Operated by Avanti West Coast
Trainline receipt
`;

export async function GET() {
  const supa = getSupabaseAdmin();

  const { data } = await supa
    .from("oauth_staging").select("user_email")
    .order("created_at",{ ascending:false }).limit(1);

  const user_email = data?.[0]?.user_email || "hello@fareguard.co.uk";

  const { error: rawErr } = await supa.from("raw_emails").insert({
    provider: "google",
    user_email,
    message_id: `mock-${Date.now()}`,
    subject: SUBJECT,
    sender: "noreply@thetrainline.com",
    snippet: "Your e-ticket is attached",
    body_plain: BODY,
  });
  if (rawErr) return NextResponse.json({ ok:false, error: rawErr.message }, { status:500 });

  const p = parseEmail(SUBJECT, BODY);
  const { error: tripErr } = await supa.from("trips").insert({
    user_email,
    retailer: p.retailer || "trainline",
    operator: p.operator || "Avanti West Coast",
    booking_ref: p.booking_ref || "ABC1234",
    origin: p.origin || "London Euston",
    destination: p.destination || "Manchester Piccadilly",
    depart_planned: p.depart_planned || new Date().toISOString(),
    arrive_planned: p.arrive_planned || new Date(Date.now()+2.5*3600e3).toISOString(),
    pnr_json: p as any,
  });
  if (tripErr) return NextResponse.json({ ok:false, error: tripErr.message }, { status:500 });

  return NextResponse.json({ ok:true });
}
