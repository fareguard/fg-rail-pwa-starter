// app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revokeSessionAndClearCookie } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function POST(req: NextRequest) {
  const res = noStoreJson({ ok: true });
  await revokeSessionAndClearCookie(req, res);
  return res;
}

// Optional: reject GET to avoid CSRF-ish surprises
export async function GET() {
  return noStoreJson({ ok: false, error: "Method not allowed" }, 405);
}
