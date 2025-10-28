import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Fan out to Gmail ingest for now (single user MVP)
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ingest/google/save`, { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  return NextResponse.json({ ok: true, gmail: j });
}
