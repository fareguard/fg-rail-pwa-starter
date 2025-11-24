// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

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
    const supabase = getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return noStoreJson({ authenticated: false });
    }

    return noStoreJson({
      authenticated: true,
      email: user.email,
      userId: user.id,
      via: "supabase",
    });
  } catch (e: any) {
    return noStoreJson({
      authenticated: false,
      error: String(e?.message || e),
    });
  }
}
