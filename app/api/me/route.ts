// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function jsonNoStore(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}

export async function GET() {
  try {
    const supabase = getSupabaseServer();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) return jsonNoStore({ authenticated: false, error: error.message });
    if (!user) return jsonNoStore({ authenticated: false });

    return jsonNoStore({
      authenticated: true,
      email: user.email,
      userId: user.id,
    });
  } catch (e: any) {
    return jsonNoStore({ authenticated: false, error: String(e?.message || e) });
  }
}
