import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseEmail } from "@/lib/parsers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// a realistic Trainline-style plain text
const MOCK_SUBJECT = "Your e-ticket: London Euston to Manchester Piccadilly";
const MOCK_BODY = `
Booking reference ABC1234
From London Euston to Manchester Piccadilly
Depart 08:15 – Arrive 10:38 on 27/10/2025
Operated by Avanti West Coast
Trainline receipt
`;

export async function GET() {
  const supa = getSupabaseAdmin();

  // associate with whoever connected Gmail first (for demo)
  const { data } = await supa
    .from("oauth_staging").select("user_email")
    .order("created_at", { ascending: false }).limit(1);

  const user_email = data?.[0]?.user_email || "demo@fareguard.co.uk";

  // raw email
  const { error: rawErr } = await supa.from("raw_emails").insert({
    provider: "google",
    user_email,
    message_id: `mock-${Date.now()}`,
    subject: MOCK_SUBJECT,
    sender: "noreply@thetrainline.com",
    snippet: "Your e-ticket is attached",
    body_plain: MOCK_BODY,
  });
  if (rawErr) return NextResponse.json({ ok: false, error: rawErr.message }, { status: 500 });

  // parse → trips
  const p = parseEmail(MOCK_SUBJECT, MOCK_BODY);
  const { error: tripErr } = await supa.from("trips").insert({
    user_email,
    retailer: p.retailer || "trainline",
    operator: p.operator || "Avanti West Coast",
    booking_ref: p.booking_ref || "ABC1234",
    origin: p.origin || "London Euston",
    destination: p.destination || "Manchester Piccadilly",
    depart_planned: p.depart_planned ? new Date(p.depart_planned).toISOString() : new Date().toISOString(),
    arrive_planned: p.arrive_planned ? new Date(p.arrive_planned).toISOString() : new Date(Date.now()+2.5*3600e3).toISOString(),
    pnr_json: p as any,
  });
  if (tripErr) return NextResponse.json({ ok: false, error: tripErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
