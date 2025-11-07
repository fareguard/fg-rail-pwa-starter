// app/api/ingest/kickoff/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withAuthHeaders(init?: RequestInit) {
  const secret = process.env.CRON_SECRET || "";
  return {
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${secret}`
    },
    // Never cache internal fan-out
    cache: "no-store" as const
  };
}

export async function GET(req: Request) {
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

    // Kick the previous “ingest” worker you had on a cron
    const ingestUrl = new URL("/api/cron/ingest", base).toString();

    // You can add other light tasks here in parallel if you want
    const [ingestRes] = await Promise.all([
      fetch(ingestUrl, withAuthHeaders())
      // , fetch(new URL("/api/whatever", base), withAuthHeaders())
    ]);

    const ingestOk = ingestRes.ok;

    return NextResponse.json({ ok: true, ingestOk });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
