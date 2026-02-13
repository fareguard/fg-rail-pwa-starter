// app/api/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireSessionEmailFromCookies } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const supa = getSupabaseAdmin();

    const email = await requireSessionEmailFromCookies(supa, {
      user_agent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for"), // Vercel will set this (may be a list)
    });

    if (!email) {
      return noStoreJson({ authenticated: false });
    }

    return noStoreJson({
      authenticated: true,
      email,
      via: "gmail-session",
    });
  } catch (e: any) {
    return noStoreJson({ authenticated: false, error: String(e?.message || e) });
  }
}
