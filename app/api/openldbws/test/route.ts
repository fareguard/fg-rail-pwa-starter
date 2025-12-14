import { NextResponse } from "next/server";
import { openLdbwsCall } from "@/lib/openldbws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Simple sanity check: departure board for a CRS code (e.g. "EUS", "BHM", etc)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const crs = (searchParams.get("crs") || "EUS").toUpperCase();
  const numRows = Number(searchParams.get("rows") || "5");

  const soapAction =
    "http://thalesgroup.com/RTTI/2017-10-01/ldb/GetDepartureBoard";

  const body = `
<ldb:GetDepartureBoardRequest>
  <ldb:numRows>${Number.isFinite(numRows) ? numRows : 5}</ldb:numRows>
  <ldb:crs>${crs}</ldb:crs>
</ldb:GetDepartureBoardRequest>`;

  try {
    const xml = await openLdbwsCall(soapAction, body);
    return NextResponse.json({ ok: true, crs, xml_preview: xml.slice(0, 1200) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
