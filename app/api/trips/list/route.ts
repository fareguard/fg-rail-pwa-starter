// app/api/trips/list/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supa = getSupabaseServer();
  const { data: auth } = await supa.auth.getUser();
  const email = auth?.user?.email || null;
  if (!email) return NextResponse.json({ ok:true, authenticated:false, trips:[] });

  const { data, error } = await supa
  .from("trips")
  .select(
    [
      "id",
      "origin",
      "destination",
      "booking_ref",
      "operator",
      "retailer",
      "depart_planned",
      "arrive_planned",
      "status",
      "is_ticket",
      "created_at",
    ].join(",")
  )
  .eq("user_email", email)
  .is("is_ticket", true)                       // <- NEW filter
  .order("depart_planned", { ascending: false })
  .order("created_at", { ascending: false })   // tiebreaker
  .limit(50);

  if (error) return NextResponse.json({ ok:false, error:error.message, trips:[] }, { status:500 });
  return NextResponse.json({ ok:true, authenticated:true, trips: data ?? [] });
}
