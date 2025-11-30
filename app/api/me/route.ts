// app/api/me/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, decodeSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET() {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
    const session = decodeSession(token);

    if (!session?.email) {
      return noStoreJson({ authenticated: false });
    }

    return noStoreJson({
      authenticated: true,
      email: session.email,
      via: "gmail-session",
    });
  } catch (e: any) {
    return noStoreJson({ authenticated: false, error: String(e?.message || e) });
  }
}
