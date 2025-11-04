// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const db = getSupabaseServer();
    const { data, error } = await db.auth.getUser();
    if (error) return NextResponse.json({ email: null }, { status: 200 });

    const email = data?.user?.email ?? null;
    return NextResponse.json({ email }, { status: 200 });
  } catch {
    return NextResponse.json({ email: null }, { status: 200 });
  }
}
