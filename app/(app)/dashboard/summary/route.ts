import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = getSupabaseAdmin();
  const [{ count: trips }, { count: eligible }, { count: pending }] = await Promise.all([
    s.from("trips").select("*", { count: "exact", head: true }),
    s.from("trips").select("*", { count: "exact", head: true }).eq("eligible", true),
    s.from("claims").select("*", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return NextResponse.json({ ok:true, trips, eligible, pending });
}
