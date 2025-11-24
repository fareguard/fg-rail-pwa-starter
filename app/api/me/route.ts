// app/api/me/route.ts
import { NextResponse } from "next/server";
import { parseUserFromRequest } from "@/lib/oauth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  return res;
}

export async function GET() {
  try {
    const sessionUser = parseUserFromRequest();

    if (sessionUser) {
      return noStoreJson({
        authenticated: true,
        email: sessionUser.email,
        via: "gmail-session",
      });
    }

    // Not logged in
    return noStoreJson({ authenticated: false });
  } catch (e: any) {
    return noStoreJson({
      authenticated: false,
      error: String(e?.message || e),
    });
  }
}
