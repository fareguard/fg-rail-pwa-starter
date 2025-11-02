// app/api/trips/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const db = getSupabaseAdmin();
    const body = await req.json();

    const {
      user_email,
      operator,
      retailer = null,
      origin,
      destination,
      booking_ref = null,
      depart_planned,
      arrive_planned,
    } = body || {};

    if (!user_email || !origin || !destination) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }

    const { data: ins, error } = await db
      .from("trips")
      .insert({
        user_email,
        operator,
        retailer,
        origin,
        destination,
        booking_ref,
        depart_planned,
        arrive_planned,
        status: "new",
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, trip_id: ins.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}