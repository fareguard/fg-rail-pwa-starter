// app/(app)/dashboard/summary/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin"; // ⬅️ correct helper

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const db = getSupabaseAdmin();
  const { count, error } = await db.from("claims").select("*", { count: "exact", head: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, claims: count ?? 0 });
}
