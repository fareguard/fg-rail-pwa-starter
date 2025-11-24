import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "";
  let next = "/dashboard";

  if (state.startsWith("next=")) {
    try {
      next = decodeURIComponent(state.slice("next=".length));
    } catch {}
  }

  // Just confirm we can reach this code at all
  console.log("Google callback reached OK with state:", state);

  return NextResponse.redirect(next + "?debug=callback-ok");
}
