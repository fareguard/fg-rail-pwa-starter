// app/api/openldbws/test/route.ts
import { NextResponse } from "next/server";
import { openLdbwsCall } from "@/lib/openldbws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const crs = (searchParams.get("crs") || "EUS").toUpperCase().slice(0, 3);

    // Minimal public board request
    // Namespace matches the public LDB service examples
    const body = `
<ldb:GetDepartureBoardRequest xmlns:ldb="http://thalesgroup.com/RTTI/2016-02-16/ldb/">
  <ldb:numRows>10</ldb:numRows>
  <ldb:crs>${crs}</ldb:crs>
</ldb:GetDepartureBoardRequest>`.trim();

    const xml = await openLdbwsCall(body);

    return NextResponse.json({ ok: true, crs, sample: xml.slice(0, 600) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
