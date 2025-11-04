// app/api/trips/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const db = getSupabaseServer();
    const { data: auth } = await db.auth.getUser();
    const email = auth?.user?.email ?? null;

    if (!email) return NextResponse.json({ trips: [] }, { status: 200 });

    const { data, error } = await db
      .from("trips")
      .select(
        "id, origin, destination, operator, retailer, booking_ref, depart_planned, arrive_planned, is_ticket, status, created_at"
      )
      .eq("user_email", email)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ trips: [] }, { status: 200 });

    return NextResponse.json({ trips: data ?? [] }, { status: 200 });
  } catch {
    return NextResponse.json({ trips: [] }, { status: 200 });
  }
}
