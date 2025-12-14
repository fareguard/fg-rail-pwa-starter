import { NextResponse } from "next/server";
import { getDepartureBoard } from "@/lib/openldbws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const crs = (url.searchParams.get("crs") || "EUS").toUpperCase();
    const xml = await getDepartureBoard(crs, 10);

    return NextResponse.json({
      ok: true,
      crs,
      preview: xml.slice(0, 1200),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
