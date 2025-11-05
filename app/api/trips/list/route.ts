// app/api/trips/list/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const supa = getSupabaseServer();
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser();

    if (authErr || !user?.email) {
      return NextResponse.json(
        { ok: true, authenticated: false, trips: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Pull the user's trips (adjust columns if your schema differs)
    const { data, error } = await supa
      .from("trips")
      .select(
        "id, user_email, operator, retailer, origin, destination, booking_ref, depart_planned, arrive_planned, status, delay_minutes, created_at, potential_refund"
      )
      .eq("user_email", user.email)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, trips: [] },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Map to a UI-friendly shape
    const trips = (data || []).map((t) => {
      // Friendly status text
      let friendly: string = "Not delayed";
      if (t.status === "queued") friendly = "Queued";
      if (t.status === "pending") friendly = "Pending";
      if (t.status === "delayed" || typeof t.delay_minutes === "number")
        friendly =
          typeof t.delay_minutes === "number"
            ? `Delayed by ${t.delay_minutes} min`
            : "Delayed";
      if (t.status === "submitted") friendly = "Submitted";

      return {
        id: t.id,
        title:
          t.origin && t.destination
            ? `${t.origin} → ${t.destination}`
            : t.operator || "Train journey",
        operator: t.operator || null,
        retailer: t.retailer || null,
        booking_ref: t.booking_ref || null,
        depart_planned: t.depart_planned || null,
        arrive_planned: t.arrive_planned || null,
        status: t.status || null,
        status_text: friendly,
        delay_minutes: t.delay_minutes ?? null,
        potential_refund: t.potential_refund ?? null,
        created_at: t.created_at,
      };
    });

    return NextResponse.json(
      { ok: true, authenticated: true, trips },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, trips: [], error: String(e?.message || e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
